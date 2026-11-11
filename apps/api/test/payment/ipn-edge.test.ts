import { randomUUID } from 'node:crypto';
import { BuyerOrderView } from '@tickee/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  ipnKeyOf,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type PayoutSpec,
  type SaleEvent,
  type TierSpec,
  type User,
} from '../ordering/order-fixtures.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type FakeIpnPayload, type TingeeFake } from '../tingee-fake/server.js';
import {
  ACK_TEXT,
  expectInvariants,
  orderState,
  paymentEventsOf,
  postIpn,
  reviewItemsOf,
  type PaymentEventRow,
  type ReviewItemRow,
} from './ipn-fixtures.js';

/*
 * Story 3.6: IPN `success` cho các trường hợp biên qua HTTP, trên Postgres thật và Tingee fake. Mọi dòng của I/O Matrix
 * trừ gửi đồng thời (ipn-concurrency.test.ts): khoản tiền không thành Vé → đúng một `review_items` của BTC sở hữu
 * `ipnKey`, gắn event vừa lưu; Đơn `pending`/`expired` chuyển `review` khi cần; tiền về muộn cho Đơn `expired` bán lại có
 * điều kiện. Sau mỗi ca: bất biến tồn kho – Vé (`expectInvariants`). Cuối file: CHECK/unique và quyền cột của bảng.
 */

const MAIN: TingeeCredential = { clientId: 'tg-edge-main-4b2d', secretToken: 'tg-edge-main-secret-Pq8Ws7Ed6' };
const OTHER: TingeeCredential = { clientId: 'tg-edge-other-9e1f', secretToken: 'tg-edge-other-secret-Rf5Tg4Yh3' };
const mainAccount = fakeAccount({ accountName: 'VO THI HOA' });
const otherAccount = fakeAccount({ accountName: 'DANG VAN KHOA' });
const payoutOf = (account: Record<string, unknown>): PayoutSpec => ({
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
});

const TIER_A: TierSpec = { name: 'Hạng A', price: 100_000, capacity: 5 };
const TIER_B: TierSpec = { name: 'Hạng B', price: 250_000, capacity: 3 };

let fake: TingeeFake;
let h: Harness;
let org: Org;
let other: Org;
let ipnKey: string;
let otherKey: string;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [mainAccount] },
      { ...OTHER, accounts: [otherAccount] },
    ],
  });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, { name: 'CLB Bóng chuyền Gò Vấp', credential: MAIN, payout: payoutOf(mainAccount) });
  other = await paidReadyOrg(h, { name: 'CLB Futsal Bình Thạnh', credential: OTHER, payout: payoutOf(otherAccount) });
  ipnKey = await ipnKeyOf(h, org.orgId);
  otherKey = await ipnKeyOf(h, other.orgId);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

interface Placed {
  buyer: User;
  eventId: string;
  slug: string;
  /** Id Hạng vé theo thứ tự tạo. */
  tiers: string[];
  code: string;
  orderId: string;
  total: number;
  funnelId: string;
}

/** Sự kiện mới của `owner` đã mở bán với các Hạng vé. */
const saleOf = (tiers: TierSpec[] = [TIER_A], owner: Org = org) => eventOnSale(owner, tiers);

/**
 * Người mua mới đặt `quantities[i]` Vé Hạng vé thứ `i` (bỏ dòng 0) ở Sự kiện `sale`; Đơn `pending` có link thanh toán
 * (tạo bằng credential hiện hành của BTC sở hữu Sự kiện).
 */
async function placeIn(sale: SaleEvent, quantities: number[]): Promise<Placed> {
  const buyer = await signUp(h);
  const funnelId = randomUUID();
  const items = sale.tiers
    .map((tier, i) => ({ ticketTypeId: tier.id, quantity: quantities[i] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody(items, { funnelId }));
  expect(res.status).toBe(201);
  const order = parseOrder(res.body);
  expect(order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { checkoutUrl: expect.any(String) } });
  const { id } = await orderState(h, order.code);
  return {
    buyer,
    eventId: sale.event.id,
    slug: sale.event.slug,
    tiers: sale.tiers.map((t) => t.id),
    code: order.code,
    orderId: id,
    total: order.totalAmount,
    funnelId,
  };
}

/** Sự kiện mới (mặc định một Hạng vé 100.000đ, 5 suất) và một Đơn `pending` trên đó. */
async function place(quantities: number[] = [2], tiers: TierSpec[] = [TIER_A], owner: Org = org): Promise<Placed> {
  return placeIn(await saleOf(tiers, owner), quantities);
}

/** Body IPN `success` của Đơn (đúng tiền trừ khi `overrides` đổi). */
const paid = (placed: Pick<Placed, 'code' | 'total'>, overrides: FakeIpnPayload = {}) =>
  fakeIpnPayload(placed.code, placed.total, overrides);

/** Body IPN trạng thái như Tingee: không có giao dịch, chưa trả tiền. */
const statusIpn = (placed: Pick<Placed, 'code' | 'total'>, status: string) =>
  fakeIpnPayload(placed.code, placed.total, {
    status,
    statusCode: '01',
    paidAmount: null,
    paidAt: null,
    providerTransactionCode: null,
    paymentMethod: null,
  });

const send = (payload: FakeIpnPayload, credential: TingeeCredential = MAIN, key = ipnKey) =>
  postIpn(h, key, signIpn(credential.secretToken, payload));

/** Hết hạn Đơn bằng IPN `expired` của Tingee (AD-4 (b)): `held` đã nhả. */
async function expire(placed: Placed): Promise<void> {
  await send(statusIpn(placed, 'expired')).expect(200);
  expect((await orderState(h, placed.code)).status).toBe('expired');
}

/** Đổi Sự kiện bằng SQL như Epic 7 sẽ làm (hủy, khóa) hay như đã kết thúc. */
const setEvent = (eventId: string, set: string) => h.db.pool.query(`UPDATE events SET ${set} WHERE id = $1`, [eventId]);
const ENDED = "effective_end_at = now() - interval '1 minute'";
const CANCELLED = "status = 'cancelled'";
const LOCKED = "locked_at = now(), lock_reason = 'test'";

async function auditCount(orderId: string): Promise<number> {
  const { rows } = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
    orderId,
  ]);
  return rows.length;
}

/** Event `payment` vừa lưu cho IPN `payload` (theo mã giao dịch, dưới BTC `organizationId`). */
async function eventOf(payload: FakeIpnPayload, organizationId = org.orgId): Promise<PaymentEventRow> {
  const events = await paymentEventsOf(h, organizationId, String(payload.orderId));
  const event = events.find((e) => e.provider_transaction_code === payload.providerTransactionCode);
  expect(event, `event của ${String(payload.providerTransactionCode)}`).toBeDefined();
  return event!;
}

interface ExpectedItem {
  branch: string;
  type: string;
  reason?: string | null;
  /** Đơn gắn với mục; `null` với `unmatched`. */
  orderId: string | null;
}

/**
 * AC: gửi IPN `success` (BTC `org`) → 200 `00`; event đã lưu có đúng một `review_items` `open` cùng BTC của `ipnKey`,
 * đúng loại, lý do, Đơn; log warn kèm nhánh và loại mục (`unmatched`: log error kèm `alert`). Trả event và mục.
 */
async function expectReviewItem(
  payload: FakeIpnPayload,
  expected: ExpectedItem,
): Promise<{ event: PaymentEventRow; item: ReviewItemRow }> {
  const res = await send(payload).expect(200);
  expect(res.text).toBe(ACK_TEXT);
  const event = await eventOf(payload);
  const items = await reviewItemsOf(h, { paymentEventId: event.id });
  expect(items, expected.branch).toHaveLength(1);
  const item = items[0]!;
  expect(item).toMatchObject({
    organization_id: org.orgId,
    order_id: expected.orderId,
    type: expected.type,
    reason: expected.reason ?? null,
    status: 'open',
    resolution: null,
  });
  const logged = h.logs.lines.filter((l) => l.paymentEventId === event.id);
  expect(logged).toHaveLength(1);
  const unmatched = expected.type === 'unmatched';
  expect(logged[0]).toMatchObject({
    level: unmatched ? 50 : 40,
    organizationId: org.orgId,
    branch: expected.branch,
    reviewItemId: item.id,
    reviewItemType: expected.type,
    ...(expected.reason ? { reviewItemReason: expected.reason } : {}),
  });
  if (unmatched) expect(logged[0]).toMatchObject({ alert: 'payment_unmatched' });
  else expect(logged[0]!.alert).toBeUndefined();
  return { event, item };
}

/** Gửi IPN `success` phát Vé (Đơn của `org`): 200 `00`, nhánh `paid`, log info, event không có mục. */
async function expectPaid(payload: FakeIpnPayload): Promise<PaymentEventRow> {
  const res = await send(payload).expect(200);
  expect(res.text).toBe(ACK_TEXT);
  const event = await eventOf(payload);
  expect(await reviewItemsOf(h, { paymentEventId: event.id })).toEqual([]);
  expect(h.logs.lines.filter((l) => l.paymentEventId === event.id)).toEqual([
    expect.objectContaining({ level: 30, branch: 'paid' }),
  ]);
  return event;
}

describe('Matrix: lệch tiền', () => {
  it('Đơn pending (thiếu tiền) → review, held -= n, mục amount_mismatch, 0 Vé; trang Đơn của Người mua vẫn đọc được (review)', async () => {
    const placed = await place([2]);
    expect(await inventory(h, placed.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectReviewItem(paid(placed, { paidAmount: placed.total - 1_000 }), {
      branch: 'mismatch',
      type: 'amount_mismatch',
      orderId: placed.orderId,
    });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', paid_at: null, tickets: 0 });
    expect(await inventory(h, placed.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await auditCount(placed.orderId)).toBe(0);
    await expectInvariants(h, placed.eventId);

    const order = BuyerOrderView.parse(
      (await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body,
    );
    expect(order).toMatchObject({ buyerStatus: 'under_review', tickets: [] });
  });

  it('Đơn expired (thừa tiền) → review, mục amount_mismatch, tồn kho không đổi', async () => {
    const placed = await place([2]);
    await expire(placed);
    await expectReviewItem(paid(placed, { paidAmount: placed.total + 1_000 }), {
      branch: 'mismatch',
      type: 'amount_mismatch',
      orderId: placed.orderId,
    });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await inventory(h, placed.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, placed.eventId);
  });
});

describe('Matrix: tiền về muộn', () => {
  it('Đơn expired, chưa kết thúc, không khóa, đủ chỗ mọi Hạng vé → paid (ipn), sold += n từng hạng, N Vé, audit, phễu; không mục', async () => {
    const placed = await place([2, 1], [TIER_A, TIER_B]);
    await expire(placed);
    const [a, b] = placed.tiers as [string, string];
    expect(await inventory(h, a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    const paidAt = new Date(Date.now() - 16 * 60_000);
    await expectPaid(paid(placed, { paidAt: paidAt.toISOString() }));

    const state = await orderState(h, placed.code);
    expect(state).toMatchObject({ status: 'paid', paid_source: 'ipn', paid_amount: String(placed.total), tickets: 3 });
    expect(state.paid_at!.toISOString()).toBe(paidAt.toISOString());
    expect(await inventory(h, a)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(await inventory(h, b)).toEqual({ capacity: 3, sold: 1, held: 0 });
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
    expect(await auditCount(placed.orderId)).toBe(1);
    const funnel = await h.db.pool.query<{ type: string }>(
      'SELECT type FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [placed.funnelId],
    );
    expect(funnel.rows.map((r) => r.type)).toEqual(['order_created', 'paid']);
    const order = BuyerOrderView.parse(
      (await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body,
    );
    expect(order.tickets).toHaveLength(3);
    await expectInvariants(h, placed.eventId);
  });

  it('Đơn expired, 2 Hạng vé, hạng đứng sau (ticket_type_id lớn hơn) đã bán hết → không hạng nào đổi sold; Đơn review; mục orphan/sold_out', async () => {
    const sale = await saleOf([TIER_A, TIER_B]);
    const placed = await placeIn(sale, [2, 1]);
    await expire(placed);
    const capacity = new Map(sale.tiers.map((t, i) => [t.id, [TIER_A, TIER_B][i]!.capacity]));
    const [first, last] = [...placed.tiers].sort() as [string, string];
    // Người mua khác mua hết hạng đứng sau (đã trả tiền: `sold` = số suất).
    const rival = await placeIn(sale, placed.tiers.map((id) => (id === last ? capacity.get(id)! : 0)));
    await expectPaid(paid(rival));
    const before = { first: await inventory(h, first), last: await inventory(h, last) };
    expect(before.first).toMatchObject({ sold: 0, held: 0 });
    expect(before.last).toEqual({ capacity: capacity.get(last), sold: capacity.get(last), held: 0 });

    await expectReviewItem(paid(placed), { branch: 'orphan', type: 'orphan', reason: 'sold_out', orderId: placed.orderId });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', paid_at: null, tickets: 0 });
    // Hạng đứng trước đã bán trong savepoint rồi rollback cùng savepoint.
    expect(await inventory(h, first)).toEqual(before.first);
    expect(await inventory(h, last)).toEqual(before.last);
    expect(await auditCount(placed.orderId)).toBe(0);
    await expectInvariants(h, placed.eventId);
  });

  it('đã kết thúc (quá effective_end_at), đúng tiền: Đơn pending → review, nhả held; Đơn expired → review; mục orphan/event_ended', async () => {
    const sale = await saleOf([TIER_A]);
    const pending = await placeIn(sale, [2]);
    const expired = await placeIn(sale, [1]);
    await expire(expired);
    expect(await inventory(h, pending.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await setEvent(sale.event.id, ENDED);

    for (const placed of [pending, expired]) {
      await expectReviewItem(paid(placed), {
        branch: 'orphan',
        type: 'orphan',
        reason: 'event_ended',
        orderId: placed.orderId,
      });
      expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', tickets: 0 });
    }
    expect(await inventory(h, pending.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, sale.event.id);
  });

  it('Sự kiện bị khóa (locked_at), đúng tiền, chưa kết thúc: Đơn expired → review + mục orphan/event_locked; Đơn pending → paid + N Vé, không mục', async () => {
    const sale = await saleOf([TIER_A]);
    const pending = await placeIn(sale, [2]);
    const expired = await placeIn(sale, [1]);
    await expire(expired);
    await setEvent(sale.event.id, LOCKED);

    await expectReviewItem(paid(expired), {
      branch: 'orphan',
      type: 'orphan',
      reason: 'event_locked',
      orderId: expired.orderId,
    });
    expect(await orderState(h, expired.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await inventory(h, pending.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 2 });

    await expectPaid(paid(pending));
    expect(await orderState(h, pending.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await inventory(h, pending.tiers[0]!)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(await reviewItemsOf(h, { orderId: pending.orderId })).toEqual([]);
    await expectInvariants(h, sale.event.id);
  });
});

describe('Matrix: Sự kiện đã hủy', () => {
  it('Đơn ở mọi trạng thái: pending/expired → review (nhả held nếu pending); paid/review/cancelled giữ nguyên; mỗi khoản một mục event_cancelled, kể cả khoản thứ hai cho cùng Đơn', async () => {
    const sale = await saleOf([{ ...TIER_A, capacity: 20 }]);
    const tier = sale.tiers[0]!.id;
    const pending = await placeIn(sale, [2]);
    const expired = await placeIn(sale, [1]);
    await expire(expired);
    const paidOrder = await placeIn(sale, [3]);
    await expectPaid(paid(paidOrder));
    const review = await placeIn(sale, [1]);
    const { item: mismatchItem } = await expectReviewItem(paid(review, { paidAmount: review.total - 500 }), {
      branch: 'mismatch',
      type: 'amount_mismatch',
      orderId: review.orderId,
    });
    // Hủy Sự kiện (Story 7.1) đưa Đơn chờ sang `cancelled` và nhả chỗ; ở đây Đơn đã hết hạn rồi mới hủy.
    const cancelled = await placeIn(sale, [1]);
    await expire(cancelled);
    await h.db.pool.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [cancelled.orderId]);
    expect(await inventory(h, tier)).toEqual({ capacity: 20, sold: 3, held: 2 });
    await setEvent(sale.event.id, CANCELLED);

    const expectations: [Placed, string][] = [
      [pending, 'review'],
      [expired, 'review'],
      [paidOrder, 'paid'],
      [review, 'review'],
      [cancelled, 'cancelled'],
    ];
    for (const [placed, status] of expectations) {
      await expectReviewItem(paid(placed), { branch: 'event_cancelled', type: 'event_cancelled', orderId: placed.orderId });
      expect(await orderState(h, placed.code), status).toMatchObject({ status, tickets: placed === paidOrder ? 3 : 0 });
    }
    // Nhả held của Đơn pending; Vé đã bán giữ nguyên.
    expect(await inventory(h, tier)).toEqual({ capacity: 20, sold: 3, held: 0 });
    // Mục lệch tiền cũ vẫn mở.
    expect((await reviewItemsOf(h, { paymentEventId: mismatchItem.payment_event_id }))[0]).toMatchObject({
      id: mismatchItem.id,
      status: 'open',
    });

    // Khoản trả thứ hai cho cùng Đơn (giờ đã review) → thêm một mục event_cancelled.
    await expectReviewItem(paid(pending), { branch: 'event_cancelled', type: 'event_cancelled', orderId: pending.orderId });
    const items = await reviewItemsOf(h, { orderId: pending.orderId });
    expect(items.map((i) => i.type)).toEqual(['event_cancelled', 'event_cancelled']);
    expect(new Set(items.map((i) => i.payment_event_id)).size).toBe(2);
    expect(await auditCount(paidOrder.orderId)).toBe(1);
    await expectInvariants(h, sale.event.id);
  });
});

describe('Matrix: Đơn không còn chờ tiền', () => {
  it('trả trùng: Đơn paid, hai IPN success khác mã → hai mục duplicate_payment; Đơn, Vé, tồn kho không đổi', async () => {
    const placed = await place([2]);
    await expectPaid(paid(placed));
    const before = await orderState(h, placed.code);
    for (let i = 0; i < 2; i++) {
      await expectReviewItem(paid(placed), { branch: 'duplicate_payment', type: 'duplicate_payment', orderId: placed.orderId });
    }
    expect(await orderState(h, placed.code)).toEqual(before);
    expect(await inventory(h, placed.tiers[0]!)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect((await reviewItemsOf(h, { orderId: placed.orderId })).map((i) => i.type)).toEqual([
      'duplicate_payment',
      'duplicate_payment',
    ]);
    expect(await auditCount(placed.orderId)).toBe(1);
    await expectInvariants(h, placed.eventId);
  });

  it('Đơn review (lệch tiền) nhận thêm khoản đúng tiền → mục duplicate_payment; vẫn review; mục cũ giữ open', async () => {
    const placed = await place([1]);
    const { item: first } = await expectReviewItem(paid(placed, { paidAmount: 1_000 }), {
      branch: 'mismatch',
      type: 'amount_mismatch',
      orderId: placed.orderId,
    });
    await expectReviewItem(paid(placed), { branch: 'duplicate_payment', type: 'duplicate_payment', orderId: placed.orderId });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', tickets: 0 });
    const items = await reviewItemsOf(h, { orderId: placed.orderId });
    expect(items.map((i) => [i.type, i.status])).toEqual([
      ['amount_mismatch', 'open'],
      ['duplicate_payment', 'open'],
    ]);
    expect(items[0]!.id).toBe(first.id);
    await expectInvariants(h, placed.eventId);
  });
});

describe('Matrix: không khớp Đơn của BTC', () => {
  it('mã đúng ORDER_CODE_PATTERN mà không có Đơn → mục unmatched, order_id null, BTC của ipnKey; log error alert', async () => {
    const payload = fakeIpnPayload('TK0000ZZZZ', 75_000);
    const { event } = await expectReviewItem(payload, { branch: 'order_not_found', type: 'unmatched', orderId: null });
    expect(event).toMatchObject({ organization_id: org.orgId, order_id: null });
  });

  it('Đơn của BTC B, IPN (ký đúng secret BTC A) vào URL BTC A → mục unmatched của A, order_id null; Đơn B không đổi; log error alert', async () => {
    const foreign = await place([2], [TIER_A], other);
    const { event } = await expectReviewItem(paid(foreign), {
      branch: 'other_organization',
      type: 'unmatched',
      orderId: null,
    });
    expect(event).toMatchObject({ organization_id: org.orgId, order_id: null });
    expect(await orderState(h, foreign.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, foreign.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 2 });
    expect(await reviewItemsOf(h, { orderId: foreign.orderId })).toEqual([]);
    expect(await reviewItemsOf(h, { organizationId: other.orgId })).toEqual([]);
    await expectInvariants(h, foreign.eventId);
    // Đơn B vẫn nhận IPN của chính BTC B.
    await send(paid(foreign), OTHER, otherKey).expect(200);
    expect(await orderState(h, foreign.code)).toMatchObject({ status: 'paid', tickets: 2 });
  });

  it('mã sai định dạng → chỉ lưu event, không mục; log info', async () => {
    const payload = fakeIpnPayload(`HD-${randomUUID()}`, 120_000);
    const res = await send(payload).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    const event = await eventOf(payload);
    expect(event.order_id).toBeNull();
    expect(await reviewItemsOf(h, { paymentEventId: event.id })).toEqual([]);
    expect(h.logs.lines.filter((l) => l.paymentEventId === event.id)).toEqual([
      expect.objectContaining({ level: 30, branch: 'invalid_order_code' }),
    ]);
  });
});

describe('không tạo mục', () => {
  it('IPN trạng thái (expired, canceled, lạ) và IPN lặp → không mục; khoản đúng tiền phát Vé → không mục', async () => {
    const sale = await saleOf([TIER_A]);
    const placed = await placeIn(sale, [1]);
    await send(statusIpn(placed, 'pending')).expect(200);
    await send(statusIpn(placed, 'expired')).expect(200);
    await send(statusIpn(placed, 'canceled')).expect(200);
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);

    const mismatch = paid(placed, { paidAmount: 7_000 });
    await expectReviewItem(mismatch, { branch: 'mismatch', type: 'amount_mismatch', orderId: placed.orderId });
    // IPN lặp (cùng mã giao dịch, ký lại timestamp mới) → `duplicate`: không thêm event hay mục.
    for (let i = 0; i < 2; i++) await send(mismatch).expect(200);
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(4);
    expect((await reviewItemsOf(h, { orderId: placed.orderId })).map((r) => r.type)).toEqual(['amount_mismatch']);
    await expectInvariants(h, sale.event.id);

    const good = await placeIn(sale, [1]);
    await expectPaid(paid(good));
    expect(await reviewItemsOf(h, { orderId: good.orderId })).toEqual([]);
  });
});

describe('lỗi giữa chừng', () => {
  it('AC: lỗi sau khi Đơn đã chuyển review (tạo mục vỡ unique) → 5xx, rollback cả gói: không event, không mục, Đơn vẫn pending, held không đổi; gửi lại cùng mã → xử lý đúng một lần', async () => {
    const placed = await place([2]);
    // Chiếm trước unique "một mục amount_mismatch open mỗi Đơn" bằng một mục gắn khoản tiền khác.
    const setup = await h.db.pool.query<{ id: string }>(
      `INSERT INTO payment_events (organization_id, kind, status, provider_order_id)
       VALUES ($1, 'status', 'setup', $2) RETURNING id`,
      [org.orgId, `SETUP-${randomUUID()}`],
    );
    const blocker = await h.db.pool.query<{ id: string }>(
      `INSERT INTO review_items (organization_id, order_id, payment_event_id, type)
       VALUES ($1, $2, $3, 'amount_mismatch') RETURNING id`,
      [org.orgId, placed.orderId, setup.rows[0]!.id],
    );
    const ipn = signIpn(MAIN.secretToken, paid(placed, { paidAmount: placed.total - 2_000 }));
    const failed = await postIpn(h, ipnKey, ipn);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect((await reviewItemsOf(h, { orderId: placed.orderId })).map((i) => i.id)).toEqual([blocker.rows[0]!.id]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, placed.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInvariants(h, placed.eventId);

    // BTC xử lý xong mục chặn (tickee_app ghi được `status`, `resolution`), rồi Tingee gửi lại đúng IPN đó.
    await h.db.pool.query("UPDATE review_items SET status = 'resolved', resolution = 'dismissed' WHERE id = $1", [
      blocker.rows[0]!.id,
    ]);
    expect((await postIpn(h, ipnKey, ipn).expect(200)).text).toBe(ACK_TEXT);
    expect((await postIpn(h, ipnKey, ipn).expect(200)).text).toBe(ACK_TEXT);
    const events = await paymentEventsOf(h, org.orgId, placed.code);
    expect(events).toHaveLength(1);
    expect(await reviewItemsOf(h, { paymentEventId: events[0]!.id })).toEqual([
      expect.objectContaining({ type: 'amount_mismatch', status: 'open', order_id: placed.orderId }),
    ]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await inventory(h, placed.tiers[0]!)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, placed.eventId);
  });
});

describe('bảng review_items', () => {
  const pgCode = (err: unknown) => (err as { code?: string }).code;

  it('CHECK và unique chặn dòng sai; dòng đúng được nhận (trong transaction, rollback sau cùng)', async () => {
    const placed = await place([1]);
    const client: pg.PoolClient = await h.db.pool.connect();
    try {
      await client.query('BEGIN');
      const newEvent = async () =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO payment_events (organization_id, kind, status, provider_order_id)
             VALUES ($1, 'status', 'setup', $2) RETURNING id`,
            [org.orgId, `SETUP-${randomUUID()}`],
          )
        ).rows[0]!.id;
      interface Row {
        orderId?: string | null;
        paymentEventId?: string;
        type: string;
        reason?: string | null;
        status?: string;
        resolution?: string | null;
      }
      const insert = async (row: Row) => {
        await client.query(
          `INSERT INTO review_items (organization_id, order_id, payment_event_id, type, reason, status, resolution)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            org.orgId,
            row.orderId === undefined ? placed.orderId : row.orderId,
            row.paymentEventId ?? (await newEvent()),
            row.type,
            row.reason ?? null,
            row.status ?? 'open',
            row.resolution ?? null,
          ],
        );
      };
      /** Chèn trong savepoint; trả mã lỗi Postgres (`null` khi nhận). */
      const attempt = async (row: Row): Promise<string | null> => {
        await client.query('SAVEPOINT s');
        try {
          await insert(row);
          await client.query('RELEASE SAVEPOINT s');
          return null;
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT s');
          return pgCode(err) ?? 'unknown';
        }
      };

      const rejectedByCheck: [string, Row][] = [
        ['loại lạ', { type: 'lost_race' }],
        ['unmatched gắn Đơn', { type: 'unmatched' }],
        ['loại khác không gắn Đơn', { type: 'amount_mismatch', orderId: null }],
        ['orphan thiếu lý do', { type: 'orphan' }],
        ['lý do ở loại khác orphan', { type: 'amount_mismatch', reason: 'sold_out' }],
        ['lý do lạ', { type: 'orphan', reason: 'expired' }],
        ['trạng thái lạ', { type: 'event_cancelled', status: 'closed' }],
        ['resolved thiếu cách xử lý', { type: 'event_cancelled', status: 'resolved' }],
        ['open kèm cách xử lý', { type: 'event_cancelled', resolution: 'refunded' }],
        ['cách xử lý lạ', { type: 'event_cancelled', status: 'resolved', resolution: 'paid' }],
        ['duplicate_payment duyệt', { type: 'duplicate_payment', status: 'resolved', resolution: 'approved' }],
        ['event_cancelled duyệt', { type: 'event_cancelled', status: 'resolved', resolution: 'approved' }],
        ['event_cancelled từ chối', { type: 'event_cancelled', status: 'resolved', resolution: 'rejected' }],
        ['unmatched từ chối', { type: 'unmatched', orderId: null, status: 'resolved', resolution: 'rejected' }],
      ];
      for (const [name, row] of rejectedByCheck) expect(await attempt(row), name).toBe('23514');

      const accepted: [string, Row][] = [
        ['amount_mismatch open', { type: 'amount_mismatch' }],
        ['orphan open (loại khác amount_mismatch)', { type: 'orphan', reason: 'sold_out' }],
        ['event_cancelled thứ nhất', { type: 'event_cancelled' }],
        ['event_cancelled thứ hai cùng Đơn', { type: 'event_cancelled' }],
        ['duplicate_payment thứ nhất', { type: 'duplicate_payment' }],
        ['duplicate_payment thứ hai cùng Đơn', { type: 'duplicate_payment' }],
        ['amount_mismatch đã xử lý, cùng Đơn', { type: 'amount_mismatch', status: 'resolved', resolution: 'approved' }],
        ['duplicate_payment đã hoàn', { type: 'duplicate_payment', status: 'resolved', resolution: 'refunded' }],
        ['event_cancelled đã hoàn', { type: 'event_cancelled', status: 'resolved', resolution: 'refunded' }],
        ['unmatched bỏ qua', { type: 'unmatched', orderId: null, status: 'resolved', resolution: 'dismissed' }],
      ];
      for (const [name, row] of accepted) expect(await attempt(row), name).toBeNull();

      const shared = await newEvent();
      expect(await attempt({ type: 'event_cancelled', paymentEventId: shared })).toBeNull();
      const rejectedByUnique: [string, Row][] = [
        ['một khoản tiền hai mục', { type: 'duplicate_payment', paymentEventId: shared }],
        ['hai amount_mismatch open cùng Đơn', { type: 'amount_mismatch' }],
        ['hai orphan open cùng Đơn', { type: 'orphan', reason: 'event_ended' }],
      ];
      for (const [name, row] of rejectedByUnique) expect(await attempt(row), name).toBe('23505');

      // Xử lý xong mục amount_mismatch open → mục mới cùng loại được mở lại.
      await client.query(
        `UPDATE review_items SET status = 'resolved', resolution = 'rejected'
          WHERE order_id = $1 AND type = 'amount_mismatch' AND status = 'open'`,
        [placed.orderId],
      );
      expect(await attempt({ type: 'amount_mismatch' })).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
  });

  it('tickee_app chỉ UPDATE được status, resolution: cột khác → 42501', async () => {
    const placed = await place([1]);
    const { item } = await expectReviewItem(paid(placed, { paidAmount: 3_000 }), {
      branch: 'mismatch',
      type: 'amount_mismatch',
      orderId: placed.orderId,
    });
    const otherEvent = await h.db.pool.query<{ id: string }>(
      `INSERT INTO payment_events (organization_id, kind, status, provider_order_id)
       VALUES ($1, 'status', 'setup', $2) RETURNING id`,
      [org.orgId, `SETUP-${randomUUID()}`],
    );
    const denied: [string, unknown][] = [
      ['organization_id', other.orgId],
      ['order_id', null],
      ['payment_event_id', otherEvent.rows[0]!.id],
      ['type', 'duplicate_payment'],
      ['reason', 'sold_out'],
      ['created_at', new Date(0)],
      ['id', randomUUID()],
    ];
    for (const [column, value] of denied) {
      await expect(
        h.db.pool.query(`UPDATE review_items SET ${column} = $2 WHERE id = $1`, [item.id, value]),
        column,
      ).rejects.toSatisfy((err) => pgCode(err) === '42501');
    }
    await h.db.pool.query("UPDATE review_items SET status = 'resolved', resolution = 'rejected' WHERE id = $1", [item.id]);
    expect((await reviewItemsOf(h, { paymentEventId: item.payment_event_id }))[0]).toMatchObject({
      id: item.id,
      organization_id: org.orgId,
      order_id: placed.orderId,
      type: 'amount_mismatch',
      status: 'resolved',
      resolution: 'rejected',
    });
  });
});
