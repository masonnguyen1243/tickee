import { randomInt, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  CHECKIN_LOOKUP_RATE_LIMITS,
  CheckinLookupRateLimitedDetails,
  CheckinLookupResult,
  CreatedCheckerInvite,
  ErrorResponse,
  IDEMPOTENCY_KEY_HEADER,
  JobQueue,
  Role,
  ScanResult,
  toEventIso,
  type BuyerTicket,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PURGE_LOOKUP_ATTEMPTS_CRON,
  purgeCheckinLookupAttempts,
} from '../../src/modules/checkin/lookup-attempts-jobs.js';
import { TICKET_CANCEL_REASON } from '../../src/modules/ticketing/schema.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { databaseUrl, migrationDatabaseUrl, workerConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type SaleEvent,
  type User,
} from '../ordering/order-fixtures.js';

/*
 * Story 5.5: tra tay (`POST /v1/checkin/events/:eventId/lookups`) và check-in tay (`POST …/tickets/:ticketId/check-in`,
 * `Idempotency-Key`) trên Postgres thật. Vé lấy từ Đơn 0đ (`markPaid` nguồn `free`); mỗi test dùng SĐT ngẫu nhiên riêng để
 * không khớp Đơn của test khác. Sự kiện chính có hai CTV `active`; BTC có Owner và Admin. Bộ đếm tra tay và bộ đếm tạo Đơn
 * được xóa trước mỗi test. Tín hiệu realtime đọc bằng kết nối `LISTEN` riêng. Ca song song giữ khóa dòng Vé bằng một kết
 * nối riêng tới khi mọi request đang chờ khóa (như `scan.test.ts`).
 */

const TIER = 'Vé tham dự';
const BUYER_NAME = 'Nguyễn Văn Minh';

let h: Harness;
let org: Org;
let admin: User;
let ctv: User;
let ctv2: User;
let main: SaleEvent;
let listener: pg.Client;
/** Mọi tín hiệu realtime đã commit. */
const signals: Record<string, unknown>[] = [];

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Pickleball Sóng Xanh' });
  admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  main = await freeEvent();
  ctv = await checkerOf(main);
  ctv2 = await checkerOf(main);
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => signals.push(JSON.parse(message.payload ?? '{}') as Record<string, unknown>));
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
  await resetLookupLimit();
});
afterAll(async () => {
  await listener.end();
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const resetLookupLimit = () => h.db.orm.execute(sql`DELETE FROM checkin_lookup_attempts`);

/** Sự kiện 0đ đã mở bán của BTC `owner` (mặc định BTC chính). */
const freeEvent = (owner: Org = org) => eventOnSale(owner, [{ name: TIER, price: 0, capacity: 100 }]);

/** Tài khoản mới nhận lời mời CTV của Sự kiện (Owner tạo link mới). */
async function checkerOf(sale: SaleEvent, owner: Org = org): Promise<User> {
  const created = await signUp(h);
  const res = await h.http
    .post(`/v1/orgs/${owner.orgId}/events/${sale.event.id}/checker-invite`)
    .set('cookie', owner.owner.cookie)
    .expect(201);
  const { token } = CreatedCheckerInvite.parse(res.body);
  await h.http.post('/v1/checkin/invites/accept').set('cookie', created.cookie).send({ token }).expect(200);
  return created;
}

/** SĐT di động ngẫu nhiên theo cách Người mua hay gõ (`09xx xxx xxx`) và dạng E.164 lưu trên Đơn. */
function newPhone(): { typed: string; local: string; e164: string } {
  const digits = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const local = `09${digits}`;
  return { typed: `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`, local, e164: `+849${digits}` };
}

/** Người mua `buyer` (mặc định tài khoản mới) đặt `quantity` Vé 0đ của Sự kiện `sale` với SĐT `phone`. */
async function issue(
  sale: SaleEvent,
  phone: string,
  quantity = 1,
  buyer?: User,
): Promise<{ buyer: User; code: string; tickets: BuyerTicket[] }> {
  const account = buyer ?? (await signUp(h));
  const body = orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }], { buyer: { name: BUYER_NAME, phone } });
  const res = await postOrder(h, account, sale.event.slug, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  expect(order.tickets).toHaveLength(quantity);
  return { buyer: account, code: order.code, tickets: order.tickets };
}

const lookupPath = (eventId: string) => `/v1/checkin/events/${eventId}/lookups`;
const checkInPath = (eventId: string, ticketId: string) => `/v1/checkin/events/${eventId}/tickets/${ticketId}/check-in`;

type Caller = User | Org['owner'];

/** Tra `query` ở Sự kiện `eventId` bằng `caller`. */
const lookup = (eventId: string, caller: Caller, query: unknown) =>
  h.http.post(lookupPath(eventId)).set('cookie', caller.cookie).send({ query });

/** Tra và đòi `200`: trả `CheckinLookupResult` đã kiểm schema. */
async function lookupOk(eventId: string, caller: Caller, query: string): Promise<CheckinLookupResult> {
  const res = await lookup(eventId, caller, query);
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return CheckinLookupResult.parse(res.body);
}

/** Check-in tay Vé `ticketId` ở Sự kiện `eventId` bằng `caller` với khóa `key` (`null` = không gửi header). */
function checkIn(eventId: string, caller: Caller, ticketId: string, key: string | null = randomUUID()) {
  const req = h.http.post(checkInPath(eventId, ticketId)).set('cookie', caller.cookie);
  return key === null ? req : req.set(IDEMPOTENCY_KEY_HEADER, key);
}

/** Check-in tay và đòi `200`: trả `ScanResult` đã kiểm schema. */
async function checkInOk(eventId: string, caller: Caller, ticketId: string, key?: string): Promise<ScanResult> {
  const res = await checkIn(eventId, caller, ticketId, key);
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return ScanResult.parse(res.body);
}

interface TicketRow {
  checked_in_at: Date | null;
  checked_in_by: string | null;
  checkin_scan_id: string | null;
  updated_at: Date;
}

async function ticketRow(id: string): Promise<TicketRow> {
  const { rows } = await h.db.pool.query<TicketRow>(
    'SELECT checked_in_at, checked_in_by, checkin_scan_id, updated_at FROM tickets WHERE id = $1',
    [id],
  );
  return rows[0]!;
}

const NOT_CHECKED_IN = { checked_in_at: null, checked_in_by: null, checkin_scan_id: null };

/** Số lượt tra đã đếm (mọi tài khoản và IP). */
async function attempts(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM checkin_lookup_attempts');
  return rows[0]!.n;
}

const checkinSignals = (eventId: string) =>
  signals.filter((s) => s.type === 'event_checkins_changed' && s.eventId === eventId);

/** Chờ tín hiệu tới (NOTIFY gửi lúc commit, tới kết nối LISTEN không đồng bộ) rồi đòi đúng `expected` tín hiệu. */
async function signalsSettled(eventId: string, expected: number): Promise<void> {
  await expect.poll(() => checkinSignals(eventId).length, { timeout: 5_000, interval: 50 }).toBe(expected);
  await sleep(150);
  expect(checkinSignals(eventId)).toHaveLength(expected);
}

const rowOf = (ticket: BuyerTicket, checkedIn = false) => ({
  ticketId: ticket.id,
  holderName: BUYER_NAME,
  ticketTypeName: TIER,
  seq: ticket.seq,
  count: ticket.count,
  checkedIn,
});

const okOf = (ticket: BuyerTicket) => ({
  outcome: 'ok',
  holderName: BUYER_NAME,
  seq: ticket.seq,
  count: ticket.count,
  ticketTypeName: TIER,
});

/** Mọi cách viết SĐT để kiểm response/log không lộ. */
const phoneForms = (phone: ReturnType<typeof newPhone>) => [phone.typed, phone.local, phone.e164, phone.e164.slice(1)];

/** Body của response không chứa Mã QR vé, SĐT hay email. */
function expectPrivate(text: string, secrets: { tickets?: BuyerTicket[]; phones?: string[]; emails?: string[] }) {
  for (const ticket of secrets.tickets ?? []) expect(text).not.toContain(ticket.qr);
  for (const phone of secrets.phones ?? []) expect(text).not.toContain(phone);
  for (const email of secrets.emails ?? []) expect(text.toLowerCase()).not.toContain(email.toLowerCase());
  expect(text).not.toContain('@');
}

/** Số request của app đang chờ khóa ở câu SQL khớp `query` (ILIKE) trên bảng `tickets`. */
async function waitingOnLock(query: string): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'tickee-api' AND wait_event_type = 'Lock'
        AND query ILIKE $1`,
    [query],
  );
  return rows[0]!.n;
}

/**
 * Giữ khóa dòng Vé (`FOR UPDATE`) trong transaction của một kết nối riêng, gửi các request, COMMIT khi cả N request đang
 * chờ ở câu UPDATE check-in: chúng thật sự tranh nhau cùng một dòng. Trả response theo thứ tự gửi.
 */
async function whileTicketLocked<T>(ticketId: string, send: () => PromiseLike<T>[]): Promise<T[]> {
  const locker = new pg.Client({ connectionString: databaseUrl() });
  await locker.connect();
  let pending: Promise<T[]> | undefined;
  try {
    await locker.query('BEGIN');
    await locker.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    const requests = send();
    pending = Promise.all(requests);
    await expect
      .poll(() => waitingOnLock('update "tickets"%'), { timeout: 15_000, interval: 50 })
      .toBe(requests.length);
    await locker.query('COMMIT');
    return await pending;
  } catch (err) {
    await locker.query('ROLLBACK').catch(() => undefined);
    await pending?.catch(() => undefined);
    throw err;
  } finally {
    await locker.end();
  }
}

describe('POST /v1/checkin/events/:eventId/lookups', () => {
  it('tra theo SĐT gõ có khoảng trắng: Đơn E.164 có 2 Vé hợp lệ (1 đã check-in) → 2 hàng theo seq, hàng đã check-in checkedIn true; chỉ bản chụp trên Vé', async () => {
    const phone = newPhone();
    const { buyer, tickets } = await issue(main, phone.typed, 2);
    await checkInOk(main.event.id, ctv, tickets[1]!.id);

    const res = await lookup(main.event.id, ctv, phone.typed);
    expect(res.status, res.text).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ tickets: [rowOf(tickets[0]!), rowOf(tickets[1]!, true)] });
    for (const row of (res.body as CheckinLookupResult).tickets) {
      expect(Object.keys(row).sort()).toEqual(['checkedIn', 'count', 'holderName', 'seq', 'ticketId', 'ticketTypeName']);
    }
    expectPrivate(res.text, { tickets, phones: phoneForms(phone), emails: [buyer.email] });

    // Mọi cách gõ cùng số đều khớp đầy đủ.
    for (const query of [phone.local, phone.e164, `+84 ${phone.local.slice(1)}`, `${phone.local.slice(0, 4)}.${phone.local.slice(4)}`]) {
      expect((await lookupOk(main.event.id, ctv, query)).tickets.map((t) => t.ticketId), query).toEqual(
        tickets.map((t) => t.id),
      );
    }
  });

  it('nhiều Đơn cùng SĐT (hai Người mua): mọi Vé hợp lệ, sắp theo mã Đơn rồi seq', async () => {
    const phone = newPhone();
    const first = await issue(main, phone.typed, 2);
    const second = await issue(main, phone.local, 1);
    const result = await lookupOk(main.event.id, ctv, phone.e164);
    const byCode = [first, second].sort((a, b) => a.code.localeCompare(b.code));
    expect(result.tickets).toEqual(byCode.flatMap((order) => order.tickets.map((t) => rowOf(t))));
  });

  it('tra theo email: trim + chữ thường khớp email lúc đặt; Đơn lưu email chưa viết thường (đường Google) vẫn khớp', async () => {
    const phone = newPhone();
    const { buyer, tickets } = await issue(main, phone.typed, 1);
    const query = `  ${buyer.email.toUpperCase()} `;
    const result = await lookupOk(main.event.id, ctv, query);
    expect(result.tickets).toEqual([rowOf(tickets[0]!)]);

    // Bản chụp email trên Đơn chỉ đổi được bằng role migrator (cột bất biến với `tickee_app`).
    const migrator = new pg.Client({ connectionString: migrationDatabaseUrl() });
    await migrator.connect();
    try {
      const mixed = `Minh.${randomUUID()}@Gmail.COM`;
      const other = await issue(main, newPhone().typed, 1);
      await migrator.query('UPDATE orders SET buyer_email = $1 WHERE code = $2', [mixed, other.code]);
      const res = await lookup(main.event.id, ctv, mixed.toLowerCase());
      expect(res.status, res.text).toBe(200);
      expect(CheckinLookupResult.parse(res.body).tickets).toEqual([rowOf(other.tickets[0]!)]);
      expectPrivate(res.text, { tickets: other.tickets, emails: [mixed] });
    } finally {
      await migrator.end();
    }
  });

  it('khớp một phần, theo tên hay sai dạng → 400 VALIDATION_FAILED (no-store, không lặp lại giá trị), không tính lượt', async () => {
    const phone = newPhone();
    const { buyer } = await issue(main, phone.typed, 1);
    const partials = [
      phone.local.slice(0, 7),
      phone.local.slice(-4),
      buyer.email.slice(0, buyer.email.indexOf('@') + 1),
      `@${buyer.email.split('@')[1]}`,
      BUYER_NAME,
      '',
      'x'.repeat(255),
    ];
    for (const query of partials) {
      const res = await lookup(main.event.id, ctv, query);
      expect(res.status, query).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
      expect(res.headers['cache-control']).toBe('no-store');
      if (query.length > 0) expect(res.text, query).not.toContain(query);
    }
    for (const body of [{}, { query: 42 }, { query: null }, []]) {
      const res = await h.http.post(lookupPath(main.event.id)).set('cookie', ctv.cookie).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    }
    expect(await attempts()).toBe(0);
  });

  it('Đơn của Sự kiện khác (cùng BTC hoặc BTC khác) cùng SĐT → không có trong kết quả', async () => {
    const phone = newPhone();
    const sameOrg = await freeEvent();
    const orgB = await paidReadyOrg(h, { name: 'CLB Bơi Lội' });
    const otherOrg = await freeEvent(orgB);
    await issue(sameOrg, phone.typed, 1);
    await issue(otherOrg, phone.typed, 1);
    expect(await lookupOk(main.event.id, ctv, phone.typed)).toEqual({ tickets: [] });

    const own = await issue(main, phone.typed, 1);
    expect(await lookupOk(main.event.id, ctv, phone.typed)).toEqual({ tickets: [rowOf(own.tickets[0]!)] });
    // Owner BTC khác không tra được Sự kiện này (403), dù SĐT có Đơn ở Sự kiện của mình.
    const cross = await lookup(main.event.id, orgB.owner, phone.typed);
    expect(cross.status).toBe(403);
    expect(errorOf(cross.body).code).toBe('NOT_A_MEMBER');
  });

  it('Vé đã hủy hoặc bị vô hiệu (kể cả đã check-in) không hiện; Đơn chỉ còn Vé hủy → tickets rỗng', async () => {
    const phone = newPhone();
    const { tickets } = await issue(main, phone.typed, 3);
    await checkInOk(main.event.id, ctv, tickets[2]!.id);
    const cancel = (ticketId: string, reason: string) =>
      h.db.orm.execute(sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${reason} WHERE id = ${ticketId}`);
    await cancel(tickets[0]!.id, TICKET_CANCEL_REASON.VOIDED);
    await cancel(tickets[2]!.id, TICKET_CANCEL_REASON.EVENT_CANCELLED);
    expect(await lookupOk(main.event.id, ctv, phone.typed)).toEqual({ tickets: [rowOf(tickets[1]!)] });
    await cancel(tickets[1]!.id, TICKET_CANCEL_REASON.VOIDED);
    expect(await lookupOk(main.event.id, ctv, phone.typed)).toEqual({ tickets: [] });
  });

  it('không có Đơn khớp → tickets rỗng, vẫn tính một lượt', async () => {
    expect(await lookupOk(main.event.id, ctv, newPhone().typed)).toEqual({ tickets: [] });
    expect(await lookupOk(main.event.id, ctv, `khong-co-${randomUUID()}@vidu.vn`)).toEqual({ tickets: [] });
    expect(await attempts()).toBe(2);
  });

  it('Owner và Admin của BTC tra được không cần lời mời', async () => {
    const phone = newPhone();
    const { tickets } = await issue(main, phone.typed, 1);
    for (const caller of [org.owner, admin]) {
      expect(await lookupOk(main.event.id, caller, phone.typed)).toEqual({ tickets: [rowOf(tickets[0]!)] });
    }
  });
});

describe('giới hạn tốc độ tra tay (AD-31)', () => {
  const { windowSeconds, perUser, perIp } = CHECKIN_LOOKUP_RATE_LIMITS;

  it(`quá ${perUser} lần/${windowSeconds / 60} phút theo tài khoản → 429 CHECKIN_LOOKUP_RATE_LIMITED {retryAfterSeconds}; không đếm thêm; tài khoản khác cùng IP vẫn tra được`, async () => {
    const phone = newPhone();
    await lookupOk(main.event.id, ctv, phone.typed);
    const { rows } = await h.db.pool.query<{ ip_hmac: string; user_id: string }>(
      'SELECT ip_hmac, user_id FROM checkin_lookup_attempts',
    );
    expect(rows).toEqual([{ ip_hmac: expect.stringMatching(/^[0-9a-f]{64}$/), user_id: ctv.userId }]);
    // Bảng chỉ có HMAC của IP, không IP thô, không giá trị đã tra.
    expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
    // 1 lượt thật + 58 dòng = 59 < 60: lượt thứ 60 vẫn qua.
    await h.db.orm.execute(sql`
      INSERT INTO checkin_lookup_attempts (user_id, ip_hmac)
      SELECT ${ctv.userId}, 'khac-ip' FROM generate_series(1, ${perUser - 2})`);
    await lookupOk(main.event.id, ctv, phone.typed);
    expect(await attempts()).toBe(perUser);

    const res = await lookup(main.event.id, ctv, phone.typed);
    expect(res.status).toBe(429);
    expect(res.headers['cache-control']).toBe('no-store');
    const error = errorOf(res.body);
    expect(error.code).toBe('CHECKIN_LOOKUP_RATE_LIMITED');
    const { retryAfterSeconds } = CheckinLookupRateLimitedDetails.parse(error.details);
    expect(retryAfterSeconds).toBeGreaterThan(windowSeconds - 10);
    expect(retryAfterSeconds).toBeLessThanOrEqual(windowSeconds);
    expect(Object.keys(error.details as object)).toEqual(['retryAfterSeconds']);
    for (const form of phoneForms(phone)) expect(res.text).not.toContain(form);
    expect(await attempts()).toBe(perUser);

    // Sai dạng vẫn là 400 (kiểm trước bộ đếm), không 429.
    expect((await lookup(main.event.id, ctv, '0912')).status).toBe(400);
    // CTV khác cùng IP vẫn tra được; check-in tay không bị giới hạn.
    await lookupOk(main.event.id, ctv2, phone.typed);
    const { tickets } = await issue(main, newPhone().typed, 1);
    expect(await checkInOk(main.event.id, ctv, tickets[0]!.id)).toEqual(okOf(tickets[0]!));
  });

  it(`song song cùng tài khoản (khóa theo tài khoản): còn 1 lượt, 3 lần tra cùng lúc → đúng một 200, hai 429; đếm đúng ${perUser}`, async () => {
    await h.db.orm.execute(sql`
      INSERT INTO checkin_lookup_attempts (user_id, ip_hmac)
      SELECT ${ctv.userId}, 'khac-ip' FROM generate_series(1, ${perUser - 1})`);
    const phone = newPhone();
    const responses = await Promise.all([1, 2, 3].map(() => lookup(main.event.id, ctv, phone.typed)));
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 429, 429]);
    for (const res of responses.filter((r) => r.status === 429)) {
      expect(errorOf(res.body).code).toBe('CHECKIN_LOOKUP_RATE_LIMITED');
    }
    expect(await attempts()).toBe(perUser);
  });

  it('lượt cũ hơn cửa sổ không tính', async () => {
    await h.db.orm.execute(sql`
      INSERT INTO checkin_lookup_attempts (user_id, ip_hmac, created_at)
      SELECT ${ctv.userId}, 'khac-ip', now() - make_interval(secs => ${windowSeconds + 1}) FROM generate_series(1, ${perUser})`);
    await lookupOk(main.event.id, ctv, newPhone().typed);
  });

  it(`quá ${perIp} lần/${windowSeconds / 60} phút theo IP (WiFi sự kiện, CGNAT) → 429 cho cả tài khoản mới; ${perIp - 1} thì vẫn qua`, async () => {
    const phone = newPhone();
    await lookupOk(main.event.id, ctv, phone.typed);
    const { rows } = await h.db.pool.query<{ ip_hmac: string }>('SELECT ip_hmac FROM checkin_lookup_attempts LIMIT 1');
    const ipHmac = rows[0]!.ip_hmac;
    // 1 lượt thật + 598 dòng của nhiều tài khoản = 599 < 600: lượt thứ 600 (tài khoản khác) vẫn qua.
    await h.db.orm.execute(sql`
      INSERT INTO checkin_lookup_attempts (user_id, ip_hmac)
      SELECT uuidv7(), ${ipHmac} FROM generate_series(1, ${perIp - 2})`);
    await lookupOk(main.event.id, ctv2, phone.typed);
    for (const caller of [org.owner, admin]) {
      const res = await lookup(main.event.id, caller, phone.typed);
      expect(res.status).toBe(429);
      const error = errorOf(res.body);
      expect(error.code).toBe('CHECKIN_LOOKUP_RATE_LIMITED');
      expect(CheckinLookupRateLimitedDetails.parse(error.details).retryAfterSeconds).toBeLessThanOrEqual(windowSeconds);
    }
    expect(await attempts()).toBe(perIp);
  });
});

describe('POST /v1/checkin/events/:eventId/tickets/:ticketId/check-in', () => {
  it('Vé hợp lệ, khóa mới → 200 ok (bản chụp trên Vé); checked_in_by = người bấm, checkin_scan_id = khóa; phát event_checkins_changed; tra lại thấy đã check-in', async () => {
    const phone = newPhone();
    const { buyer, tickets } = await issue(main, phone.typed, 2);
    const key = randomUUID();
    const signalCount = checkinSignals(main.event.id).length;

    const res = await checkIn(main.event.id, ctv, tickets[1]!.id, key);
    expect(res.status, res.text).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual(okOf(tickets[1]!));
    expectPrivate(res.text, { tickets, phones: phoneForms(phone), emails: [buyer.email] });

    const row = await ticketRow(tickets[1]!.id);
    expect(row).toMatchObject({ checked_in_by: ctv.userId, checkin_scan_id: key });
    expect(row.checked_in_at).toBeInstanceOf(Date);
    expect(await ticketRow(tickets[0]!.id)).toMatchObject(NOT_CHECKED_IN);
    await signalsSettled(main.event.id, signalCount + 1);
    expect(checkinSignals(main.event.id).at(-1)).toEqual({
      type: 'event_checkins_changed',
      id: main.event.id,
      organizationId: org.orgId,
      eventId: main.event.id,
    });
    expect(await lookupOk(main.event.id, ctv2, phone.typed)).toEqual({
      tickets: [rowOf(tickets[0]!), rowOf(tickets[1]!, true)],
    });
  });

  it('gửi lại cùng khóa (kể cả chữ hoa) → ok như lần đầu; không ghi gì, không phát thêm tín hiệu', async () => {
    const { tickets } = await issue(main, newPhone().typed, 1);
    const ticket = tickets[0]!;
    const key = randomUUID();
    const signalCount = checkinSignals(main.event.id).length;
    const first = await checkInOk(main.event.id, ctv, ticket.id, key);
    expect(first).toEqual(okOf(ticket));
    const before = await ticketRow(ticket.id);
    await signalsSettled(main.event.id, signalCount + 1);

    for (const k of [key, key.toUpperCase()]) expect(await checkInOk(main.event.id, ctv, ticket.id, k)).toEqual(first);
    // Id Vé chữ hoa vẫn là cùng Vé.
    expect(await checkInOk(main.event.id, ctv, ticket.id.toUpperCase(), key)).toEqual(first);
    expect(await ticketRow(ticket.id)).toEqual(before);
    await signalsSettled(main.event.id, signalCount + 1);
  });

  it('gửi lại cùng khóa sau khi Sự kiện đóng → ok như lần đầu; khóa mới → invalid EVENT_ENDED', async () => {
    const sale = await freeEvent();
    const { tickets } = await issue(sale, newPhone().typed, 2);
    const key = randomUUID();
    const first = await checkInOk(sale.event.id, org.owner, tickets[0]!.id, key);
    expect(first).toEqual(okOf(tickets[0]!));
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${sale.event.id}`);
    expect(await checkInOk(sale.event.id, org.owner, tickets[0]!.id, key)).toEqual(first);
    expect(await checkInOk(sale.event.id, org.owner, tickets[0]!.id)).toEqual({ outcome: 'invalid', reason: 'EVENT_ENDED' });
    expect(await checkInOk(sale.event.id, org.owner, tickets[1]!.id)).toEqual({ outcome: 'invalid', reason: 'EVENT_ENDED' });
    expect(await ticketRow(tickets[1]!.id)).toMatchObject(NOT_CHECKED_IN);
  });

  it('người khác đã check-in (hàng cũ trên Sheet) → already kèm lúc và người; cùng người, khóa mới, chưa tới 60 giây → recent', async () => {
    const { tickets } = await issue(main, newPhone().typed, 1);
    const ticket = tickets[0]!;
    await checkInOk(main.event.id, ctv, ticket.id);
    const row = await ticketRow(ticket.id);
    expect(await checkInOk(main.event.id, ctv2, ticket.id)).toEqual({
      outcome: 'already',
      checkedInAt: toEventIso(row.checked_in_at!),
      checkedBy: { kind: 'role', role: 'checker' },
    });
    expect(await checkInOk(main.event.id, ctv, ticket.id)).toEqual({ outcome: 'recent' });
    expect(await ticketRow(ticket.id)).toEqual(row);
  });

  it('Owner và Admin check-in tay không cần lời mời; checked_in_by là người bấm', async () => {
    const { tickets } = await issue(main, newPhone().typed, 2);
    expect(await checkInOk(main.event.id, org.owner, tickets[0]!.id)).toEqual(okOf(tickets[0]!));
    expect(await checkInOk(main.event.id, admin, tickets[1]!.id)).toEqual(okOf(tickets[1]!));
    expect((await ticketRow(tickets[0]!.id)).checked_in_by).toBe(org.owner.userId);
    expect((await ticketRow(tickets[1]!.id)).checked_in_by).toBe(admin.userId);
  });

  it('Vé không có → invalid BAD_SIGNATURE; Vé của Sự kiện khác → invalid OTHER_EVENT; không ghi gì', async () => {
    const other = await freeEvent();
    const { tickets } = await issue(other, newPhone().typed, 1);
    expect(await checkInOk(main.event.id, ctv, randomUUID())).toEqual({ outcome: 'invalid', reason: 'BAD_SIGNATURE' });
    expect(await checkInOk(main.event.id, ctv, tickets[0]!.id)).toEqual({ outcome: 'invalid', reason: 'OTHER_EVENT' });
    expect(await ticketRow(tickets[0]!.id)).toMatchObject(NOT_CHECKED_IN);
  });

  it('Idempotency-Key thiếu hoặc không phải uuid, ticketId không phải uuid → 400 VALIDATION_FAILED (no-store); không ghi gì', async () => {
    const { tickets } = await issue(main, newPhone().typed, 1);
    const ticket = tickets[0]!;
    const cases: [string, string | null][] = [
      [ticket.id, null],
      [ticket.id, 'khong-phai-uuid'],
      [ticket.id, ''],
      ['khong-phai-uuid', randomUUID()],
    ];
    for (const [ticketId, key] of cases) {
      const res = await checkIn(main.event.id, ctv, ticketId, key);
      expect(res.status, `${ticketId} ${key}`).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(await ticketRow(ticket.id)).toMatchObject(NOT_CHECKED_IN);
  });
});

describe('quyền: tra tay và check-in tay', () => {
  it('CTV Sự kiện khác, người lạ, Owner BTC khác → 403 NOT_A_MEMBER; CTV bị thu hồi → 403 CHECKER_REVOKED; chưa đăng nhập → 401; không ghi gì, không đếm', async () => {
    const other = await freeEvent();
    const ctvOther = await checkerOf(other);
    const stranger = await signUp(h);
    const orgB = await paidReadyOrg(h, { name: 'CLB Bóng Bàn' });
    const revoked = await checkerOf(main);
    await h.db.orm.execute(
      sql`UPDATE checkers SET status = 'revoked', revoked_at = now(), revoked_by = ${org.owner.userId}
          WHERE event_id = ${main.event.id} AND user_id = ${revoked.userId}`,
    );
    const phone = newPhone();
    const { tickets } = await issue(main, phone.typed, 1);
    const cases: [Caller, string][] = [
      [ctvOther, 'NOT_A_MEMBER'],
      [stranger, 'NOT_A_MEMBER'],
      [orgB.owner, 'NOT_A_MEMBER'],
      [revoked, 'CHECKER_REVOKED'],
    ];
    for (const [caller, code] of cases) {
      for (const res of [await lookup(main.event.id, caller, phone.typed), await checkIn(main.event.id, caller, tickets[0]!.id)]) {
        expect(res.status, code).toBe(403);
        expect(errorOf(res.body).code).toBe(code);
        expect(res.text).not.toContain(BUYER_NAME);
      }
    }
    const anonymousLookup = await h.http.post(lookupPath(main.event.id)).send({ query: phone.typed });
    expect(anonymousLookup.status).toBe(401);
    const anonymousCheckIn = await h.http
      .post(checkInPath(main.event.id, tickets[0]!.id))
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID());
    expect(anonymousCheckIn.status).toBe(401);
    expect(await ticketRow(tickets[0]!.id)).toMatchObject(NOT_CHECKED_IN);
    expect(await attempts()).toBe(0);
  });
});

describe('check-in tay song song cùng một Vé (FR-28, AD-15)', () => {
  it('hai người, hai khóa khác nhau, cùng chờ khóa dòng Vé → đúng 1 ok, người kia already kèm checkedInAt của lượt đầu; đúng 1 tín hiệu', async () => {
    const { tickets } = await issue(main, newPhone().typed, 1);
    const ticket = tickets[0]!;
    const keys = [randomUUID(), randomUUID()];
    const callers = [ctv, ctv2];
    const signalCount = checkinSignals(main.event.id).length;

    const responses = await whileTicketLocked(ticket.id, () =>
      callers.map((caller, i) => checkIn(main.event.id, caller, ticket.id, keys[i]!)),
    );
    const results = responses.map((res) => {
      expect(res.status, res.text).toBe(200);
      return ScanResult.parse(res.body);
    });
    const winners = [...results.keys()].filter((i) => results[i]!.outcome === 'ok');
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    expect(results[winner]).toEqual(okOf(ticket));
    const row = await ticketRow(ticket.id);
    expect(row).toMatchObject({ checked_in_by: callers[winner]!.userId, checkin_scan_id: keys[winner] });
    expect(results[1 - winner]).toMatchObject({ outcome: 'already', checkedInAt: toEventIso(row.checked_in_at!) });
    await signalsSettled(main.event.id, signalCount + 1);
  });
});

describe('riêng tư', () => {
  it('log không chứa giá trị đã tra (SĐT, email), kể cả lần sai dạng và lần bị chặn', async () => {
    const phone = newPhone();
    const { buyer } = await issue(main, phone.typed, 1);
    const email = `  ${buyer.email.toUpperCase()}`;
    await lookupOk(main.event.id, ctv, phone.typed);
    await lookupOk(main.event.id, ctv, email);
    await lookup(main.event.id, ctv, phone.local.slice(0, 7));
    await h.db.orm.execute(sql`
      INSERT INTO checkin_lookup_attempts (user_id, ip_hmac)
      SELECT ${ctv.userId}, 'khac-ip' FROM generate_series(1, ${CHECKIN_LOOKUP_RATE_LIMITS.perUser})`);
    expect((await lookup(main.event.id, ctv, phone.typed)).status).toBe(429);
    const logs = h.logs.text;
    for (const form of [...phoneForms(phone), phone.local.slice(0, 7)]) expect(logs).not.toContain(form);
    expect(logs.toLowerCase()).not.toContain(buyer.email.toLowerCase());
  });
});

describe('dọn bộ đếm tra tay (job checkin.purge-lookup-attempts)', () => {
  const QUEUE = JobQueue.CHECKIN_PURGE_LOOKUP_ATTEMPTS;

  /** Một dòng cũ hơn cửa sổ (`cu`) và một dòng còn trong cửa sổ (`moi`), gắn `tag` riêng. */
  async function seed(): Promise<string> {
    const tag = randomUUID();
    const window = CHECKIN_LOOKUP_RATE_LIMITS.windowSeconds;
    await h.db.orm.execute(sql`
      INSERT INTO checkin_lookup_attempts (user_id, ip_hmac, created_at) VALUES
        (uuidv7(), ${`cu-${tag}`}, now() - make_interval(secs => ${window + 60})),
        (uuidv7(), ${`moi-${tag}`}, now() - make_interval(secs => ${window - 60}))`);
    return tag;
  }

  async function remaining(tag: string): Promise<string[]> {
    const { rows } = await h.db.pool.query<{ ip_hmac: string }>(
      'SELECT ip_hmac FROM checkin_lookup_attempts WHERE ip_hmac IN ($1, $2)',
      [`cu-${tag}`, `moi-${tag}`],
    );
    return rows.map((row) => row.ip_hmac.replace(`-${tag}`, ''));
  }

  it('purgeCheckinLookupAttempts: xóa lượt cũ hơn cửa sổ, giữ lượt trong cửa sổ; chạy lại không đổi gì', async () => {
    const tag = await seed();
    expect(await purgeCheckinLookupAttempts(h.db)).toBeGreaterThanOrEqual(1);
    expect(await remaining(tag)).toEqual(['moi']);
    expect(await purgeCheckinLookupAttempts(h.db)).toBe(0);
    expect(await remaining(tag)).toEqual(['moi']);
  });

  it('vai worker lên đúng một lịch mỗi 10 phút và xử lý job: lượt cũ bị xóa, lượt trong cửa sổ còn', async () => {
    const tag = await seed();
    const worker = await NestFactory.createApplicationContext(WorkerModule.forRoot(workerConfig()), { logger: false });
    await worker.init();
    try {
      const boss = worker.get<PgBoss>(BOSS);
      const schedules = await boss.getSchedules(QUEUE);
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({ name: QUEUE, cron: PURGE_LOOKUP_ATTEMPTS_CRON });
      const jobId = await boss.send(QUEUE, null);
      expect(jobId).toBeTruthy();
      await expect
        .poll(async () => (await boss.getJobById(QUEUE, jobId!))?.state, { timeout: 15_000, interval: 200 })
        .toBe('completed');
      expect(await remaining(tag)).toEqual(['moi']);
    } finally {
      // Không để lịch */10 sống trong DB test dùng chung.
      await worker.get<PgBoss>(BOSS).unschedule(QUEUE);
      await worker.close();
    }
  });
});
