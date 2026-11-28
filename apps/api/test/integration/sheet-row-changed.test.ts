import { randomUUID } from 'node:crypto';
import { IDEMPOTENCY_KEY_HEADER, ReviewActionResult, type ReviewAction } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markSheetRowChanged } from '../../src/modules/integration/sheet-flush-jobs.js';
import { runSheetInitialSync } from '../../src/modules/integration/sheet-sync-jobs.js';
import { markExpired, OrderPayments } from '../../src/modules/ordering/index.js';
import { checkIn } from '../../src/modules/ticketing/index.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { startGoogleFake, type GoogleFake } from '../google-fake/server.js';
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
} from '../ordering/order-fixtures.js';
import { orderState, postIpn } from '../payment/ipn-fixtures.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type FakeIpnPayload, type TingeeFake } from '../tingee-fake/server.js';
import {
  connectAndSync,
  connectSheet,
  dirtyOf,
  flushJobsOf,
  freeSheetEvent,
  googleUrlsOf,
  placeFreeOrder,
  prepareSheetQueues,
  rowChangedJobsOf,
  SHEETS_CLIENT_ID,
  SHEETS_CLIENT_SECRET,
  sheetDeps,
  type SheetEnv,
} from './sheet-fixtures.js';

/*
 * Story 6.5: năm điểm enqueue `integration.sheet_row_changed` (`OrderPayments.pay()`, `moveToReview()`,
 * `OrderReviewDecisions.reject`/`.refund`, `ticketing.checkIn`) bằng chính `tx` của lệnh đổi trạng thái, qua đường thật
 * (Đơn 0đ, IPN ký bởi Tingee fake, thao tác trên mục Cần xử lý, quét và tra tay); rollback thì không có job; hết hạn không
 * enqueue. Handler `markSheetRowChanged`: không kết nối → không ghi gì; `syncing`/`auth_revoked` chỉ đánh dấu; `active`
 * đánh dấu và hẹn flush theo debounce của kết nối.
 */

const MAIN: TingeeCredential = { clientId: 'tg-sheet-row-5a7c', secretToken: 'tg-sheet-row-secret-Qw8Er7Ty6' };
const account = fakeAccount({ accountName: 'PHAM THI HOA' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};
const PRICE = 120_000;

let tingee: TingeeFake;
let google: GoogleFake;
let h: Harness;
let org: Org;
let ipnKey: string;
let env: SheetEnv;

beforeAll(async () => {
  tingee = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  google = await startGoogleFake({ clientId: SHEETS_CLIENT_ID, clientSecret: SHEETS_CLIENT_SECRET });
  h = await createHarness({ TINGEE_BASE_URL: tingee.url, ...googleUrlsOf(google) });
  org = await paidReadyOrg(h, { name: 'CLB Chạy bộ Thủ Thiêm', credential: MAIN, payout: PAYOUT });
  ipnKey = await ipnKeyOf(h, org.orgId);
  env = { h, fake: google, org };
  await prepareSheetQueues(h);
});
beforeEach(async () => {
  google.reset();
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await google.close();
  await tingee.close();
});

const paidEvent = () => eventOnSale(org, [{ name: 'Cự ly 10km', price: PRICE, capacity: 20 }]);

/** Người mua mới đặt Đơn có phí ở `sale` (Đơn `pending` có link thanh toán của Tingee fake). */
async function placePaid(sale: SaleEvent, quantity = 1): Promise<{ code: string; id: string; total: number }> {
  const buyer = await signUp(h);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  return { code: order.code, id: (await orderState(h, order.code)).id, total: order.totalAmount };
}

/** IPN `success` đã ký cho mã `code` với số tiền `amount`. */
async function ipn(code: string, amount: number): Promise<FakeIpnPayload> {
  const payload = fakeIpnPayload(code, amount);
  await postIpn(h, ipnKey, signIpn(MAIN.secretToken, payload)).expect(200);
  return payload;
}

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

/** Thao tác trên mục Cần xử lý qua HTTP (Owner): 200. */
async function act(itemId: string, action: ReviewAction): Promise<void> {
  const res = await h.http
    .post(`/v1/orgs/${org.orgId}/review-items/${itemId}/${action}`)
    .set('cookie', org.owner.cookie)
    .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
    .send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  ReviewActionResult.parse(res.body);
}

const jobOf = (eventId: string, orderId: string) => ({ eventId, orderId });

describe('năm điểm enqueue (cùng tx của lệnh đổi trạng thái)', () => {
  it('Đơn 0đ (pay, nguồn free): đúng một job { eventId, orderId } trong TX1', async () => {
    const sale = await freeSheetEvent(org);
    const order = await placeFreeOrder(h, sale);
    expect(await rowChangedJobsOf(h, order.id)).toEqual([jobOf(sale.event.id, order.id)]);
  });

  it('IPN khớp tiền → paid: một job; IPN lệch tiền → review (moveToReview): một job', async () => {
    const sale = await paidEvent();
    const paid = await placePaid(sale);
    expect(await rowChangedJobsOf(h, paid.id)).toEqual([]);
    await ipn(paid.code, paid.total);
    expect((await orderState(h, paid.code)).status).toBe('paid');
    expect(await rowChangedJobsOf(h, paid.id)).toEqual([jobOf(sale.event.id, paid.id)]);

    const mismatch = await placePaid(sale);
    await ipn(mismatch.code, mismatch.total - 20_000);
    expect((await orderState(h, mismatch.code)).status).toBe('review');
    expect(await rowChangedJobsOf(h, mismatch.id)).toEqual([jobOf(sale.event.id, mismatch.id)]);
  });

  it('Cần xử lý qua HTTP: duyệt tay → paid; từ chối → cancelled; đã hoàn tay → refunded, mỗi lần đổi một job', async () => {
    const sale = await paidEvent();
    const approved = await placePaid(sale);
    const approveItem = await itemIdOf(await ipn(approved.code, approved.total - 10_000));
    await act(approveItem, 'approve');
    expect((await orderState(h, approved.code)).status).toBe('paid');
    // review (IPN lệch tiền) rồi paid (duyệt tay).
    expect(await rowChangedJobsOf(h, approved.id)).toHaveLength(2);

    const rejected = await placePaid(sale);
    const rejectItem = await itemIdOf(await ipn(rejected.code, rejected.total + 5_000));
    await act(rejectItem, 'reject');
    expect((await orderState(h, rejected.code)).status).toBe('cancelled');
    expect(await rowChangedJobsOf(h, rejected.id)).toHaveLength(2);
    await act(rejectItem, 'refund');
    expect((await orderState(h, rejected.code)).status).toBe('refunded');
    expect(await rowChangedJobsOf(h, rejected.id)).toEqual([
      jobOf(sale.event.id, rejected.id),
      jobOf(sale.event.id, rejected.id),
      jobOf(sale.event.id, rejected.id),
    ]);
  });

  it('check-in quét và tra tay: job khi check-in thành công, quét lại không thêm; checkin_method scan / manual', async () => {
    const sale = await freeSheetEvent(org);
    const order = await placeFreeOrder(h, sale, { tickets: 2 });
    const [first, second] = order.tickets;
    const scan = (code: string, scanId = randomUUID()) =>
      h.http.post(`/v1/checkin/events/${sale.event.id}/scans`).set('cookie', org.owner.cookie).send({ code, scanId }).expect(200);

    await scan(first!.qr);
    expect(await rowChangedJobsOf(h, order.id)).toHaveLength(2);
    // Quét lại (trong 60 giây, cùng người: `recent`) và gửi lại cùng scanId (phát lại): không đổi gì, không job.
    await scan(first!.qr);
    expect(await rowChangedJobsOf(h, order.id)).toHaveLength(2);

    await h.http
      .post(`/v1/checkin/events/${sale.event.id}/tickets/${second!.id}/check-in`)
      .set('cookie', org.owner.cookie)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
      .expect(200);
    expect(await rowChangedJobsOf(h, order.id)).toEqual([
      jobOf(sale.event.id, order.id),
      jobOf(sale.event.id, order.id),
      jobOf(sale.event.id, order.id),
    ]);
    const { rows } = await h.db.pool.query<{ id: string; checkin_method: string | null }>(
      'SELECT id, checkin_method FROM tickets WHERE order_id = $1 ORDER BY seq',
      [order.id],
    );
    expect(rows.map((r) => r.checkin_method)).toEqual(['scan', 'manual']);
  });

  it('rollback: markPaid hay checkIn trong tx rollback → không có job, không đổi gì', async () => {
    const db = h.app.get<Database>(DATABASE);
    const boss = h.app.get<PgBoss>(BOSS);
    const payments = h.app.get(OrderPayments);
    await payments.ready();
    const sale = await paidEvent();
    const pending = await placePaid(sale);
    await expect(
      db.transaction(async (tx) => {
        expect(await payments.markPaid(tx, pending.id, 'ipn', pending.total)).toEqual({ outcome: 'paid' });
        throw new Error('rollback thử');
      }),
    ).rejects.toThrow('rollback thử');
    expect((await orderState(h, pending.code)).status).toBe('pending');
    expect(await rowChangedJobsOf(h, pending.id)).toEqual([]);

    const free = await freeSheetEvent(org);
    const order = await placeFreeOrder(h, free);
    await expect(
      db.transaction(async (tx) => {
        const result = await checkIn(tx, boss, {
          ticketId: order.tickets[0]!.id,
          eventId: free.event.id,
          organizationId: org.orgId,
          userId: org.owner.userId,
          scanId: randomUUID(),
          method: 'scan',
        });
        expect(result.outcome).toBe('ok');
        throw new Error('rollback thử');
      }),
    ).rejects.toThrow('rollback thử');
    // Chỉ job của Đơn 0đ (TX1).
    expect(await rowChangedJobsOf(h, order.id)).toHaveLength(1);
    const { rows } = await h.db.pool.query('SELECT 1 FROM tickets WHERE order_id = $1 AND checked_in_at IS NOT NULL', [
      order.id,
    ]);
    expect(rows).toEqual([]);
  });

  it('hết hạn (markExpired, cũng phát order_changed) không enqueue', async () => {
    const db = h.app.get<Database>(DATABASE);
    const sale = await paidEvent();
    const pending = await placePaid(sale);
    expect(await db.transaction((tx) => markExpired(tx, pending.id))).toBe('expired');
    expect(await rowChangedJobsOf(h, pending.id)).toEqual([]);
  });
});

describe('handler sheet_row_changed', () => {
  it('Sự kiện chưa kết nối → no_connection: không dòng bẩn, không hẹn flush, không gọi Google', async () => {
    const sale = await freeSheetEvent(org);
    const order = await placeFreeOrder(h, sale);
    expect(await markSheetRowChanged(sheetDeps(env), { eventId: sale.event.id, orderId: order.id })).toBe('no_connection');
    const { rows } = await h.db.pool.query('SELECT 1 FROM sheet_dirty_rows WHERE order_id = $1', [order.id]);
    expect(rows).toEqual([]);
    expect(google.requests).toEqual([]);
  });

  it('kết nối syncing (lần đẩy đầu chưa xong) → chỉ đánh dấu (version tăng), không hẹn flush; đẩy đầu xong → hẹn flush', async () => {
    const sale = await freeSheetEvent(org);
    const order = await placeFreeOrder(h, sale);
    const connectionId = await connectSheet(env, sale.event.id);
    const payload = { eventId: sale.event.id, orderId: order.id };
    expect(await markSheetRowChanged(sheetDeps(env), payload)).toBe('marked');
    expect(await markSheetRowChanged(sheetDeps(env), payload)).toBe('marked');
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order.id, 2]]));
    expect(await flushJobsOf(h, connectionId)).toEqual([]);

    expect(await runSheetInitialSync(sheetDeps(env), connectionId)).toMatchObject({ result: 'synced', orders: 1 });
    const jobs = await flushJobsOf(h, connectionId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: 'created', data: { connectionId } });
    // Dòng bẩn giữ tới khi flush ghi xong.
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order.id, 2]]));
  });

  it('auth_revoked → chỉ đánh dấu, giữ dòng bẩn cho 6.6, không hẹn flush', async () => {
    const sale = await freeSheetEvent(org);
    const { connectionId } = await connectAndSync(env, sale.event.id);
    await h.db.pool.query(
      "UPDATE sheet_connections SET status = 'auth_revoked', last_error_code = 'invalid_grant' WHERE id = $1",
      [connectionId],
    );
    const order = await placeFreeOrder(h, sale);
    expect(await markSheetRowChanged(sheetDeps(env), { eventId: sale.event.id, orderId: order.id })).toBe('marked');
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order.id, 1]]));
    expect(await flushJobsOf(h, connectionId)).toEqual([]);
  });

  it('active → đánh dấu và hẹn flush debounce theo kết nối: khe hiện tại chạy ngay, rồi khe kế, rồi không thêm', async () => {
    const sale = await freeSheetEvent(org);
    const { connectionId } = await connectAndSync(env, sale.event.id);
    const [a, b, c] = [await placeFreeOrder(h, sale), await placeFreeOrder(h, sale), await placeFreeOrder(h, sale)];
    // Cửa sổ 1 giờ: ba lần gọi chắc chắn cùng một khe.
    const deps = sheetDeps(env, undefined, 3_600);
    const before = Date.now();
    for (const order of [a, b, c]) {
      expect(await markSheetRowChanged(deps, { eventId: sale.event.id, orderId: order!.id })).toBe('scheduled');
    }
    const jobs = await flushJobsOf(h, connectionId);
    expect(jobs.map((job) => [job.state, job.singleton_key])).toEqual([
      ['created', connectionId],
      ['created', connectionId],
    ]);
    // Job đầu chạy ngay; job thứ hai ở đầu khe kế (sau ít nhất vài giây, tối đa một cửa sổ).
    expect(jobs[0]!.start_after.getTime()).toBeLessThan(before + 5_000);
    expect(jobs[1]!.start_after.getTime()).toBeGreaterThan(Date.now());
    expect(jobs[1]!.start_after.getTime()).toBeLessThanOrEqual(before + 3_602_000);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([a, b, c].map((order) => [order!.id, 1])));
  });
});
