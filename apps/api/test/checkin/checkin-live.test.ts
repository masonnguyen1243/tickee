import { randomUUID } from 'node:crypto';
import {
  CheckinEvent,
  CreatedCheckerInvite,
  ErrorResponse,
  IDEMPOTENCY_KEY_HEADER,
  Role,
  ScanResult,
  type BuyerTicket,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TICKET_CANCEL_REASON } from '../../src/modules/ticketing/schema.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
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
import { listen, openSse, sleep, type SseClient } from '../platform/sse-client.js';

/*
 * Story 5.7: số check-in theo Hạng vé của `GET /v1/checkin/events/:eventId` và stream `GET …/live`
 * (`event_checkins_changed` lọc theo Sự kiện và BTC, dùng chung cho Owner, Admin và CTV được giao) trên Postgres thật,
 * server HTTP thật và client SSE thật. Vé lấy từ Đơn 0đ (`markPaid` nguồn `free`); tạo Đơn cũng phát
 * `event_orders_changed` cho cùng Sự kiện, nên mỗi ca kiểm luôn rằng topic khác không lọt vào stream check-in. Trạng thái
 * Vé, CTV, tên Hạng vé và mốc kết thúc đặt bằng SQL.
 */

const TIERS = ['Vé thường', 'Vé VIP', 'Vé mời'] as const;
const CHECKINS_CHANGED = '{"type":"event_checkins_changed"}';
const NO_LONGER = 'Bạn không còn quyền soát vé cho Sự kiện này.';

let h: Harness;
let org: Org;
let otherOrg: Org;
let admin: User;
let http: Awaited<ReturnType<typeof listen>>;
const streams: SseClient[] = [];

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Bóng Rổ Gò Vấp' });
  otherOrg = await paidReadyOrg(h, { name: 'CLB Bơi Lội Thủ Đức' });
  admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  http = await listen(h.app);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  for (const s of streams) s.close();
  await http.close();
  await h.close();
});

type Caller = User | Org['owner'];

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const eventPath = (eventId: string) => `/v1/checkin/events/${eventId}`;

/**
 * Sự kiện 0đ đã mở bán của BTC `owner` (mặc định BTC chính) với ba Hạng vé, tạo theo thứ tự `TIERS` (tổng suất 0đ dưới
 * trần 200 của Sự kiện miễn phí).
 */
const tieredEvent = (owner: Org = org) => eventOnSale(owner, TIERS.map((name) => ({ name, price: 0, capacity: 50 })));

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

/** Người mua mới nhận `quantity` Vé 0đ của Hạng vé thứ `tier` của Sự kiện `sale`. */
async function issue(sale: SaleEvent, tier: number, quantity = 1): Promise<BuyerTicket[]> {
  const buyer = await signUp(h);
  const body = orderBody([{ ticketTypeId: sale.tiers[tier]!.id, quantity }]);
  const res = await postOrder(h, buyer, sale.event.slug, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  expect(order.tickets).toHaveLength(quantity);
  return order.tickets;
}

/** Quét Mã QR vé `ticket` ở Sự kiện `eventId` bằng `scanner`: đòi kết quả xanh. */
async function scanOk(eventId: string, scanner: Caller, ticket: BuyerTicket): Promise<void> {
  const res = await h.http
    .post(`${eventPath(eventId)}/scans`)
    .set('cookie', scanner.cookie)
    .send({ code: ticket.qr, scanId: randomUUID() });
  expect(res.status, res.text).toBe(200);
  expect(ScanResult.parse(res.body).outcome).toBe('ok');
}

/** Check-in tay Vé `ticket` ở Sự kiện `eventId` bằng `caller`: đòi kết quả xanh. */
async function checkInByHandOk(eventId: string, caller: Caller, ticket: BuyerTicket): Promise<void> {
  const res = await h.http
    .post(`${eventPath(eventId)}/tickets/${ticket.id}/check-in`)
    .set('cookie', caller.cookie)
    .set(IDEMPOTENCY_KEY_HEADER, randomUUID());
  expect(res.status, res.text).toBe(200);
  expect(ScanResult.parse(res.body).outcome).toBe('ok');
}

/** `GET /v1/checkin/events/:eventId` bằng `caller`: `200`, `no-store`, đúng schema. */
async function checkinEventOf(eventId: string, caller: Caller): Promise<CheckinEvent> {
  const res = await h.http.get(eventPath(eventId)).set('cookie', caller.cookie);
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return CheckinEvent.parse(res.body);
}

/** Mở stream như `EventSource(url, { withCredentials: true })` từ web. */
async function live(eventId: string, cookie?: string): Promise<SseClient> {
  const headers: Record<string, string> = { origin: TEST_WEB_ORIGIN, ...(cookie ? { cookie } : {}) };
  const s = await openSse(http.baseUrl, `${eventPath(eventId)}/live`, headers);
  streams.push(s);
  return s;
}

/** Stream bị từ chối trước khi mở: response JSON lỗi (không treo), đúng mã. */
async function expectRejected(s: SseClient, status: number, code: string): Promise<void> {
  await s.ended;
  expect(s.status, code).toBe(status);
  expect(s.headers['content-type']).toMatch(/^application\/json/);
  expect(errorOf(JSON.parse(s.text())).code).toBe(code);
}

const cancelTicket = (ticketId: string, reason: string) =>
  h.db.orm.execute(sql`UPDATE tickets SET status = 'cancelled', cancel_reason = ${reason} WHERE id = ${ticketId}`);

const setChecker = (eventId: string, userId: string, status: 'active' | 'revoked') =>
  h.db.orm.execute(
    sql`UPDATE checkers SET status = ${status}, revoked_at = ${status === 'revoked' ? sql`now()` : null},
          revoked_by = ${status === 'revoked' ? org.owner.userId : null}
        WHERE event_id = ${eventId} AND user_id = ${userId}`,
  );

describe('GET /v1/checkin/events/:eventId: số theo Hạng vé (Story 5.7)', () => {
  it('mọi Hạng vé theo thứ tự tạo, kể cả Hạng vé chưa có Vé (0/0); chỉ Vé valid (Vé hủy hay vô hiệu không tính, kể cả đã check-in); tổng = tổng các Hạng vé; tên hiện tại; Owner, Admin, CTV thấy như nhau', async () => {
    const sale = await tieredEvent();
    const ctv = await checkerOf(sale);
    const [regular, vip, guest] = sale.tiers.map((t) => t.id) as [string, string, string];
    const view = async () => {
      const own = await checkinEventOf(sale.event.id, org.owner);
      expect(await checkinEventOf(sale.event.id, admin)).toEqual(own);
      expect(await checkinEventOf(sale.event.id, ctv)).toEqual(own);
      expect(own).toMatchObject({ eventId: sale.event.id, eventName: sale.event.name });
      // Tổng luôn khớp các thanh.
      const sum = (key: 'checkedInCount' | 'validTicketCount') =>
        own.ticketTypes.reduce((total, type) => total + type[key], 0);
      expect(own.checkedInCount).toBe(sum('checkedInCount'));
      expect(own.validTicketCount).toBe(sum('validTicketCount'));
      return own;
    };
    const row = (ticketTypeId: string, name: string, checkedInCount: number, validTicketCount: number) => ({
      ticketTypeId,
      name,
      checkedInCount,
      validTicketCount,
    });

    expect(await view()).toMatchObject({
      checkedInCount: 0,
      validTicketCount: 0,
      ticketTypes: [row(regular, TIERS[0], 0, 0), row(vip, TIERS[1], 0, 0), row(guest, TIERS[2], 0, 0)],
    });

    const regularTickets = await issue(sale, 0, 3);
    const vipTickets = await issue(sale, 1, 2);
    // Vé của Sự kiện khác (cùng BTC), đã check-in: không tính.
    const elsewhere = await tieredEvent();
    const [foreign] = await issue(elsewhere, 0);
    await scanOk(elsewhere.event.id, org.owner, foreign!);
    expect(await view()).toMatchObject({
      checkedInCount: 0,
      validTicketCount: 5,
      ticketTypes: [row(regular, TIERS[0], 0, 3), row(vip, TIERS[1], 0, 2), row(guest, TIERS[2], 0, 0)],
    });

    await scanOk(sale.event.id, ctv, regularTickets[0]!);
    await checkInByHandOk(sale.event.id, admin, vipTickets[0]!);
    expect(await view()).toMatchObject({
      checkedInCount: 2,
      validTicketCount: 5,
      ticketTypes: [row(regular, TIERS[0], 1, 3), row(vip, TIERS[1], 1, 2), row(guest, TIERS[2], 0, 0)],
    });

    // Vé chưa check-in bị hủy theo Sự kiện; Vé đã check-in bị vô hiệu: ra khỏi cả hai số của Hạng vé đó.
    await cancelTicket(regularTickets[1]!.id, TICKET_CANCEL_REASON.EVENT_CANCELLED);
    await cancelTicket(vipTickets[0]!.id, TICKET_CANCEL_REASON.VOIDED);
    // Đổi tên Hạng vé: trả tên hiện tại (bản chụp trên Vé không đổi).
    await h.db.orm.execute(sql`UPDATE ticket_types SET name = 'Vé khách mời' WHERE id = ${guest}`);
    expect(await view()).toMatchObject({
      checkedInCount: 1,
      validTicketCount: 3,
      ticketTypes: [row(regular, TIERS[0], 1, 2), row(vip, TIERS[1], 0, 1), row(guest, 'Vé khách mời', 0, 0)],
    });
  });

  it('Sự kiện đã kết thúc: Owner/Admin vẫn đọc được số; CTV → 403 EVENT_ENDED', async () => {
    const sale = await tieredEvent();
    const ctv = await checkerOf(sale);
    await issue(sale, 1);
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${sale.event.id}`);
    for (const caller of [org.owner, admin]) {
      expect((await checkinEventOf(sale.event.id, caller)).ticketTypes.map((t) => t.validTicketCount)).toEqual([0, 1, 0]);
    }
    const res = await h.http.get(eventPath(sale.event.id)).set('cookie', ctv.cookie);
    expect(res.status).toBe(403);
    expect(errorOf(res.body)).toEqual({ code: 'EVENT_ENDED', message: NO_LONGER, details: null });
  });
});

describe('stream GET /v1/checkin/events/:eventId/live (Story 5.7, AD-17)', () => {
  it('Owner, Admin và CTV được giao (id thường hay HOA) nhận {type} dưới 1 giây sau khi quét xanh và sau check-in tay; Sự kiện khác cùng BTC và BTC khác không lọt; tạo Đơn (event_orders_changed) không lọt', async () => {
    const x = await tieredEvent();
    const y = await tieredEvent();
    const z = await tieredEvent(otherOrg);
    const ctv = await checkerOf(x);

    const ownStreams = [
      await live(x.event.id, org.owner.cookie),
      await live(x.event.id, admin.cookie),
      await live(x.event.id, ctv.cookie),
      // Id Sự kiện viết HOA trên URL vẫn khớp `eventId` (chữ thường) của tín hiệu.
      await live(x.event.id.toUpperCase(), ctv.cookie),
    ];
    const streamY = await live(y.event.id, org.owner.cookie);
    const streamZ = await live(z.event.id, otherOrg.owner.cookie);
    for (const s of [...ownStreams, streamY, streamZ]) {
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(s.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    }

    // Tạo Đơn ở cả ba Sự kiện phát `event_orders_changed`: không stream check-in nào nhận.
    const xTickets = await issue(x, 0, 2);
    const [yTicket] = await issue(y, 1);
    const [zTicket] = await issue(z, 2);
    await sleep(300);
    for (const s of [...ownStreams, streamY, streamZ]) expect(s.messages).toEqual([]);

    // Quét xanh ở X (CTV).
    await scanOk(x.event.id, ctv, xTickets[0]!);
    for (const s of ownStreams) {
      const [signal] = await s.waitForMessages(1, 1_000);
      expect(signal!.raw).toBe(CHECKINS_CHANGED);
    }
    // Check-in tay ở X (Admin).
    await checkInByHandOk(x.event.id, admin, xTickets[1]!);
    for (const s of ownStreams) {
      const [, signal] = await s.waitForMessages(2, 1_000);
      expect(signal!.raw).toBe(CHECKINS_CHANGED);
    }
    await sleep(300);
    expect(streamY.messages).toEqual([]);
    expect(streamZ.messages).toEqual([]);

    // Check-in ở Sự kiện khác cùng BTC và ở BTC khác: chỉ stream của Sự kiện đó nhận.
    await scanOk(y.event.id, org.owner, yTicket!);
    await scanOk(z.event.id, otherOrg.owner, zTicket!);
    expect((await streamY.waitForMessages(1, 1_000))[0]!.raw).toBe(CHECKINS_CHANGED);
    expect((await streamZ.waitForMessages(1, 1_000))[0]!.raw).toBe(CHECKINS_CHANGED);
    await sleep(300);
    for (const s of ownStreams) {
      expect(s.messages.map((m) => m.raw)).toEqual([CHECKINS_CHANGED, CHECKINS_CHANGED]);
      expect(s.isEnded()).toBe(false);
    }
    expect(streamY.messages).toHaveLength(1);
    expect(streamZ.messages).toHaveLength(1);
  });

  it('quét không ghi gì (Vé đã check-in, Vé của Sự kiện khác) → không tín hiệu', async () => {
    const sale = await tieredEvent();
    const [ticket] = await issue(sale, 0);
    const elsewhere = await tieredEvent();
    const [foreign] = await issue(elsewhere, 0);
    await scanOk(sale.event.id, org.owner, ticket!);
    const s = await live(sale.event.id, org.owner.cookie);
    expect(s.status).toBe(200);
    for (const code of [ticket!.qr, foreign!.qr]) {
      // Người khác quét lại: đỏ "đã check-in"; Vé của Sự kiện khác: đỏ.
      const res = await h.http
        .post(`${eventPath(sale.event.id)}/scans`)
        .set('cookie', admin.cookie)
        .send({ code, scanId: randomUUID() });
      expect(res.status, res.text).toBe(200);
      expect(ScanResult.parse(res.body).outcome).not.toBe('ok');
    }
    await sleep(400);
    expect(s.messages).toEqual([]);
  });

  it('CTV quá hạn (active, sau effective_end_at) → 403 EVENT_ENDED, không mở stream; Owner và Admin vẫn mở được', async () => {
    const sale = await tieredEvent();
    const ctv = await checkerOf(sale);
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${sale.event.id}`);
    const rejected = await live(sale.event.id, ctv.cookie);
    await expectRejected(rejected, 403, 'EVENT_ENDED');
    expect(errorOf(JSON.parse(rejected.text())).message).toBe(NO_LONGER);
    for (const caller of [org.owner, admin]) {
      const s = await live(sale.event.id, caller.cookie);
      expect(s.status).toBe(200);
      expect(s.isEnded()).toBe(false);
    }
  });

  it('không có quyền → JSON lỗi trước khi mở stream: CTV bị thu hồi 403 CHECKER_REVOKED; CTV Sự kiện khác, Owner BTC khác, người lạ, Sự kiện lạ, id sai dạng 403 NOT_A_MEMBER; chưa đăng nhập 401', async () => {
    const sale = await tieredEvent();
    const revoked = await checkerOf(sale);
    await setChecker(sale.event.id, revoked.userId, 'revoked');
    const otherEvent = await tieredEvent();
    const otherChecker = await checkerOf(otherEvent);
    const stranger = await signUp(h);

    await expectRejected(await live(sale.event.id, revoked.cookie), 403, 'CHECKER_REVOKED');
    for (const [eventId, cookie] of [
      [sale.event.id, otherChecker.cookie],
      [sale.event.id, otherOrg.owner.cookie],
      [sale.event.id, stranger.cookie],
      [randomUUID(), org.owner.cookie],
      ['khong-phai-uuid', org.owner.cookie],
    ] as const) {
      const s = await live(eventId, cookie);
      await expectRejected(s, 403, 'NOT_A_MEMBER');
      expect(s.text()).not.toContain(sale.event.name);
    }
    await expectRejected(await live(sale.event.id), 401, 'UNAUTHENTICATED');
  });

  it('CTV bị thu hồi khi stream đang mở: server không đóng stream (tín hiệu vẫn tới); lần tải lại kế tiếp → 403 CHECKER_REVOKED', async () => {
    const sale = await tieredEvent();
    const ctv = await checkerOf(sale);
    const [ticket] = await issue(sale, 0);
    const s = await live(sale.event.id, ctv.cookie);
    expect(s.status).toBe(200);

    await setChecker(sale.event.id, ctv.userId, 'revoked');
    await scanOk(sale.event.id, org.owner, ticket!);
    expect((await s.waitForMessages(1, 1_000))[0]!.raw).toBe(CHECKINS_CHANGED);
    expect(s.isEnded()).toBe(false);

    const res = await h.http.get(eventPath(sale.event.id)).set('cookie', ctv.cookie);
    expect(res.status).toBe(403);
    expect(errorOf(res.body)).toEqual({ code: 'CHECKER_REVOKED', message: NO_LONGER, details: null });
  });
});
