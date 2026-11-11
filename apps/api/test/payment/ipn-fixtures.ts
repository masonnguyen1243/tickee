import { TINGEE_IPN_PATH } from '@tickee/contracts';
import { expect } from 'vitest';
import type { Harness } from '../identity/harness.js';
import type { SignedIpn } from '../tingee-fake/server.js';

/*
 * Dùng chung cho test IPN (Story 3.5, 3.6): gửi IPN đã ký tới api đúng byte đã ký, đọc lại `payment_events` và
 * `review_items`, và kiểm bất biến tồn kho – Vé sau mỗi nhánh.
 */

export const ipnPath = (ipnKey: string) => `${TINGEE_IPN_PATH}/${ipnKey}`;

/** Gửi IPN như Tingee: header đã ký và nguyên chuỗi body đã ký (không serialize lại). */
export function postIpn(h: Harness, ipnKey: string, ipn: SignedIpn, path = ipnPath(ipnKey)) {
  return h.http.post(path).set(ipn.headers).send(ipn.body);
}

/** Body thành công đúng như Tingee chờ (so trên chuỗi, không chỉ trên object). */
export const ACK_TEXT = '{"code":"00","message":"Success"}';

export interface PaymentEventRow {
  id: string;
  organization_id: string;
  order_id: string | null;
  kind: string;
  status: string;
  provider_order_id: string;
  provider_transaction_code: string | null;
  amount: string | null;
  paid_amount: string | null;
  paid_at: Date | null;
  status_code: string | null;
  payment_method: string | null;
  bill_id: string | null;
  merchant_id: string | null;
  request_id: string | null;
  received_at: Date;
}

/** `payment_events` của BTC theo thứ tự nhận; lọc theo `provider_order_id` nếu có. */
export async function paymentEventsOf(h: Harness, organizationId: string, providerOrderId?: string): Promise<PaymentEventRow[]> {
  const { rows } = await h.db.pool.query<PaymentEventRow>(
    `SELECT * FROM payment_events
      WHERE organization_id = $1 AND ($2::text IS NULL OR provider_order_id = $2)
      ORDER BY received_at, id`,
    [organizationId, providerOrderId ?? null],
  );
  return rows;
}

export interface ReviewItemRow {
  id: string;
  organization_id: string;
  order_id: string | null;
  payment_event_id: string;
  type: string;
  reason: string | null;
  status: string;
  resolution: string | null;
  created_at: Date;
}

/** `review_items` theo thứ tự tạo, lọc theo Đơn (`orderId`) hoặc theo khoản tiền (`paymentEventId`). */
export async function reviewItemsOf(
  h: Harness,
  filter: { orderId?: string; paymentEventId?: string; organizationId?: string },
): Promise<ReviewItemRow[]> {
  const { rows } = await h.db.pool.query<ReviewItemRow>(
    `SELECT * FROM review_items
      WHERE ($1::uuid IS NULL OR order_id = $1)
        AND ($2::uuid IS NULL OR payment_event_id = $2)
        AND ($3::uuid IS NULL OR organization_id = $3)
      ORDER BY created_at, id`,
    [filter.orderId ?? null, filter.paymentEventId ?? null, filter.organizationId ?? null],
  );
  return rows;
}

export interface OrderState {
  id: string;
  status: string;
  paid_at: Date | null;
  paid_amount: string | null;
  paid_source: string | null;
  tickets: number;
}

export async function orderState(h: Harness, code: string): Promise<OrderState> {
  const { rows } = await h.db.pool.query<OrderState>(
    `SELECT o.id, o.status, o.paid_at, o.paid_amount, o.paid_source,
            (SELECT count(*)::int FROM tickets t WHERE t.order_id = o.id) AS tickets
       FROM orders o WHERE o.code = $1`,
    [code],
  );
  return rows[0]!;
}

/**
 * AC: `sold + held ≤ capacity`; `held` mỗi Hạng vé = tổng Vé của các Đơn `pending`; `sold` = tổng Vé đã phát; mỗi Đơn
 * có 0 Vé hoặc đủ N Vé (Đơn `paid` đủ N, Đơn khác 0).
 */
export async function expectInvariants(h: Harness, eventId: string): Promise<void> {
  const inventory = await h.db.pool.query<{ capacity: number; sold: number; held: number; pending: number; issued: number }>(
    `SELECT i.capacity, i.sold, i.held,
            COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.ticket_type_id = i.ticket_type_id AND o.status = 'pending'), 0)::int AS pending,
            (SELECT count(*)::int FROM tickets t WHERE t.ticket_type_id = i.ticket_type_id) AS issued
       FROM ticket_type_inventory i WHERE i.event_id = $1`,
    [eventId],
  );
  expect(inventory.rows.length).toBeGreaterThan(0);
  for (const row of inventory.rows) {
    expect(row.sold + row.held).toBeLessThanOrEqual(row.capacity);
    expect(row.held).toBe(row.pending);
    expect(row.sold).toBe(row.issued);
  }
  const orders = await h.db.pool.query<{ code: string; status: string; quantity: number; tickets: number; seqs: number[] }>(
    `SELECT o.code, o.status,
            (SELECT SUM(quantity)::int FROM order_items WHERE order_id = o.id) AS quantity,
            (SELECT count(*)::int FROM tickets WHERE order_id = o.id) AS tickets,
            COALESCE((SELECT array_agg(seq ORDER BY seq) FROM tickets WHERE order_id = o.id), '{}') AS seqs
       FROM orders o WHERE o.event_id = $1`,
    [eventId],
  );
  for (const order of orders.rows) {
    const expected = order.status === 'paid' ? order.quantity : 0;
    expect(order.tickets, `${order.code} (${order.status})`).toBe(expected);
    expect(order.seqs).toEqual(Array.from({ length: expected }, (_, i) => i + 1));
  }
}
