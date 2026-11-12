import {
  ErrorResponse,
  MyTicketDetail,
  MyTicketsView,
  SharedTicketView,
  type BuyerOrderView,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderPayments } from '../../src/modules/ordering/index.js';
import { TicketQrKeys, verifyTicketQr } from '../../src/modules/ticketing/index.js';
import { TEST_TICKET_QR_KEYS, TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { listen, openSse, sleep, type SseClient } from '../platform/sse-client.js';
import {
  eventOnSale,
  orderBody,
  orderRow,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.9: "Vé của tôi" (`GET /v1/me/tickets`), Chi tiết Vé (`GET /v1/me/tickets/:ticketId`) và stream
 * `GET /v1/me/tickets/live` trên Postgres thật, server HTTP thật nghe cổng (SSE). Phủ Matrix của spec: ba nhóm và thứ tự,
 * check-in, Vé/Sự kiện hủy, mốc kết thúc theo đồng hồ DB, Đơn chờ theo `buyerStatus` (kể cả Đơn hết hạn trong 30 phút),
 * cách ly hai Người mua, stream không rò tín hiệu, Vé được chia sẻ không lọt vào "Vé của tôi" của người nhận link. Tingee
 * từ chối `create-link` (`rejectingTingee`): Đơn có phí vẫn `pending` chưa có link (`awaiting_payment`); trả tiền bằng
 * `markPaid` nguồn `ipn` (như IPN đúng tiền).
 */

const qrKeys = TicketQrKeys.parse(TEST_TICKET_QR_KEYS);
const CONTACT = { phone: '0901234567', email: 'lienhe@clbcaulong.vn' };
const PRICE = 200_000;

let h: Harness;
let org: Org;
let payments: OrderPayments;
let http: Awaited<ReturnType<typeof listen>>;
const streams: SseClient[] = [];

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Cầu lông Quận 3' });
  await h.db.orm.execute(
    sql`UPDATE organizations SET contact_phone = ${CONTACT.phone}, contact_email = ${CONTACT.email} WHERE id = ${org.orgId}`,
  );
  payments = h.app.get(OrderPayments);
  await payments.ready();
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

interface Placed {
  eventId: string;
  orderId: string;
  order: BuyerOrderView;
}

interface PlaceOptions {
  quantity?: number;
  price?: number;
  tier?: string;
  eventName?: string;
  /** Giờ bắt đầu của Sự kiện (ISO, trước `ends_at` 2099-11-16 17:00 của `EVENT_DRAFT`). */
  startsAt?: string;
  venue?: string;
}

/** `buyer` đặt Đơn ở Sự kiện mới: giá 0 → `paid` kèm Vé ngay; có phí → `pending` chưa có link (`awaiting_payment`). */
async function place(buyer: User, options: PlaceOptions = {}): Promise<Placed> {
  const { quantity = 1, price = 0, tier = price === 0 ? 'Vé tham dự' : 'Đơn nam' } = options;
  const sale = await eventOnSale(org, [{ name: tier, price, capacity: 10 }]);
  const eventId = sale.event.id;
  if (options.eventName) await h.db.pool.query('UPDATE events SET name = $1 WHERE id = $2', [options.eventName, eventId]);
  if (options.startsAt) await h.db.pool.query('UPDATE events SET starts_at = $1 WHERE id = $2', [options.startsAt, eventId]);
  if (options.venue) await h.db.pool.query('UPDATE events SET venue = $1 WHERE id = $2', [options.venue, eventId]);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  const { id } = (await orderRow(h, order.code))!;
  return { eventId, orderId: id, order };
}

/** Trả tiền cho Đơn có phí như IPN đúng tiền (phát `order_changed`). */
async function pay(placed: Placed): Promise<void> {
  const result = await h.db.transaction((tx) =>
    payments.markPaid(tx, placed.orderId, 'ipn', placed.order.totalAmount),
  );
  expect(result).toEqual({ outcome: 'paid' });
}

const endEvent = (eventId: string) =>
  h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = $1", [eventId]);

async function list(user: User) {
  const res = await h.http.get('/v1/me/tickets').set('cookie', user.cookie).expect(200);
  return { res, view: MyTicketsView.parse(res.body) };
}

async function detail(user: User, ticketId: string) {
  const res = await h.http.get(`/v1/me/tickets/${ticketId}`).set('cookie', user.cookie).expect(200);
  return { res, view: MyTicketDetail.parse(res.body) };
}

const ticketsOf = async (user: User, code: string) =>
  parseOrder((await h.http.get(`/v1/me/orders/${code}`).set('cookie', user.cookie).expect(200)).body).tickets;

async function live(cookie?: string): Promise<SseClient> {
  const headers: Record<string, string> = { origin: TEST_WEB_ORIGIN, ...(cookie ? { cookie } : {}) };
  const s = await openSse(http.baseUrl, '/v1/me/tickets/live', headers);
  streams.push(s);
  return s;
}

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

describe('GET /v1/me/tickets', () => {
  it('chưa có gì → ba nhóm rỗng, serverNow theo đồng hồ DB, no-store; chưa đăng nhập → 401', async () => {
    const buyer = await signUp(h);
    const before = Date.now();
    const { res, view } = await list(buyer);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(view).toEqual({ serverNow: expect.any(String), active: [], pending: [], history: [] });
    expect(Math.abs(Date.parse(view.serverNow) - before)).toBeLessThan(5_000);
    expect(errorOf((await h.http.get('/v1/me/tickets').expect(401)).body).code).toBe('UNAUTHENTICATED');
  });

  it('ba nhóm và thứ tự: active theo giờ Sự kiện tăng dần, pending mới nhất trước, history giờ giảm dần; không QR, không token', async () => {
    const buyer = await signUp(h);
    const later = await place(buyer, { quantity: 2, eventName: 'Giải mùa đông', startsAt: '2099-11-15T07:00:00+07:00', venue: 'Sân A' });
    const sooner = await place(buyer, { eventName: 'Giải mùa thu', startsAt: '2099-11-10T07:00:00+07:00' });
    const olderPending = await place(buyer, { price: PRICE, quantity: 2, eventName: 'Workshop cà phê' });
    const newerPending = await place(buyer, { price: PRICE, eventName: 'Đêm nhạc' });
    const pastA = await place(buyer, { eventName: 'Giải mùa xuân', startsAt: '2026-03-01T07:00:00+07:00' });
    const pastB = await place(buyer, { eventName: 'Giải mùa hè', startsAt: '2026-06-01T07:00:00+07:00' });
    await endEvent(pastA.eventId);
    await endEvent(pastB.eventId);

    const { res, view } = await list(buyer);
    expect(view.active).toEqual([
      {
        id: sooner.order.tickets[0]!.id,
        event: { name: 'Giải mùa thu', startsAt: '2099-11-10T07:00:00+07:00', venue: null },
        ticketTypeName: 'Vé tham dự',
        seq: 1,
        count: 1,
        orderCode: sooner.order.code,
        status: 'valid',
      },
      ...later.order.tickets.map((t) => ({
        id: t.id,
        event: { name: 'Giải mùa đông', startsAt: '2099-11-15T07:00:00+07:00', venue: 'Sân A' },
        ticketTypeName: 'Vé tham dự',
        seq: t.seq,
        count: 2,
        orderCode: later.order.code,
        status: 'valid',
      })),
    ]);
    expect(view.pending.map((o) => o.code)).toEqual([newerPending.order.code, olderPending.order.code]);
    expect(view.pending[1]).toEqual({
      code: olderPending.order.code,
      buyerStatus: 'awaiting_payment',
      event: { name: 'Workshop cà phê', startsAt: olderPending.order.event.startsAt, venue: null },
      items: [{ name: 'Đơn nam', quantity: 2 }],
      totalAmount: 2 * PRICE,
      expiresAt: olderPending.order.expiresAt,
      organizer: { name: 'CLB Cầu lông Quận 3', contactPhone: CONTACT.phone, contactEmail: CONTACT.email },
    });
    expect(view.history).toEqual([
      {
        id: pastB.order.tickets[0]!.id,
        eventName: 'Giải mùa hè',
        eventStartsAt: '2026-06-01T07:00:00+07:00',
        ticketTypeName: 'Vé tham dự',
        seq: 1,
        count: 1,
        attended: false,
      },
      {
        id: pastA.order.tickets[0]!.id,
        eventName: 'Giải mùa xuân',
        eventStartsAt: '2026-03-01T07:00:00+07:00',
        ticketTypeName: 'Vé tham dự',
        seq: 1,
        count: 1,
        attended: false,
      },
    ]);
    // Danh sách không bao giờ có Mã QR vé hay token link chia sẻ.
    for (const placed of [later, sooner, pastA, pastB]) {
      for (const t of placed.order.tickets) {
        expect(res.text).not.toContain(t.qr);
        expect(res.text).not.toContain(t.shareToken);
      }
    }
    expect(res.text).not.toMatch(/"qr"|"shareToken"/);
  });

  it('check-in → checked_in; Vé hủy, Sự kiện hủy → cancelled (vẫn ở active); sau mốc kết thúc → chỉ history kèm attended', async () => {
    const buyer = await signUp(h);
    const checked = await place(buyer, { startsAt: '2099-11-01T07:00:00+07:00' });
    const cancelledTicket = await place(buyer, { startsAt: '2099-11-02T07:00:00+07:00' });
    const cancelledEvent = await place(buyer, { startsAt: '2099-11-03T07:00:00+07:00' });
    const ended = await place(buyer, { quantity: 2, startsAt: '2026-01-01T07:00:00+07:00' });
    await h.db.pool.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [checked.order.tickets[0]!.id]);
    await h.db.pool.query("UPDATE tickets SET status = 'cancelled', cancel_reason = 'voided' WHERE id = $1", [
      cancelledTicket.order.tickets[0]!.id,
    ]);
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [cancelledEvent.eventId]);
    await h.db.pool.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ended.order.tickets[1]!.id]);

    const before = (await list(buyer)).view;
    // Theo giờ Sự kiện tăng dần: Sự kiện năm 2026 (chưa quá effective_end_at năm 2099) đứng đầu.
    expect(before.active.map((t) => [t.orderCode, t.status])).toEqual([
      [ended.order.code, 'valid'],
      [ended.order.code, 'checked_in'],
      [checked.order.code, 'checked_in'],
      [cancelledTicket.order.code, 'cancelled'],
      [cancelledEvent.order.code, 'cancelled'],
    ]);
    expect(before.history).toEqual([]);

    // Đồng hồ DB vừa quá effective_end_at (không chờ job nào).
    await endEvent(ended.eventId);
    const after = (await list(buyer)).view;
    expect(after.active.map((t) => t.orderCode)).not.toContain(ended.order.code);
    expect(after.history.map((t) => [t.seq, t.attended])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('Đơn đang chờ theo buyerStatus; Đơn hết hạn chỉ trong 30 phút sau expires_at; Sự kiện đã kết thúc → không còn; Đơn được trả → rời nhóm, Vé vào active', async () => {
    const buyer = await signUp(h);
    const awaiting = await place(buyer, { price: PRICE });
    const confirming = await place(buyer, { price: PRICE });
    const review = await place(buyer, { price: PRICE });
    const rejected = await place(buyer, { price: PRICE });
    const eventCancelled = await place(buyer, { price: PRICE });
    const expiredRecent = await place(buyer, { price: PRICE });
    const expiredOld = await place(buyer, { price: PRICE });
    const endedEvent = await place(buyer, { price: PRICE });
    await resetOrderRateLimit(h);
    const paid = await place(buyer, { price: PRICE, quantity: 2 });

    const set = (orderId: string, assignment: string) =>
      h.db.pool.query(`UPDATE orders SET ${assignment} WHERE id = $1`, [orderId]);
    await set(confirming.orderId, "expires_at = now() - interval '1 second'");
    await set(review.orderId, "status = 'review'");
    await set(rejected.orderId, "status = 'cancelled'");
    await set(eventCancelled.orderId, "status = 'review'");
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [eventCancelled.eventId]);
    await set(expiredRecent.orderId, "status = 'expired', expires_at = now() - interval '29 minutes'");
    await set(expiredOld.orderId, "status = 'expired', expires_at = now() - interval '31 minutes'");
    await endEvent(endedEvent.eventId);

    const statusOf = (view: MyTicketsView) => Object.fromEntries(view.pending.map((o) => [o.code, o.buyerStatus]));
    const before = (await list(buyer)).view;
    expect(statusOf(before)).toEqual({
      [awaiting.order.code]: 'awaiting_payment',
      [confirming.order.code]: 'confirming',
      [review.order.code]: 'under_review',
      [rejected.order.code]: 'cancelled_by_organizer',
      [eventCancelled.order.code]: 'event_cancelled',
      [expiredRecent.order.code]: 'expired',
      [paid.order.code]: 'awaiting_payment',
    });
    expect(before.active).toEqual([]);
    expect(before.history).toEqual([]);

    await pay(paid);
    const after = (await list(buyer)).view;
    expect(after.pending.map((o) => o.code)).not.toContain(paid.order.code);
    expect(after.active.map((t) => [t.orderCode, t.seq, t.status])).toEqual([
      [paid.order.code, 1, 'valid'],
      [paid.order.code, 2, 'valid'],
    ]);
  });

  it('Đơn hết hạn (còn trong 30 phút) rồi tiền về muộn, còn chỗ → rời nhóm chờ, Vé vào active', async () => {
    const buyer = await signUp(h);
    const late = await place(buyer, { price: PRICE, quantity: 2 });
    // Hết hạn như job: nhả chỗ đang giữ rồi chuyển `expired` (expires_at 5 phút trước, còn trong cửa sổ 30 phút).
    await h.db.pool.query(
      `UPDATE ticket_type_inventory SET held = held - 2
         WHERE ticket_type_id = (SELECT ticket_type_id FROM order_items WHERE order_id = $1)`,
      [late.orderId],
    );
    await h.db.pool.query("UPDATE orders SET status = 'expired', expires_at = now() - interval '5 minutes' WHERE id = $1", [
      late.orderId,
    ]);
    const before = (await list(buyer)).view;
    expect(before.pending.map((o) => [o.code, o.buyerStatus])).toEqual([[late.order.code, 'expired']]);

    await pay(late);
    const after = (await list(buyer)).view;
    expect(after.pending).toEqual([]);
    expect(after.active.map((t) => [t.orderCode, t.seq, t.status])).toEqual([
      [late.order.code, 1, 'valid'],
      [late.order.code, 2, 'valid'],
    ]);
  });

  it('không lộ loại Cần xử lý hay số tiền đã nhận', async () => {
    const buyer = await signUp(h);
    const placed = await place(buyer, { price: PRICE });
    await h.db.pool.query("UPDATE orders SET status = 'review' WHERE id = $1", [placed.orderId]);
    const { res } = await list(buyer);
    for (const leak of ['amount_mismatch', 'orphan', 'paidAmount', '"status"']) expect(res.text).not.toContain(leak);
  });

  it('hai Người mua: A không bao giờ thấy Đơn hay Vé của B', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const aFree = await place(a);
    const bFree = await place(b, { quantity: 2 });
    const bPending = await place(b, { price: PRICE });
    const bPast = await place(b);
    await endEvent(bPast.eventId);

    const { res, view } = await list(a);
    expect(view.active.map((t) => t.id)).toEqual([aFree.order.tickets[0]!.id]);
    expect(view.pending).toEqual([]);
    expect(view.history).toEqual([]);
    for (const code of [bFree.order.code, bPending.order.code, bPast.order.code]) expect(res.text).not.toContain(code);
  });
});

describe('GET /v1/me/tickets/:ticketId', () => {
  it('Vé hợp lệ của Đơn có phí: QR và token như Trang Đơn, biên nhận (dòng, tổng, giờ trả), liên hệ BTC, no-store', async () => {
    const buyer = await signUp(h);
    const placed = await place(buyer, { price: PRICE, quantity: 2, venue: 'Nhà thi đấu Phú Thọ' });
    await pay(placed);
    const tickets = await ticketsOf(buyer, placed.order.code);
    const second = tickets[1]!;

    const { res, view } = await detail(buyer, second.id);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(view).toEqual({
      id: second.id,
      event: { name: placed.order.event.name, startsAt: placed.order.event.startsAt, venue: 'Nhà thi đấu Phú Thọ' },
      ticketTypeName: 'Đơn nam',
      seq: 2,
      count: 2,
      holderName: placed.order.buyer.name,
      status: 'valid',
      attended: false,
      eventCancelled: false,
      ended: false,
      qr: second.qr,
      shareToken: second.shareToken,
      organizer: { name: 'CLB Cầu lông Quận 3', contactPhone: CONTACT.phone, contactEmail: CONTACT.email },
      receipt: {
        orderCode: placed.order.code,
        items: [{ name: 'Đơn nam', unitPrice: PRICE, quantity: 2, amount: 2 * PRICE }],
        totalAmount: 2 * PRICE,
        paidAt: expect.any(String),
      },
    });
    expect(verifyTicketQr(qrKeys, view.qr!)).toEqual({ ticketId: second.id, keyVersion: 1 });
    // Token mở được đúng Vé.
    const shared = SharedTicketView.parse((await h.http.get(`/v1/shared-tickets/${view.shareToken}`).expect(200)).body);
    expect(shared.seq).toBe(2);
    // Id viết hoa vẫn là Vé đó.
    expect((await detail(buyer, second.id.toUpperCase())).view.id).toBe(second.id);
  });

  it('Đơn 0đ: biên nhận tổng 0; check-in → vẫn có QR, status checked_in, attended', async () => {
    const buyer = await signUp(h);
    const placed = await place(buyer);
    const ticket = placed.order.tickets[0]!;
    const free = (await detail(buyer, ticket.id)).view;
    expect(free.receipt).toEqual({
      orderCode: placed.order.code,
      items: [{ name: 'Vé tham dự', unitPrice: 0, quantity: 1, amount: 0 }],
      totalAmount: 0,
      paidAt: expect.any(String),
    });
    await h.db.pool.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ticket.id]);
    expect((await detail(buyer, ticket.id)).view).toMatchObject({ status: 'checked_in', attended: true, qr: ticket.qr });
  });

  it('Vé hủy / Sự kiện hủy / quá effective_end_at → 200, không QR, không token; biên nhận vẫn có', async () => {
    const buyer = await signUp(h);
    const cancelledTicket = await place(buyer);
    const cancelledEvent = await place(buyer);
    const ended = await place(buyer);
    await h.db.pool.query("UPDATE tickets SET status = 'cancelled', cancel_reason = 'voided' WHERE id = $1", [
      cancelledTicket.order.tickets[0]!.id,
    ]);
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [cancelledEvent.eventId]);
    await h.db.pool.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ended.order.tickets[0]!.id]);
    await endEvent(ended.eventId);

    const cases = [
      [cancelledTicket, { status: 'cancelled', eventCancelled: false, ended: false }],
      [cancelledEvent, { status: 'cancelled', eventCancelled: true, ended: false }],
      [ended, { status: 'checked_in', attended: true, eventCancelled: false, ended: true }],
    ] as const;
    for (const [placed, expected] of cases) {
      const { res, view } = await detail(buyer, placed.order.tickets[0]!.id);
      expect(view).toMatchObject({ ...expected, qr: null, shareToken: null });
      expect(view.receipt.orderCode).toBe(placed.order.code);
      expect(res.text).not.toContain(placed.order.tickets[0]!.qr);
      expect(res.text).not.toContain(placed.order.tickets[0]!.shareToken);
    }
  });

  it('Vé của người khác, id lạ, id sai dạng → 404 TICKET_NOT_FOUND; chưa đăng nhập → 401', async () => {
    const owner = await signUp(h);
    const stranger = await signUp(h);
    const ticket = (await place(owner)).order.tickets[0]!;
    for (const id of [ticket.id, '019a3b2c-0b00-7abc-8def-0000000000ff', 'khong-phai-uuid']) {
      const res = await h.http.get(`/v1/me/tickets/${id}`).set('cookie', stranger.cookie).expect(404);
      expect(errorOf(res.body), id).toEqual({ code: 'TICKET_NOT_FOUND', message: 'Không tìm thấy Vé này.', details: null });
      expect(res.text).not.toContain(ticket.qr);
    }
    expect(errorOf((await h.http.get(`/v1/me/tickets/${ticket.id}`).expect(401)).body).code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /v1/me/tickets/live', () => {
  it('chưa đăng nhập → 401, không mở stream', async () => {
    const s = await live();
    await s.ended;
    expect(s.status).toBe(401);
    expect(errorOf(JSON.parse(s.text())).code).toBe('UNAUTHENTICATED');
  });

  it('chỉ nhận order_changed của Đơn mình sở hữu lúc mở: Đơn của B đổi → A không nhận; Đơn của A được trả → A nhận, REST thấy Vé', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const aOrder = await place(a, { price: PRICE });
    const bOrder = await place(b, { price: PRICE });
    const streamA = await live(a.cookie);
    expect(streamA.status).toBe(200);
    expect(streamA.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(streamA.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);

    await pay(bOrder);
    await sleep(400);
    expect(streamA.messages).toEqual([]);

    await pay(aOrder);
    const [signal] = await streamA.waitForMessages(1, 2_000);
    expect(signal!.raw).toBe('{"type":"order_changed"}');
    const view = (await list(a)).view;
    expect(view.pending).toEqual([]);
    expect(view.active.map((t) => t.orderCode)).toEqual([aOrder.order.code]);
  });

  it('Đơn tạo sau lúc mở không có trong tập (web mở lại stream khi tập mã Đơn đổi); stream mở sau đó thì nhận', async () => {
    const a = await signUp(h);
    const opened = await live(a.cookie);
    // TX1 không bao giờ NOTIFY; Tingee từ chối `create-link` cũng không.
    const fresh = await place(a, { price: PRICE });
    const reopened = await live(a.cookie);
    await pay(fresh);
    await reopened.waitForMessages(1, 2_000);
    await sleep(300);
    expect(opened.messages).toEqual([]);
  });
});

describe('link chia sẻ không lọt vào Vé của tôi của người nhận', () => {
  it('B (đã đăng nhập) mở link Vé của A → B vẫn không có gì; Vé của A không đổi', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const ticket = (await place(a)).order.tickets[0]!;
    const before = await h.db.pool.query('SELECT user_id, updated_at, share_version FROM tickets WHERE id = $1', [ticket.id]);
    await h.http.get(`/v1/shared-tickets/${ticket.shareToken}`).set('cookie', b.cookie).expect(200);
    expect((await list(b)).view).toMatchObject({ active: [], pending: [], history: [] });
    await h.http.get(`/v1/me/tickets/${ticket.id}`).set('cookie', b.cookie).expect(404);
    const after = await h.db.pool.query('SELECT user_id, updated_at, share_version FROM tickets WHERE id = $1', [ticket.id]);
    expect(after.rows).toEqual(before.rows);
    expect((await list(a)).view.active.map((t) => t.id)).toEqual([ticket.id]);
  });
});
