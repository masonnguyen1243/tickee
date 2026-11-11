import { randomUUID } from 'node:crypto';
import { JobQueue } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markExpired, OrderPayments, orderForPayment } from '../../src/modules/ordering/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { expectInvariants, orderState } from '../payment/ipn-fixtures.js';
import {
  eventOnSale,
  inventory,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
} from './order-fixtures.js';

/*
 * Story 3.5, 3.6: `ordering.markPaid` nguồn `ipn` và `ordering.markExpired`, gọi thẳng trong transaction (không qua HTTP
 * IPN, nên không có `review_items`: đó là việc của `payment`) trên Postgres thật. Đơn nhiều Hạng vé `pending` (Tingee từ
 * chối tạo link: Đơn vẫn chờ, đang giữ chỗ). Thứ tự kiểm dưới khóa Đơn (bước 3–7 của AD-7): Sự kiện hủy → Đơn không còn
 * chờ tiền → lệch tiền → tiền về muộn (đã kết thúc / bị khóa / bán lại có điều kiện) → `pending` thì CAS, `held -= n,
 * sold += n` theo từng Hạng vé, N Vé.
 */

let h: Harness;
let org: Org;
let db: Database;
let payments: OrderPayments;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h);
  db = h.app.get<Database>(DATABASE);
  payments = h.app.get(OrderPayments);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

/** Đơn `pending` 2 Vé Hạng A (100.000đ, 5 suất) + 1 Vé Hạng B (250.000đ, 3 suất) = 450.000đ, ở Sự kiện mới. */
async function pendingOrder() {
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [
    { name: 'Hạng A', price: 100_000, capacity: 5 },
    { name: 'Hạng B', price: 250_000, capacity: 3 },
  ]);
  const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
  const funnelId = randomUUID();
  const res = await postOrder(
    h,
    buyer,
    sale.event.slug,
    orderBody(
      [
        { ticketTypeId: a.id, quantity: 2 },
        { ticketTypeId: b.id, quantity: 1 },
      ],
      { funnelId },
    ),
  ).expect(201);
  const order = parseOrder(res.body);
  expect(order.buyerStatus).toBe('awaiting_payment');
  const { id } = await orderState(h, order.code);
  return {
    id,
    code: order.code,
    eventId: sale.event.id,
    slug: sale.event.slug,
    a: a.id,
    b: b.id,
    total: 450_000,
    funnelId,
  };
}

/** Như `pendingOrder` rồi hết hạn (IPN `expired`/`canceled`): `held` đã nhả. */
async function expiredOrder() {
  const order = await pendingOrder();
  expect(await db.transaction((tx) => markExpired(tx, order.id))).toBe('expired');
  return order;
}

const ipnPaid = (orderId: string, amount: number, paidAt: Date | null = null) =>
  db.transaction((tx) => payments.markPaid(tx, orderId, 'ipn', amount, { paidAt }));

const setEvent = (eventId: string, set: string) => h.db.pool.query(`UPDATE events SET ${set} WHERE id = $1`, [eventId]);
const ENDED = "effective_end_at = now() - interval '1 minute'";
const CANCELLED = "status = 'cancelled'";
const LOCKED = "locked_at = now(), lock_reason = 'test'";

/** Payload các job email Người mua của Đơn (Story 3.8). */
async function buyerEmails(orderId: string): Promise<unknown[]> {
  const jobs = await h.app.get<PgBoss>(BOSS).findJobs(JobQueue.ORDERING_SEND_BUYER_EMAIL, { data: { orderId } });
  return jobs.map((job) => job.data);
}

async function auditCount(orderId: string): Promise<number> {
  const { rows } = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
    orderId,
  ]);
  return rows.length;
}

describe('markPaid nguồn ipn: Đơn pending', () => {
  it('khớp tiền → paid: paid_at = paidAt, held → sold từng Hạng vé, N Vé seq 1..N (issued_at = đồng hồ DB), audit, phễu; gọi lại → duplicate_payment', async () => {
    const order = await pendingOrder();
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 2 });
    const paidAt = new Date(Date.now() - 5 * 60_000);
    expect(await ipnPaid(order.id, order.total, paidAt)).toEqual({ outcome: 'paid' });

    const state = await orderState(h, order.code);
    expect(state).toMatchObject({ status: 'paid', paid_source: 'ipn', paid_amount: '450000', tickets: 3 });
    expect(state.paid_at!.toISOString()).toBe(paidAt.toISOString());
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 1, held: 0 });
    const { rows: tickets } = await h.db.pool.query<{ seq: number; ticket_type_id: string; issued_at: Date }>(
      'SELECT seq, ticket_type_id, issued_at FROM tickets WHERE order_id = $1 ORDER BY seq',
      [order.id],
    );
    expect(tickets.map((t) => t.seq)).toEqual([1, 2, 3]);
    for (const ticket of tickets) expect(Math.abs(ticket.issued_at.getTime() - Date.now())).toBeLessThan(30_000);
    expect(await auditCount(order.id)).toBe(1);
    const funnel = await h.db.pool.query<{ type: string }>(
      'SELECT type FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [order.funnelId],
    );
    expect(funnel.rows.map((r) => r.type)).toEqual(['order_created', 'paid']);
    await expectInvariants(h, order.eventId);

    expect(await ipnPaid(order.id, order.total, paidAt)).toEqual({ outcome: 'duplicate_payment' });
    expect((await orderState(h, order.code)).tickets).toBe(3);
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
  });

  it('không có paidAt → paid_at = đồng hồ DB (= issued_at của Vé)', async () => {
    const order = await pendingOrder();
    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'paid' });
    const state = await orderState(h, order.code);
    const { rows } = await h.db.pool.query<{ issued_at: Date }>('SELECT DISTINCT issued_at FROM tickets WHERE order_id = $1', [
      order.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(state.paid_at!.getTime()).toBe(rows[0]!.issued_at.getTime());
    await expectInvariants(h, order.eventId);
  });

  it('lệch tiền (thiếu, thừa, 0) → mismatch: Đơn review, nhả held mọi Hạng vé, 0 Vé; khoản sau → duplicate_payment', async () => {
    for (const delta of [-1, 1, -450_000]) {
      const order = await pendingOrder();
      expect(await ipnPaid(order.id, order.total + delta)).toEqual({ outcome: 'mismatch' });
      expect(await orderState(h, order.code)).toMatchObject({ status: 'review', paid_at: null, tickets: 0 });
      expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
      expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 0, held: 0 });
      expect(await auditCount(order.id)).toBe(0);
      await expectInvariants(h, order.eventId);
      expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'duplicate_payment' });
      expect((await orderState(h, order.code)).status).toBe('review');
    }
  });

  it('đã kết thúc (đúng tiền) → orphan event_ended: Đơn review, nhả held', async () => {
    const order = await pendingOrder();
    await setEvent(order.eventId, ENDED);
    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'orphan', reason: 'event_ended' });
    expect(await orderState(h, order.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 0, held: 0 });
    await expectInvariants(h, order.eventId);
  });

  it('Sự kiện bị khóa (chưa kết thúc) vẫn phát Vé', async () => {
    const order = await pendingOrder();
    await setEvent(order.eventId, LOCKED);
    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'paid' });
    expect(await orderState(h, order.code)).toMatchObject({ status: 'paid', tickets: 3 });
    await expectInvariants(h, order.eventId);
  });

  it('thứ tự kiểm: Sự kiện hủy thắng lệch tiền và đã kết thúc; lệch tiền thắng đã kết thúc', async () => {
    const cancelled = await pendingOrder();
    await setEvent(cancelled.eventId, `${ENDED}, ${CANCELLED}`);
    expect(await ipnPaid(cancelled.id, cancelled.total + 5)).toEqual({ outcome: 'event_cancelled' });
    expect(await orderState(h, cancelled.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await inventory(h, cancelled.b)).toEqual({ capacity: 3, sold: 0, held: 0 });
    // Sự kiện đã hủy đứng trước Đơn không còn chờ tiền: khoản sau vẫn là event_cancelled.
    expect(await ipnPaid(cancelled.id, cancelled.total)).toEqual({ outcome: 'event_cancelled' });
    expect((await orderState(h, cancelled.code)).status).toBe('review');
    await expectInvariants(h, cancelled.eventId);

    const mismatch = await pendingOrder();
    await setEvent(mismatch.eventId, ENDED);
    expect(await ipnPaid(mismatch.id, mismatch.total + 5)).toEqual({ outcome: 'mismatch' });
    expect(await orderState(h, mismatch.code)).toMatchObject({ status: 'review', tickets: 0 });
    await expectInvariants(h, mismatch.eventId);
  });
});

describe('markPaid nguồn ipn: Đơn không còn chờ tiền', () => {
  it('Đơn paid: lệch tiền hay đã kết thúc → duplicate_payment; Sự kiện hủy → event_cancelled; Đơn, Vé, tồn kho không đổi', async () => {
    const order = await pendingOrder();
    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'paid' });
    const before = await orderState(h, order.code);
    expect(await ipnPaid(order.id, order.total + 1_000)).toEqual({ outcome: 'duplicate_payment' });
    await setEvent(order.eventId, ENDED);
    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'duplicate_payment' });
    await setEvent(order.eventId, CANCELLED);
    expect(await ipnPaid(order.id, order.total + 1_000)).toEqual({ outcome: 'event_cancelled' });
    expect(await orderState(h, order.code)).toEqual(before);
    expect(before).toMatchObject({ status: 'paid', paid_amount: '450000', tickets: 3 });
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 1, held: 0 });
    expect(await auditCount(order.id)).toBe(1);
    await expectInvariants(h, order.eventId);
  });

  it('Đơn cancelled hay refunded → duplicate_payment; Sự kiện đã hủy → event_cancelled, Đơn cancelled giữ nguyên', async () => {
    for (const status of ['cancelled', 'refunded']) {
      const order = await expiredOrder();
      await h.db.pool.query('UPDATE orders SET status = $2 WHERE id = $1', [order.id, status]);
      expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'duplicate_payment' });
      await setEvent(order.eventId, CANCELLED);
      expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'event_cancelled' });
      expect(await orderState(h, order.code)).toMatchObject({ status, tickets: 0 });
      expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    }
  });
});

describe('markPaid nguồn ipn: tiền về muộn cho Đơn expired', () => {
  it('chưa kết thúc, không khóa, đủ chỗ mọi Hạng vé → bán có điều kiện, CAS expired → paid, N Vé, audit, phễu', async () => {
    const order = await expiredOrder();
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    const paidAt = new Date(Date.now() - 20 * 60_000);
    expect(await ipnPaid(order.id, order.total, paidAt)).toEqual({ outcome: 'paid' });
    const state = await orderState(h, order.code);
    expect(state).toMatchObject({ status: 'paid', paid_source: 'ipn', paid_amount: '450000', tickets: 3 });
    expect(await buyerEmails(order.id)).toEqual([{ kind: 'tickets', orderId: order.id }]);
    expect(state.paid_at!.toISOString()).toBe(paidAt.toISOString());
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 1, held: 0 });
    expect(await auditCount(order.id)).toBe(1);
    const funnel = await h.db.pool.query<{ type: string }>(
      'SELECT type FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [order.funnelId],
    );
    expect(funnel.rows.map((r) => r.type)).toEqual(['order_created', 'paid']);
    await expectInvariants(h, order.eventId);
  });

  it('Hạng vé đứng sau (ticket_type_id lớn hơn) hết chỗ → orphan sold_out: rollback savepoint, không Hạng vé nào đổi sold; Đơn review', async () => {
    const order = await expiredOrder();
    const capacity = { [order.a]: 5, [order.b]: 3 };
    const [first, last] = [order.a, order.b].sort() as [string, string];
    // Người mua khác giữ hết chỗ của Hạng vé đứng sau.
    const other = await signUp(h);
    await postOrder(h, other, order.slug, orderBody([{ ticketTypeId: last, quantity: capacity[last]! }])).expect(201);
    const before = { first: await inventory(h, first), last: await inventory(h, last) };
    expect(before.first).toMatchObject({ sold: 0, held: 0 });
    expect(before.last).toMatchObject({ sold: 0, held: capacity[last] });

    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'orphan', reason: 'sold_out' });
    expect(await orderState(h, order.code)).toMatchObject({ status: 'review', paid_at: null, tickets: 0 });
    expect(await inventory(h, first)).toEqual(before.first);
    expect(await inventory(h, last)).toEqual(before.last);
    expect(await auditCount(order.id)).toBe(0);
    // Story 3.8: email báo Người mua (BTC sẽ liên hệ hoàn tiền), không email Vé.
    expect(await buyerEmails(order.id)).toEqual([{ kind: 'orphan_sold_out', orderId: order.id }]);
    await expectInvariants(h, order.eventId);
  });

  it('đã kết thúc → orphan event_ended; Sự kiện bị khóa → orphan event_locked; Đơn review, tồn kho không đổi', async () => {
    for (const [set, reason] of [
      [ENDED, 'event_ended'],
      [LOCKED, 'event_locked'],
      [`${ENDED}, ${LOCKED}`, 'event_ended'],
    ] as const) {
      const order = await expiredOrder();
      await setEvent(order.eventId, set);
      expect(await ipnPaid(order.id, order.total), reason).toEqual({ outcome: 'orphan', reason });
      expect(await orderState(h, order.code)).toMatchObject({ status: 'review', tickets: 0 });
      expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
      expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 0, held: 0 });
      await expectInvariants(h, order.eventId);
    }
  });

  it('lệch tiền → mismatch (đứng trước tiền về muộn); Sự kiện hủy → event_cancelled; Đơn review', async () => {
    const mismatch = await expiredOrder();
    expect(await ipnPaid(mismatch.id, mismatch.total - 1)).toEqual({ outcome: 'mismatch' });
    expect(await orderState(h, mismatch.code)).toMatchObject({ status: 'review', tickets: 0 });
    await expectInvariants(h, mismatch.eventId);

    const cancelled = await expiredOrder();
    await setEvent(cancelled.eventId, CANCELLED);
    expect(await ipnPaid(cancelled.id, cancelled.total)).toEqual({ outcome: 'event_cancelled' });
    expect(await orderState(h, cancelled.code)).toMatchObject({ status: 'review', tickets: 0 });
    expect(await inventory(h, cancelled.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, cancelled.eventId);
  });
});

describe('markPaid nguồn ipn: lỗi giữa chừng', () => {
  it('phát Vé lỗi → rollback cả transaction: Đơn vẫn pending, tồn kho không đổi', async () => {
    const order = await pendingOrder();
    // Chiếm trước seq 1 của Đơn: INSERT Vé của markPaid vi phạm `tickets_order_id_seq_key`.
    await h.db.pool.query(
      `INSERT INTO tickets (order_id, event_id, organization_id, user_id, ticket_type_id, seq, order_ticket_count,
         holder_name, ticket_type_name, order_code, issued_at, qr_key_version)
       SELECT o.id, o.event_id, o.organization_id, o.user_id, $2, 1, 3, 'X', 'Hạng A', o.code, now(), 1
         FROM orders o WHERE o.id = $1`,
      [order.id, order.a],
    );
    await expect(ipnPaid(order.id, order.total)).rejects.toThrow();
    expect((await orderState(h, order.code)).status).toBe('pending');
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await h.db.pool.query('DELETE FROM tickets WHERE order_id = $1', [order.id]).catch(() => undefined);
  });

  it('lỗi sau khi Đơn đã chuyển review (bên gọi ném) → rollback: Đơn vẫn pending, held không đổi', async () => {
    const order = await pendingOrder();
    await expect(
      db.transaction(async (tx) => {
        expect(await payments.markPaid(tx, order.id, 'ipn', order.total + 1)).toEqual({ outcome: 'mismatch' });
        throw new Error('lỗi của bên gọi');
      }),
    ).rejects.toThrow('lỗi của bên gọi');
    expect(await orderState(h, order.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 2 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 0, held: 1 });
    await expectInvariants(h, order.eventId);
  });

  it('không có Đơn → lỗi', async () => {
    await expect(ipnPaid(randomUUID(), 1_000)).rejects.toThrow(/không có Đơn/);
  });
});

describe('markExpired', () => {
  it('pending → expired, held -= n mọi Hạng vé (không xét hạn); gọi lại → skipped; Đơn paid → skipped', async () => {
    const order = await pendingOrder();
    expect(await db.transaction((tx) => markExpired(tx, order.id))).toBe('expired');
    expect((await orderState(h, order.code)).status).toBe('expired');
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 0, held: 0 });
    expect(await db.transaction((tx) => markExpired(tx, order.id))).toBe('skipped');
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, order.eventId);

    const paid = await pendingOrder();
    expect(await ipnPaid(paid.id, paid.total)).toEqual({ outcome: 'paid' });
    expect(await db.transaction((tx) => markExpired(tx, paid.id))).toBe('skipped');
    expect(await orderState(h, paid.code)).toMatchObject({ status: 'paid', tickets: 3 });
    await expectInvariants(h, paid.eventId);

    expect(await db.transaction((tx) => markExpired(tx, randomUUID()))).toBe('skipped');
  });

  it('markPaid và markExpired song song cho cùng Đơn → Đơn luôn paid (hết hạn trước thì tiền về muộn bán lại); bất biến giữ', async () => {
    for (let i = 0; i < 3; i++) {
      const order = await pendingOrder();
      const [paid, expired] = await Promise.all([
        ipnPaid(order.id, order.total),
        db.transaction((tx) => markExpired(tx, order.id)),
      ]);
      expect(paid).toEqual({ outcome: 'paid' });
      expect(['expired', 'skipped']).toContain(expired);
      expect(await orderState(h, order.code)).toMatchObject({ status: 'paid', tickets: 3 });
      expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
      await expectInvariants(h, order.eventId);
    }
  });

  it('orderForPayment: Đơn theo mã (id, BTC, trạng thái, tổng tiền, tài khoản nhận tiền của link); mã không có → null', async () => {
    const order = await pendingOrder();
    // Tingee từ chối tạo link: chưa chụp tài khoản nhận tiền.
    expect(await orderForPayment(db.orm, order.code)).toEqual({
      id: order.id,
      organizationId: org.orgId,
      status: 'pending',
      totalAmount: 450_000,
      payoutAccountId: null,
    });
    const { rows } = await h.db.pool.query<{ id: string }>(
      'SELECT id FROM payout_accounts WHERE organization_id = $1 AND is_default',
      [org.orgId],
    );
    await h.db.pool.query("UPDATE orders SET payment_link = 'https://pay.example/x', payout_account_id = $2 WHERE id = $1", [
      order.id,
      rows[0]!.id,
    ]);
    expect(await orderForPayment(db.orm, order.code)).toMatchObject({ payoutAccountId: rows[0]!.id });
    expect(await orderForPayment(db.orm, 'TK00000000')).toBeNull();
  });
});
