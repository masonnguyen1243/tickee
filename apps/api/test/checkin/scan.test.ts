import { randomUUID } from 'node:crypto';
import { metrics, trace } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import {
  CheckinEvent,
  CreatedCheckerInvite,
  ErrorResponse,
  Role,
  ScanResult,
  toEventIso,
  type BuyerTicket,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKIN_SCAN_DURATION_METRIC, scanTicket } from '../../src/flows/index.js';
import { signTicketQr, TicketQrKeys } from '../../src/modules/ticketing/index.js';
import { TICKET_CANCEL_REASON } from '../../src/modules/ticketing/schema.js';
import type { EventAccessContext } from '../../src/platform/access/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { databaseUrl, TEST_TICKET_QR_KEYS } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  buyerInput,
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
 * Story 5.3-a: `POST /v1/checkin/events/:eventId/scans` (quét Mã QR vé, `ticketing.checkIn`, AD-15/AD-16) và số đếm của
 * `GET /v1/checkin/events/:eventId`, trên Postgres thật. Vé lấy từ Đơn 0đ (`markPaid` nguồn `free`). Sự kiện chính có hai
 * CTV `active`; BTC có Owner và Admin. Trạng thái Vé, Sự kiện, tên tài khoản và mốc check-in đặt bằng SQL (role
 * `tickee_app` ghi được các cột này). Tín hiệu realtime đọc bằng kết nối `LISTEN` riêng; span `checkin scan` và histogram
 * thời gian quét đọc bằng tracer/meter provider trong bộ nhớ (đăng ký toàn cục cho file này).
 *
 * Story 5.4: gửi lại cùng `scanId` sau khi Sự kiện đóng hay Vé bị hủy; quét song song cùng một Vé (FR-28) với khóa dòng
 * Vé giữ bằng một kết nối riêng tới khi mọi request đang chờ khóa, để chắc các request thật sự tranh nhau.
 */

class TestReader extends MetricReader {
  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const TIER = 'Vé tham dự';
const qrKeys = TicketQrKeys.parse(TEST_TICKET_QR_KEYS);
const reader = new TestReader();
const spans = new InMemorySpanExporter();

let h: Harness;
let org: Org;
let admin: User;
let ctv: User;
let ctv2: User;
let main: SaleEvent;
let listener: pg.Client;
/** Mọi tín hiệu realtime đã commit. */
const signals: Record<string, unknown>[] = [];
/** Email của mọi tài khoản trong file (Người mua, người quét). */
const emails: string[] = [];

beforeAll(async () => {
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }));
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Chạy Bộ Quận 1' });
  emails.push(org.owner.email);
  admin = await user();
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
});
afterAll(async () => {
  await listener.end();
  await h.close();
  metrics.disable();
  trace.disable();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function user(): Promise<User> {
  const created = await signUp(h);
  emails.push(created.email);
  return created;
}

/** Sự kiện 0đ đã mở bán của BTC `owner` (mặc định BTC chính). */
const freeEvent = (owner: Org = org) => eventOnSale(owner, [{ name: TIER, price: 0, capacity: 100 }]);

/** Tài khoản mới nhận lời mời CTV của Sự kiện (Owner tạo link mới). */
async function checkerOf(sale: SaleEvent, owner: Org = org): Promise<User> {
  const created = await user();
  const res = await h.http
    .post(`/v1/orgs/${owner.orgId}/events/${sale.event.id}/checker-invite`)
    .set('cookie', owner.owner.cookie)
    .expect(201);
  const { token } = CreatedCheckerInvite.parse(res.body);
  await h.http.post('/v1/checkin/invites/accept').set('cookie', created.cookie).send({ token }).expect(200);
  return created;
}

/** Người mua mới nhận `quantity` Vé 0đ của Sự kiện `sale`. */
async function issue(sale: SaleEvent, quantity = 1): Promise<BuyerTicket[]> {
  const buyer = await user();
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  expect(order.tickets).toHaveLength(quantity);
  return order.tickets;
}

const scanPath = (eventId: string) => `/v1/checkin/events/${eventId}/scans`;

/** Quét `code` ở Sự kiện `eventId` bằng `scanner`. */
const scan = (eventId: string, scanner: User | Org['owner'], code: string, scanId: string = randomUUID()) =>
  h.http.post(scanPath(eventId)).set('cookie', scanner.cookie).send({ code, scanId });

/** Quét và đòi `200`: trả `ScanResult` đã kiểm schema. */
async function scanOk(eventId: string, scanner: User | Org['owner'], code: string, scanId?: string): Promise<ScanResult> {
  const res = await scan(eventId, scanner, code, scanId);
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

const checkinSignals = (eventId: string) =>
  signals.filter((s) => s.type === 'event_checkins_changed' && s.eventId === eventId);

/** Chờ tín hiệu tới (NOTIFY gửi lúc commit, tới kết nối LISTEN không đồng bộ) rồi đòi đúng `expected` tín hiệu. */
async function signalsSettled(eventId: string, expected: number): Promise<void> {
  await expect.poll(() => checkinSignals(eventId).length, { timeout: 5_000, interval: 50 }).toBe(expected);
  await sleep(150);
  expect(checkinSignals(eventId)).toHaveLength(expected);
}

const okOf = (ticket: BuyerTicket) => ({
  outcome: 'ok',
  holderName: buyerInput.name,
  seq: ticket.seq,
  count: ticket.count,
  ticketTypeName: TIER,
});

const invalid = (reason: string) => ({ outcome: 'invalid', reason });

/** Đặt mốc check-in của Vé về trước chừng này giây (giả lập thời gian trôi). */
const backdateCheckin = (ticketId: string, seconds: number) =>
  h.db.orm.execute(
    sql`UPDATE tickets SET checked_in_at = checked_in_at - make_interval(secs => ${seconds}) WHERE id = ${ticketId}`,
  );

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

/** Câu UPDATE check-in của `ticketing.checkIn`. */
const TICKET_UPDATE = 'update "tickets"%';
/** Câu đọc Vé `FOR SHARE` của `replayOf` (nhánh Sự kiện đóng). */
const TICKET_REPLAY_READ = 'select %from "tickets"%for share';

/**
 * Chạy `lock` (giữ khóa dòng Vé) trong transaction của một kết nối riêng (ngoài pool của app, `max: 10`), gửi các request,
 * COMMIT khi cả N request đang chờ khóa ở câu khớp `waitingQuery`: chúng thật sự tranh nhau cùng một dòng. Trả response
 * theo thứ tự gửi. Lỗi giữa chừng thì ROLLBACK và chờ các request xong trước khi đóng kết nối (không để lại khóa).
 */
async function whileLocked<T>(
  lock: [string, unknown[]],
  waitingQuery: string,
  send: () => PromiseLike<T>[],
): Promise<T[]> {
  const locker = new pg.Client({ connectionString: databaseUrl() });
  await locker.connect();
  let pending: Promise<T[]> | undefined;
  try {
    await locker.query('BEGIN');
    await locker.query(...lock);
    const requests = send();
    pending = Promise.all(requests);
    await expect.poll(() => waitingOnLock(waitingQuery), { timeout: 15_000, interval: 50 }).toBe(requests.length);
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

/** Giữ khóa dòng Vé (`FOR UPDATE`), nhả khi cả N request đang chờ ở câu UPDATE check-in. */
const whileTicketLocked = <T>(ticketId: string, send: () => PromiseLike<T>[]) =>
  whileLocked(['SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]], TICKET_UPDATE, send);

describe('POST /v1/checkin/events/:eventId/scans', () => {
  it('xanh: Vé valid chưa check-in → 200 ok (bản chụp trên Vé); ghi checked_in_at, checked_in_by, checkin_scan_id; phát event_checkins_changed', async () => {
    const tickets = await issue(main, 2);
    const ticket = tickets[1]!;
    const scanId = randomUUID();
    const signalCount = checkinSignals(main.event.id).length;
    expect(await scanOk(main.event.id, ctv, ticket.qr, scanId)).toEqual({
      outcome: 'ok',
      holderName: 'Nguyễn Văn An',
      seq: 2,
      count: 2,
      ticketTypeName: TIER,
    });
    const row = await ticketRow(ticket.id);
    expect(row).toMatchObject({ checked_in_by: ctv.userId, checkin_scan_id: scanId });
    expect(row.checked_in_at).toBeInstanceOf(Date);
    expect(await ticketRow(tickets[0]!.id)).toMatchObject(NOT_CHECKED_IN);
    await signalsSettled(main.event.id, signalCount + 1);
    expect(checkinSignals(main.event.id).at(-1)).toEqual({
      type: 'event_checkins_changed',
      id: main.event.id,
      organizationId: org.orgId,
      eventId: main.event.id,
    });
  });

  it('phát lại: cùng scanId, cùng người → ok như lần đầu (kể cả scanId chữ hoa); không ghi gì, không phát thêm tín hiệu', async () => {
    const [ticket] = await issue(main);
    const scanId = randomUUID();
    const signalCount = checkinSignals(main.event.id).length;
    const first = await scanOk(main.event.id, ctv, ticket!.qr, scanId);
    expect(first).toEqual(okOf(ticket!));
    const before = await ticketRow(ticket!.id);
    await signalsSettled(main.event.id, signalCount + 1);

    for (const id of [scanId, scanId.toUpperCase()]) {
      expect(await scanOk(main.event.id, ctv, ticket!.qr, id)).toEqual(first);
    }
    expect(await ticketRow(ticket!.id)).toEqual(before);
    await signalsSettled(main.event.id, signalCount + 1);

    // Phát lại không theo cửa sổ 60 giây: quá 60 giây, cùng scanId và cùng người vẫn nhận kết quả xanh của lần đầu.
    await backdateCheckin(ticket!.id, 60);
    const backdated = await ticketRow(ticket!.id);
    expect(await scanOk(main.event.id, ctv, ticket!.qr, scanId)).toEqual(first);
    expect(await ticketRow(ticket!.id)).toEqual(backdated);
  });

  it('scanId của người khác không lấy được kết quả xanh → already', async () => {
    const [ticket] = await issue(main);
    const scanId = randomUUID();
    await scanOk(main.event.id, ctv, ticket!.qr, scanId);
    const again = await scanOk(main.event.id, ctv2, ticket!.qr, scanId);
    expect(again.outcome).toBe('already');
  });

  it('trung tính: cùng người, scanId khác, chưa tới 60 giây → recent; không ghi gì', async () => {
    const [ticket] = await issue(main);
    await scanOk(main.event.id, ctv, ticket!.qr);
    const before = await ticketRow(ticket!.id);
    expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual({ outcome: 'recent' });
    // 50 giây trước vẫn trong cửa sổ.
    await backdateCheckin(ticket!.id, 50);
    const backdated = await ticketRow(ticket!.id);
    expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual({ outcome: 'recent' });
    expect(await ticketRow(ticket!.id)).toEqual(backdated);
    expect(backdated.checked_in_by).toBe(before.checked_in_by);
  });

  it('hai người lần lượt quét cùng Vé: người sau nhận already (giờ và người quét trước); checked_in_at giữ giá trị của lượt đầu', async () => {
    const [ticket] = await issue(main);
    expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual(okOf(ticket!));
    const first = await ticketRow(ticket!.id);
    const second = await scanOk(main.event.id, ctv2, ticket!.qr);
    expect(second).toEqual({
      outcome: 'already',
      checkedInAt: toEventIso(first.checked_in_at!),
      checkedBy: { kind: 'role', role: 'checker' },
    });
    expect(await ticketRow(ticket!.id)).toEqual(first);
  });

  it('cùng người từ 60 giây trở lên → already, checkedBy self', async () => {
    const [ticket] = await issue(main);
    await scanOk(main.event.id, ctv, ticket!.qr);
    await backdateCheckin(ticket!.id, 60);
    const row = await ticketRow(ticket!.id);
    expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual({
      outcome: 'already',
      checkedInAt: toEventIso(row.checked_in_at!),
      checkedBy: { kind: 'self' },
    });
    expect(await ticketRow(ticket!.id)).toEqual(row);
  });

  it('checkedBy: có tên (trim) → name; không tên → vai owner/admin trong BTC, hoặc checker; không bao giờ email', async () => {
    const named = await checkerOf(main);
    await h.db.orm.execute(sql`UPDATE users SET name = '  Trần Thị Bình  ' WHERE id = ${named.userId}`);
    const blank = await checkerOf(main);
    await h.db.orm.execute(sql`UPDATE users SET name = '   ' WHERE id = ${blank.userId}`);
    const tickets = await issue(main, 5);
    const cases: [User | Org['owner'], unknown][] = [
      [named, { kind: 'name', name: 'Trần Thị Bình' }],
      [blank, { kind: 'role', role: 'checker' }],
      [org.owner, { kind: 'role', role: 'owner' }],
      [admin, { kind: 'role', role: 'admin' }],
      [ctv, { kind: 'role', role: 'checker' }],
    ];
    for (const [i, [first, checkedBy]] of cases.entries()) {
      const ticket = tickets[i]!;
      expect(await scanOk(main.event.id, first, ticket.qr)).toEqual(okOf(ticket));
      const later = first === ctv2 ? ctv : ctv2;
      const res = await scan(main.event.id, later, ticket.qr);
      expect(res.status).toBe(200);
      expect(ScanResult.parse(res.body)).toMatchObject({ outcome: 'already', checkedBy });
      expect(res.text).not.toContain(first.email);
    }
  });

  it('checkedBy theo thứ tự: chính mình thắng tên; tên thắng vai trong BTC', async () => {
    const named = await checkerOf(main);
    await h.db.orm.execute(sql`UPDATE users SET name = 'Lê Văn Cường' WHERE id = ${named.userId}`);
    const [own, adminFirst] = await issue(main, 2);
    // Người có tên quét lại Vé mình check-in từ 60 giây trước → self, không phải tên của chính mình.
    await scanOk(main.event.id, named, own!.qr);
    await backdateCheckin(own!.id, 60);
    expect(await scanOk(main.event.id, named, own!.qr)).toMatchObject({ outcome: 'already', checkedBy: { kind: 'self' } });

    // Admin có tên (tài khoản Google) → tên, không phải vai admin.
    await h.db.orm.execute(sql`UPDATE users SET name = ' Phạm Thu Hà ' WHERE id = ${admin.userId}`);
    try {
      await scanOk(main.event.id, admin, adminFirst!.qr);
      expect(await scanOk(main.event.id, ctv2, adminFirst!.qr)).toMatchObject({
        outcome: 'already',
        checkedBy: { kind: 'name', name: 'Phạm Thu Hà' },
      });
    } finally {
      await h.db.orm.execute(sql`UPDATE users SET name = '' WHERE id = ${admin.userId}`);
    }
  });

  it('Vé có checked_in_at mà không ghi người quét → already, checkedBy checker', async () => {
    const [ticket] = await issue(main);
    await h.db.orm.execute(sql`UPDATE tickets SET checked_in_at = now() - interval '5 minutes' WHERE id = ${ticket!.id}`);
    const row = await ticketRow(ticket!.id);
    expect(row).toMatchObject({ checked_in_by: null, checkin_scan_id: null });
    expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual({
      outcome: 'already',
      checkedInAt: toEventIso(row.checked_in_at!),
      checkedBy: { kind: 'role', role: 'checker' },
    });
    expect(await ticketRow(ticket!.id)).toEqual(row);
  });

  it('sai mã → invalid BAD_SIGNATURE: sai dạng, sai chữ ký, khóa k lạ, chữ ký đúng mà không có Vé; không ghi gì', async () => {
    const [ticket] = await issue(main);
    const signalCount = checkinSignals(main.event.id).length;
    const sig = ticket!.qr.slice(ticket!.qr.lastIndexOf('.') + 1);
    const flipped = `${ticket!.qr.slice(0, -1)}${ticket!.qr.endsWith('A') ? 'B' : 'A'}`;
    const otherKey = TicketQrKeys.parse(`v1:${Buffer.alloc(32, 7).toString('base64')}`);
    const unknownVersion = TicketQrKeys.parse(`v9:${Buffer.alloc(32, 9).toString('base64')}`);
    const codes = [
      'khong-phai-ma-qr',
      `${ticket!.qr} `,
      ticket!.qr.toUpperCase(),
      `t1.${ticket!.id}`,
      flipped,
      `t1.${randomUUID()}.${sig}`,
      signTicketQr(otherKey, ticket!.id),
      signTicketQr(unknownVersion, ticket!.id),
      signTicketQr(qrKeys, randomUUID()),
    ];
    for (const code of codes) {
      const res = await scan(main.event.id, ctv, code);
      expect(res.status, code).toBe(200);
      expect(res.body, code).toEqual(invalid('BAD_SIGNATURE'));
    }
    expect(await ticketRow(ticket!.id)).toMatchObject(NOT_CHECKED_IN);
    await signalsSettled(main.event.id, signalCount);
  });

  it('sai chữ ký không truy vấn DB: flow không chạm Database, request không mở transaction', async () => {
    const [ticket] = await issue(main);
    const untouchable = new Proxy({} as Database, {
      get: () => {
        throw new Error('không được chạm DB khi chữ ký sai');
      },
    });
    const ctx: EventAccessContext = {
      userId: ctv.userId,
      organizationId: org.orgId,
      eventId: main.event.id,
      role: null,
      assignedEventIds: [main.event.id],
      stepUpAt: null,
    };
    const otherKey = TicketQrKeys.parse(`v1:${Buffer.alloc(32, 7).toString('base64')}`);
    for (const code of ['khong-phai-ma-qr', signTicketQr(otherKey, ticket!.id)]) {
      await expect(scanTicket(untouchable, qrKeys, ctx, { code, scanId: randomUUID() })).resolves.toEqual(
        invalid('BAD_SIGNATURE'),
      );
    }

    const appDb = h.app.get<Database>(DATABASE);
    const transaction = vi.spyOn(appDb, 'transaction');
    try {
      expect(await scanOk(main.event.id, ctv, `${ticket!.qr.slice(0, -1)}_`)).toEqual(invalid('BAD_SIGNATURE'));
      expect(transaction).not.toHaveBeenCalled();
      expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual(okOf(ticket!));
      expect(transaction).toHaveBeenCalledTimes(1);
    } finally {
      transaction.mockRestore();
    }
  });

  it('Vé của Sự kiện khác (cùng BTC hoặc BTC khác) → invalid OTHER_EVENT, không lộ gì thêm; không ghi gì', async () => {
    const sameOrg = await freeEvent();
    const orgB = await paidReadyOrg(h, { name: 'CLB Bơi Lội' });
    emails.push(orgB.owner.email);
    const otherOrg = await freeEvent(orgB);
    const signalCount = checkinSignals(main.event.id).length;
    for (const sale of [sameOrg, otherOrg]) {
      const [ticket] = await issue(sale);
      const res = await scan(main.event.id, ctv, ticket!.qr);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(invalid('OTHER_EVENT'));
      expect(res.text).not.toContain(buyerInput.name);
      expect(res.text).not.toContain(ticket!.id);
      expect(await ticketRow(ticket!.id)).toMatchObject(NOT_CHECKED_IN);
    }
    await signalsSettled(main.event.id, signalCount);
    expect(checkinSignals(sameOrg.event.id)).toHaveLength(0);
    expect(checkinSignals(otherOrg.event.id)).toHaveLength(0);
  });

  it('Vé đã hủy → CANCELLED, hoặc VOIDED khi cancel_reason = voided; kể cả Vé đã check-in; không ghi gì', async () => {
    const tickets = await issue(main, 4);
    await scanOk(main.event.id, ctv, tickets[3]!.qr);
    const { EVENT_CANCELLED, VOIDED } = TICKET_CANCEL_REASON;
    const reasons = [EVENT_CANCELLED, VOIDED, null, EVENT_CANCELLED] as const;
    for (const [i, reason] of reasons.entries()) {
      await h.db.orm.execute(
        sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${reason} WHERE id = ${tickets[i]!.id}`,
      );
    }
    const checkedIn = await ticketRow(tickets[3]!.id);
    const expected = ['CANCELLED', 'VOIDED', 'CANCELLED', 'CANCELLED'];
    for (const [i, ticket] of tickets.entries()) {
      for (const scanner of [ctv, ctv2]) {
        expect(await scanOk(main.event.id, scanner, ticket.qr), `${i}`).toEqual(invalid(expected[i]!));
      }
    }
    for (const ticket of tickets.slice(0, 3)) expect(await ticketRow(ticket.id)).toMatchObject(NOT_CHECKED_IN);
    expect(await ticketRow(tickets[3]!.id)).toEqual(checkedIn);
  });

  it.each([
    [TICKET_CANCEL_REASON.EVENT_CANCELLED, 'CANCELLED'],
    [TICKET_CANCEL_REASON.VOIDED, 'VOIDED'],
  ] as const)(
    'gửi lại cùng scanId sau lần ok rồi Vé bị hủy (%s) → ok như lần đầu; scanId mới, hay người khác dùng scanId đó → %s; không ghi gì',
    async (cancelReason, reason) => {
      const [ticket] = await issue(main);
      const scanId = randomUUID();
      const signalCount = checkinSignals(main.event.id).length;
      const first = await scanOk(main.event.id, ctv, ticket!.qr, scanId);
      expect(first).toEqual(okOf(ticket!));
      await h.db.orm.execute(
        sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${cancelReason} WHERE id = ${ticket!.id}`,
      );
      const row = await ticketRow(ticket!.id);

      for (const id of [scanId, scanId.toUpperCase()]) {
        expect(await scanOk(main.event.id, ctv, ticket!.qr, id)).toEqual(first);
      }
      expect(await scanOk(main.event.id, ctv, ticket!.qr)).toEqual(invalid(reason));
      expect(await scanOk(main.event.id, ctv2, ticket!.qr, scanId)).toEqual(invalid(reason));
      expect(await ticketRow(ticket!.id)).toEqual(row);
      await signalsSettled(main.event.id, signalCount + 1);
    },
  );

  const CLOSE = {
    /** Đồng hồ DB đã qua `effective_end_at`. */
    time_ended: (eventId: string) =>
      h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${eventId}`),
    /** "Kết thúc" với mốc còn "tương lai" theo đồng hồ DB: vẫn là đã kết thúc. */
    ended_manually: (eventId: string) =>
      h.db.orm.execute(
        sql`UPDATE events SET ended_manually_at = now() + interval '5 seconds', effective_end_at = now() + interval '5 seconds'
            WHERE id = ${eventId}`,
      ),
    cancelled: (eventId: string) => h.db.orm.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${eventId}`),
    /** Vừa hủy vừa quá `effective_end_at`: hủy thắng. */
    cancelled_and_ended: (eventId: string) =>
      h.db.orm.execute(
        sql`UPDATE events SET status = 'cancelled', effective_end_at = now() - interval '1 second' WHERE id = ${eventId}`,
      ),
  } satisfies Record<string, (eventId: string) => Promise<unknown>>;

  it.each([
    ['time_ended', 'EVENT_ENDED'],
    ['ended_manually', 'EVENT_ENDED'],
    ['cancelled', 'CANCELLED'],
    ['cancelled_and_ended', 'CANCELLED'],
  ] as const)('Sự kiện đóng (%s) → invalid %s; không ghi gì, không phát tín hiệu', async (state, reason) => {
    const sale = await freeEvent();
    const [fresh, other] = await issue(sale, 2);
    const [foreign] = await issue(main);
    await CLOSE[state](sale.event.id);
    for (const scanner of [org.owner, admin]) {
      // Lý do đóng thắng mọi phân loại Vé (kể cả Vé của Sự kiện khác hay chữ ký đúng mà không có Vé).
      for (const code of [fresh!.qr, other!.qr, foreign!.qr, signTicketQr(qrKeys, randomUUID())]) {
        expect(await scanOk(sale.event.id, scanner, code)).toEqual(invalid(reason));
      }
    }
    for (const ticket of [fresh!, other!, foreign!]) expect(await ticketRow(ticket.id)).toMatchObject(NOT_CHECKED_IN);
    await sleep(150);
    expect(checkinSignals(sale.event.id)).toHaveLength(0);
  });

  it.each([
    ['time_ended', 'EVENT_ENDED', false],
    ['ended_manually', 'EVENT_ENDED', false],
    // Hủy Sự kiện thì Vé (kể cả đã check-in) cũng chuyển `cancelled`: `replayOf` vẫn phát lại trên Vé đã hủy.
    ['cancelled', 'CANCELLED', true],
    ['cancelled_and_ended', 'CANCELLED', true],
  ] as const)(
    'gửi lại cùng scanId sau lần ok rồi Sự kiện đóng (%s) → ok như lần đầu; scanId mới, hay người khác dùng scanId đó → invalid %s; không ghi gì',
    async (state, reason, cancelTicket) => {
      const sale = await freeEvent();
      const [ticket, untouched] = await issue(sale, 2);
      const scanId = randomUUID();
      const first = await scanOk(sale.event.id, org.owner, ticket!.qr, scanId);
      expect(first).toEqual(okOf(ticket!));
      await signalsSettled(sale.event.id, 1);
      await CLOSE[state](sale.event.id);
      if (cancelTicket) {
        await h.db.orm.execute(
          sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${TICKET_CANCEL_REASON.EVENT_CANCELLED}
              WHERE id = ${ticket!.id}`,
        );
      }
      const row = await ticketRow(ticket!.id);

      for (const id of [scanId, scanId.toUpperCase()]) {
        expect(await scanOk(sale.event.id, org.owner, ticket!.qr, id)).toEqual(first);
      }
      expect(await scanOk(sale.event.id, org.owner, ticket!.qr)).toEqual(invalid(reason));
      expect(await scanOk(sale.event.id, admin, ticket!.qr, scanId)).toEqual(invalid(reason));
      // scanId của lần ok không mở được Vé khác của Sự kiện đã đóng.
      expect(await scanOk(sale.event.id, org.owner, untouched!.qr, scanId)).toEqual(invalid(reason));
      expect(await ticketRow(ticket!.id)).toEqual(row);
      expect(await ticketRow(untouched!.id)).toMatchObject(NOT_CHECKED_IN);
      await signalsSettled(sale.event.id, 1);
    },
  );

  // Admin: từ Story 5.6, CTV gửi lại cùng scanId sau khi Sự kiện đóng nhận `403 EVENT_ENDED` từ guard (cái giá đã chấp
  // nhận ở Design Notes của spec 5.6); `checkers.test.ts` phủ CTV bị `403 EVENT_ENDED` ở cả 4 route CTV.
  it('Sự kiện đóng khi lần đầu còn chạy (UPDATE chưa commit): lần gửi lại cùng scanId chờ lần đầu commit → ok bản chụp của Vé', async () => {
    const sale = await freeEvent();
    const [ticket] = await issue(sale);
    const scanId = randomUUID();
    // Lần đầu đã qua cổng (Sự kiện còn mở) và ghi Vé nhưng chưa commit (kết nối riêng); đồng hồ qua `effective_end_at`.
    const [res] = await whileLocked(
      [
        'UPDATE tickets SET checked_in_at = now(), checked_in_by = $2, checkin_scan_id = $3 WHERE id = $1',
        [ticket!.id, admin.userId, scanId],
      ],
      TICKET_REPLAY_READ,
      () => [CLOSE.time_ended(sale.event.id).then(() => scan(sale.event.id, admin, ticket!.qr, scanId))],
    );
    expect(res!.status, res!.text).toBe(200);
    expect(ScanResult.parse(res!.body)).toEqual(okOf(ticket!));
    expect(await ticketRow(ticket!.id)).toMatchObject({ checked_in_by: admin.userId, checkin_scan_id: scanId });
  });

  it('Sự kiện bị khóa hoặc đã Ẩn vẫn check-in được: khóa chỉ chặn bán', async () => {
    const sale = await freeEvent();
    const [locked, hidden] = await issue(sale, 2);
    await h.db.orm.execute(
      sql`UPDATE events SET locked_at = now(), locked_by = ${randomUUID()}, lock_reason = 'Kiểm tra' WHERE id = ${sale.event.id}`,
    );
    expect(await scanOk(sale.event.id, org.owner, locked!.qr)).toEqual(okOf(locked!));
    await h.db.orm.execute(
      sql`UPDATE events SET locked_at = NULL, locked_by = NULL, lock_reason = NULL, status = 'hidden'
          WHERE id = ${sale.event.id}`,
    );
    expect(await scanOk(sale.event.id, org.owner, hidden!.qr)).toEqual(okOf(hidden!));
  });

  it('Owner/Admin của BTC sở hữu quét không cần lời mời → như CTV', async () => {
    const [a, b] = await issue(main, 2);
    expect(await scanOk(main.event.id, org.owner, a!.qr)).toEqual(okOf(a!));
    expect(await scanOk(main.event.id, admin, b!.qr)).toEqual(okOf(b!));
    expect((await ticketRow(a!.id)).checked_in_by).toBe(org.owner.userId);
    expect((await ticketRow(b!.id)).checked_in_by).toBe(admin.userId);
  });

  it('không quyền → 403 (CTV Sự kiện khác, người lạ, Owner BTC khác: NOT_A_MEMBER; CTV bị thu hồi: CHECKER_REVOKED); chưa đăng nhập → 401; không ghi gì', async () => {
    const other = await freeEvent();
    const ctvOther = await checkerOf(other);
    const stranger = await user();
    const orgB = await paidReadyOrg(h, { name: 'CLB Bóng Bàn' });
    emails.push(orgB.owner.email);
    const revoked = await checkerOf(main);
    await h.db.orm.execute(
      sql`UPDATE checkers SET status = 'revoked', revoked_at = now(), revoked_by = ${org.owner.userId}
          WHERE event_id = ${main.event.id} AND user_id = ${revoked.userId}`,
    );
    const [ticket] = await issue(main);
    const cases: [User | Org['owner'], string][] = [
      [ctvOther, 'NOT_A_MEMBER'],
      [stranger, 'NOT_A_MEMBER'],
      [orgB.owner, 'NOT_A_MEMBER'],
      [revoked, 'CHECKER_REVOKED'],
    ];
    for (const [caller, code] of cases) {
      const res = await scan(main.event.id, caller, ticket!.qr);
      expect(res.status, code).toBe(403);
      expect(errorOf(res.body).code).toBe(code);
      expect(res.text).not.toContain(buyerInput.name);
    }
    const anonymous = await h.http.post(scanPath(main.event.id)).send({ code: ticket!.qr, scanId: randomUUID() });
    expect(anonymous.status).toBe(401);
    expect(errorOf(anonymous.body).code).toBe('UNAUTHENTICATED');
    expect(await ticketRow(ticket!.id)).toMatchObject(NOT_CHECKED_IN);
  });

  it('body sai → 400 VALIDATION_FAILED (no-store, không lặp lại mã); không ghi gì', async () => {
    const [ticket] = await issue(main);
    const scanId = randomUUID();
    const bodies: unknown[] = [
      {},
      { code: ticket!.qr },
      { scanId },
      { code: '', scanId },
      { code: `${ticket!.qr}${'x'.repeat(513 - ticket!.qr.length)}`, scanId },
      { code: ticket!.qr, scanId: 'khong-phai-uuid' },
      { code: 42, scanId },
    ];
    for (const body of bodies) {
      const res = await h.http.post(scanPath(main.event.id)).set('cookie', ctv.cookie).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).not.toContain(ticket!.qr);
    }
    expect(await ticketRow(ticket!.id)).toMatchObject(NOT_CHECKED_IN);
  });
});

describe('quét song song cùng một Vé (FR-28, AD-15): các request cùng chờ khóa dòng Vé', () => {
  it('8 người, 8 scanId → đúng 1 ok, 7 already kèm checkedInAt của lượt đầu; dòng Vé giữ người và scanId của người thắng; đúng 1 tín hiệu; quét thêm không đổi checked_in_at', async () => {
    const more: User[] = [];
    for (let i = 0; i < 4; i++) more.push(await checkerOf(main));
    const scanners: (User | Org['owner'])[] = [ctv, ctv2, org.owner, admin, ...more];
    expect(scanners).toHaveLength(8);
    const [ticket] = await issue(main);
    const scanIds = scanners.map(() => randomUUID());
    const signalCount = checkinSignals(main.event.id).length;

    const responses = await whileTicketLocked(ticket!.id, () =>
      scanners.map((scanner, i) => scan(main.event.id, scanner, ticket!.qr, scanIds[i])),
    );
    const results = responses.map((res) => {
      expect(res.status, res.text).toBe(200);
      return ScanResult.parse(res.body);
    });
    const winners = [...results.keys()].filter((i) => results[i]!.outcome === 'ok');
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    expect(results[winner]).toEqual(okOf(ticket!));

    const row = await ticketRow(ticket!.id);
    expect(row).toMatchObject({ checked_in_by: scanners[winner]!.userId, checkin_scan_id: scanIds[winner] });
    const checkedInAt = toEventIso(row.checked_in_at!);
    for (const [i, result] of results.entries()) {
      if (i !== winner) expect(result, `${i}`).toMatchObject({ outcome: 'already', checkedInAt });
    }
    await signalsSettled(main.event.id, signalCount + 1);

    // Quét thêm (mỗi người một scanId mới): không ai được ok nữa, checked_in_at giữ giá trị của lượt đầu.
    for (const [i, scanner] of scanners.entries()) {
      const again = await scanOk(main.event.id, scanner, ticket!.qr);
      expect(again, `${i}`).toEqual(i === winner ? { outcome: 'recent' } : expect.objectContaining({ outcome: 'already', checkedInAt }));
    }
    expect(await ticketRow(ticket!.id)).toEqual(row);
    await signalsSettled(main.event.id, signalCount + 1);
  });

  it('cùng người, cùng scanId, 2 request song song (gửi lại khi lần đầu còn chạy ở server) → cả hai ok giống nhau; đúng 1 tín hiệu', async () => {
    const [ticket] = await issue(main);
    const scanId = randomUUID();
    const signalCount = checkinSignals(main.event.id).length;

    const responses = await whileTicketLocked(ticket!.id, () => [
      scan(main.event.id, ctv, ticket!.qr, scanId),
      scan(main.event.id, ctv, ticket!.qr, scanId),
    ]);
    for (const res of responses) {
      expect(res.status, res.text).toBe(200);
      expect(ScanResult.parse(res.body)).toEqual(okOf(ticket!));
    }
    expect(await ticketRow(ticket!.id)).toMatchObject({ checked_in_by: ctv.userId, checkin_scan_id: scanId });
    await signalsSettled(main.event.id, signalCount + 1);
  });
});

describe('GET /v1/checkin/events/:eventId: số đã check-in / tổng Vé hợp lệ', () => {
  it('chỉ đếm Vé valid của Sự kiện; checkedInCount thêm điều kiện đã check-in', async () => {
    const sale = await freeEvent();
    const saleChecker = await checkerOf(sale);
    const counts = async () => {
      const res = await h.http.get(`/v1/checkin/events/${sale.event.id}`).set('cookie', saleChecker.cookie).expect(200);
      const event = CheckinEvent.parse(res.body);
      const ownerView = await h.http.get(`/v1/checkin/events/${sale.event.id}`).set('cookie', org.owner.cookie).expect(200);
      expect(ownerView.body).toEqual(res.body);
      expect(event).toMatchObject({ eventId: sale.event.id, eventName: sale.event.name });
      return { checkedInCount: event.checkedInCount, validTicketCount: event.validTicketCount };
    };
    expect(await counts()).toEqual({ checkedInCount: 0, validTicketCount: 0 });

    const tickets = [...(await issue(sale, 3)), ...(await issue(sale, 1))];
    // Vé của Sự kiện khác (đã check-in) không tính.
    const [foreign] = await issue(main);
    await scanOk(main.event.id, ctv, foreign!.qr);
    expect(await counts()).toEqual({ checkedInCount: 0, validTicketCount: 4 });

    await scanOk(sale.event.id, saleChecker, tickets[0]!.qr);
    await scanOk(sale.event.id, org.owner, tickets[1]!.qr);
    expect(await counts()).toEqual({ checkedInCount: 2, validTicketCount: 4 });

    const cancel = (ticketId: string, reason: string) =>
      h.db.orm.execute(sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${reason} WHERE id = ${ticketId}`);
    await cancel(tickets[2]!.id, TICKET_CANCEL_REASON.EVENT_CANCELLED);
    expect(await counts()).toEqual({ checkedInCount: 2, validTicketCount: 3 });

    // Vé đã check-in rồi bị vô hiệu: ra khỏi cả hai số.
    await cancel(tickets[0]!.id, TICKET_CANCEL_REASON.VOIDED);
    expect(await counts()).toEqual({ checkedInCount: 1, validTicketCount: 2 });
  });
});

describe('riêng tư và đo lường', () => {
  /** Mã đã gửi và body nhận được của chính khối này (tự tạo trong `beforeAll`, không dựa vào khối khác). */
  const own = { codes: [] as string[], responses: [] as string[] };
  /** Thuộc tính của span `checkin scan` mỗi lần quét, theo thứ tự quét. */
  let spanAttributes: Record<string, unknown>[] = [];
  /** Số lần ghi histogram theo `outcome/reason` mà khối này thêm vào. */
  let recorded = new Map<string, number>();
  /** Thuộc tính của mọi điểm dữ liệu histogram. */
  let pointAttributes: Record<string, unknown>[] = [];

  /** Điểm dữ liệu histogram thời gian quét (cộng dồn từ đầu file): `outcome/reason` → số lần ghi. */
  async function histogram(): Promise<{ counts: Map<string, number>; attributes: Record<string, unknown>[] }> {
    const { resourceMetrics } = await reader.collect();
    const counts = new Map<string, number>();
    const attributes: Record<string, unknown>[] = [];
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== CHECKIN_SCAN_DURATION_METRIC) continue;
        expect(metric.descriptor.unit).toBe('s');
        for (const point of metric.dataPoints as DataPoint<{ count: number }>[]) {
          counts.set(`${String(point.attributes.outcome)}/${String(point.attributes.reason ?? '')}`, point.value.count);
          attributes.push(point.attributes);
        }
      }
    }
    return { counts, attributes };
  }

  /** Lần quét kèm kết quả mong đợi (cũng là thuộc tính mong đợi trên span và histogram). */
  const EXPECTED = [
    ['ok', null],
    ['recent', null],
    ['already', null],
    ['invalid', 'BAD_SIGNATURE'],
    ['invalid', 'OTHER_EVENT'],
    ['invalid', 'CANCELLED'],
    ['invalid', 'VOIDED'],
    ['invalid', 'EVENT_ENDED'],
  ] as const;

  beforeAll(async () => {
    await resetOrderRateLimit(h);
    const [checked, cancelled, voided] = await issue(main, 3);
    const [foreign] = await issue(await freeEvent());
    const ended = await freeEvent();
    const [late] = await issue(ended);
    await h.db.orm.execute(
      sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${TICKET_CANCEL_REASON.EVENT_CANCELLED}
          WHERE id = ${cancelled!.id}`,
    );
    await h.db.orm.execute(
      sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${TICKET_CANCEL_REASON.VOIDED} WHERE id = ${voided!.id}`,
    );
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${ended.event.id}`);

    const before = (await histogram()).counts;
    spans.reset();
    const scans: [string, User | Org['owner'], string][] = [
      [main.event.id, ctv, checked!.qr],
      [main.event.id, ctv, checked!.qr],
      [main.event.id, ctv2, checked!.qr],
      [main.event.id, ctv, `${checked!.qr.slice(0, -1)}${checked!.qr.endsWith('A') ? 'B' : 'A'}`],
      [main.event.id, ctv, foreign!.qr],
      [main.event.id, ctv, cancelled!.qr],
      [main.event.id, ctv, voided!.qr],
      [ended.event.id, org.owner, late!.qr],
    ];
    for (const [i, [eventId, scanner, code]] of scans.entries()) {
      own.codes.push(code);
      const res = await h.http.post(scanPath(eventId)).set('cookie', scanner.cookie).send({ code, scanId: randomUUID() });
      own.responses.push(res.text);
      const [outcome, reason] = EXPECTED[i]!;
      expect(res.status, res.text).toBe(200);
      expect(res.body, `${i}`).toMatchObject(reason ? { outcome, reason } : { outcome });
    }
    // Body sai: không tới flow (không span, không histogram), không lặp lại mã.
    own.codes.push(checked!.qr);
    const rejected = await h.http
      .post(scanPath(main.event.id))
      .set('cookie', ctv.cookie)
      .send({ code: `${checked!.qr}${'x'.repeat(600)}`, scanId: randomUUID() });
    expect(rejected.status).toBe(400);
    own.responses.push(rejected.text);

    spanAttributes = spans
      .getFinishedSpans()
      .filter((span) => span.name === 'checkin scan')
      .map((span) => ({ ...span.attributes }));
    const after = await histogram();
    pointAttributes = after.attributes;
    recorded = new Map([...after.counts].map(([key, count]) => [key, count - (before.get(key) ?? 0)]));
  });

  it('mọi response quét không chứa Mã QR vé, SĐT hay email; log không chứa mã đã gửi', () => {
    expect(own.codes).toHaveLength(EXPECTED.length + 1);
    expect(own.responses).toHaveLength(EXPECTED.length + 1);
    const phones = ['0912345678', '0912 345 678', '+84912345678', '84912345678', '912345678'];
    for (const text of own.responses) {
      for (const code of own.codes) expect(text).not.toContain(code);
      for (const phone of phones) expect(text).not.toContain(phone);
      for (const email of emails) expect(text).not.toContain(email);
      expect(text).not.toContain('@');
    }
    const logs = h.logs.text;
    for (const code of own.codes) expect(logs).not.toContain(code);
  });

  it('span checkin scan: outcome, thêm reason khi invalid; không thuộc tính nào khác', () => {
    expect(spanAttributes).toEqual(EXPECTED.map(([outcome, reason]) => (reason ? { outcome, reason } : { outcome })));
  });

  it(`histogram ${CHECKIN_SCAN_DURATION_METRIC}: theo outcome, thêm reason khi invalid; không thuộc tính nào khác`, () => {
    const expected = new Map<string, number>();
    for (const [outcome, reason] of EXPECTED) {
      const key = `${outcome}/${reason ?? ''}`;
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
    expect(new Map([...recorded].filter(([, count]) => count > 0))).toEqual(expected);
    for (const attributes of pointAttributes) {
      expect(Object.keys(attributes).sort()).toEqual(attributes.outcome === 'invalid' ? ['outcome', 'reason'] : ['outcome']);
    }
  });
});
