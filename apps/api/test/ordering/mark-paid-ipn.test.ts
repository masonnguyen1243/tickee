import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markExpired, OrderPayments, orderForPayment } from '../../src/modules/ordering/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
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
 * Story 3.5: `ordering.markPaid` nguồn `ipn` và `ordering.markExpired`, gọi thẳng trong transaction (không qua HTTP IPN)
 * trên Postgres thật. Đơn nhiều Hạng vé `pending` (Tingee từ chối tạo link: Đơn vẫn chờ, đang giữ chỗ). Thứ tự kiểm:
 * Sự kiện hủy → lệch tiền → đã kết thúc; qua cả ba thì CAS, `held -= n, sold += n` theo từng Hạng vé, N Vé.
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

/** Đơn `pending` 2 Vé Hạng A (100.000đ) + 1 Vé Hạng B (250.000đ) = 450.000đ, ở Sự kiện mới. */
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
  expect(order.status).toBe('pending');
  const { id } = await orderState(h, order.code);
  return { id, code: order.code, eventId: sale.event.id, a: a.id, b: b.id, total: 450_000, funnelId };
}

const ipnPaid = (orderId: string, amount: number, paidAt: Date | null = null) =>
  db.transaction((tx) => payments.markPaid(tx, orderId, 'ipn', amount, { paidAt }));

describe('markPaid nguồn ipn', () => {
  it('khớp tiền → paid: paid_at = paidAt, held → sold từng Hạng vé, N Vé seq 1..N (issued_at = đồng hồ DB), audit, phễu; gọi lại → lost_race', async () => {
    const order = await pendingOrder();
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 2 });
    const paidAt = new Date(Date.now() - 5 * 60_000);
    expect(await ipnPaid(order.id, order.total, paidAt)).toBe('paid');

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
    const audits = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
      order.id,
    ]);
    expect(audits.rows).toHaveLength(1);
    const funnel = await h.db.pool.query<{ type: string }>(
      'SELECT type FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [order.funnelId],
    );
    expect(funnel.rows.map((r) => r.type)).toEqual(['order_created', 'paid']);
    await expectInvariants(h, order.eventId);

    expect(await ipnPaid(order.id, order.total, paidAt)).toBe('lost_race');
    expect((await orderState(h, order.code)).tickets).toBe(3);
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
  });

  it('không có paidAt → paid_at = đồng hồ DB (= issued_at của Vé)', async () => {
    const order = await pendingOrder();
    expect(await ipnPaid(order.id, order.total)).toBe('paid');
    const state = await orderState(h, order.code);
    const { rows } = await h.db.pool.query<{ issued_at: Date }>('SELECT DISTINCT issued_at FROM tickets WHERE order_id = $1', [
      order.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(state.paid_at!.getTime()).toBe(rows[0]!.issued_at.getTime());
    await expectInvariants(h, order.eventId);
  });

  it('Đơn đã paid (IPN khác mã vừa thắng) → lost_race trước kiểm lệch tiền / hủy / kết thúc; không đổi gì', async () => {
    const order = await pendingOrder();
    expect(await ipnPaid(order.id, order.total)).toBe('paid');
    const before = await orderState(h, order.code);
    expect(await ipnPaid(order.id, order.total + 1_000)).toBe('lost_race');
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [order.eventId]);
    expect(await ipnPaid(order.id, order.total + 1_000)).toBe('lost_race');
    expect(await orderState(h, order.code)).toEqual(before);
    expect(before).toMatchObject({ status: 'paid', paid_amount: '450000', tickets: 3 });
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 1, held: 0 });
    const audits = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
      order.id,
    ]);
    expect(audits.rows).toHaveLength(1);
    await expectInvariants(h, order.eventId);
  });

  it('lệch tiền (thiếu, thừa, 0) → mismatch; không đổi gì', async () => {
    const order = await pendingOrder();
    for (const amount of [order.total - 1, order.total + 1, 0]) expect(await ipnPaid(order.id, amount)).toBe('mismatch');
    expect(await orderState(h, order.code)).toMatchObject({ status: 'pending', paid_at: null, tickets: 0 });
    expect(await inventory(h, order.a)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInvariants(h, order.eventId);
  });

  it('thứ tự kiểm: Sự kiện hủy thắng lệch tiền và đã kết thúc; lệch tiền thắng đã kết thúc; rồi orphan', async () => {
    const order = await pendingOrder();
    await h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 minute' WHERE id = $1", [order.eventId]);
    expect(await ipnPaid(order.id, order.total + 5)).toBe('mismatch');
    expect(await ipnPaid(order.id, order.total)).toBe('orphan');
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [order.eventId]);
    expect(await ipnPaid(order.id, order.total + 5)).toBe('event_cancelled');
    expect(await ipnPaid(order.id, order.total)).toBe('event_cancelled');
    expect(await orderState(h, order.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, order.b)).toEqual({ capacity: 3, sold: 0, held: 1 });
    await expectInvariants(h, order.eventId);
  });

  it('Sự kiện bị khóa (chưa kết thúc) vẫn phát Vé; Đơn đã hết hạn → lost_race', async () => {
    const locked = await pendingOrder();
    await h.db.pool.query("UPDATE events SET locked_at = now(), lock_reason = 'test' WHERE id = $1", [locked.eventId]);
    expect(await ipnPaid(locked.id, locked.total)).toBe('paid');
    await expectInvariants(h, locked.eventId);

    const expired = await pendingOrder();
    expect(await db.transaction((tx) => markExpired(tx, expired.id))).toBe('expired');
    expect(await ipnPaid(expired.id, expired.total)).toBe('lost_race');
    expect(await orderState(h, expired.code)).toMatchObject({ status: 'expired', tickets: 0 });
    await expectInvariants(h, expired.eventId);
  });

  it('lỗi giữa chừng (phát Vé lỗi) → rollback cả transaction: Đơn vẫn pending, tồn kho không đổi', async () => {
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
    expect(await ipnPaid(paid.id, paid.total)).toBe('paid');
    expect(await db.transaction((tx) => markExpired(tx, paid.id))).toBe('skipped');
    expect(await orderState(h, paid.code)).toMatchObject({ status: 'paid', tickets: 3 });
    await expectInvariants(h, paid.eventId);

    expect(await db.transaction((tx) => markExpired(tx, randomUUID()))).toBe('skipped');
  });

  it('markPaid và markExpired song song cho cùng Đơn → đúng một bên thắng; bất biến giữ', async () => {
    for (let i = 0; i < 3; i++) {
      const order = await pendingOrder();
      const [paid, expired] = await Promise.all([
        ipnPaid(order.id, order.total),
        db.transaction((tx) => markExpired(tx, order.id)),
      ]);
      expect([paid === 'paid', expired === 'expired'].filter(Boolean)).toHaveLength(1);
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
