import { randomUUID } from 'node:crypto';
import { ErrorResponse } from '@tickee/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderPayments } from '../../src/modules/ordering/index.js';
import { randomOrderCode } from '../../src/modules/ordering/order-code.js';
import { TicketQrKeys, verifyTicketQr } from '../../src/modules/ticketing/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { TEST_TICKET_QR_KEYS } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  orderBody,
  ordersOfEvent,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.3: Đơn 0đ dưới đua, trên Postgres thật. Không bao giờ bán quá số suất; trần Vé miễn phí của một Người mua
 * đứng vững khi hai Đơn khác khóa chạy song song (TX1 thứ hai chờ ở unique Đơn chờ hoặc dòng tồn kho, rồi thấy Vé đã
 * phát); `markPaid` gọi hai lần chỉ phát Vé một lần. Để chắc các TX1 chồng nhau, test giữ khóa dòng `events` bằng một
 * kết nối riêng cho tới khi đủ request đang chờ rồi mới nhả.
 */

let h: Harness;
let org: Org;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

async function buyers(n: number): Promise<User[]> {
  const list: User[] = [];
  for (let i = 0; i < n; i++) list.push(await signUp(h));
  return list;
}

async function waitingOnLocks(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'tickee-api' AND wait_event_type = 'Lock'",
  );
  return rows[0]!.n;
}

/** Giữ khóa `FOR UPDATE` dòng `events` (như BTC đang sửa Sự kiện) cho tới khi `release`. */
async function holdEventLock(eventId: string) {
  const client: pg.PoolClient = await h.db.pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  let released = false;
  return {
    async release(commit = true) {
      if (released) return;
      released = true;
      try {
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      } finally {
        client.release();
      }
    },
  };
}

/** Chạy các request trong lúc giữ khóa Sự kiện, nhả khi cả `n` đang chờ khóa; trả kết quả theo thứ tự gửi. */
async function raced<T>(eventId: string, n: number, send: () => Promise<T>[]): Promise<T[]> {
  const lock = await holdEventLock(eventId);
  try {
    const pending = Promise.all(send());
    await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBe(n);
    await lock.release();
    return await pending;
  } catch (err) {
    await lock.release(false);
    throw err;
  }
}

async function ticketsOfEvent(eventId: string) {
  const { rows } = await h.db.pool.query<{ order_id: string; seq: number; order_ticket_count: number }>(
    'SELECT order_id, seq, order_ticket_count FROM tickets WHERE event_id = $1 ORDER BY order_id, seq',
    [eventId],
  );
  return rows;
}

describe('trần Vé miễn phí khi một Người mua gửi song song', () => {
  it.each([
    ['cùng Hạng vé (chờ ở dòng tồn kho)', true],
    ['hai Hạng vé khác nhau (chờ ở unique Đơn chờ)', false],
  ])('giới hạn 10, hai Đơn khác khóa mỗi Đơn 6 Vé, %s → đúng một Đơn paid, bên kia 409 FREE_TICKET_LIMIT_REACHED', async (_label, sameTier) => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [
      { name: 'Vé A', price: 0, capacity: 50 },
      { name: 'Vé B', price: 0, capacity: 50 },
    ]);
    const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const results = await raced(sale.event.id, 2, () => [
      postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: a.id, quantity: 6 }]), randomUUID()),
      postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: (sameTier ? a : b).id, quantity: 6 }]), randomUUID()),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = parseOrder(results.find((r) => r.status === 201)!.body);
    expect(winner.status).toBe('paid');
    expect(winner.tickets).toHaveLength(6);
    // DI thật (không thay `TicketsService`): QR ký bằng đúng `TICKET_QR_KEYS` của cấu hình.
    const qrKeys = TicketQrKeys.parse(TEST_TICKET_QR_KEYS);
    for (const t of winner.tickets) expect(verifyTicketQr(qrKeys, t.qr)).toEqual({ ticketId: t.id, keyVersion: 1 });
    expect(errorOf(results.find((r) => r.status === 409)!.body).code).toBe('FREE_TICKET_LIMIT_REACHED');

    const orders = await ordersOfEvent(h, sale.event.id);
    expect(orders.map((o) => o.status)).toEqual(['paid']);
    expect((await ticketsOfEvent(sale.event.id)).length).toBe(6);
    const sold = (await inventory(h, a.id))!.sold + (await inventory(h, b.id))!.sold;
    expect(sold).toBe(6);
  });

  it('giới hạn 10, hai Đơn khác khóa mỗi Đơn 5 Vé → cả hai paid (đúng bằng trần)', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 50 }]);
    const tier = sale.tiers[0]!;
    const results = await raced(sale.event.id, 2, () => [
      postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity: 5 }])),
      postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity: 5 }])),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await inventory(h, tier.id)).toMatchObject({ sold: 10, held: 0 });
  });
});

describe('không bao giờ bán quá số suất', () => {
  it('30 request 0đ song song cho 10 chỗ từ 30 Người mua → đúng 10 Đơn paid, số Vé = sold ≤ capacity, seq riêng', async () => {
    const list = await buyers(30);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 10 }]);
    const tier = sale.tiers[0]!;
    const body = orderBody([{ ticketTypeId: tier.id, quantity: 1 }]);
    const results = await Promise.all(list.map((buyer) => postOrder(h, buyer, sale.event.slug, body)));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(20);
    for (const r of results.filter((x) => x.status === 409)) expect(errorOf(r.body).code).toBe('TICKET_TYPE_SOLD_OUT');
    for (const r of results.filter((x) => x.status === 201)) expect(parseOrder(r.body).status).toBe('paid');

    const stock = (await inventory(h, tier.id))!;
    expect(stock).toEqual({ capacity: 10, sold: 10, held: 0 });
    const orders = await ordersOfEvent(h, sale.event.id);
    expect(orders).toHaveLength(10);
    expect(orders.every((o) => o.status === 'paid')).toBe(true);
    const tickets = await ticketsOfEvent(sale.event.id);
    expect(tickets).toHaveLength(stock.sold);
    expect(tickets.every((t) => t.seq === 1 && t.order_ticket_count === 1)).toBe(true);
    expect(new Set(tickets.map((t) => t.order_id)).size).toBe(10);
  });

  it('Đơn nhiều Vé song song: mỗi Đơn seq 1..N riêng, tổng Vé = sold ≤ capacity', async () => {
    const list = await buyers(6);
    const sale = await eventOnSale(org, [
      { name: 'Vé A', price: 0, capacity: 7 },
      { name: 'Vé B', price: 0, capacity: 7 },
    ]);
    const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const results = await Promise.all(
      list.map((buyer) =>
        postOrder(
          h,
          buyer,
          sale.event.slug,
          orderBody([
            { ticketTypeId: b.id, quantity: 2 },
            { ticketTypeId: a.id, quantity: 1 },
          ]),
        ),
      ),
    );
    const winners = results.filter((r) => r.status === 201).map((r) => parseOrder(r.body));
    // B có 7 chỗ, mỗi Đơn lấy 2 → tối đa 3 Đơn.
    expect(winners).toHaveLength(3);
    const stockA = (await inventory(h, a.id))!;
    const stockB = (await inventory(h, b.id))!;
    expect(stockA).toMatchObject({ sold: 3, held: 0 });
    expect(stockB).toMatchObject({ sold: 6, held: 0 });
    const tickets = await ticketsOfEvent(sale.event.id);
    expect(tickets).toHaveLength(stockA.sold + stockB.sold);
    const byOrder = new Map<string, number[]>();
    for (const t of tickets) byOrder.set(t.order_id, [...(byOrder.get(t.order_id) ?? []), t.seq]);
    for (const seqs of byOrder.values()) expect(seqs).toEqual([1, 2, 3]);
  });
});

describe('markPaid đúng một lần', () => {
  /** Đơn 0đ `pending` chèn thẳng vào DB (như TX1 dừng ngay trước `markPaid`). */
  async function pendingFreeOrder(buyer: User, eventId: string, ticketTypeId: string, quantity: number) {
    const code = randomOrderCode();
    const { rows } = await h.db.pool.query<{ id: string }>(
      `INSERT INTO orders (code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
         buyer_email, idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', 0, 'Nguyễn Văn An', '+84912345678', $5, $6, now()) RETURNING id`,
      [code, buyer.userId, eventId, org.orgId, buyer.email, randomUUID()],
    );
    const orderId = rows[0]!.id;
    await h.db.pool.query(
      `INSERT INTO order_items (order_id, ticket_type_id, ticket_type_name, unit_price, quantity)
       VALUES ($1, $2, 'Vé', 0, $3)`,
      [orderId, ticketTypeId, quantity],
    );
    return { orderId, code };
  }

  it('gọi hai lần nối tiếp → paid rồi lost_race, không thêm Vé', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const { orderId } = await pendingFreeOrder(buyer, sale.event.id, sale.tiers[0]!.id, 2);
    const db = h.app.get<Database>(DATABASE);
    const payments = h.app.get(OrderPayments);
    expect(await db.transaction((tx) => payments.markPaid(tx, orderId, 'free', 0))).toBe('paid');
    expect(await db.transaction((tx) => payments.markPaid(tx, orderId, 'free', 0))).toBe('lost_race');
    expect((await ticketsOfEvent(sale.event.id)).map((t) => t.seq)).toEqual([1, 2]);
  });

  it('gọi hai lần song song → đúng một paid, một lost_race, Vé chỉ phát một lần', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const { orderId } = await pendingFreeOrder(buyer, sale.event.id, sale.tiers[0]!.id, 3);
    const db = h.app.get<Database>(DATABASE);
    const payments = h.app.get(OrderPayments);
    const results = await Promise.all([
      db.transaction((tx) => payments.markPaid(tx, orderId, 'free', 0)),
      db.transaction((tx) => payments.markPaid(tx, orderId, 'free', 0)),
    ]);
    expect([...results].sort()).toEqual(['lost_race', 'paid']);
    expect((await ticketsOfEvent(sale.event.id)).map((t) => t.seq)).toEqual([1, 2, 3]);
    const audits = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
      orderId,
    ]);
    expect(audits.rows).toHaveLength(1);
  });

  it('Đơn không còn pending (đã hết hạn) → lost_race, không Vé; nguồn chưa làm (Đối soát bù, duyệt tay) → lỗi', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const { orderId } = await pendingFreeOrder(buyer, sale.event.id, sale.tiers[0]!.id, 1);
    await h.db.pool.query("UPDATE orders SET status = 'expired' WHERE id = $1", [orderId]);
    const db = h.app.get<Database>(DATABASE);
    const payments = h.app.get(OrderPayments);
    expect(await db.transaction((tx) => payments.markPaid(tx, orderId, 'free', 0))).toBe('lost_race');
    expect(await ticketsOfEvent(sale.event.id)).toEqual([]);
    for (const source of ['reconciliation', 'manual'] as const) {
      await expect(db.transaction((tx) => payments.markPaid(tx, orderId, source, 0))).rejects.toThrow(/chưa hỗ trợ/);
    }
  });
});
