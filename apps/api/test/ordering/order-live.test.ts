import { BuyerOrderStatus, ErrorResponse, OrderStatus, RealtimeTopic, type BuyerOrderView } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPayments } from '../../src/modules/ordering/index.js';
import { buyerStatusOf } from '../../src/modules/ordering/buyer-status.js';
import { expireOrder } from '../../src/modules/ordering/order-jobs.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { realtime, REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { databaseUrl, TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { orderState, postIpn } from '../payment/ipn-fixtures.js';
import { listen, openSse, sleep, type SseClient } from '../platform/sse-client.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';
import {
  eventOnSale,
  ipnKeyOf,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  resetPaymentService,
  type Org,
  type PayoutSpec,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.7: `GET /v1/me/orders/:code/live` và `BuyerOrderView` trên Postgres thật, Tingee fake, server HTTP thật nghe
 * cổng và client SSE thật. Đo từ lúc gửi IPN tới khi stream của Người mua nhận tín hiệu (< 1 giây); stream của người
 * khác không nhận gì; TX1 không bao giờ `NOTIFY` (mọi topic qua `realtime.notify`: lúc phát, Đơn đã commit); mọi điểm
 * đổi Đơn sau TX1 phát `order_changed`; bảng `buyerStatus`.
 */

const MAIN: TingeeCredential = { clientId: 'tg-live-main-7c3a', secretToken: 'tg-live-main-secret-Hj6Kl5Zx4' };
const account = fakeAccount({ accountName: 'PHAM THI LAN' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const PRICE = 200_000;
const CONTACT = { phone: '0901234567', email: 'lienhe@clbcaulong.vn' };

let fake: TingeeFake;
let h: Harness;
let org: Org;
let ipnKey: string;
let http: Awaited<ReturnType<typeof listen>>;
/** Kết nối `LISTEN` riêng của test: thấy mọi `NOTIFY` của kênh realtime (kể cả không ai mở stream). */
let listener: pg.Client;
const notified: { id: string; type: string; payload: Record<string, unknown>; at: number }[] = [];
const streams: SseClient[] = [];

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, { name: 'CLB Cầu lông Hoàn Kiếm', credential: MAIN, payout: PAYOUT });
  await h.db.orm.execute(
    sql`UPDATE organizations SET contact_phone = ${CONTACT.phone}, contact_email = ${CONTACT.email} WHERE id = ${org.orgId}`,
  );
  ipnKey = await ipnKeyOf(h, org.orgId);
  http = await listen(h.app);
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => {
    const payload = JSON.parse(message.payload ?? '{}') as Record<string, unknown>;
    notified.push({ id: String(payload.id), type: String(payload.type), payload, at: Date.now() });
  });
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
  fake.merchant(MAIN.clientId).linkReplies = [];
  // Mã ngắt dịch vụ (1007) của test trước đã bật cờ của BTC dùng chung (Story 4.2).
  await resetPaymentService(h, org.orgId);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  for (const s of streams) s.close();
  await listener.end();
  await http.close();
  await h.close();
  await fake.close();
});

interface Placed {
  buyer: User;
  eventId: string;
  code: string;
  orderId: string;
  total: number;
  order: BuyerOrderView;
}

/**
 * Người mua (mặc định mới) đặt `quantity` Vé 200.000đ ở Sự kiện mới; Đơn `pending` (mặc định có link thanh toán của
 * Tingee fake).
 */
async function place(
  quantity = 2,
  options: { link?: boolean; linkCode?: string; price?: number; buyer?: User } = {},
): Promise<Placed> {
  const buyer = options.buyer ?? (await signUp(h));
  const sale = await eventOnSale(org, [{ name: 'Đơn nữ', price: options.price ?? PRICE, capacity: 5 }]);
  // Tingee từ chối `create-link`: `1006` (mã thường → trả lượt, Đơn vẫn chờ) hoặc `linkCode` (vd. nhóm tạm ngừng bán).
  if (options.link === false) fake.merchant(MAIN.clientId).linkReplies = [{ code: options.linkCode ?? '1006' }];
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status).toBe(201);
  const order = parseOrder(res.body);
  const { id } = await orderState(h, order.code);
  return { buyer, eventId: sale.event.id, code: order.code, orderId: id, total: order.totalAmount, order };
}

/** Mở stream như `EventSource(url, { withCredentials: true })` từ web: kèm `Origin` của web và cookie phiên. */
async function live(code: string, cookie?: string): Promise<SseClient> {
  const headers: Record<string, string> = { origin: TEST_WEB_ORIGIN, ...(cookie ? { cookie } : {}) };
  const s = await openSse(http.baseUrl, `/v1/me/orders/${code}/live`, headers);
  streams.push(s);
  return s;
}

const view = async (placed: Pick<Placed, 'buyer' | 'code'>) =>
  parseOrder((await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body);

/**
 * Tín hiệu `type` (mặc định `order_changed`) của Đơn: từ Story 3.11 mỗi điểm đổi Đơn phát thêm `event_orders_changed`, và
 * Đơn mới phát `event_orders_changed` sau khi TX1 commit. Đếm tín hiệu không phân biệt được tín hiệu phát sau commit với
 * tín hiệu phát trong TX1; luật "TX1 không `NOTIFY`" kiểm bằng `recordNotifies`.
 */
const notificationsFor = (orderId: string, type: string = RealtimeTopic.ORDER_CHANGED) =>
  notified.filter((n) => n.id === orderId && n.type === type);

/** Một lần gọi `realtime.notify`: topic, id Đơn, và lúc phát Đơn đã commit chưa. */
interface NotifyCall {
  topic: string;
  id: string;
  committed: boolean;
}

/**
 * Bọc `realtime.notify` (mọi topic) cho tới hết test: trước khi phát, đọc Đơn bằng một kết nối khác của pool. Trong TX1
 * tạo Đơn, Đơn chưa commit nên kết nối khác không thấy (`committed: false`). Mọi điểm phát đúng luật (sau commit TX1,
 * TX2 gắn link, hết hạn, IPN) đều thấy Đơn.
 */
function recordNotifies(): NotifyCall[] {
  const calls: NotifyCall[] = [];
  const original = realtime.notify.bind(realtime);
  vi.spyOn(realtime, 'notify').mockImplementation(async (tx, topic, ids) => {
    const { rowCount } = await h.db.pool.query('SELECT 1 FROM orders WHERE id = $1', [ids.id]);
    calls.push({ topic, id: ids.id, committed: rowCount === 1 });
    return original(tx, topic, ids);
  });
  return calls;
}

/**
 * `calls` chỉ gồm tín hiệu về các Đơn `orderIds`: tín hiệu khóa theo id khác phát trong TX1 cũng lộ ra. Mọi lần phát đều
 * khi Đơn đã commit. Mỗi Đơn có `event_orders_changed`, tức bộ kiểm thật sự chạy qua tín hiệu Tổng quan.
 */
function expectNotifiesAfterCommit(calls: NotifyCall[], orderIds: string[]): void {
  expect(calls.filter((c) => !orderIds.includes(c.id))).toEqual([]);
  expect(calls.filter((c) => !c.committed)).toEqual([]);
  const overview = calls.filter((c) => c.topic === RealtimeTopic.EVENT_ORDERS_CHANGED).map((c) => c.id);
  expect(new Set(overview)).toEqual(new Set(orderIds));
}

const sendIpn = (placed: Pick<Placed, 'code' | 'total'>, overrides: Record<string, unknown> = {}) =>
  postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload(placed.code, placed.total, overrides)));

describe('GET /v1/me/orders/:code/live: phạm vi Người mua', () => {
  it('chưa đăng nhập → 401; Đơn của người khác, mã lạ, mã sai dạng → 404 ORDER_NOT_FOUND, không mở stream', async () => {
    const placed = await place(1);
    const anonymous = await live(placed.code);
    await anonymous.ended;
    expect(anonymous.status).toBe(401);
    expect(ErrorResponse.parse(JSON.parse(anonymous.text())).error.code).toBe('UNAUTHENTICATED');

    const stranger = await signUp(h);
    for (const code of [placed.code, 'TKZZZZZZZZ', 'khong-phai-ma']) {
      const s = await live(code, stranger.cookie);
      await s.ended;
      expect(s.status, code).toBe(404);
      expect(s.headers['content-type']).toMatch(/^application\/json/);
      expect(ErrorResponse.parse(JSON.parse(s.text())).error.code).toBe('ORDER_NOT_FOUND');
    }
  });

  it('IPN đúng tiền → stream của Người mua nhận {type} < 1 giây sau khi gửi IPN; stream của người khác không nhận; REST trả paid + Vé', async () => {
    const a = await place(2);
    const b = await place(1);
    const streamA = await live(a.code, a.buyer.cookie);
    const streamB = await live(b.code, b.buyer.cookie);
    expect(streamA.status).toBe(200);
    expect(streamA.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(streamA.headers['cache-control']).toBe('no-store, no-transform');
    // EventSource cross-origin kèm cookie: CORS cho đúng origin web, có credentials.
    expect(streamA.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(streamA.headers['access-control-allow-credentials']).toBe('true');
    expect(streamB.status).toBe(200);

    const sent = Date.now();
    await sendIpn(a).expect(200);
    const [signal] = await streamA.waitForMessages(1, 1_000);
    expect(signal!.at - sent).toBeLessThan(1_000);
    // Chỉ là tín hiệu: không mang dữ liệu Đơn.
    expect(signal!.raw).toBe('{"type":"order_changed"}');

    await sleep(300);
    expect(streamB.messages).toEqual([]);
    expect(streamA.messages).toHaveLength(1);
    const order = await view(a);
    expect(order.buyerStatus).toBe('paid');
    expect(order.tickets).toHaveLength(2);
  });

  it('Đơn khác của cùng Người mua đổi → stream của Đơn này không nhận gì', async () => {
    const x = await place(1);
    const xStream = await live(x.code, x.buyer.cookie);
    const y = await place(1, { buyer: x.buyer });
    await sendIpn(y).expect(200);
    await expect.poll(() => notificationsFor(y.orderId).length).toBe(2);
    await sleep(200);
    expect(xStream.messages).toEqual([]);
  });
});

describe('order_changed ở mọi điểm đổi Đơn sau TX1, không bao giờ trong TX1', () => {
  it('TX1 không NOTIFY (mọi topic, Đơn đã commit lúc phát); order_changed: Đơn 0đ và Tingee từ chối không có, Đơn có link đúng một lần từ TX2', async () => {
    const calls = recordNotifies();
    const free = await place(2, { price: 0 });
    expect(free.order.buyerStatus).toBe('paid');
    const rejected = await place(1, { link: false });
    expect(rejected.order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { checkoutUrl: null } });
    const linked = await place(1);
    expect(linked.order.payment?.checkoutUrl).toEqual(expect.any(String));

    await expect.poll(() => notificationsFor(linked.orderId).length).toBe(1);
    await sleep(300);
    expect(notificationsFor(free.orderId)).toEqual([]);
    expect(notificationsFor(rejected.orderId)).toEqual([]);
    expect(notificationsFor(linked.orderId)).toEqual([expect.objectContaining({ type: 'order_changed' })]);

    // Mọi topic, kể cả `event_orders_changed` của Tổng quan (Story 3.11): không lần phát nào nằm trong TX1. Tín hiệu
    // "Đơn mới" phát sau commit TX1; dời nó vào TX1 thì số tín hiệu không đổi, nhưng `committed` thành `false`.
    expectNotifiesAfterCommit(calls, [free.orderId, rejected.orderId, linked.orderId]);
  });

  it('tạo link bị Tingee từ chối nhóm tạm ngừng bán (1007) → Đơn hết hạn trong một transaction và phát đúng một order_changed', async () => {
    const calls = recordNotifies();
    const paused = await place(1, { link: false, linkCode: '1007' });
    expect(paused.order).toMatchObject({ buyerStatus: 'expired', payment: { checkoutUrl: null, linkError: 'sales_paused' } });
    await expect.poll(() => notificationsFor(paused.orderId).length).toBe(1);
    await sleep(300);
    expect(notificationsFor(paused.orderId)).toEqual([expect.objectContaining({ type: 'order_changed' })]);
    // `PaymentLinks.expire` phát cả `event_orders_changed` (Story 3.11), cũng sau commit như tín hiệu "Đơn mới".
    expectNotifiesAfterCommit(calls, [paused.orderId]);
  });

  it('lỗi sau khi Đơn đổi trong tx của IPN (rollback) → không tín hiệu nào, Đơn vẫn chờ', async () => {
    const placed = await place(1);
    const s = await live(placed.code, placed.buyer.cookie);
    const payments = h.app.get(OrderPayments);
    await expect(
      h.db.transaction(async (tx) => {
        expect(await payments.markPaid(tx, placed.orderId, 'ipn', placed.total)).toEqual({ outcome: 'paid' });
        throw new Error('lỗi sau khi Đơn đổi');
      }),
    ).rejects.toThrow('lỗi sau khi Đơn đổi');
    await sleep(400);
    expect(s.messages).toEqual([]);
    expect((await orderState(h, placed.code)).status).toBe(OrderStatus.PENDING);
    expect((await view(placed)).buyerStatus).toBe('awaiting_payment');
  });

  it('job hết hạn (worker) → tín hiệu, trang thấy expired; IPN expired cũng vậy', async () => {
    const placed = await place(1, { link: false });
    const s = await live(placed.code, placed.buyer.cookie);
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = ${placed.orderId}`);
    expect((await view(placed)).buyerStatus).toBe('confirming');
    expect(await expireOrder(h.db, placed.orderId, 'hold')).toBe('expired');
    await s.waitForMessages(1, 1_000);
    expect((await view(placed)).buyerStatus).toBe('expired');

    const viaIpn = await place(1);
    const t = await live(viaIpn.code, viaIpn.buyer.cookie);
    await sendIpn(viaIpn, {
      status: 'expired',
      statusCode: '01',
      paidAmount: null,
      paidAt: null,
      providerTransactionCode: null,
      paymentMethod: null,
    }).expect(200);
    await t.waitForMessages(1, 1_000);
    expect((await view(viaIpn)).buyerStatus).toBe('expired');
  });

  it('lệch tiền → tín hiệu; under_review kèm liên hệ BTC, không lộ số tiền lệch hay loại Cần xử lý', async () => {
    const placed = await place(2);
    const s = await live(placed.code, placed.buyer.cookie);
    await sendIpn(placed, { paidAmount: placed.total - 1_000 }).expect(200);
    await s.waitForMessages(1, 1_000);
    const res = await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200);
    const order = parseOrder(res.body);
    expect(order).toMatchObject({
      buyerStatus: 'under_review',
      tickets: [],
      organizer: { name: 'CLB Cầu lông Hoàn Kiếm', contactPhone: CONTACT.phone, contactEmail: CONTACT.email },
    });
    expect(res.body).not.toHaveProperty('status');
    for (const leak of ['amount_mismatch', 'mismatch', 'paidAmount', String(placed.total - 1_000)]) {
      expect(res.text).not.toContain(leak);
    }
  });
});

describe('BuyerOrderView.buyerStatus', () => {
  const at = new Date('2026-11-11T08:00:00.000Z');
  const before = new Date(at.getTime() + 1);
  const after = new Date(at.getTime() - 1);

  it('bảng của AD-17 (hàm thuần)', () => {
    const cases: [OrderStatus, Date, boolean, BuyerOrderStatus][] = [
      ['pending', before, false, 'awaiting_payment'],
      ['pending', before, true, 'awaiting_payment'],
      ['pending', at, false, 'confirming'],
      ['pending', after, true, 'confirming'],
      ['expired', after, false, 'expired'],
      ['expired', after, true, 'expired'],
      ['paid', at, false, 'paid'],
      ['paid', at, true, 'event_cancelled'],
      ['review', at, false, 'under_review'],
      ['review', at, true, 'event_cancelled'],
      ['cancelled', at, false, 'cancelled_by_organizer'],
      ['cancelled', at, true, 'event_cancelled'],
      ['refunded', at, false, 'cancelled_by_organizer'],
      ['refunded', at, true, 'event_cancelled'],
    ];
    for (const [status, expiresAt, eventCancelled, expected] of cases) {
      expect(buyerStatusOf({ status, expiresAt, eventCancelled }, at), `${status} ${eventCancelled}`).toBe(expected);
    }
  });

  it('qua REST: Đơn hủy/hoàn → cancelled_by_organizer; Sự kiện hủy → event_cancelled, không Vé dù Đơn đã paid', async () => {
    const placed = await place(1);
    await sendIpn(placed).expect(200);
    const paid = await view(placed);
    expect(paid).toMatchObject({ buyerStatus: 'paid', organizer: { contactPhone: CONTACT.phone } });
    expect(paid.tickets).toHaveLength(1);

    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [placed.eventId]);
    expect(await view(placed)).toMatchObject({ buyerStatus: 'event_cancelled', tickets: [] });

    const other = await place(1);
    for (const status of ['cancelled', 'refunded']) {
      await h.db.pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, other.orderId]);
      expect(await view(other)).toMatchObject({ buyerStatus: 'cancelled_by_organizer', tickets: [] });
    }
    // BTC không nhập kênh liên hệ → null.
    await h.db.orm.execute(sql`UPDATE organizations SET contact_phone = NULL, contact_email = NULL WHERE id = ${org.orgId}`);
    try {
      expect((await view(other)).organizer).toEqual({ name: 'CLB Cầu lông Hoàn Kiếm', contactPhone: null, contactEmail: null });
    } finally {
      await h.db.orm.execute(
        sql`UPDATE organizations SET contact_phone = ${CONTACT.phone}, contact_email = ${CONTACT.email} WHERE id = ${org.orgId}`,
      );
    }
  });

  it('payload NOTIFY đúng {type, id, organizationId, eventId} của Đơn (không PII, không trạng thái)', async () => {
    const placed = await place(1);
    await expect.poll(() => notificationsFor(placed.orderId).length).toBe(1);
    const [{ payload }] = notificationsFor(placed.orderId) as [(typeof notified)[number]];
    expect(payload).toEqual({ type: 'order_changed', id: placed.orderId, organizationId: org.orgId, eventId: placed.eventId });
  });
});
