import { randomInt, randomUUID } from 'node:crypto';
import {
  ErrorResponse,
  EventOrderDetail,
  EventOrderPage,
  eventOrderApiPath,
  eventOrdersApiPath,
  EventOverview,
  IDEMPOTENCY_KEY_HEADER,
  ORDER_CODE_ALPHABET,
  Role,
  type EventOrdersPathQuery,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  eventsPath,
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
import { orderState, postIpn } from '../payment/ipn-fixtures.js';
import {
  fakeAccount,
  fakeIpnPayload,
  fakeStatusIpnPayload,
  signIpn,
  startTingeeFake,
  type FakeIpnPayload,
  type TingeeFake,
} from '../tingee-fake/server.js';

/*
 * Story 6.1: tab Đơn — `GET /v1/orgs/:orgId/events/:eventId/orders` (lọc ở server, phân trang keyset `cursor` + `limit`)
 * và `GET …/orders/:code` (chi tiết: câu trả lời form, Vé, lịch sử), `reporting` ghép read model của `ordering`,
 * `ticketing`, `payment` trên Postgres thật và Tingee fake. Đơn thật đi qua đặt Đơn + IPN + thao tác Cần xử lý; ca cần
 * nhiều Đơn hoặc giờ tạo cố định chèn thẳng bằng SQL.
 */

const MAIN: TingeeCredential = { clientId: 'tg-orders-main-2b7d', secretToken: 'tg-orders-main-secret-Lp0Ok9Ij8' };
const account = fakeAccount({ accountName: 'PHAM THU HA' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const VIP = 300_000;
const NORMAL = 100_000;
const PHONE = '0912 345 678';
const PHONE_E164 = '+84912345678';

let fake: TingeeFake;
let h: Harness;
let org: Org;
let ipnKey: string;

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, { name: 'CLB Bơi lội Hồ Tây', credential: MAIN, payout: PAYOUT });
  ipnKey = await ipnKeyOf(h, org.orgId);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

const listPath = (eventId: string, query: EventOrdersPathQuery = {}, orgId = org.orgId) =>
  `/v1${eventOrdersApiPath(orgId, eventId, query)}`;
const detailPath = (eventId: string, code: string, orgId = org.orgId) => `/v1${eventOrderApiPath(orgId, eventId, code)}`;

async function listOf(eventId: string, query: EventOrdersPathQuery = {}, cookie = org.owner.cookie): Promise<EventOrderPage> {
  const res = await h.http.get(listPath(eventId, query)).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return EventOrderPage.parse(res.body);
}

const codesOf = async (eventId: string, query: EventOrdersPathQuery = {}) =>
  (await listOf(eventId, query)).orders.map((o) => o.code);

async function detailOf(eventId: string, code: string, cookie = org.owner.cookie): Promise<EventOrderDetail> {
  const res = await h.http.get(detailPath(eventId, code)).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return EventOrderDetail.parse(res.body);
}

/** Mọi trang của danh sách (`limit` mỗi trang): mã Đơn theo thứ tự đọc, và số trang. */
async function walk(eventId: string, query: Omit<EventOrdersPathQuery, 'cursor'>): Promise<{ codes: string[]; pages: number }> {
  const codes: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await listOf(eventId, { ...query, cursor });
    codes.push(...page.orders.map((o) => o.code));
    cursor = page.nextCursor ?? undefined;
    pages += 1;
    expect(pages).toBeLessThan(50);
  } while (cursor !== undefined);
  return { codes, pages };
}

/** Sự kiện mới đã mở bán: Hạng vé VIP 300.000đ và Thường 100.000đ (tạo theo thứ tự này), kèm câu hỏi nếu có. */
const saleEvent = (questions: Parameters<typeof eventOnSale>[2] = {}) =>
  eventOnSale(
    org,
    [
      { name: 'VIP', price: VIP, capacity: 50 },
      { name: 'Thường', price: NORMAL, capacity: 50 },
    ],
    questions,
  );

interface Placed {
  code: string;
  orderId: string;
  total: number;
  buyer: User;
}

/** Người mua mới đặt `vip` Vé VIP và `normal` Vé Thường; Đơn có link thanh toán của Tingee fake. */
async function place(
  sale: SaleEvent,
  options: { vip?: number; normal?: number; name?: string; phone?: string; answers?: Record<string, string> } = {},
): Promise<Placed> {
  const buyer = await signUp(h);
  const items = [
    ...((options.vip ?? 1) > 0 ? [{ ticketTypeId: sale.tiers[0]!.id, quantity: options.vip ?? 1 }] : []),
    ...(options.normal ? [{ ticketTypeId: sale.tiers[1]!.id, quantity: options.normal }] : []),
  ];
  const res = await postOrder(
    h,
    buyer,
    sale.event.slug,
    orderBody(items, {
      buyer: { name: options.name ?? 'Nguyễn Văn Minh', phone: options.phone ?? PHONE },
      answers: options.answers ?? {},
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  return { code: order.code, orderId: (await orderState(h, order.code)).id, total: order.totalAmount, buyer };
}

async function ipn(code: string, amount: number, overrides: FakeIpnPayload = {}): Promise<FakeIpnPayload> {
  const payload = fakeIpnPayload(code, amount, overrides);
  await postIpn(h, ipnKey, signIpn(MAIN.secretToken, payload)).expect(200);
  return payload;
}

async function itemIdOf(payload: FakeIpnPayload): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>(
    `SELECT r.id FROM review_items r JOIN payment_events e ON e.id = r.payment_event_id
      WHERE e.provider_transaction_code = $1`,
    [payload.providerTransactionCode],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

/** Thao tác trên mục Cần xử lý (Story 4.4) bằng Owner: 200. */
async function act(itemId: string, action: 'approve' | 'reject' | 'refund'): Promise<void> {
  const res = await h.http
    .post(`/v1/orgs/${org.orgId}/review-items/${itemId}/${action}`)
    .set('cookie', org.owner.cookie)
    .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
    .send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const randomCode = () =>
  `TK${Array.from({ length: 8 }, () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)]).join('')}`;

interface Seed {
  createdAt: string;
  code?: string;
  /** `expired` (mặc định) hoặc `paid` (Đơn 0đ, nguồn `free`). */
  status?: 'expired' | 'paid';
  name?: string;
  phone?: string;
  email?: string;
}

/** Chèn thẳng Đơn (không dòng, không Vé) cho Sự kiện `sale`, giờ tạo cố định đủ micro giây. Trả mã theo thứ tự `seeds`. */
async function seed(sale: SaleEvent, seeds: Seed[]): Promise<string[]> {
  const rows = seeds.map((s) => ({
    code: s.code ?? randomCode(),
    created_at: s.createdAt,
    status: s.status ?? 'expired',
    name: s.name ?? 'Người mua chèn tay',
    phone: s.phone ?? '+84900000000',
    email: s.email ?? 'chen-tay@vidu.vn',
  }));
  await h.db.pool.query(
    `INSERT INTO orders (code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                         buyer_email, idempotency_key, expires_at, created_at, paid_at, paid_amount, paid_source)
     SELECT s.code, gen_random_uuid(), $1, $2, s.status, 0, s.name, s.phone, s.email, gen_random_uuid(), s.created_at,
            s.created_at,
            CASE WHEN s.status = 'paid' THEN s.created_at END,
            CASE WHEN s.status = 'paid' THEN 0 END,
            CASE WHEN s.status = 'paid' THEN 'free' END
       FROM jsonb_to_recordset($3::jsonb)
         AS s(code text, created_at timestamptz, status text, name text, phone text, email text)`,
    [sale.event.id, org.orgId, JSON.stringify(rows)],
  );
  return rows.map((r) => r.code);
}

/** Giờ tạo thứ `i` (giây tăng dần) kèm phần micro giây `micros`. */
const at = (i: number, micros = '000000') =>
  `2026-11-26T${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.${micros}Z`;

async function addAdmin(): Promise<User> {
  const admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return admin;
}

describe('danh sách: phân trang keyset', () => {
  it('120 Đơn, limit mặc định 50 → 50 Đơn mới nhất kèm nextCursor; đi hết 3 trang, không mất, không lặp; cursor mờ, không chứa id nội bộ', async () => {
    const sale = await saleEvent();
    const codes = await seed(
      sale,
      Array.from({ length: 120 }, (_, i) => ({ createdAt: at(i, String(i).padStart(6, '0')) })),
    );
    const newestFirst = [...codes].reverse();

    const first = await listOf(sale.event.id);
    expect(first.orders.map((o) => o.code)).toEqual(newestFirst.slice(0, 50));
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const { rows } = await h.db.pool.query<{ id: string }>('SELECT id FROM orders WHERE code = $1', [newestFirst[49]]);
    expect(Buffer.from(first.nextCursor!, 'base64url').toString()).not.toContain(rows[0]!.id);

    const second = await listOf(sale.event.id, { cursor: first.nextCursor! });
    expect(second.orders.map((o) => o.code)).toEqual(newestFirst.slice(50, 100));
    const third = await listOf(sale.event.id, { cursor: second.nextCursor! });
    expect(third.orders.map((o) => o.code)).toEqual(newestFirst.slice(100));
    expect(third.nextCursor).toBeNull();

    expect(await walk(sale.event.id, { limit: 100 })).toEqual({ codes: newestFirst, pages: 2 });
  });

  it('trùng created_at: 3 Đơn cùng micro giây ở ranh giới trang và 2 Đơn cùng mili giây khác micro giây → đi hết (limit 2): không mất, không lặp; created_at rồi mã Đơn giảm dần', async () => {
    const sale = await saleEvent();
    const same = at(10, '123456');
    const [a, b, c] = [randomCode(), randomCode(), randomCode()];
    const codes = await seed(sale, [
      { createdAt: at(1) },
      { createdAt: same, code: a },
      { createdAt: same, code: b },
      { createdAt: same, code: c },
      // Cùng mili giây với nhau, khác micro giây: qua `Date` của JS sẽ thành một mốc.
      { createdAt: at(20, '500001') },
      { createdAt: at(20, '500002') },
    ]);
    const expected = [codes[5]!, codes[4]!, ...[a!, b!, c!].sort().reverse(), codes[0]!];
    for (const limit of [1, 2, 3, 4]) {
      const { codes: read } = await walk(sale.event.id, { limit });
      expect(read, `limit ${limit}`).toEqual(expected);
    }
  });

  it('Sự kiện chưa có Đơn → trang rỗng, nextCursor null', async () => {
    const sale = await saleEvent();
    expect(await listOf(sale.event.id)).toEqual({ orders: [], nextCursor: null });
  });
});

describe('danh sách: dòng Đơn', () => {
  it('đủ trường: Người mua (SĐT E.164), Vé theo Hạng vé, tổng tiền, tiền đã nhận, lúc tạo/thanh toán; không id nội bộ', async () => {
    const sale = await saleEvent();
    const paid = await place(sale, { vip: 2, normal: 1, name: 'Phạm Thu Hà', phone: '0987.654.321' });
    await ipn(paid.code, paid.total);
    const pending = await place(sale, { vip: 1, name: 'Lê Hoàng Nam' });

    const page = await listOf(sale.event.id);
    expect(page.orders.map((o) => o.code)).toEqual([pending.code, paid.code]);
    const [p, q] = page.orders;
    expect(q).toMatchObject({
      code: paid.code,
      buyerName: 'Phạm Thu Hà',
      buyerEmail: paid.buyer.email,
      buyerPhone: '+84987654321',
      items: [
        { ticketTypeName: 'VIP', quantity: 2 },
        { ticketTypeName: 'Thường', quantity: 1 },
      ],
      totalAmount: 2 * VIP + NORMAL,
      paidAmount: 2 * VIP + NORMAL,
      status: 'paid',
      review: null,
    });
    expect(q!.paidAt).not.toBeNull();
    expect(p).toMatchObject({ code: pending.code, status: 'pending', paidAmount: null, paidAt: null, items: [{ ticketTypeName: 'VIP', quantity: 1 }] });
    expect(Object.keys(p!).sort()).toEqual(
      ['buyerEmail', 'buyerName', 'buyerPhone', 'code', 'createdAt', 'items', 'paidAmount', 'paidAt', 'review', 'status', 'totalAmount'].sort(),
    );
    const res = await h.http.get(listPath(sale.event.id)).set('cookie', org.owner.cookie).expect(200);
    for (const leak of [paid.orderId, pending.orderId, paid.buyer.userId, sale.event.id, sale.tiers[0]!.id]) {
      expect(res.text, leak).not.toContain(leak);
    }
  });
});

describe('danh sách: lọc theo trạng thái', () => {
  it('mỗi chip lọc ở server; "Cần xử lý" = Đơn có mục open ở mọi trạng thái (khớp số của needs-action-card); "Tất cả" có cả Đơn hết hạn', async () => {
    const sale = await saleEvent();
    const paid = await place(sale, { name: 'Đã trả' });
    await ipn(paid.code, paid.total);
    const pending = await place(sale, { name: 'Đang chờ' });
    const mismatch = await place(sale, { name: 'Lệch tiền' });
    await ipn(mismatch.code, 250_000);
    // Trả trùng cho Đơn đã `paid`: Đơn vẫn `paid`, có mục `duplicate_payment` open.
    const duplicate = await place(sale, { name: 'Trả trùng' });
    await ipn(duplicate.code, duplicate.total);
    await ipn(duplicate.code, duplicate.total);
    // Từ chối: Đơn `cancelled`, mục vẫn open tới khi hoàn tay.
    const rejected = await place(sale, { name: 'Bị từ chối' });
    await act(await itemIdOf(await ipn(rejected.code, 100_000)), 'reject');
    // Từ chối rồi hoàn tay: Đơn `refunded`, mục đã đóng.
    const refunded = await place(sale, { name: 'Đã hoàn' });
    const refundItem = await itemIdOf(await ipn(refunded.code, 120_000));
    await act(refundItem, 'reject');
    await act(refundItem, 'refund');
    const expired = await place(sale, { name: 'Hết hạn' });
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeStatusIpnPayload(expired.code, expired.total, 'expired'))).expect(200);
    expect((await orderState(h, expired.code)).status).toBe('expired');

    const newest = [expired, refunded, rejected, duplicate, mismatch, pending, paid].map((o) => o.code);
    expect(await codesOf(sale.event.id)).toEqual(newest);
    expect(await codesOf(sale.event.id, { status: 'paid' })).toEqual([duplicate.code, paid.code]);
    expect(await codesOf(sale.event.id, { status: 'pending' })).toEqual([pending.code]);
    expect(await codesOf(sale.event.id, { status: 'cancelled' })).toEqual([rejected.code]);
    expect(await codesOf(sale.event.id, { status: 'refunded' })).toEqual([refunded.code]);
    const needsAction = await listOf(sale.event.id, { status: 'needs_action' });
    expect(needsAction.orders.map((o) => [o.code, o.status, o.review])).toEqual([
      [rejected.code, 'cancelled', { type: 'amount_mismatch', receivedAmount: 100_000 }],
      [duplicate.code, 'paid', { type: 'duplicate_payment', receivedAmount: VIP }],
      [mismatch.code, 'review', { type: 'amount_mismatch', receivedAmount: 250_000 }],
    ]);
    const overview = await h.http
      .get(`/v1/orgs/${org.orgId}/events/${sale.event.id}/overview`)
      .set('cookie', org.owner.cookie)
      .expect(200);
    expect(EventOverview.parse(overview.body).openReviewCount).toBe(needsAction.orders.length);

    // `review` có ở mọi trạng thái Đơn, cả khi không lọc.
    const all = await listOf(sale.event.id);
    expect(all.orders.find((o) => o.code === duplicate.code)!.review).toEqual({ type: 'duplicate_payment', receivedAmount: VIP });
    expect(all.orders.find((o) => o.code === refunded.code)!.review).toBeNull();

    // Phân trang trong bộ lọc "Cần xử lý".
    expect((await walk(sale.event.id, { status: 'needs_action', limit: 1 })).codes).toEqual(
      needsAction.orders.map((o) => o.code),
    );
  });

  it('"Cần xử lý" không có mục open → trang rỗng; mục open của Sự kiện khác không lọt vào', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    await place(x);
    const other = await place(y);
    await ipn(other.code, 1_000);
    expect(await listOf(x.event.id, { status: 'needs_action' })).toEqual({ orders: [], nextCursor: null });
    expect(await codesOf(y.event.id, { status: 'needs_action' })).toEqual([other.code]);
  });
});

describe('danh sách: tìm theo mã Đơn, email, SĐT', () => {
  it('khớp đầy đủ sau chuẩn hóa (SĐT E.164, email chữ thường, mã Đơn viết hoa); không khớp một phần; không lấy Đơn của Sự kiện khác; status AND q', async () => {
    const sale = await saleEvent();
    const other = await saleEvent();
    const code = randomCode();
    const [phoneA, phoneB, emailUpper, emailLower, , , byCode] = await seed(sale, [
      { createdAt: at(1), phone: PHONE_E164, status: 'paid' },
      { createdAt: at(2), phone: PHONE_E164 },
      { createdAt: at(3), email: 'Minh@X.vn' },
      { createdAt: at(4), email: 'minh@x.vn' },
      { createdAt: at(5), email: 'a.minh@x.vn' },
      { createdAt: at(6), email: 'minh@x.vn.com', phone: '+84912345679' },
      { createdAt: at(7), code },
    ]);
    const [foreignPhone] = await seed(other, [{ createdAt: at(8), phone: PHONE_E164, email: 'minh@x.vn' }]);

    expect(await codesOf(sale.event.id, { q: '0912 345 678' })).toEqual([phoneB, phoneA]);
    expect(await codesOf(sale.event.id, { q: '+84 912.345.678' })).toEqual([phoneB, phoneA]);
    expect(await codesOf(sale.event.id, { q: 'Minh@X.vn' })).toEqual([emailLower, emailUpper]);
    expect(await codesOf(sale.event.id, { q: code.toLowerCase() })).toEqual([byCode]);
    expect(await codesOf(sale.event.id, { q: ` ${code} ` })).toEqual([byCode]);
    expect(await codesOf(sale.event.id, { q: foreignPhone!.toLowerCase() })).toEqual([]);
    expect(await codesOf(other.event.id, { q: PHONE })).toEqual([foreignPhone]);
    expect(await codesOf(sale.event.id, { q: '0912 345 678', status: 'paid' })).toEqual([phoneA]);
    expect(await codesOf(sale.event.id, { q: 'minh@x.vn', status: 'paid' })).toEqual([]);
    expect((await walk(sale.event.id, { q: PHONE, limit: 1 })).codes).toEqual([phoneB, phoneA]);
  });

  it('giá trị tìm không vào log của api', async () => {
    const sale = await saleEvent();
    const before = h.logs.lines.length;
    await listOf(sale.event.id, { q: '0977 111 222' });
    await listOf(sale.event.id, { q: 'Rieng.Tu@VIDU.vn' });
    await h.http.get(listPath(sale.event.id, { q: '0977' })).set('cookie', org.owner.cookie).expect(400);
    const logged = JSON.stringify(h.logs.lines.slice(before));
    for (const value of ['0977', '977111222', 'Rieng', 'rieng.tu', 'VIDU']) expect(logged, value).not.toContain(value);
  });
});

describe('danh sách: query sai → 400 VALIDATION_FAILED', () => {
  it('q sai dạng, cursor hỏng, status lạ (kể cả expired), limit ngoài 1–100; lỗi không lặp lại giá trị', async () => {
    const sale = await saleEvent();
    for (const query of [
      'q=0912',
      'q=minh%40',
      'q=',
      'cursor=abc',
      'status=expired',
      'status=review',
      'limit=0',
      'limit=101',
      'q=0912345678&q=0987654321',
    ]) {
      const res = await h.http.get(`${listPath(sale.event.id)}?${query}`).set('cookie', org.owner.cookie);
      expect(res.status, query).toBe(400);
      expect(ErrorResponse.parse(res.body).error.code, query).toBe('VALIDATION_FAILED');
      expect(res.text, query).not.toContain('0912');
    }
    expect((await listOf(sale.event.id, { limit: 100 })).orders).toEqual([]);
  });
});

describe('chi tiết Đơn', () => {
  it('Đơn duyệt tay khi lệch tiền (300.000đ, nhận 250.000đ): tiền đã nhận 250.000đ, nguồn manual; lịch sử "Cần xử lý · Lệch số tiền" rồi "Đã thanh toán · Duyệt tay"; câu trả lời theo nhãn lúc đặt kể cả câu đã xóa; Vé theo seq kèm check-in; không QR, token, id', async () => {
    const sale = await saleEvent({
      questions: [
        { label: 'Size áo', kind: 'text', required: true },
        { label: 'Câu lạc bộ', kind: 'text', required: false },
      ],
    });
    const [size, club] = sale.questions;
    const placed = await place(sale, {
      vip: 1,
      name: 'Võ Minh Thư',
      answers: { [size!.id]: 'L', [club!.id]: 'CLB Hồ Tây' },
    });
    expect(placed.total).toBe(VIP);
    // Tingee báo tiền về một giờ trước: `paid_at` của Đơn duyệt tay là lúc này, sớm hơn lúc mở mục Cần xử lý.
    const paidAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const itemId = await itemIdOf(await ipn(placed.code, 250_000, { paidAt }));
    await act(itemId, 'approve');
    expect((await orderState(h, placed.code)).paid_at!.toISOString()).toBe(paidAt);

    // BTC đổi nhãn câu đầu và xóa câu sau sau khi đã có Đơn.
    await h.http
      .patch(`${eventsPath(org, sale.event.id)}/form/questions/${size!.id}`)
      .set('cookie', org.owner.cookie)
      .send({ label: 'Cỡ áo thi đấu', kind: 'text', required: true, options: [] })
      .expect(200);
    await h.http.delete(`${eventsPath(org, sale.event.id)}/form/questions/${club!.id}`).set('cookie', org.owner.cookie).expect(204);
    await h.db.pool.query(`UPDATE tickets SET checked_in_at = now() WHERE order_id = $1`, [placed.orderId]);

    const detail = await detailOf(sale.event.id, placed.code);
    expect(detail).toMatchObject({
      code: placed.code,
      buyerName: 'Võ Minh Thư',
      buyerEmail: placed.buyer.email,
      buyerPhone: PHONE_E164,
      items: [{ ticketTypeName: 'VIP', quantity: 1 }],
      totalAmount: VIP,
      paidAmount: 250_000,
      status: 'paid',
      paidSource: 'manual',
      cancelReason: null,
      review: null,
      answers: [
        { label: 'Size áo', answer: 'L' },
        { label: 'Câu lạc bộ', answer: 'CLB Hồ Tây' },
      ],
    });
    expect(detail.tickets).toEqual([
      {
        seq: 1,
        orderTicketCount: 1,
        ticketTypeName: 'VIP',
        holderName: 'Võ Minh Thư',
        status: 'valid',
        cancelReason: null,
        checkedInAt: expect.any(String),
      },
    ]);
    expect(detail.history.map((e) => e.kind)).toEqual(['created', 'review_opened', 'paid']);
    expect(detail.history[1]).toMatchObject({ reviewType: 'amount_mismatch' });
    expect(detail.history[2]).toMatchObject({ paidSource: 'manual' });
    // "Đã thanh toán · Duyệt tay" lấy lúc BTC duyệt (audit `order.paid`), không phải `paid_at` (lúc tiền về).
    const { rows: paidAudit } = await h.db.pool.query<{ created_at: Date }>(
      `SELECT created_at FROM audit_events WHERE action = 'order.paid' AND target_type = 'order' AND target_id = $1`,
      [placed.orderId],
    );
    expect(paidAudit).toHaveLength(1);
    expect(detail.history[2]!.at).toBe(paidAudit[0]!.created_at.toISOString());
    const times = detail.history.map((e) => Date.parse(e.at));
    expect([...times].sort((x, y) => x - y)).toEqual(times);

    const res = await h.http.get(detailPath(sale.event.id, placed.code)).set('cookie', org.owner.cookie).expect(200);
    const { rows: tickets } = await h.db.pool.query<{ id: string; share_token_hash: string | null }>(
      'SELECT id, share_token_hash FROM tickets WHERE order_id = $1',
      [placed.orderId],
    );
    for (const leak of [placed.orderId, placed.buyer.userId, itemId, sale.event.id, size!.id, ...tickets.map((t) => t.id)]) {
      expect(res.text, leak).not.toContain(leak);
    }
    for (const key of ['"id"', '"qr"', '"shareToken"', '"checkinScanId"', '"checkedInBy"']) {
      expect(res.text, key).not.toContain(key);
    }
  });

  it('lịch sử: Đơn review có mục open, Đơn bị từ chối rồi hoàn tay, Đơn hết hạn; mã Đơn trim + viết hoa', async () => {
    const sale = await saleEvent();
    const review = await place(sale);
    await ipn(review.code, 1_000);
    const refunded = await place(sale);
    const refundItem = await itemIdOf(await ipn(refunded.code, 2_000));
    await act(refundItem, 'reject');
    await act(refundItem, 'refund');
    const expired = await place(sale);
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeStatusIpnPayload(expired.code, expired.total, 'expired'))).expect(200);

    const r = await detailOf(sale.event.id, ` ${review.code.toLowerCase()} `);
    expect(r).toMatchObject({ code: review.code, status: 'review', review: { type: 'amount_mismatch', receivedAmount: 1_000 } });
    expect(r.history.map((e) => e.kind)).toEqual(['created', 'review_opened']);
    expect(r.tickets).toEqual([]);

    const f = await detailOf(sale.event.id, refunded.code);
    expect(f).toMatchObject({ status: 'refunded', cancelReason: 'rejected', paidSource: null, review: null });
    expect(f.history.map((e) => e.kind)).toEqual(['created', 'review_opened', 'cancelled', 'refunded']);

    const e = await detailOf(sale.event.id, expired.code);
    expect(e.history.map((x) => x.kind)).toEqual(['created', 'expired']);
    // IPN `expired` chuyển Đơn sang `expired` trước hạn Giữ chỗ (không đổi `expires_at`): "Hết hạn" lấy lúc Đơn đổi.
    const { rows: expiredRows } = await h.db.pool.query<{ updated_at: Date; expires_at: Date }>(
      'SELECT updated_at, expires_at FROM orders WHERE code = $1',
      [expired.code],
    );
    const expiredRow = expiredRows[0]!;
    expect(expiredRow.updated_at.getTime()).toBeLessThan(expiredRow.expires_at.getTime());
    expect(e.history[1]!.at).toBe(expiredRow.updated_at.toISOString());
    expect(Date.parse(e.history[1]!.at)).toBeLessThanOrEqual(expiredRow.expires_at.getTime());
  });

  it('Đơn 0đ: lịch sử "Đã thanh toán · Miễn phí"; Đơn bị hủy không audit (hủy Sự kiện) lấy lúc Đơn đổi', async () => {
    const sale = await eventOnSale(org, [{ name: 'Vé mời', price: 0, capacity: 10 }]);
    const buyer = await signUp(h);
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 2 }]));
    expect(res.status).toBe(201);
    const code = parseOrder(res.body).code;
    const free = await detailOf(sale.event.id, code);
    expect(free).toMatchObject({ status: 'paid', paidSource: 'free', paidAmount: 0, totalAmount: 0 });
    expect(free.history.map((e) => [e.kind, 'paidSource' in e ? e.paidSource : null])).toEqual([
      ['created', null],
      ['paid', 'free'],
    ]);
    expect(free.tickets.map((t) => [t.seq, t.orderTicketCount, t.status])).toEqual([
      [1, 2, 'valid'],
      [2, 2, 'valid'],
    ]);

    // Hủy Sự kiện (Story 7.1) chưa có: giả lập bằng SQL, nên Đơn không có audit `order.rejected`. SQL thô không tự đổi
    // `updated_at`: đặt rõ.
    const cancelledAt = new Date(Date.now() + 5 * 60_000);
    await h.db.pool.query(
      `UPDATE orders SET status = 'cancelled', cancel_reason = 'event_cancelled', updated_at = $2 WHERE code = $1`,
      [code, cancelledAt],
    );
    await h.db.pool.query(`UPDATE tickets SET status = 'cancelled', cancel_reason = 'event_cancelled' WHERE order_code = $1`, [code]);
    const cancelled = await detailOf(sale.event.id, code);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'event_cancelled' });
    expect(cancelled.history.map((e) => e.kind)).toEqual(['created', 'paid', 'cancelled']);
    expect(cancelled.history[2]!.at).toBe(cancelledAt.toISOString());
    expect(cancelled.tickets.map((t) => [t.status, t.cancelReason])).toEqual([
      ['cancelled', 'event_cancelled'],
      ['cancelled', 'event_cancelled'],
    ]);
  });
});

describe('quyền và phạm vi', () => {
  it('Admin xem được; chưa đăng nhập → 401; không phải thành viên → 403 NOT_A_MEMBER', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    const admin = await addAdmin();
    expect((await listOf(sale.event.id, {}, admin.cookie)).orders.map((o) => o.code)).toEqual([placed.code]);
    expect((await detailOf(sale.event.id, placed.code, admin.cookie)).code).toBe(placed.code);

    for (const path of [listPath(sale.event.id), detailPath(sale.event.id, placed.code)]) {
      await h.http.get(path).expect(401);
      const stranger = await signUp(h);
      const res = await h.http.get(path).set('cookie', stranger.cookie).expect(403);
      expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
    }
  });

  it('CTV được giao Sự kiện gọi cả hai route → 403 NOT_A_MEMBER', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    const checker = await signUp(h);
    await h.db.orm.execute(
      sql`INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES (${org.orgId}, ${sale.event.id}, ${checker.userId}, 'active')`,
    );
    for (const path of [listPath(sale.event.id), detailPath(sale.event.id, placed.code)]) {
      const res = await h.http.get(path).set('cookie', checker.cookie).expect(403);
      expect(ErrorResponse.parse(res.body).error.code, path).toBe('NOT_A_MEMBER');
      expect(res.text).not.toContain(placed.code);
    }
  });

  it('Sự kiện id ngẫu nhiên hoặc sai dạng → 404 EVENT_NOT_FOUND ở cả hai route (kiểm trước mã Đơn)', async () => {
    const sale = await saleEvent();
    const placed = await place(sale);
    for (const id of [randomUUID(), 'khong-phai-uuid']) {
      for (const path of [listPath(id), detailPath(id, placed.code), detailPath(id, 'khong-phai-ma')]) {
        const res = await h.http.get(path).set('cookie', org.owner.cookie).expect(404);
        expect(ErrorResponse.parse(res.body).error.code, path).toBe('EVENT_NOT_FOUND');
      }
    }
  });

  it('mã Đơn sai dạng, không có, của Sự kiện khác cùng BTC, của BTC khác → 404 ORDER_NOT_FOUND; danh sách không lẫn Sự kiện khác', async () => {
    const x = await saleEvent();
    const y = await saleEvent();
    const inX = await place(x);
    const inY = await place(y);
    const otherOrg = await paidReadyOrg(h, { name: 'BTC khác', credential: MAIN, payout: PAYOUT });
    const foreign = await eventOnSale(otherOrg, [{ name: 'Vé mời', price: 0, capacity: 5 }]);
    const foreignBuyer = await signUp(h);
    const foreignRes = await postOrder(
      h,
      foreignBuyer,
      foreign.event.slug,
      orderBody([{ ticketTypeId: foreign.tiers[0]!.id, quantity: 1 }]),
    );
    const foreignCode = parseOrder(foreignRes.body).code;

    for (const code of ['khong-phai-ma', 'TK123', randomCode(), inY.code, foreignCode]) {
      const res = await h.http.get(detailPath(x.event.id, code)).set('cookie', org.owner.cookie).expect(404);
      expect(ErrorResponse.parse(res.body).error.code, code).toBe('ORDER_NOT_FOUND');
    }
    expect(await codesOf(x.event.id)).toEqual([inX.code]);
    expect(await codesOf(x.event.id, { q: inY.code })).toEqual([]);

    // Owner BTC khác: Sự kiện của BTC này trên BTC của mình → 404; trên BTC này → 403.
    const cross = await h.http
      .get(listPath(x.event.id, {}, otherOrg.orgId))
      .set('cookie', otherOrg.owner.cookie)
      .expect(404);
    expect(ErrorResponse.parse(cross.body).error.code).toBe('EVENT_NOT_FOUND');
    const crossDetail = await h.http
      .get(detailPath(x.event.id, inX.code, otherOrg.orgId))
      .set('cookie', otherOrg.owner.cookie)
      .expect(404);
    expect(ErrorResponse.parse(crossDetail.body).error.code).toBe('EVENT_NOT_FOUND');
    const crossOrg = await h.http.get(listPath(x.event.id)).set('cookie', otherOrg.owner.cookie).expect(403);
    expect(ErrorResponse.parse(crossOrg.body).error.code).toBe('NOT_A_MEMBER');
  });
});
