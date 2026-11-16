import { randomInt, randomUUID } from 'node:crypto';
import {
  ErrorResponse,
  ORDER_CODE_ALPHABET,
  organizationLiveApiPath,
  ReviewItemDetail,
  ReviewQueue,
  ReviewQueueSummary,
  Role,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
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
import { orderState, postIpn } from '../payment/ipn-fixtures.js';
import { listen, openSse, type SseClient } from '../platform/sse-client.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type FakeIpnPayload, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 4.3: hàng Cần xử lý của BTC — `GET /v1/orgs/:orgId/review-items[?eventId=]`, `…/summary`, `…/:itemId` (`reporting`
 * ghép read model của `payment`, `ordering`, `event`) trên Postgres thật và Tingee fake. Mục tạo bằng IPN thật (lệch số
 * tiền, trả trùng, mồ côi, chưa khớp); ca cần nhiều mục chèn thẳng bằng SQL. Tín hiệu `org_review_items_changed` khi tạo mục:
 * `ipn-edge.test.ts` (commit, rollback) và `organization-live.test.ts` (stream cấp BTC).
 */

const MAIN: TingeeCredential = { clientId: 'tg-review-main-7c3a', secretToken: 'tg-review-main-secret-Zx9Cv8Bn7' };
const account = fakeAccount({ accountName: 'LE THI MAI' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const PRICE = 300_000;
const BUYER_PHONE = '0912 345 678';

let fake: TingeeFake;
let h: Harness;
let http: Awaited<ReturnType<typeof listen>>;
const streams: SseClient[] = [];

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  http = await listen(h.app);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  for (const s of streams) s.close();
  await http.close();
  await h.close();
  await fake.close();
});

/** BTC mới (Owner mới) bán được Vé có phí bằng `MAIN`, kèm `ipnKey`: mỗi ca một BTC để hàng không lẫn mục của ca khác. */
async function freshOrg(name = 'CLB Bóng rổ Tân Bình'): Promise<Org & { ipnKey: string }> {
  const org = await paidReadyOrg(h, { name, credential: MAIN, payout: PAYOUT });
  return { ...org, ipnKey: await ipnKeyOf(h, org.orgId) };
}

/** Sự kiện mới đã mở bán của `org` (một Hạng vé 300.000đ), đổi tên thành `name`. */
async function saleEvent(org: Org, name: string): Promise<SaleEvent> {
  const sale = await eventOnSale(org, [{ name: 'Vé thường', price: PRICE, capacity: 20 }]);
  await h.db.orm.execute(sql`UPDATE events SET name = ${name} WHERE id = ${sale.event.id}`);
  return sale;
}

interface Placed {
  code: string;
  orderId: string;
  total: number;
  buyer: User;
}

/** Người mua mới tên `name` đặt 1 Vé ở `sale`; Đơn có link thanh toán của Tingee fake. */
async function place(sale: SaleEvent, name: string): Promise<Placed> {
  const buyer = await signUp(h);
  const res = await postOrder(
    h,
    buyer,
    sale.event.slug,
    orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }], { buyer: { name, phone: BUYER_PHONE } }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  return { code: order.code, orderId: (await orderState(h, order.code)).id, total: order.totalAmount, buyer };
}

/** Gửi IPN `success` đã ký cho mã `code` tới URL IPN của `org`: 200. Trả body đã gửi. */
async function ipn(
  org: { ipnKey: string },
  code: string,
  amount: number,
  overrides: FakeIpnPayload = {},
): Promise<FakeIpnPayload> {
  const payload = fakeIpnPayload(code, amount, overrides);
  await postIpn(h, org.ipnKey, signIpn(MAIN.secretToken, payload)).expect(200);
  return payload;
}

/** Mã đúng `ORDER_CODE_PATTERN` mà không có Đơn nào (tiền về không khớp Đơn). */
const strayCode = () =>
  `TK${Array.from({ length: 8 }, () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)]).join('')}`;

const listPath = (orgId: string, eventId?: string) =>
  `/v1/orgs/${orgId}/review-items${eventId === undefined ? '' : `?eventId=${encodeURIComponent(eventId)}`}`;
const summaryPath = (orgId: string) => `/v1/orgs/${orgId}/review-items/summary`;
const itemPath = (orgId: string, itemId: string) => `/v1/orgs/${orgId}/review-items/${itemId}`;

async function queueOf(org: Org, eventId?: string, cookie = org.owner.cookie): Promise<ReviewQueue> {
  const res = await h.http.get(listPath(org.orgId, eventId)).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return ReviewQueue.parse(res.body);
}

async function openCountOf(org: Org, cookie = org.owner.cookie): Promise<number> {
  const res = await h.http.get(summaryPath(org.orgId)).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return ReviewQueueSummary.parse(res.body).openCount;
}

async function detailOf(org: Org, itemId: string, cookie = org.owner.cookie): Promise<ReviewItemDetail> {
  const res = await h.http.get(itemPath(org.orgId, itemId)).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return ReviewItemDetail.parse(res.body);
}

/** Id mục Cần xử lý của khoản tiền có mã giao dịch `payload.providerTransactionCode`. */
async function itemIdOf(payload: FakeIpnPayload): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>(
    `SELECT r.id FROM review_items r JOIN payment_events e ON e.id = r.payment_event_id
      WHERE e.provider_transaction_code = $1`,
    [payload.providerTransactionCode],
  );
  expect(rows, String(payload.providerTransactionCode)).toHaveLength(1);
  return rows[0]!.id;
}

async function addAdmin(org: Org): Promise<User> {
  const admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return admin;
}

/**
 * Chèn `count` mục `unmatched` `open` của BTC bằng SQL (mỗi mục một khoản tiền, nhận 10.000đ × thứ tự chèn). Lúc tạo tăng
 * dần theo thứ tự chèn, hoặc cùng một lúc (`sameTime`). Trả id mọi mục của BTC theo lúc tạo rồi id.
 */
async function insertUnmatched(orgId: string, count: number, { sameTime = false } = {}): Promise<string[]> {
  await h.db.pool.query(
    `WITH events AS (
       INSERT INTO payment_events (organization_id, kind, status, provider_order_id, provider_transaction_code, paid_amount)
       SELECT $1, 'payment', 'success', 'TK0000ZZZZ', 'tg-bulk-' || gen_random_uuid(), 10000 * g
         FROM generate_series(1, $2::int) AS g
       RETURNING id, paid_amount
     )
     INSERT INTO review_items (organization_id, payment_event_id, type, created_at)
     SELECT $1, id, 'unmatched',
            CASE WHEN $3::boolean THEN now()
                 ELSE now() - make_interval(secs => ($2::int - paid_amount / 10000)::double precision) END
       FROM events`,
    [orgId, count, sameTime],
  );
  const { rows } = await h.db.pool.query<{ id: string }>(
    'SELECT id FROM review_items WHERE organization_id = $1 ORDER BY created_at, id',
    [orgId],
  );
  return rows.map((r) => r.id);
}

/** Sự kiện đã kết thúc (quá `effective_end_at`): tiền về sau đó → mục `orphan`/`event_ended`. */
const setEnded = (eventId: string) =>
  h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 minute' WHERE id = $1", [eventId]);

describe('GET …/review-items: hàng gộp', () => {
  it('mục open ở 2 Sự kiện và mục chưa khớp, cũ nhất trước; mục resolved không hiện; Owner và Admin như nhau; summary đếm mục open', async () => {
    const org = await freshOrg();
    const a = await saleEvent(org, 'Giải bóng rổ 3x3 Tân Bình');
    const b = await saleEvent(org, 'Đêm nhạc gây quỹ');

    const mismatch = await place(a, 'Nguyễn Văn Minh');
    const mismatchIpn = await ipn(org, mismatch.code, 250_000);
    const stray = strayCode();
    const strayIpn = await ipn(org, stray, 75_000);
    const other = await place(b, 'Phạm Thu Hà');
    const otherIpn = await ipn(org, other.code, 100_000);
    const paid = await place(a, 'Lê Hoàng Nam');
    await ipn(org, paid.code, PRICE);
    const duplicateIpn = await ipn(org, paid.code, PRICE);
    const resolved = await place(a, 'Trần Quốc Bảo');
    const resolvedIpn = await ipn(org, resolved.code, 1_000);
    await h.db.pool.query("UPDATE review_items SET status = 'resolved', resolution = 'rejected' WHERE id = $1", [
      await itemIdOf(resolvedIpn),
    ]);

    const ids = await Promise.all([mismatchIpn, strayIpn, otherIpn, duplicateIpn].map(itemIdOf));
    const queue = await queueOf(org);
    expect(queue.event).toBeNull();
    expect(queue.items.map((i) => i.id)).toEqual(ids);
    expect(queue.items).toEqual([
      {
        id: ids[0],
        type: 'amount_mismatch',
        receivedAmount: 250_000,
        createdAt: expect.any(String),
        order: { code: mismatch.code, buyerName: 'Nguyễn Văn Minh', totalAmount: PRICE },
        event: { id: a.event.id, name: 'Giải bóng rổ 3x3 Tân Bình' },
      },
      {
        id: ids[1],
        type: 'unmatched',
        receivedAmount: 75_000,
        createdAt: expect.any(String),
        order: null,
        event: null,
      },
      {
        id: ids[2],
        type: 'amount_mismatch',
        receivedAmount: 100_000,
        createdAt: expect.any(String),
        order: { code: other.code, buyerName: 'Phạm Thu Hà', totalAmount: PRICE },
        event: { id: b.event.id, name: 'Đêm nhạc gây quỹ' },
      },
      {
        id: ids[3],
        type: 'duplicate_payment',
        receivedAmount: PRICE,
        createdAt: expect.any(String),
        order: { code: paid.code, buyerName: 'Lê Hoàng Nam', totalAmount: PRICE },
        event: { id: a.event.id, name: 'Giải bóng rổ 3x3 Tân Bình' },
      },
    ]);
    const createdAt = queue.items.map((i) => Date.parse(i.createdAt));
    expect([...createdAt].sort((x, y) => x - y)).toEqual(createdAt);
    expect(await openCountOf(org)).toBe(4);

    const admin = await addAdmin(org);
    expect(await queueOf(org, undefined, admin.cookie)).toEqual(queue);
    expect(await openCountOf(org, admin.cookie)).toBe(4);
  });

  it('cùng lúc tạo → xếp theo id tăng dần', async () => {
    const org = await freshOrg();
    const ids = await insertUnmatched(org.orgId, 3, { sameTime: true });
    expect((await queueOf(org)).items.map((i) => i.id)).toEqual([...ids].sort());
  });

  it('không lộ email, SĐT, id Đơn, id Người mua hay trường thô của payment_events (danh sách và chi tiết)', async () => {
    const org = await freshOrg();
    const sale = await saleEvent(org, 'Giải chạy đêm');
    const placed = await place(sale, 'Võ Minh Thư');
    const billId = `BILL-${randomUUID()}`;
    const payload = await ipn(org, placed.code, 120_000, { billId });
    const itemId = await itemIdOf(payload);
    const list = await h.http.get(listPath(org.orgId)).set('cookie', org.owner.cookie).expect(200);
    const detail = await h.http.get(itemPath(org.orgId, itemId)).set('cookie', org.owner.cookie).expect(200);
    const leaks = [
      placed.orderId,
      placed.buyer.userId,
      placed.buyer.email,
      '+84912345678',
      '0912345678',
      'nguoi-tra@vidu.vn',
      String(payload.requestId),
      billId,
      'bill_id',
      'merchant',
      'request_id',
      'requestId',
    ];
    for (const leak of leaks) {
      expect(list.text, leak).not.toContain(leak);
      expect(detail.text, leak).not.toContain(leak);
    }
  });
});

describe('GET …/review-items?eventId=: lọc theo Sự kiện', () => {
  it('chỉ mục của Sự kiện A (không có unmatched, không có Sự kiện B), kèm tên A; Sự kiện chưa có mục → hàng trống kèm tên', async () => {
    const org = await freshOrg();
    const a = await saleEvent(org, 'Giải cầu lông mở rộng');
    const b = await saleEvent(org, 'Hội thảo khởi nghiệp');
    const empty = await saleEvent(org, 'Workshop gốm');
    const a1 = await ipn(org, (await place(a, 'Đỗ Thị Lan')).code, 200_000);
    await ipn(org, strayCode(), 50_000);
    await ipn(org, (await place(b, 'Bùi Văn Tú')).code, 10_000);
    const a2Order = await place(a, 'Hồ Ngọc Anh');
    await setEnded(a.event.id);
    const a2 = await ipn(org, a2Order.code, PRICE);

    const queue = await queueOf(org, a.event.id);
    expect(queue.event).toEqual({ id: a.event.id, name: 'Giải cầu lông mở rộng' });
    expect(queue.items.map((i) => [i.id, i.type, i.event?.id])).toEqual([
      [await itemIdOf(a1), 'amount_mismatch', a.event.id],
      [await itemIdOf(a2), 'orphan', a.event.id],
    ]);
    // Id viết HOA vẫn khớp.
    expect((await queueOf(org, a.event.id.toUpperCase())).items).toHaveLength(2);
    expect((await queueOf(org, b.event.id)).items.map((i) => i.type)).toEqual(['amount_mismatch']);
    expect(await queueOf(org, empty.event.id)).toEqual({ event: { id: empty.event.id, name: 'Workshop gốm' }, items: [] });
    // Không lọc: đủ 4 mục.
    expect((await queueOf(org)).items).toHaveLength(4);
  });

  it('Sự kiện của BTC khác, không tồn tại, sai dạng hoặc rỗng → 404 EVENT_NOT_FOUND; eventId lặp → 400', async () => {
    const org = await freshOrg();
    const other = await freshOrg('CLB khác');
    const foreign = await saleEvent(other, 'Sự kiện của BTC khác');
    for (const eventId of [foreign.event.id, randomUUID(), 'khong-phai-uuid', '']) {
      const res = await h.http.get(listPath(org.orgId, eventId)).set('cookie', org.owner.cookie).expect(404);
      expect(ErrorResponse.parse(res.body).error.code, eventId).toBe('EVENT_NOT_FOUND');
    }
    const repeated = await h.http
      .get(`/v1/orgs/${org.orgId}/review-items?eventId=${foreign.event.id}&eventId=${foreign.event.id}`)
      .set('cookie', org.owner.cookie)
      .expect(400);
    expect(ErrorResponse.parse(repeated.body).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET …/review-items/:itemId: chi tiết', () => {
  it('lệch số tiền: giao dịch (nhận, mã, thời điểm trả, phương thức), Đơn liên quan, Sự kiện, nhật ký', async () => {
    const org = await freshOrg();
    const sale = await saleEvent(org, 'Giải bơi Quận 7');
    const placed = await place(sale, 'Nguyễn Thị Hoa');
    const paidAt = new Date(Date.now() - 60_000).toISOString();
    const payload = await ipn(org, placed.code, 250_000, { paidAt });
    const itemId = await itemIdOf(payload);

    const detail = await detailOf(org, itemId);
    expect(detail).toEqual({
      id: itemId,
      type: 'amount_mismatch',
      reason: null,
      status: 'open',
      resolution: null,
      createdAt: expect.any(String),
      transaction: {
        receivedAmount: 250_000,
        transactionCode: payload.providerTransactionCode,
        paidAt,
        receivedAt: expect.any(String),
        paymentMethod: 'qr',
        providerOrderId: null,
      },
      order: {
        code: placed.code,
        status: 'review',
        buyerName: 'Nguyễn Thị Hoa',
        ticketCount: 1,
        totalAmount: PRICE,
        createdAt: expect.any(String),
      },
      event: { id: sale.event.id, name: 'Giải bơi Quận 7' },
      log: [
        { kind: 'payment_received', at: paidAt },
        { kind: 'item_opened', at: detail.createdAt },
      ],
    });
  });

  it('Tingee báo paidAt muộn hơn lúc mở mục (lệch đồng hồ) → nhật ký xếp theo thời điểm: "Mở mục" trước "Nhận tiền"', async () => {
    const org = await freshOrg();
    const sale = await saleEvent(org, 'Giải bơi đêm');
    const placed = await place(sale, 'Đinh Văn Long');
    const paidAt = new Date(Date.now() + 60_000).toISOString();
    const detail = await detailOf(org, await itemIdOf(await ipn(org, placed.code, 100_000, { paidAt })));
    expect(detail.transaction.paidAt).toBe(paidAt);
    expect(detail.log).toEqual([
      { kind: 'item_opened', at: detail.createdAt },
      { kind: 'payment_received', at: paidAt },
    ]);
  });

  it('chưa khớp: không Đơn, không Sự kiện, có "Mã Đơn trong giao dịch"; IPN không báo paidAt → nhật ký "Nhận tiền" lúc Tickee nhận', async () => {
    const org = await freshOrg();
    const code = strayCode();
    const payload = await ipn(org, code, 75_000, { paidAt: null });
    const detail = await detailOf(org, await itemIdOf(payload));
    expect(detail).toMatchObject({ type: 'unmatched', reason: null, order: null, event: null });
    expect(detail.transaction).toMatchObject({ receivedAmount: 75_000, paidAt: null, providerOrderId: code });
    expect(detail.log).toEqual([
      { kind: 'payment_received', at: detail.transaction.receivedAt },
      { kind: 'item_opened', at: detail.createdAt },
    ]);
  });

  it('mồ côi: kèm lý do (Sự kiện đã kết thúc); mục đã xử lý vẫn đọc được (resolved + cách xử lý)', async () => {
    const org = await freshOrg();
    const sale = await saleEvent(org, 'Giải marathon');
    const placed = await place(sale, 'Mai Văn Phúc');
    await setEnded(sale.event.id);
    const itemId = await itemIdOf(await ipn(org, placed.code, PRICE));
    expect(await detailOf(org, itemId)).toMatchObject({
      type: 'orphan',
      reason: 'event_ended',
      status: 'open',
      order: { code: placed.code, status: 'review' },
    });

    await h.db.pool.query("UPDATE review_items SET status = 'resolved', resolution = 'refunded' WHERE id = $1", [itemId]);
    expect(await detailOf(org, itemId)).toMatchObject({ status: 'resolved', resolution: 'refunded' });
    expect((await queueOf(org)).items).toEqual([]);
  });

  it('mục của BTC khác, id ngẫu nhiên, sai dạng → 404 REVIEW_ITEM_NOT_FOUND', async () => {
    const org = await freshOrg();
    const other = await freshOrg('CLB khác');
    const [foreign] = await insertUnmatched(other.orgId, 1);
    for (const itemId of [foreign!, randomUUID(), 'khong-phai-uuid']) {
      const res = await h.http.get(itemPath(org.orgId, itemId)).set('cookie', org.owner.cookie).expect(404);
      expect(ErrorResponse.parse(res.body).error.code, itemId).toBe('REVIEW_ITEM_NOT_FOUND');
    }
    // Chủ của mục vẫn đọc được.
    expect((await detailOf(other, foreign!)).type).toBe('unmatched');
  });
});

describe('hàng trống và badge lớn', () => {
  it('không có mục open → hàng trống, summary 0', async () => {
    const org = await freshOrg();
    expect(await queueOf(org)).toEqual({ event: null, items: [] });
    expect(await openCountOf(org)).toBe(0);
  });

  it('120 mục open → summary 120, hàng đủ 120 mục cũ nhất trước (không phân trang)', async () => {
    const org = await freshOrg();
    const ids = await insertUnmatched(org.orgId, 120);
    expect(await openCountOf(org)).toBe(120);
    const queue = await queueOf(org);
    expect(queue.items.map((i) => i.id)).toEqual(ids);
    expect(queue.items[0]!.receivedAmount).toBe(10_000);
  });
});

describe('quyền: không phải thành viên', () => {
  it('người ngoài (kể cả CTV chưa là thành viên), Owner BTC khác → 403 NOT_A_MEMBER ở cả 3 route và /live; chưa đăng nhập → 401', async () => {
    const org = await freshOrg();
    const [itemId] = await insertUnmatched(org.orgId, 1);
    const other = await freshOrg('CLB khác');
    const stranger = await signUp(h);
    for (const cookie of [stranger.cookie, other.owner.cookie]) {
      for (const path of [listPath(org.orgId), summaryPath(org.orgId), itemPath(org.orgId, itemId!)]) {
        const res = await h.http.get(path).set('cookie', cookie).expect(403);
        expect(ErrorResponse.parse(res.body).error.code, path).toBe('NOT_A_MEMBER');
      }
      const s = await openSse(http.baseUrl, `/v1${organizationLiveApiPath(org.orgId)}`, { origin: TEST_WEB_ORIGIN, cookie });
      streams.push(s);
      await s.ended;
      expect(s.status).toBe(403);
      expect(ErrorResponse.parse(JSON.parse(s.text())).error.code).toBe('NOT_A_MEMBER');
    }
    for (const path of [listPath(org.orgId), summaryPath(org.orgId), itemPath(org.orgId, itemId!)]) {
      await h.http.get(path).expect(401);
    }
  });
});
