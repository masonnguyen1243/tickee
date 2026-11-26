import { randomUUID } from 'node:crypto';
import {
  CheckinEvent,
  ErrorResponse,
  EventOverview,
  RealtimeTopic,
  Role,
  ScanResult,
  type BuyerTicket,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TICKET_CANCEL_REASON } from '../../src/modules/ticketing/schema.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { REALTIME_CHANNEL, realtime } from '../../src/platform/realtime/index.js';
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
  type Org,
  type PayoutSpec,
  type SaleEvent,
  type User,
} from '../ordering/order-fixtures.js';

/*
 * Story 3.11: Tổng quan Sự kiện — `GET /v1/orgs/:orgId/events/:eventId/overview` (doanh thu + 5 Đơn gần đây, đọc qua read
 * model của `ordering` và `payment`) và stream `GET …/overview/live` (`event_orders_changed` lọc theo Sự kiện) trên
 * Postgres thật, Tingee fake, server HTTP thật và client SSE thật. Điểm phát tín hiệu: mọi chỗ phát `order_changed`, và
 * một lệnh riêng sau khi TX1 tạo Đơn commit (Đơn 0đ lẫn Đơn có phí); TX1 rollback thì không có gì.
 *
 * Story 6.2: doanh thu cộng `paid_amount`, số check-in (chỉ Vé `valid`), Vé theo Hạng vé (đã bán · đang giữ chỗ · còn
 * lại, đọc qua `event` + `ordering`), và stream Tổng quan nhận thêm `event_checkins_changed` của Sự kiện. Duyệt tay
 * lệch tiền (doanh thu = số nhận) ở `test/payment/review-actions.test.ts`.
 */

const MAIN: TingeeCredential = { clientId: 'tg-overview-main-4d1e', secretToken: 'tg-overview-main-secret-Qw8Er7Ty6' };
const account = fakeAccount({ accountName: 'TRAN VAN TUAN' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const PRICE = 300_000;

let fake: TingeeFake;
let h: Harness;
let org: Org;
let ipnKey: string;
let http: Awaited<ReturnType<typeof listen>>;
/** Kết nối `LISTEN` riêng của test: thấy mọi `NOTIFY` của kênh realtime. */
let listener: pg.Client;
const notified: { type: string; id: string; eventId: string; organizationId: string }[] = [];
const streams: SseClient[] = [];

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, { name: 'CLB Cầu lông Ba Đình', credential: MAIN, payout: PAYOUT });
  ipnKey = await ipnKeyOf(h, org.orgId);
  http = await listen(h.app);
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => {
    const p = JSON.parse(message.payload ?? '{}') as Record<string, unknown>;
    notified.push({
      type: String(p.type),
      id: String(p.id),
      eventId: String(p.eventId),
      organizationId: String(p.organizationId),
    });
  });
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
  fake.merchant(MAIN.clientId).linkReplies = [];
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

const overviewPath = (eventId: string, orgId = org.orgId) => `/v1/orgs/${orgId}/events/${eventId}/overview`;

async function overviewOf(eventId: string, cookie = org.owner.cookie): Promise<EventOverview> {
  const res = await h.http.get(overviewPath(eventId)).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return EventOverview.parse(res.body);
}

/** Mở stream như `EventSource(url, { withCredentials: true })` từ web. */
async function live(eventId: string, cookie?: string, orgId = org.orgId): Promise<SseClient> {
  const headers: Record<string, string> = { origin: TEST_WEB_ORIGIN, ...(cookie ? { cookie } : {}) };
  const s = await openSse(http.baseUrl, `${overviewPath(eventId, orgId)}/live`, headers);
  streams.push(s);
  return s;
}

/** Sự kiện mới của BTC: Hạng vé có phí 300.000đ và Hạng vé 0đ. */
const saleEvent = (options: { maxTicketsPerOrder?: number } = {}) =>
  eventOnSale(
    org,
    [
      { name: 'Vé thường', price: PRICE, capacity: 20 },
      { name: 'Vé mời', price: 0, capacity: 20 },
    ],
    options,
  );

interface Placed {
  code: string;
  orderId: string;
  total: number;
  buyer: User;
  /** Vé của Đơn (chỉ Đơn 0đ có Vé ngay khi tạo). */
  tickets: BuyerTicket[];
}

/**
 * Người mua (mặc định mới) đặt `quantity` Vé của Hạng vé thứ `tier` (với `saleEvent`: 0 có phí, 1 0đ), tên `name`. Đơn
 * có phí có link thanh toán của Tingee fake, trừ khi `link: false` (Tingee từ chối `create-link`, Đơn vẫn chờ).
 */
async function place(
  sale: SaleEvent,
  options: { tier?: number; quantity?: number; name?: string; buyer?: User; link?: boolean } = {},
): Promise<Placed> {
  const buyer = options.buyer ?? (await signUp(h));
  if (options.link === false) fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
  const items = [{ ticketTypeId: sale.tiers[options.tier ?? 0]!.id, quantity: options.quantity ?? 1 }];
  const extra = options.name ? { buyer: { name: options.name, phone: '0912 345 678' } } : {};
  const res = await postOrder(h, buyer, sale.event.slug, orderBody(items, extra));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  const { id } = await orderState(h, order.code);
  return { code: order.code, orderId: id, total: order.totalAmount, buyer, tickets: order.tickets };
}

const sendIpn = (placed: Pick<Placed, 'code' | 'total'>, overrides: Record<string, unknown> = {}) =>
  postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload(placed.code, placed.total, overrides)));

/** Owner quét Mã QR vé `ticket` ở Sự kiện `eventId` (Màn quét, Story 5.3): đòi kết quả xanh. */
async function scanOk(eventId: string, ticket: BuyerTicket, scanner: User = org.owner): Promise<void> {
  const res = await h.http
    .post(`/v1/checkin/events/${eventId}/scans`)
    .set('cookie', scanner.cookie)
    .send({ code: ticket.qr, scanId: randomUUID() });
  expect(res.status, res.text).toBe(200);
  expect(ScanResult.parse(res.body).outcome).toBe('ok');
}

const CHECKINS_CHANGED = '{"type":"event_checkins_changed"}';

const signalsOf = (filter: { id?: string; eventId?: string; type?: string }) =>
  notified.filter(
    (n) =>
      (filter.id === undefined || n.id === filter.id) &&
      (filter.eventId === undefined || n.eventId === filter.eventId) &&
      (filter.type === undefined || n.type === filter.type),
  );

describe('GET …/overview: doanh thu và Đơn gần đây', () => {
  it('chưa có Đơn → 0đ, 0 Đơn, danh sách rỗng; cache-control no-store', async () => {
    const sale = await saleEvent();
    const res = await h.http.get(overviewPath(sale.event.id)).set('cookie', org.owner.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(EventOverview.parse(res.body)).toEqual({
      revenue: { amount: 0, paidOrders: 0 },
      recentOrders: [],
      openReviewCount: 0,
      checkin: { checkedInCount: 0, validTicketCount: 0 },
      ticketTypes: [
        { name: 'Vé thường', price: PRICE, capacity: 20, sold: 0, held: 0, remaining: 20 },
        { name: 'Vé mời', price: 0, capacity: 20, sold: 0, held: 0, remaining: 20 },
      ],
    });
  });

  it('doanh thu chỉ tính Đơn paid (kể cả Đơn 0đ); Đơn mọi trạng thái mới nhất trước; Đơn review kèm loại và số tiền nhận', async () => {
    const sale = await saleEvent();
    const a = await place(sale, { name: 'Nguyễn Văn Minh', quantity: 1 });
    await sendIpn(a).expect(200);
    const b = await place(sale, { name: 'Phạm Thu Hà', tier: 1, quantity: 2 });
    const c = await place(sale, { name: 'Lê Hoàng Nam', quantity: 1 });
    await sendIpn(c, { paidAmount: 250_000 }).expect(200);
    const d = await place(sale, { name: 'Trần Quốc Bảo', quantity: 2 });

    const overview = await overviewOf(sale.event.id);
    expect(overview.revenue).toEqual({ amount: PRICE, paidOrders: 2 });
    expect(overview.openReviewCount).toBe(1);
    expect(overview.recentOrders.map((o) => [o.code, o.status, o.buyerName, o.ticketCount, o.totalAmount])).toEqual([
      [d.code, 'pending', 'Trần Quốc Bảo', 2, 2 * PRICE],
      [c.code, 'review', 'Lê Hoàng Nam', 1, PRICE],
      [b.code, 'paid', 'Phạm Thu Hà', 2, 0],
      [a.code, 'paid', 'Nguyễn Văn Minh', 1, PRICE],
    ]);
    expect(overview.recentOrders.map((o) => o.review)).toEqual([
      null,
      { type: 'amount_mismatch', receivedAmount: 250_000 },
      null,
      null,
    ]);
    const createdAt = overview.recentOrders.map((o) => Date.parse(o.createdAt));
    expect([...createdAt].sort((x, y) => y - x)).toEqual(createdAt);
  });

  it('không lộ id nội bộ, email hay SĐT của Người mua', async () => {
    const sale = await saleEvent();
    const placed = await place(sale, { name: 'Võ Minh Thư', tier: 1 });
    const res = await h.http.get(overviewPath(sale.event.id)).set('cookie', org.owner.cookie).expect(200);
    for (const leak of [placed.orderId, placed.buyer.userId, placed.buyer.email, '+84912345678', '0912345678', sale.event.id]) {
      expect(res.text, leak).not.toContain(leak);
    }
    expect(Object.keys(res.body.recentOrders[0]).sort()).toEqual(
      ['buyerName', 'code', 'createdAt', 'review', 'status', 'ticketCount', 'totalAmount'].sort(),
    );
  });

  it('hơn 5 Đơn → đúng 5 Đơn mới nhất (lúc tạo rồi id, giảm dần)', async () => {
    const sale = await saleEvent();
    const buyer = await signUp(h);
    const codes: string[] = [];
    for (let i = 0; i < 7; i++) codes.push((await place(sale, { tier: 1, buyer })).code);
    const overview = await overviewOf(sale.event.id);
    expect(overview.recentOrders.map((o) => o.code)).toEqual(codes.slice(2).reverse());
    expect(overview.revenue).toEqual({ amount: 0, paidOrders: 7 });
  });

  it('Đơn review mà mục Cần xử lý đã đóng → review null; mục open cũ nhất được chọn', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    await sendIpn(placed, { paidAmount: 100_000 }).expect(200);
    // Khoản trả thứ hai cho Đơn đã `review` → `duplicate_payment` (mục mới hơn).
    await sendIpn(placed, { paidAmount: PRICE }).expect(200);
    const first = await overviewOf(sale.event.id);
    expect(first.recentOrders[0]).toMatchObject({ status: 'review', review: { type: 'amount_mismatch', receivedAmount: 100_000 } });
    expect(first.openReviewCount).toBe(2);

    await h.db.orm.execute(sql`
      UPDATE review_items SET status = 'resolved', resolution = 'rejected'
       WHERE order_id = ${placed.orderId} AND type = 'amount_mismatch'`);
    const second = await overviewOf(sale.event.id);
    expect(second.recentOrders[0]).toMatchObject({ status: 'review', review: { type: 'duplicate_payment', receivedAmount: PRICE } });
    expect(second.openReviewCount).toBe(1);

    await h.db.orm.execute(sql`
      UPDATE review_items SET status = 'resolved', resolution = 'refunded' WHERE order_id = ${placed.orderId}`);
    const third = await overviewOf(sale.event.id);
    expect(third.recentOrders[0]).toMatchObject({ status: 'review', review: null });
    expect(third.openReviewCount).toBe(0);
  });

  it('Story 4.3: openReviewCount chỉ đếm mục open gắn Đơn của Sự kiện này, ở mọi trạng thái Đơn (kể cả trả trùng cho Đơn paid); không đếm Sự kiện khác hay mục chưa khớp', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    await sendIpn(await place(x), { paidAmount: 1_000 }).expect(200);
    await sendIpn(await place(y), { paidAmount: 2_000 }).expect(200);
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload('TK0000ZZZZ', 3_000))).expect(200);
    const paid = await place(x);
    await sendIpn(paid).expect(200);
    await sendIpn(paid).expect(200);

    expect((await overviewOf(x.event.id)).openReviewCount).toBe(2);
    expect((await overviewOf(y.event.id)).openReviewCount).toBe(1);
    // Id Sự kiện viết HOA trên URL vẫn đếm đúng.
    const upper = await h.http.get(overviewPath(x.event.id.toUpperCase())).set('cookie', org.owner.cookie).expect(200);
    expect(EventOverview.parse(upper.body).openReviewCount).toBe(2);

    await h.db.orm.execute(sql`
      UPDATE review_items SET status = 'resolved', resolution = 'refunded'
       WHERE order_id = ${paid.orderId}`);
    expect((await overviewOf(x.event.id)).openReviewCount).toBe(1);
  });
});

describe('Story 6.2: doanh thu theo tiền đã nhận, Vé theo Hạng vé, check-in', () => {
  it('doanh thu cộng paid_amount của Đơn paid; Đơn 0đ: paidOrders +1, số tiền không đổi; Đơn chờ không tính', async () => {
    const sale = await saleEvent();
    const paid = await place(sale);
    await sendIpn(paid).expect(200);
    expect((await overviewOf(sale.event.id)).revenue).toEqual({ amount: PRICE, paidOrders: 1 });

    await place(sale, { tier: 1, quantity: 2 });
    await place(sale, { quantity: 1 });
    expect((await overviewOf(sale.event.id)).revenue).toEqual({ amount: PRICE, paidOrders: 2 });

    // Doanh thu đọc `paid_amount`, không đọc `total_amount` (duyệt tay lệch tiền đi luồng thật ở review-actions.test).
    await h.db.orm.execute(sql`UPDATE orders SET paid_amount = 250000 WHERE id = ${paid.orderId}`);
    expect((await overviewOf(sale.event.id)).revenue).toEqual({ amount: 250_000, paidOrders: 2 });
  });

  it('Vé theo Hạng vé: thứ tự tạo, tên và giá hiện tại; đã bán, đang giữ chỗ (Đơn chờ), còn lại = sức chứa − bán − giữ; hết vé → 0; không có id nội bộ', async () => {
    const sale = await eventOnSale(org, [
      { name: 'Vé đôi', price: PRICE, capacity: 10 },
      { name: 'Vé mời', price: 0, capacity: 5 },
      { name: 'Vé VIP', price: 500_000, capacity: 2 },
    ]);
    const [pair, guest, vip] = sale.tiers.map((t) => t.id) as [string, string, string];

    // Sức chứa 10: 3 bán, 2 Đơn chờ giữ 4 → còn 3.
    const sold = await place(sale, { tier: 0, quantity: 3 });
    await sendIpn(sold).expect(200);
    await place(sale, { tier: 0, quantity: 2 });
    await place(sale, { tier: 0, quantity: 2 });
    await place(sale, { tier: 1, quantity: 2 });
    const res = await h.http.get(overviewPath(sale.event.id)).set('cookie', org.owner.cookie).expect(200);
    expect(EventOverview.parse(res.body).ticketTypes).toEqual([
      { name: 'Vé đôi', price: PRICE, capacity: 10, sold: 3, held: 4, remaining: 3 },
      { name: 'Vé mời', price: 0, capacity: 5, sold: 2, held: 0, remaining: 3 },
      { name: 'Vé VIP', price: 500_000, capacity: 2, sold: 0, held: 0, remaining: 2 },
    ]);
    expect(Object.keys(res.body.ticketTypes[0]).sort()).toEqual(
      ['capacity', 'held', 'name', 'price', 'remaining', 'sold'].sort(),
    );
    for (const id of [pair, guest, vip, sale.event.id]) expect(res.text, id).not.toContain(id);

    // Đơn chờ thứ ba giữ 3 suất cuối: bán + giữ = sức chứa → còn 0.
    await place(sale, { tier: 0, quantity: 3 });
    // Đổi tên, đổi giá Hạng vé: Tổng quan hiện tên và giá hiện tại.
    await h.db.orm.execute(sql`UPDATE ticket_types SET name = 'Vé VIP sân 1', price = 450000 WHERE id = ${vip}`);
    expect((await overviewOf(sale.event.id)).ticketTypes).toEqual([
      { name: 'Vé đôi', price: PRICE, capacity: 10, sold: 3, held: 7, remaining: 0 },
      { name: 'Vé mời', price: 0, capacity: 5, sold: 2, held: 0, remaining: 3 },
      { name: 'Vé VIP sân 1', price: 450_000, capacity: 2, sold: 0, held: 0, remaining: 2 },
    ]);

    // Hạng vé không còn dòng tồn kho (bị xóa xen giữa hai câu đọc) bị bỏ, như `listTicketTypes`.
    await h.db.orm.execute(sql`DELETE FROM ticket_type_inventory WHERE ticket_type_id = ${vip}`);
    expect((await overviewOf(sale.event.id)).ticketTypes.map((t) => t.name)).toEqual(['Vé đôi', 'Vé mời']);
  });

  it('số câu truy vấn DB của một GET …/overview cố định: không tăng theo số Hạng vé hay số Vé đã check-in', async () => {
    const countQueries = async (eventId: string): Promise<number> => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      try {
        await overviewOf(eventId);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };
    // Một Hạng vé, một Đơn (Vé đã check-in).
    const single = await eventOnSale(org, [{ name: 'Vé mời', price: 0, capacity: 20 }]);
    await scanOk(single.event.id, (await place(single, { tier: 0 })).tickets[0]!);
    // Bốn Hạng vé, Đơn ở ba hạng, vài Vé đã check-in.
    const many = await eventOnSale(
      org,
      ['Vé A', 'Vé B', 'Vé C', 'Vé D'].map((name) => ({ name, price: 0, capacity: 20 })),
    );
    for (const tier of [0, 1, 2]) {
      const { tickets } = await place(many, { tier, quantity: 2 });
      await scanOk(many.event.id, tickets[0]!);
    }

    await countQueries(single.event.id);
    const one = await countQueries(single.event.id);
    expect(one).toBeGreaterThan(0);
    const several = await countQueries(many.event.id);
    expect((await overviewOf(many.event.id)).ticketTypes).toHaveLength(4);
    expect(several).toBe(one);
  });

  it('check-in: chỉ Vé valid (Vé hủy đã check-in không tính), cùng số với tab Check-in; Sự kiện khác không lẫn', async () => {
    const sale = await saleEvent();
    const tickets = [
      ...(await place(sale, { tier: 1, quantity: 4 })).tickets,
      ...(await place(sale, { tier: 1, quantity: 2 })).tickets,
    ];
    expect(tickets).toHaveLength(6);
    // Vé đã check-in ở Sự kiện khác (cùng BTC) không tính.
    const elsewhere = await saleEvent();
    await scanOk(elsewhere.event.id, (await place(elsewhere, { tier: 1 })).tickets[0]!);
    expect((await overviewOf(sale.event.id)).checkin).toEqual({ checkedInCount: 0, validTicketCount: 6 });

    for (const ticket of tickets.slice(0, 3)) await scanOk(sale.event.id, ticket);
    // Vé đã check-in rồi bị vô hiệu: ra khỏi cả hai số.
    await h.db.orm.execute(sql`
      UPDATE tickets SET status = 'cancelled', cancel_reason = ${TICKET_CANCEL_REASON.VOIDED}
       WHERE id = ${tickets[0]!.id}`);
    const overview = await overviewOf(sale.event.id);
    expect(overview.checkin).toEqual({ checkedInCount: 2, validTicketCount: 5 });
    const tab = CheckinEvent.parse(
      (await h.http.get(`/v1/checkin/events/${sale.event.id}`).set('cookie', org.owner.cookie).expect(200)).body,
    );
    expect({ checkedInCount: tab.checkedInCount, validTicketCount: tab.validTicketCount }).toEqual(overview.checkin);
  });
});

describe('quyền và phạm vi (REST và SSE)', () => {
  it('Admin xem được; chưa đăng nhập → 401; không phải thành viên → 403 NOT_A_MEMBER, không mở stream', async () => {
    const sale = await saleEvent();
    const admin = await signUp(h);
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
    );
    expect((await overviewOf(sale.event.id, admin.cookie)).revenue).toEqual({ amount: 0, paidOrders: 0 });
    const adminStream = await live(sale.event.id, admin.cookie);
    expect(adminStream.status).toBe(200);

    await h.http.get(overviewPath(sale.event.id)).expect(401);
    const stranger = await signUp(h);
    const rest = await h.http.get(overviewPath(sale.event.id)).set('cookie', stranger.cookie).expect(403);
    expect(ErrorResponse.parse(rest.body).error.code).toBe('NOT_A_MEMBER');
    const s = await live(sale.event.id, stranger.cookie);
    await s.ended;
    expect(s.status).toBe(403);
    expect(ErrorResponse.parse(JSON.parse(s.text())).error.code).toBe('NOT_A_MEMBER');
  });

  it('Owner BTC khác: trên BTC của mình với Sự kiện của BTC này → 404; trên BTC này → 403; không mở stream', async () => {
    const sale = await saleEvent();
    const other = await paidReadyOrg(h, { name: 'BTC khác' });
    const crossEvent = await h.http
      .get(overviewPath(sale.event.id, other.orgId))
      .set('cookie', other.owner.cookie)
      .expect(404);
    expect(ErrorResponse.parse(crossEvent.body).error.code).toBe('EVENT_NOT_FOUND');
    const crossOrg = await h.http.get(overviewPath(sale.event.id)).set('cookie', other.owner.cookie).expect(403);
    expect(ErrorResponse.parse(crossOrg.body).error.code).toBe('NOT_A_MEMBER');

    const s404 = await live(sale.event.id, other.owner.cookie, other.orgId);
    await s404.ended;
    expect(s404.status).toBe(404);
    expect(ErrorResponse.parse(JSON.parse(s404.text())).error.code).toBe('EVENT_NOT_FOUND');
    const s403 = await live(sale.event.id, other.owner.cookie);
    await s403.ended;
    expect(s403.status).toBe(403);
  });

  it('Sự kiện id ngẫu nhiên hoặc sai dạng → 404 EVENT_NOT_FOUND (REST và SSE, JSON, không treo)', async () => {
    for (const id of [randomUUID(), 'khong-phai-uuid']) {
      const rest = await h.http.get(overviewPath(id)).set('cookie', org.owner.cookie).expect(404);
      expect(ErrorResponse.parse(rest.body).error.code, id).toBe('EVENT_NOT_FOUND');
      const s = await live(id, org.owner.cookie);
      await s.ended;
      expect(s.status, id).toBe(404);
      expect(s.headers['content-type']).toMatch(/^application\/json/);
      expect(ErrorResponse.parse(JSON.parse(s.text())).error.code, id).toBe('EVENT_NOT_FOUND');
    }
  });
});

describe('stream …/overview/live: event_orders_changed theo Sự kiện', () => {
  it('Đơn 0đ mới → stream Sự kiện X (id thường hay HOA) có {type} trong 1 giây sau khi tạo Đơn xong; Sự kiện Y không nhận; REST thấy Đơn đầu khối, paidOrders +1', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    const streamX = await live(x.event.id, org.owner.cookie);
    // Id Sự kiện viết HOA trên URL vẫn khớp `eventId` (chữ thường) của tín hiệu.
    const streamXUpper = await live(x.event.id.toUpperCase(), org.owner.cookie);
    const streamY = await live(y.event.id, org.owner.cookie);
    expect(streamX.status).toBe(200);
    expect(streamXUpper.status).toBe(200);
    expect(streamX.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(streamX.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);

    const placed = await place(x, { tier: 1, quantity: 2, name: 'Đỗ Thị Lan' });
    const [signal] = await streamX.waitForMessages(1, 1_000);
    expect(signal!.raw).toBe('{"type":"event_orders_changed"}');
    const [upperSignal] = await streamXUpper.waitForMessages(1, 1_000);
    expect(upperSignal!.raw).toBe('{"type":"event_orders_changed"}');
    const overview = await overviewOf(x.event.id);
    expect(overview.revenue).toEqual({ amount: 0, paidOrders: 1 });
    expect(overview.recentOrders[0]).toMatchObject({ code: placed.code, status: 'paid', buyerName: 'Đỗ Thị Lan' });

    await sleep(300);
    expect(streamY.messages).toEqual([]);
    expect(streamX.messages).toHaveLength(1);
    expect(streamXUpper.messages).toHaveLength(1);
  });

  it('Đơn có phí được IPN trả → stream nhận tín hiệu; doanh thu + paid_amount, badge paid; Đơn của Sự kiện khác không tới', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    const placed = await place(x, { quantity: 1 });
    expect((await overviewOf(x.event.id)).recentOrders[0]).toMatchObject({ code: placed.code, status: 'pending' });
    const other = await place(y, { quantity: 1 });
    const streamX = await live(x.event.id, org.owner.cookie);

    await sendIpn(other).expect(200);
    await expect.poll(() => signalsOf({ id: other.orderId, type: RealtimeTopic.EVENT_ORDERS_CHANGED }).length).toBe(3);
    await sleep(200);
    expect(streamX.messages).toEqual([]);

    await sendIpn(placed).expect(200);
    await streamX.waitForMessages(1, 1_000);
    expect(streamX.messages.map((m) => m.raw)).toEqual(['{"type":"event_orders_changed"}']);
    const overview = await overviewOf(x.event.id);
    expect(overview.revenue).toEqual({ amount: PRICE, paidOrders: 1 });
    expect(overview.recentOrders[0]).toMatchObject({ code: placed.code, status: 'paid' });
  });

  it('lệch số tiền → tín hiệu; Đơn "review" kèm amount_mismatch, nhận 250.000đ / Đơn 300.000đ', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    const s = await live(sale.event.id, org.owner.cookie);
    await sendIpn(placed, { paidAmount: 250_000 }).expect(200);
    await s.waitForMessages(1, 1_000);
    const [order] = (await overviewOf(sale.event.id)).recentOrders;
    expect(order).toMatchObject({
      code: placed.code,
      status: 'review',
      totalAmount: PRICE,
      review: { type: 'amount_mismatch', receivedAmount: 250_000 },
    });
  });
});

describe('stream …/overview/live: org_review_items_changed (Story 4.3)', () => {
  it('mục Cần xử lý mới của BTC (Sự kiện khác, chưa khớp) → stream của X nhận org_review_items_changed; event_orders_changed của Sự kiện khác vẫn không tới; BTC khác không tới', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    const placedY = await place(y);
    await expect.poll(() => signalsOf({ id: placedY.orderId }).length).toBe(3);
    const streamX = await live(x.event.id, org.owner.cookie);
    expect(streamX.status).toBe(200);

    await sendIpn(placedY, { paidAmount: 1_000 }).expect(200);
    await streamX.waitForMessages(1, 1_000);
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload('TK0000ZZZZ', 5_000))).expect(200);
    await streamX.waitForMessages(2, 1_000);
    // Mục của BTC khác (chèn bằng SQL, tín hiệu phát tay như IPN) không tới.
    const other = await paidReadyOrg(h, { name: 'BTC khác' });
    await h.db.transaction((tx) => realtime.notifyOrganization(tx, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED, other.orgId));
    await sleep(300);
    expect(streamX.messages.map((m) => m.raw)).toEqual([
      '{"type":"org_review_items_changed"}',
      '{"type":"org_review_items_changed"}',
    ]);
    expect((await overviewOf(y.event.id)).openReviewCount).toBe(1);
    expect((await overviewOf(x.event.id)).openReviewCount).toBe(0);
  });
});

describe('stream …/overview/live: event_checkins_changed (Story 6.2)', () => {
  it('quét xanh một Vé của X → stream Tổng quan X nhận {type} dưới 1 giây, REST thấy số mới; Sự kiện Y cùng BTC và BTC khác không nhận', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    const other = await paidReadyOrg(h, { name: 'BTC khác' });
    const z = await eventOnSale(other, [{ name: 'Vé mời', price: 0, capacity: 20 }]);
    const xOrder = await place(x, { tier: 1, quantity: 2 });
    const yOrder = await place(y, { tier: 1 });
    const zOrder = await place(z, { tier: 0 });
    for (const placed of [xOrder, yOrder, zOrder]) {
      await expect.poll(() => signalsOf({ id: placed.orderId }).length).toBe(1);
    }
    await sleep(200);
    const streamX = await live(x.event.id, org.owner.cookie);
    const streamY = await live(y.event.id, org.owner.cookie);
    const streamZ = await live(z.event.id, other.owner.cookie, other.orgId);
    for (const s of [streamX, streamY, streamZ]) expect(s.status).toBe(200);
    expect((await overviewOf(x.event.id)).checkin).toEqual({ checkedInCount: 0, validTicketCount: 2 });

    // Mốc số tin của mỗi stream ngay trước khi quét: hub có thể nhận NOTIFY tạo Đơn muộn hơn listener của test, nên
    // `event_orders_changed` có thể tới stream sau khi mở. Chỉ xét tín hiệu check-in tới sau mốc.
    const marks = new Map([streamX, streamY, streamZ].map((s) => [s, s.messages.length]));
    const checkinsAfterMark = (s: SseClient) =>
      s.messages.slice(marks.get(s)).filter((m) => m.raw === CHECKINS_CHANGED).length;

    await scanOk(x.event.id, xOrder.tickets[0]!);
    await expect.poll(() => checkinsAfterMark(streamX), { timeout: 1_000 }).toBe(1);
    expect((await overviewOf(x.event.id)).checkin).toEqual({ checkedInCount: 1, validTicketCount: 2 });

    // Check-in ở BTC khác chỉ tới stream của Sự kiện đó.
    await scanOk(z.event.id, zOrder.tickets[0]!, other.owner);
    await expect.poll(() => checkinsAfterMark(streamZ), { timeout: 1_000 }).toBe(1);
    await sleep(300);
    expect(checkinsAfterMark(streamX)).toBe(1);
    expect(checkinsAfterMark(streamY)).toBe(0);
    expect(checkinsAfterMark(streamZ)).toBe(1);
  });
});

describe('điểm phát event_orders_changed', () => {
  it('payload {type, id Đơn, organizationId, eventId}; Đơn 0đ: một lần sau commit TX1, không order_changed', async () => {
    const sale = await saleEvent();
    const placed = await place(sale, { tier: 1 });
    await expect.poll(() => signalsOf({ id: placed.orderId }).length).toBe(1);
    await sleep(300);
    expect(signalsOf({ id: placed.orderId })).toEqual([
      { type: 'event_orders_changed', id: placed.orderId, organizationId: org.orgId, eventId: sale.event.id },
    ]);
  });

  it('Đơn có phí, Tingee từ chối tạo link: đúng một event_orders_changed (sau commit TX1), không order_changed', async () => {
    const sale = await saleEvent();
    const placed = await place(sale, { link: false });
    await expect.poll(() => signalsOf({ id: placed.orderId }).length).toBe(1);
    await sleep(300);
    expect(signalsOf({ id: placed.orderId }).map((n) => n.type)).toEqual(['event_orders_changed']);
  });

  it('Đơn có phí có link: sau commit TX1, rồi TX2 gắn link phát cùng lúc order_changed và event_orders_changed', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    await expect.poll(() => signalsOf({ id: placed.orderId }).length).toBe(3);
    await sleep(300);
    expect(signalsOf({ id: placed.orderId }).map((n) => n.type)).toEqual([
      'event_orders_changed',
      'order_changed',
      'event_orders_changed',
    ]);
  });

  it('TX1 rollback (vượt trần Vé miễn phí sau khi đã chèn Đơn) → không NOTIFY nào; Đơn không được tạo', async () => {
    const sale = await saleEvent({ maxTicketsPerOrder: 2 });
    const buyer = await signUp(h);
    await place(sale, { tier: 1, quantity: 2, buyer });
    await expect.poll(() => signalsOf({ eventId: sale.event.id }).length).toBe(1);
    const res = await postOrder(
      h,
      buyer,
      sale.event.slug,
      orderBody([{ ticketTypeId: sale.tiers[1]!.id, quantity: 1 }]),
    );
    expect(res.status).toBe(409);
    expect(ErrorResponse.parse(res.body).error.code).toBe('FREE_TICKET_LIMIT_REACHED');
    await sleep(400);
    expect(signalsOf({ eventId: sale.event.id })).toHaveLength(1);
    const { rows } = await h.db.pool.query('SELECT count(*)::int AS n FROM orders WHERE event_id = $1', [sale.event.id]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('gửi lại cùng Idempotency-Key (trả Đơn cũ) → không phát thêm', async () => {
    const sale = await saleEvent();
    const buyer = await signUp(h);
    const key = randomUUID();
    const body = orderBody([{ ticketTypeId: sale.tiers[1]!.id, quantity: 1 }]);
    expect((await postOrder(h, buyer, sale.event.slug, body, key)).status).toBe(201);
    await expect.poll(() => signalsOf({ eventId: sale.event.id }).length).toBe(1);
    expect((await postOrder(h, buyer, sale.event.slug, body, key)).status).toBe(200);
    await sleep(300);
    expect(signalsOf({ eventId: sale.event.id })).toHaveLength(1);
  });

  it('NOTIFY sau commit lỗi → chỉ log, Đơn vẫn tạo (201, paid)', async () => {
    const sale = await saleEvent();
    vi.spyOn(realtime, 'notify').mockRejectedValueOnce(new Error('NOTIFY lỗi giả lập'));
    const buyer = await signUp(h);
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[1]!.id, quantity: 1 }]));
    expect(res.status).toBe(201);
    expect(parseOrder(res.body).buyerStatus).toBe('paid');
    await sleep(300);
    expect(signalsOf({ eventId: sale.event.id })).toEqual([]);
    expect(h.logs.lines.some((l) => String(l.msg).includes('event_orders_changed'))).toBe(true);
    expect((await overviewOf(sale.event.id)).revenue.paidOrders).toBe(1);
  });
});
