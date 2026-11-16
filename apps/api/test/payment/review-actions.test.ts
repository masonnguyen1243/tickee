import { randomInt, randomUUID } from 'node:crypto';
import {
  BuyerEmailKind,
  ErrorResponse,
  EventOverview,
  IDEMPOTENCY_KEY_HEADER,
  JobQueue,
  ORDER_CODE_ALPHABET,
  RealtimeTopic,
  ReviewActionResult,
  ReviewItemDetail,
  ReviewQueue,
  Role,
  type ReviewAction,
  type SendBuyerEmailPayload,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reviewActionDone, reviewActionsFor, type ReviewActionState } from '../../src/modules/payment/index.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { databaseUrl } from '../helpers.js';
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
import { sleep } from '../platform/sse-client.js';
import {
  fakeAccount,
  fakeIpnPayload,
  fakeStatusIpnPayload,
  signIpn,
  startTingeeFake,
  type FakeIpnPayload,
  type TingeeFake,
} from '../tingee-fake/server.js';
import { expectInvariants, orderState, postIpn } from './ipn-fixtures.js';

/*
 * Story 4.4-a: thao tác trên mục Cần xử lý — `POST /v1/orgs/:orgId/review-items/:itemId/{approve,reject,refund,dismiss}`
 * trên Postgres thật và Tingee fake. Mục tạo bằng IPN thật (lệch số tiền, mồ côi, trả trùng, Sự kiện đã hủy, chưa khớp).
 * Mọi dòng của I/O Matrix: duyệt tay còn chỗ / hết chỗ / Sự kiện không còn bán, từ chối, hoàn tay sau từ chối, hoàn tay
 * tiền trùng, bỏ qua thiếu lý do, gửi lại, hai thành viên cùng lúc, ngoài BTC. Thêm: tín hiệu realtime khi commit và
 * khi rollback, audit, nhật ký của `Sheet`, bảng thao tác (hàm thuần).
 */

const MAIN: TingeeCredential = { clientId: 'tg-actions-main-5d1e', secretToken: 'tg-actions-main-secret-Hj6Kl5Mn4' };
const account = fakeAccount({ accountName: 'TRAN VAN BINH' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const PRICE = 150_000;
const TIER: TierSpec = { name: 'Vé thường', price: PRICE, capacity: 10 };

let fake: TingeeFake;
let h: Harness;
let boss: PgBoss;
let listener: pg.Client;
/** Mọi tín hiệu realtime đã commit (kết nối `LISTEN` riêng của test). */
const signals: Record<string, unknown>[] = [];

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  boss = h.app.get<PgBoss>(BOSS);
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
  await fake.close();
});

type ActionOrg = Org & { ipnKey: string };

/** BTC mới bán được Vé có phí bằng `MAIN`: mỗi ca một BTC để hàng và tín hiệu không lẫn với ca khác. */
async function freshOrg(name = 'CLB Cầu lông Phú Nhuận'): Promise<ActionOrg> {
  const org = await paidReadyOrg(h, { name, credential: MAIN, payout: PAYOUT });
  return { ...org, ipnKey: await ipnKeyOf(h, org.orgId) };
}

interface Placed {
  code: string;
  orderId: string;
  total: number;
  buyer: User;
  sale: SaleEvent;
}

/** Người mua mới đặt `quantities[i]` Vé Hạng vé thứ `i` ở `sale`; Đơn `pending` có link thanh toán. */
async function place(sale: SaleEvent, quantities: number[] = [2]): Promise<Placed> {
  const buyer = await signUp(h);
  const items = sale.tiers
    .map((tier, i) => ({ ticketTypeId: tier.id, quantity: quantities[i] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody(items));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  return { code: order.code, orderId: (await orderState(h, order.code)).id, total: order.totalAmount, buyer, sale };
}

/** Gửi IPN đã ký tới URL IPN của `org`: 200. */
async function ipn(org: ActionOrg, payload: FakeIpnPayload): Promise<FakeIpnPayload> {
  await postIpn(h, org.ipnKey, signIpn(MAIN.secretToken, payload)).expect(200);
  return payload;
}

/** IPN `success` cho mã `code` với số tiền `amount`. */
const pay = (org: ActionOrg, code: string, amount: number, overrides: FakeIpnPayload = {}) =>
  ipn(org, fakeIpnPayload(code, amount, overrides));

/** Id mục Cần xử lý của khoản tiền `payload`. */
async function itemIdOf(payload: FakeIpnPayload): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>(
    `SELECT r.id FROM review_items r JOIN payment_events e ON e.id = r.payment_event_id
      WHERE e.provider_transaction_code = $1`,
    [payload.providerTransactionCode],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

/** Mục `amount_mismatch` của một Đơn mới (Đơn `review`): nhận `received` cho Đơn `quantities` Vé. */
async function mismatchItem(
  org: ActionOrg,
  sale: SaleEvent,
  received: number,
  quantities: number[] = [2],
  overrides: FakeIpnPayload = {},
) {
  const placed = await place(sale, quantities);
  const itemId = await itemIdOf(await pay(org, placed.code, received, overrides));
  expect((await orderState(h, placed.code)).status).toBe('review');
  return { placed, itemId };
}

/** Mục `orphan` `event_ended` (Sự kiện mới, đã kết thúc trước khi tiền về). */
async function orphanItem(org: ActionOrg) {
  const sale = await eventOnSale(org, [TIER]);
  const placed = await place(sale, [1]);
  await setEvent(sale.event.id, ENDED);
  const itemId = await itemIdOf(await pay(org, placed.code, placed.total));
  return { placed, itemId };
}

/** Mục `duplicate_payment` của Đơn đã `paid` (khoản tiền thứ hai, mã giao dịch khác). */
async function duplicateItem(org: ActionOrg, sale: SaleEvent) {
  const placed = await place(sale, [2]);
  await pay(org, placed.code, placed.total);
  expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
  const itemId = await itemIdOf(await pay(org, placed.code, placed.total));
  return { placed, itemId };
}

/** Mã đúng `ORDER_CODE_PATTERN` mà không có Đơn nào. */
const strayCode = () =>
  `TK${Array.from({ length: 8 }, () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)]).join('')}`;

const setEvent = (eventId: string, set: string) => h.db.pool.query(`UPDATE events SET ${set} WHERE id = $1`, [eventId]);
const ENDED = "effective_end_at = now() - interval '1 minute'";
const CANCELLED = "status = 'cancelled'";
const LOCKED = "locked_at = now(), lock_reason = 'test'";

const actionPath = (orgId: string, itemId: string, action: ReviewAction) =>
  `/v1/orgs/${orgId}/review-items/${itemId}/${action}`;

/** `POST` một thao tác, kèm khóa (mặc định uuid mới; `null` = không gửi header). */
function act(
  org: Org,
  itemId: string,
  action: ReviewAction,
  { cookie = org.owner.cookie, key = randomUUID() as string | null, body }: { cookie?: string; key?: string | null; body?: unknown } = {},
) {
  let req = h.http.post(actionPath(org.orgId, itemId, action)).set('cookie', cookie);
  if (key !== null) req = req.set(IDEMPOTENCY_KEY_HEADER, key);
  return req.send(body ?? (action === 'dismiss' ? { reason: 'Khách chuyển nhầm, đã liên hệ' } : {}));
}

async function actOk(org: Org, itemId: string, action: ReviewAction, options: Parameters<typeof act>[3] = {}) {
  const res = await act(org, itemId, action, options);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return ReviewActionResult.parse(res.body);
}

async function actError(org: Org, itemId: string, action: ReviewAction, status: number, options: Parameters<typeof act>[3] = {}) {
  const res = await act(org, itemId, action, options);
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return ErrorResponse.parse(res.body).error;
}

async function detailOf(org: Org, itemId: string): Promise<ReviewItemDetail> {
  const res = await h.http.get(`/v1/orgs/${org.orgId}/review-items/${itemId}`).set('cookie', org.owner.cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ReviewItemDetail.parse(res.body);
}

async function queueIds(org: Org): Promise<string[]> {
  const res = await h.http.get(`/v1/orgs/${org.orgId}/review-items`).set('cookie', org.owner.cookie).expect(200);
  return ReviewQueue.parse(res.body).items.map((i) => i.id);
}

async function itemRow(itemId: string) {
  const { rows } = await h.db.pool.query<{ status: string; resolution: string | null; dismiss_reason: string | null }>(
    'SELECT status, resolution, dismiss_reason FROM review_items WHERE id = $1',
    [itemId],
  );
  return rows[0]!;
}

/** Lúc tiền về của khoản tiền của mục: `paid_at` Tingee báo, không có thì `received_at`. */
async function paymentTimeOf(itemId: string): Promise<Date> {
  const { rows } = await h.db.pool.query<{ at: Date }>(
    `SELECT COALESCE(e.paid_at, e.received_at) AS at FROM review_items r JOIN payment_events e ON e.id = r.payment_event_id
      WHERE r.id = $1`,
    [itemId],
  );
  return rows[0]!.at;
}

async function orderRowOf(orderId: string) {
  const { rows } = await h.db.pool.query<{
    status: string;
    cancel_reason: string | null;
    paid_amount: string | null;
    paid_source: string | null;
  }>('SELECT status, cancel_reason, paid_amount, paid_source FROM orders WHERE id = $1', [orderId]);
  return rows[0]!;
}

/** Dòng audit của BTC theo thứ tự ghi: hành động, đối tượng, người làm; không bao giờ có giá trị. */
async function auditOf(orgId: string, targetIds: string[]) {
  const { rows } = await h.db.pool.query<{
    action: string;
    target_type: string;
    target_id: string;
    actor_user_id: string | null;
    changed_fields: string[];
  }>(
    `SELECT action, target_type, target_id, actor_user_id, changed_fields FROM audit_events
      WHERE organization_id = $1 AND target_id = ANY($2::text[]) ORDER BY created_at, id`,
    [orgId, targetIds],
  );
  return rows;
}

const emailJobsOf = (orderId: string) =>
  boss.findJobs<SendBuyerEmailPayload>(JobQueue.ORDERING_SEND_BUYER_EMAIL, { data: { orderId } });

const signalsOf = (orgId: string) => signals.filter((s) => s.organizationId === orgId);

/** Tín hiệu đã commit sau mốc `before` (chờ tín hiệu tới rồi đợi thêm để chắc không có gì nữa). */
async function signalsAfter(orgId: string, before: number, expected: number) {
  await expect.poll(() => signalsOf(orgId).length - before).toBeGreaterThanOrEqual(expected);
  await sleep(300);
  return signalsOf(orgId)
    .slice(before)
    .map((s) => s.type);
}

async function addAdmin(org: Org): Promise<User> {
  const admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return admin;
}

const setName = (userId: string, name: string) => h.db.pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);

describe('bảng thao tác (hàm thuần)', () => {
  const state = (patch: Partial<ReviewActionState>): ReviewActionState => ({
    type: 'amount_mismatch',
    status: 'open',
    resolution: null,
    order: { status: 'review', cancelReason: null },
    ...patch,
  });

  it('mục open: theo loại và trạng thái Đơn; mục resolved hoặc Đơn khác → không thao tác', () => {
    for (const type of ['amount_mismatch', 'orphan'] as const) {
      expect(reviewActionsFor(state({ type })), type).toEqual(['approve', 'reject']);
      expect(reviewActionsFor(state({ type, order: { status: 'cancelled', cancelReason: 'rejected' } }))).toEqual([
        'refund',
      ]);
      for (const order of [
        { status: 'cancelled', cancelReason: 'event_cancelled' },
        { status: 'paid', cancelReason: null },
        { status: 'refunded', cancelReason: 'rejected' },
        { status: 'pending', cancelReason: null },
        null,
      ] as const) {
        expect(reviewActionsFor(state({ type, order })), JSON.stringify(order)).toEqual([]);
      }
    }
    for (const type of ['event_cancelled', 'duplicate_payment', 'unmatched'] as const) {
      for (const order of [{ status: 'paid', cancelReason: null } as const, { status: 'review', cancelReason: null } as const, null]) {
        expect(reviewActionsFor(state({ type, order })), type).toEqual(['refund', 'dismiss']);
      }
    }
    for (const resolution of ['approved', 'rejected', 'refunded', 'dismissed'] as const) {
      expect(reviewActionsFor(state({ status: 'resolved', resolution }))).toEqual([]);
      expect(reviewActionsFor(state({ type: 'unmatched', order: null, status: 'resolved', resolution }))).toEqual([]);
    }
  });

  it('đã ở kết quả của thao tác (gửi lại → 200)', () => {
    const rejected = { status: 'cancelled', cancelReason: 'rejected' } as const;
    expect(reviewActionDone('approve', state({ status: 'resolved', resolution: 'approved' }))).toBe(true);
    expect(reviewActionDone('approve', state({}))).toBe(false);
    expect(reviewActionDone('reject', state({ order: rejected }))).toBe(true);
    expect(reviewActionDone('reject', state({ order: rejected, status: 'resolved', resolution: 'refunded' }))).toBe(false);
    expect(reviewActionDone('reject', state({ type: 'duplicate_payment', order: rejected }))).toBe(false);
    expect(reviewActionDone('refund', state({ status: 'resolved', resolution: 'refunded' }))).toBe(true);
    expect(reviewActionDone('refund', state({ status: 'resolved', resolution: 'dismissed' }))).toBe(false);
    expect(reviewActionDone('dismiss', state({ type: 'unmatched', status: 'resolved', resolution: 'dismissed' }))).toBe(true);
  });
});

describe('Duyệt tay phát Vé', () => {
  it('còn chỗ: Đơn paid (nguồn manual, paid_amount = số nhận), đủ Vé, một email Vé, mục approved rời hàng; audit có người làm; tín hiệu khi commit', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    // Tingee báo tiền về 10 phút trước lúc duyệt.
    const paidAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const { placed, itemId } = await mismatchItem(org, sale, 250_000, [2], { paidAt });
    expect(placed.total).toBe(300_000);
    expect(await detailOf(org, itemId)).toMatchObject({ actions: ['approve', 'reject'], approveBlockedReason: null });
    expect(await inventory(h, sale.tiers[0]!.id)).toEqual({ capacity: 10, sold: 0, held: 0 });

    const before = signalsOf(org.orgId).length;
    const result = await actOk(org, itemId, 'approve');
    expect(result).toEqual({
      itemId,
      action: 'approve',
      status: 'resolved',
      resolution: 'approved',
      orderCode: placed.code,
      orderStatus: 'paid',
      ticketCount: 2,
      amount: 250_000,
    });
    expect(await orderState(h, placed.code)).toMatchObject({
      status: 'paid',
      paid_amount: '250000',
      paid_source: 'manual',
      tickets: 2,
    });
    // `paid_at` = lúc tiền về của khoản tiền (Tingee báo), không phải lúc duyệt.
    expect((await orderState(h, placed.code)).paid_at).toEqual(await paymentTimeOf(itemId));
    expect((await orderState(h, placed.code)).paid_at!.toISOString()).toBe(paidAt);
    expect(await inventory(h, sale.tiers[0]!.id)).toEqual({ capacity: 10, sold: 2, held: 0 });
    expect((await emailJobsOf(placed.orderId)).map((j) => j.data)).toEqual([
      { kind: BuyerEmailKind.TICKETS, orderId: placed.orderId },
    ]);
    expect(await itemRow(itemId)).toEqual({ status: 'resolved', resolution: 'approved', dismiss_reason: null });
    expect(await queueIds(org)).toEqual([]);
    expect(await auditOf(org.orgId, [itemId, placed.orderId])).toEqual([
      expect.objectContaining({ action: 'order.paid', target_id: placed.orderId, actor_user_id: org.owner.userId }),
      expect.objectContaining({ action: 'review_item.approve', target_type: 'review_item', target_id: itemId, actor_user_id: org.owner.userId, changed_fields: [] }),
    ]);
    expect((await signalsAfter(org.orgId, before, 3)).sort()).toEqual(
      [RealtimeTopic.EVENT_ORDERS_CHANGED, RealtimeTopic.ORDER_CHANGED, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED].sort(),
    );

    // Người mua thấy Đơn đã thanh toán kèm Vé.
    const view = parseOrder(
      (await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body,
    );
    expect(view.buyerStatus).toBe('paid');
    expect(view.tickets).toHaveLength(2);

    const detail = await detailOf(org, itemId);
    expect(detail).toMatchObject({ status: 'resolved', resolution: 'approved', actions: [], approveBlockedReason: null });
    expect(detail.log.map((l) => l.kind)).toEqual(['payment_received', 'item_opened', 'approved']);
    await expectInvariants(h, sale.event.id);
  });

  it('AD-28: khoản đã duyệt tay không còn mục open và Đơn có paid_amount — không vào cả hai phần của danh sách hoàn tiền', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await mismatchItem(org, sale, 120_000, [1]);
    await actOk(org, itemId, 'approve');
    const { rows } = await h.db.pool.query<{ open: number }>(
      "SELECT count(*)::int AS open FROM review_items WHERE order_id = $1 AND status = 'open'",
      [placed.orderId],
    );
    expect(rows[0]!.open).toBe(0);
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'paid', paid_amount: '120000' });
    const overview = EventOverview.parse(
      (await h.http.get(`/v1/orgs/${org.orgId}/events/${sale.event.id}/overview`).set('cookie', org.owner.cookie).expect(200))
        .body,
    );
    expect(overview.openReviewCount).toBe(0);
  });

  it('hết chỗ (Đơn hai Hạng vé, Hạng thứ hai đã hết): 409 TICKET_TYPE_SOLD_OUT; Đơn giữ review, mục open, không bán dòng nào; nhật ký "Duyệt tay không thành · Hết chỗ" kèm người làm', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER, { name: 'Hạng VIP', price: 400_000, capacity: 2 }]);
    const { placed, itemId } = await mismatchItem(org, sale, 100_000, [1, 2]);
    // Người khác mua hết Hạng VIP sau khi Đơn này vào `review` (đã nhả chỗ).
    const rival = await place(sale, [0, 2]);
    await pay(org, rival.code, rival.total);
    expect(await inventory(h, sale.tiers[1]!.id)).toEqual({ capacity: 2, sold: 2, held: 0 });
    await setName(org.owner.userId, 'Ngô Thanh Vân');

    const before = signalsOf(org.orgId).length;
    const error = await actError(org, itemId, 'approve', 409);
    expect(error.code).toBe('TICKET_TYPE_SOLD_OUT');
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', tickets: 0, paid_amount: null });
    expect(await inventory(h, sale.tiers[0]!.id)).toEqual({ capacity: 10, sold: 0, held: 0 });
    expect(await inventory(h, sale.tiers[1]!.id)).toEqual({ capacity: 2, sold: 2, held: 0 });
    expect(await itemRow(itemId)).toMatchObject({ status: 'open', resolution: null });
    expect(await emailJobsOf(placed.orderId)).toEqual([]);
    expect(await queueIds(org)).toEqual([itemId]);
    // Dòng audit "không thành" đã commit; chỉ tín hiệu mục (nhật ký đổi), Đơn không đổi.
    expect((await auditOf(org.orgId, [itemId, placed.orderId])).map((a) => a.action)).toEqual(['review_item.approve_sold_out']);
    expect(await signalsAfter(org.orgId, before, 1)).toEqual([RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED]);

    const detail = await detailOf(org, itemId);
    expect(detail.actions).toEqual(['approve', 'reject']);
    expect(detail.log.at(-1)).toEqual({ kind: 'approve_sold_out', at: expect.any(String), actorName: 'Ngô Thanh Vân' });
    await expectInvariants(h, sale.event.id);

    // BTC thêm chỗ rồi duyệt lại → thành công.
    await h.db.pool.query('UPDATE ticket_type_inventory SET capacity = 4 WHERE ticket_type_id = $1', [sale.tiers[1]!.id]);
    expect(await actOk(org, itemId, 'approve')).toMatchObject({ resolution: 'approved', ticketCount: 3 });
    expect((await detailOf(org, itemId)).log.map((l) => l.kind)).toEqual([
      'payment_received',
      'item_opened',
      'approve_sold_out',
      'approved',
    ]);
    await expectInvariants(h, sale.event.id);
  });

  it.each([
    ['đã hủy', CANCELLED, 'event_cancelled', 'EVENT_CANCELLED'],
    ['đã kết thúc', ENDED, 'event_ended', 'EVENT_ALREADY_ENDED'],
    ['bị khóa', LOCKED, 'event_locked', 'EVENT_LOCKED'],
  ])('Sự kiện %s: nút tắt kèm lý do; API 409 tương ứng, không đổi gì, không tín hiệu (rollback)', async (_label, set, reason, code) => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await mismatchItem(org, sale, 100_000, [1]);
    await setEvent(sale.event.id, set);
    expect(await detailOf(org, itemId)).toMatchObject({ actions: ['approve', 'reject'], approveBlockedReason: reason });

    const before = signalsOf(org.orgId).length;
    expect((await actError(org, itemId, 'approve', 409)).code).toBe(code);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await itemRow(itemId)).toMatchObject({ status: 'open' });
    expect(await auditOf(org.orgId, [itemId, placed.orderId])).toEqual([]);
    await sleep(300);
    expect(signalsOf(org.orgId)).toHaveLength(before);
    // Từ chối vẫn làm được.
    expect(await actOk(org, itemId, 'reject')).toMatchObject({ orderStatus: 'cancelled', status: 'open' });
  });

  it('Sự kiện đã hủy thắng đã kết thúc (cùng thứ tự kiểm với markPaid)', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { itemId } = await mismatchItem(org, sale, 100_000, [1]);
    await setEvent(sale.event.id, `${ENDED}, ${CANCELLED}`);
    expect((await detailOf(org, itemId)).approveBlockedReason).toBe('event_cancelled');
    expect((await actError(org, itemId, 'approve', 409)).code).toBe('EVENT_CANCELLED');
  });
});

describe('Từ chối và Đã hoàn tay', () => {
  it('mồ côi: Từ chối → Đơn cancelled (rejected), email order_rejected, Người mua thấy "Đã hủy"; mục open ở lại hàng, chỉ còn "Đã hoàn tay"; Hoàn tay → Đơn refunded, mục rời hàng', async () => {
    const org = await freshOrg();
    const admin = await addAdmin(org);
    await setName(admin.userId, 'Đặng Thu Trang');
    const { placed, itemId } = await orphanItem(org);
    expect(await detailOf(org, itemId)).toMatchObject({
      type: 'orphan',
      reason: 'event_ended',
      actions: ['approve', 'reject'],
      approveBlockedReason: 'event_ended',
    });

    let before = signalsOf(org.orgId).length;
    const rejected = await actOk(org, itemId, 'reject', { cookie: admin.cookie });
    expect(rejected).toEqual({
      itemId,
      action: 'reject',
      status: 'open',
      resolution: null,
      orderCode: placed.code,
      orderStatus: 'cancelled',
      ticketCount: 1,
      amount: placed.total,
    });
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'cancelled', cancel_reason: 'rejected', paid_amount: null });
    expect((await emailJobsOf(placed.orderId)).map((j) => j.data)).toEqual([
      { kind: BuyerEmailKind.ORDER_REJECTED, orderId: placed.orderId },
    ]);
    expect(await queueIds(org)).toEqual([itemId]);
    expect((await signalsAfter(org.orgId, before, 3)).sort()).toEqual(
      [RealtimeTopic.EVENT_ORDERS_CHANGED, RealtimeTopic.ORDER_CHANGED, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED].sort(),
    );
    const view = parseOrder((await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body);
    expect(view).toMatchObject({ buyerStatus: 'cancelled_by_organizer', tickets: [] });
    expect(view.organizer.name).toBe('CLB Cầu lông Phú Nhuận');

    const afterReject = await detailOf(org, itemId);
    expect(afterReject).toMatchObject({
      status: 'open',
      order: { status: 'cancelled' },
      actions: ['refund'],
      approveBlockedReason: null,
    });
    expect(afterReject.log.at(-1)).toEqual({ kind: 'rejected', at: expect.any(String), actorName: 'Đặng Thu Trang' });
    // Không có "Bỏ qua" cho Đơn đã từ chối, không duyệt lại được.
    expect((await actError(org, itemId, 'dismiss', 409)).code).toBe('REVIEW_ACTION_NOT_ALLOWED');
    expect((await actError(org, itemId, 'approve', 409)).code).toBe('REVIEW_ACTION_NOT_ALLOWED');
    // Admin đã làm bị xóa khỏi BTC → không còn tên thành viên: chuỗi rỗng (web hiện "Thành viên BTC").
    await h.db.pool.query('DELETE FROM members WHERE organization_id = $1 AND user_id = $2', [org.orgId, admin.userId]);
    expect((await detailOf(org, itemId)).log.at(-1)).toEqual({ kind: 'rejected', at: expect.any(String), actorName: '' });

    before = signalsOf(org.orgId).length;
    const refunded = await actOk(org, itemId, 'refund');
    expect(refunded).toMatchObject({ status: 'resolved', resolution: 'refunded', orderStatus: 'refunded', amount: placed.total });
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'refunded', cancel_reason: 'rejected' });
    expect(await itemRow(itemId)).toMatchObject({ status: 'resolved', resolution: 'refunded' });
    expect(await queueIds(org)).toEqual([]);
    expect((await signalsAfter(org.orgId, before, 3)).sort()).toEqual(
      [RealtimeTopic.EVENT_ORDERS_CHANGED, RealtimeTopic.ORDER_CHANGED, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED].sort(),
    );
    expect((await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body).toMatchObject(
      { buyerStatus: 'cancelled_by_organizer' },
    );
    // Email báo hủy không gửi lần hai.
    expect(await emailJobsOf(placed.orderId)).toHaveLength(1);

    expect(await auditOf(org.orgId, [itemId, placed.orderId])).toEqual([
      expect.objectContaining({ action: 'order.rejected', target_id: placed.orderId, actor_user_id: admin.userId }),
      expect.objectContaining({ action: 'review_item.reject', target_id: itemId, actor_user_id: admin.userId }),
      expect.objectContaining({ action: 'order.refunded', target_id: placed.orderId, actor_user_id: org.owner.userId }),
      expect.objectContaining({ action: 'review_item.refund', target_id: itemId, actor_user_id: org.owner.userId }),
    ]);
    const detail = await detailOf(org, itemId);
    expect(detail).toMatchObject({ status: 'resolved', resolution: 'refunded', order: { status: 'refunded' }, actions: [] });
    // Owner chưa có tên (đăng nhập OTP) → chuỗi rỗng, web hiện "Thành viên BTC".
    expect(detail.log.slice(2)).toEqual([
      { kind: 'rejected', at: expect.any(String), actorName: '' },
      { kind: 'refunded', at: expect.any(String), actorName: '' },
    ]);
  });

  it('không có review → refunded: "Đã hoàn tay" trên mục lệch tiền khi Đơn còn review → 409, không đổi gì', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await mismatchItem(org, sale, 50_000, [1]);
    for (const action of ['refund', 'dismiss'] as const) {
      expect((await actError(org, itemId, action, 409)).code, action).toBe('REVIEW_ACTION_NOT_ALLOWED');
    }
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'review', cancel_reason: null });
    expect(await itemRow(itemId)).toMatchObject({ status: 'open' });
  });

  it('thanh toán trùng: "Đã hoàn tay" chỉ đóng mục; Đơn paid, Vé, doanh thu giữ nguyên; event_orders_changed của Sự kiện', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await duplicateItem(org, sale);
    const overview = async () =>
      EventOverview.parse(
        (await h.http.get(`/v1/orgs/${org.orgId}/events/${sale.event.id}/overview`).set('cookie', org.owner.cookie).expect(200))
          .body,
      );
    const revenueBefore = (await overview()).revenue;
    expect(await detailOf(org, itemId)).toMatchObject({ actions: ['refund', 'dismiss'], approveBlockedReason: null });
    for (const action of ['approve', 'reject'] as const) {
      expect((await actError(org, itemId, action, 409)).code).toBe('REVIEW_ACTION_NOT_ALLOWED');
    }

    const before = signalsOf(org.orgId).length;
    expect(await actOk(org, itemId, 'refund')).toMatchObject({
      status: 'resolved',
      resolution: 'refunded',
      orderStatus: 'paid',
      ticketCount: 2,
      amount: placed.total,
    });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2, paid_amount: String(placed.total) });
    expect(await orderRowOf(placed.orderId)).toMatchObject({ cancel_reason: null });
    expect((await overview()).revenue).toEqual(revenueBefore);
    const types = await signalsAfter(org.orgId, before, 2);
    expect(types.sort()).toEqual([RealtimeTopic.EVENT_ORDERS_CHANGED, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED].sort());
    expect(signalsOf(org.orgId).slice(before).find((s) => s.type === RealtimeTopic.EVENT_ORDERS_CHANGED)).toMatchObject({
      id: placed.orderId,
      eventId: sale.event.id,
    });
    expect((await auditOf(org.orgId, [itemId, placed.orderId])).map((a) => a.action)).toEqual([
      'order.paid',
      'review_item.refund',
    ]);
    await expectInvariants(h, sale.event.id);
  });

  it('Đơn đã từ chối có thêm mục trùng: "Đã hoàn tay" trên mục trùng chỉ đóng mục đó; Đơn giữ cancelled (rejected), mục lệch tiền vẫn còn "Đã hoàn tay"', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId: mismatch } = await mismatchItem(org, sale, 50_000, [1]);
    // Khoản tiền sau cho Đơn `review` → mục `duplicate_payment` cùng Đơn.
    const duplicate = await itemIdOf(await pay(org, placed.code, placed.total));
    expect(await detailOf(org, duplicate)).toMatchObject({ type: 'duplicate_payment', actions: ['refund', 'dismiss'] });
    await actOk(org, mismatch, 'reject');
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'cancelled', cancel_reason: 'rejected' });

    expect(await actOk(org, duplicate, 'refund')).toMatchObject({
      status: 'resolved',
      resolution: 'refunded',
      orderStatus: 'cancelled',
    });
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'cancelled', cancel_reason: 'rejected' });
    expect(await itemRow(mismatch)).toMatchObject({ status: 'open', resolution: null });
    expect(await detailOf(org, mismatch)).toMatchObject({ status: 'open', order: { status: 'cancelled' }, actions: ['refund'] });
    expect((await auditOf(org.orgId, [placed.orderId])).map((a) => a.action)).toEqual(['order.rejected']);

    expect(await actOk(org, mismatch, 'refund')).toMatchObject({ resolution: 'refunded', orderStatus: 'refunded' });
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'refunded', cancel_reason: 'rejected' });
  });

  it('"Bỏ qua" trên mục trùng có Đơn: mục dismissed, Đơn paid giữ nguyên; event_orders_changed của Sự kiện kèm tín hiệu mục', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await duplicateItem(org, sale);
    const before = signalsOf(org.orgId).length;
    expect(await actOk(org, itemId, 'dismiss')).toMatchObject({
      status: 'resolved',
      resolution: 'dismissed',
      orderStatus: 'paid',
      ticketCount: 2,
    });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await itemRow(itemId)).toMatchObject({ resolution: 'dismissed', dismiss_reason: 'Khách chuyển nhầm, đã liên hệ' });
    expect((await signalsAfter(org.orgId, before, 2)).sort()).toEqual(
      [RealtimeTopic.EVENT_ORDERS_CHANGED, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED].sort(),
    );
    expect(signalsOf(org.orgId).slice(before).find((s) => s.type === RealtimeTopic.EVENT_ORDERS_CHANGED)).toMatchObject({
      id: placed.orderId,
      eventId: sale.event.id,
    });
    await expectInvariants(h, sale.event.id);
  });

  it('Sự kiện đã hủy: "Đã hoàn tay" đóng mục, Đơn giữ review (không có review → refunded)', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const placed = await place(sale, [1]);
    await setEvent(sale.event.id, CANCELLED);
    const itemId = await itemIdOf(await pay(org, placed.code, placed.total));
    expect(await detailOf(org, itemId)).toMatchObject({ type: 'event_cancelled', actions: ['refund', 'dismiss'] });
    await actOk(org, itemId, 'refund');
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'review', cancel_reason: null });
    expect(await itemRow(itemId)).toMatchObject({ status: 'resolved', resolution: 'refunded' });
  });
});

describe('Bỏ qua', () => {
  it('chưa khớp: lý do thiếu, rỗng sau trim, quá 300 → 400 VALIDATION_FAILED, không đổi gì; có lý do → dismissed, lý do đã trim lưu ở mục, nhật ký kèm lý do; không lý do trong audit', async () => {
    const org = await freshOrg();
    const itemId = await itemIdOf(await pay(org, strayCode(), 75_000));
    for (const body of [{}, { reason: '' }, { reason: '    ' }, { reason: 'a'.repeat(301) }, { reason: 42 }]) {
      const error = await actError(org, itemId, 'dismiss', 400, { body });
      expect(error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    expect(await itemRow(itemId)).toEqual({ status: 'open', resolution: null, dismiss_reason: null });

    const before = signalsOf(org.orgId).length;
    const reason = '  Khách chuyển nhầm BTC, đã hoàn qua ngân hàng  ';
    expect(await actOk(org, itemId, 'dismiss', { body: { reason } })).toEqual({
      itemId,
      action: 'dismiss',
      status: 'resolved',
      resolution: 'dismissed',
      orderCode: null,
      orderStatus: null,
      ticketCount: 0,
      amount: 75_000,
    });
    expect(await itemRow(itemId)).toEqual({
      status: 'resolved',
      resolution: 'dismissed',
      dismiss_reason: 'Khách chuyển nhầm BTC, đã hoàn qua ngân hàng',
    });
    // Mục không gắn Đơn: chỉ tín hiệu mục.
    expect(await signalsAfter(org.orgId, before, 1)).toEqual([RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED]);
    const audits = await auditOf(org.orgId, [itemId]);
    expect(audits).toEqual([expect.objectContaining({ action: 'review_item.dismiss', changed_fields: [] })]);
    expect(JSON.stringify(audits)).not.toContain('Khách chuyển nhầm');
    expect((await detailOf(org, itemId)).log.at(-1)).toEqual({
      kind: 'dismissed',
      at: expect.any(String),
      actorName: '',
      note: 'Khách chuyển nhầm BTC, đã hoàn qua ngân hàng',
    });
    expect(await queueIds(org)).toEqual([]);
  });

  it('300 ký tự sau trim được nhận; mồ côi/lệch tiền không có "Bỏ qua"', async () => {
    const org = await freshOrg();
    const itemId = await itemIdOf(await pay(org, strayCode(), 10_000));
    await actOk(org, itemId, 'dismiss', { body: { reason: ` ${'b'.repeat(300)} ` } });
    expect((await itemRow(itemId)).dismiss_reason).toHaveLength(300);
    const { itemId: orphan } = await orphanItem(org);
    expect((await actError(org, orphan, 'dismiss', 409)).code).toBe('REVIEW_ACTION_NOT_ALLOWED');
  });
});

describe('gửi lại và cuộc đua', () => {
  it('gửi lại đúng thao tác cho mục đã ở kết quả đó → 200 trạng thái hiện tại; không phát Vé, không email, không audit lần hai', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await mismatchItem(org, sale, 200_000, [2]);
    const key = randomUUID();
    const first = await actOk(org, itemId, 'approve', { key });
    const before = signalsOf(org.orgId).length;
    // Cùng khóa (thử lại sau lỗi mạng) hay khóa mới (bấm lại ở tab khác) đều chỉ đọc trạng thái.
    expect(await actOk(org, itemId, 'approve', { key })).toEqual(first);
    expect(await actOk(org, itemId, 'approve')).toEqual(first);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await emailJobsOf(placed.orderId)).toHaveLength(1);
    expect((await auditOf(org.orgId, [itemId, placed.orderId])).map((a) => a.action)).toEqual([
      'order.paid',
      'review_item.approve',
    ]);
    await sleep(300);
    expect(signalsOf(org.orgId)).toHaveLength(before);
    await expectInvariants(h, sale.event.id);

    // Từ chối gửi lại khi mục vẫn open và Đơn đã cancelled (rejected) → 200, một email.
    const { itemId: orphan, placed: orphanOrder } = await orphanItem(org);
    await actOk(org, orphan, 'reject');
    expect(await actOk(org, orphan, 'reject')).toMatchObject({ status: 'open', orderStatus: 'cancelled' });
    expect(await emailJobsOf(orphanOrder.orderId)).toHaveLength(1);
    await actOk(org, orphan, 'refund');
    expect(await actOk(org, orphan, 'refund')).toMatchObject({ resolution: 'refunded', orderStatus: 'refunded' });
    // Từ chối sau khi đã hoàn tay: không còn là kết quả của Từ chối → 409.
    expect((await actError(org, orphan, 'reject', 409)).code).toBe('REVIEW_ACTION_NOT_ALLOWED');

    const stray = await itemIdOf(await pay(org, strayCode(), 5_000));
    await actOk(org, stray, 'dismiss');
    expect(await actOk(org, stray, 'dismiss', { body: { reason: 'lý do khác' } })).toMatchObject({ resolution: 'dismissed' });
    expect((await itemRow(stray)).dismiss_reason).toBe('Khách chuyển nhầm, đã liên hệ');
    // Thao tác khác trên mục đã đóng → 409.
    expect((await actError(org, stray, 'refund', 409)).code).toBe('REVIEW_ACTION_NOT_ALLOWED');
  });

  it('hai thành viên cùng lúc (A Duyệt, B Từ chối) → đúng một bên thắng, bên thua 409 REVIEW_ACTION_NOT_ALLOWED', async () => {
    const org = await freshOrg();
    const admin = await addAdmin(org);
    const sale = await eventOnSale(org, [TIER]);
    for (let round = 0; round < 4; round++) {
      const { placed, itemId } = await mismatchItem(org, sale, 90_000, [1]);
      const [a, b] = await Promise.all([
        act(org, itemId, 'approve'),
        act(org, itemId, 'reject', { cookie: admin.cookie }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses, JSON.stringify([a.body, b.body])).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(ErrorResponse.parse(loser.body).error.code).toBe('REVIEW_ACTION_NOT_ALLOWED');
      const order = await orderRowOf(placed.orderId);
      if (a.status === 200) {
        expect(order.status).toBe('paid');
        expect(await itemRow(itemId)).toMatchObject({ resolution: 'approved' });
        expect((await orderState(h, placed.code)).tickets).toBe(1);
      } else {
        expect(order).toMatchObject({ status: 'cancelled', cancel_reason: 'rejected' });
        expect(await itemRow(itemId)).toMatchObject({ status: 'open' });
        expect((await orderState(h, placed.code)).tickets).toBe(0);
      }
    }
    await expectInvariants(h, sale.event.id);
  });
});

describe('đầu vào, cách ly và quyền', () => {
  it('Idempotency-Key thiếu hoặc không phải uuid → 400 VALIDATION_FAILED, không đổi gì', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await mismatchItem(org, sale, 1_000, [1]);
    for (const action of ['approve', 'reject', 'refund', 'dismiss'] as const) {
      for (const key of [null, 'khong-phai-uuid', '']) {
        const error = await actError(org, itemId, action, 400, { key });
        expect(error.code, `${action} ${String(key)}`).toBe('VALIDATION_FAILED');
      }
    }
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'review' });
    expect(await itemRow(itemId)).toMatchObject({ status: 'open' });
  });

  it('mục lạ, sai dạng hoặc của BTC khác → 404 REVIEW_ITEM_NOT_FOUND; mục của BTC khác không đổi', async () => {
    const org = await freshOrg();
    const other = await freshOrg('CLB khác');
    const sale = await eventOnSale(other, [TIER]);
    const { placed, itemId: foreign } = await mismatchItem(other, sale, 1_000, [1]);
    for (const action of ['approve', 'reject', 'refund', 'dismiss'] as const) {
      for (const itemId of [foreign, randomUUID(), 'khong-phai-uuid']) {
        expect((await actError(org, itemId, action, 404)).code, `${action} ${itemId}`).toBe('REVIEW_ITEM_NOT_FOUND');
      }
    }
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'review' });
    expect(await itemRow(foreign)).toMatchObject({ status: 'open' });
    // Id viết HOA vẫn khớp mục của chính BTC.
    expect(await actOk(other, foreign.toUpperCase(), 'reject')).toMatchObject({ itemId: foreign, orderStatus: 'cancelled' });
  });

  it('người ngoài (kể cả CTV chưa là thành viên), Owner BTC khác → 403 NOT_A_MEMBER; chưa đăng nhập → 401; không đổi gì', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [TIER]);
    const { placed, itemId } = await mismatchItem(org, sale, 1_000, [1]);
    const other = await freshOrg('CLB khác');
    const stranger = await signUp(h);
    for (const cookie of [stranger.cookie, other.owner.cookie]) {
      for (const action of ['approve', 'reject', 'refund', 'dismiss'] as const) {
        expect((await actError(org, itemId, action, 403, { cookie })).code, action).toBe('NOT_A_MEMBER');
      }
    }
    for (const action of ['approve', 'reject', 'refund', 'dismiss'] as const) {
      await h.http.post(actionPath(org.orgId, itemId, action)).set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send({}).expect(401);
    }
    expect(await orderRowOf(placed.orderId)).toMatchObject({ status: 'review' });
    expect(await itemRow(itemId)).toMatchObject({ status: 'open' });
  });

  it('Admin làm được như Owner', async () => {
    const org = await freshOrg();
    const admin = await addAdmin(org);
    const sale = await eventOnSale(org, [TIER]);
    const { itemId } = await mismatchItem(org, sale, 1_000, [1]);
    expect(await actOk(org, itemId, 'approve', { cookie: admin.cookie })).toMatchObject({ resolution: 'approved' });
  });
});

describe('Đơn hết hạn vào review rồi được duyệt (mồ côi hết chỗ)', () => {
  it('mồ côi sold_out (Đơn expired, hết chỗ khi tiền về) → BTC thêm chỗ → Duyệt tay phát Vé', async () => {
    const org = await freshOrg();
    const sale = await eventOnSale(org, [{ name: 'Vé thường', price: PRICE, capacity: 1 }]);
    const placed = await place(sale, [1]);
    await ipn(org, fakeStatusIpnPayload(placed.code, placed.total, 'expired'));
    expect((await orderState(h, placed.code)).status).toBe('expired');
    const rival = await place(sale, [1]);
    await pay(org, rival.code, rival.total);
    const itemId = await itemIdOf(await pay(org, placed.code, placed.total));
    expect(await detailOf(org, itemId)).toMatchObject({ type: 'orphan', reason: 'sold_out', actions: ['approve', 'reject'] });
    expect((await actError(org, itemId, 'approve', 409)).code).toBe('TICKET_TYPE_SOLD_OUT');
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET capacity = 2 WHERE ticket_type_id = ${sale.tiers[0]!.id}`);
    expect(await actOk(org, itemId, 'approve')).toMatchObject({ resolution: 'approved', orderStatus: 'paid', ticketCount: 1 });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'manual', tickets: 1 });
    await expectInvariants(h, sale.event.id);
  });
});
