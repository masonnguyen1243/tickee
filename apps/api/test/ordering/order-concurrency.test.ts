import { ErrorResponse } from '@tickee/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  eventsPath,
  inventory,
  orderBody,
  ordersOfEvent,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.2: không bao giờ bán quá số suất, trên Postgres thật. Đua thật bằng request song song; để chắc hai TX1 chạy
 * chồng lên nhau, test giữ khóa dòng `events` bằng một kết nối riêng (như BTC đang sửa Sự kiện) cho tới khi đủ request
 * đang chờ khóa rồi mới nhả.
 */

let h: Harness;
let org: Org;

beforeAll(async () => {
  h = await createHarness();
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

/** Số kết nối của api đang chờ khóa (row lock của `events`/tồn kho, unique index…). */
async function waitingOnLocks(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'tickee-api' AND wait_event_type = 'Lock'",
  );
  return rows[0]!.n;
}

/** Giữ khóa dòng `events` (`mode`) trong một transaction của kết nối riêng; `release` commit (hoặc rollback). */
async function holdEventLock(eventId: string, mode: 'UPDATE' | 'SHARE') {
  const client: pg.PoolClient = await h.db.pool.connect();
  await client.query('BEGIN');
  await client.query(`SELECT id FROM events WHERE id = $1 FOR ${mode}`, [eventId]);
  let released = false;
  return {
    client,
    /** Gọi lại sau khi đã nhả thì không làm gì. */
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

describe('đua chỗ', () => {
  it('chỗ cuối: hai Người mua cùng đặt → đúng một Đơn; người kia 409 TICKET_TYPE_SOLD_OUT {ticketTypeId, ticketTypeName}', async () => {
    const [first, second] = (await buyers(2)) as [User, User];
    const sale = await eventOnSale(org, [{ name: 'Đôi nam', price: 500_000, capacity: 1 }]);
    const tier = sale.tiers[0]!;
    const body = orderBody([{ ticketTypeId: tier.id, quantity: 1 }]);

    const lock = await holdEventLock(sale.event.id, 'UPDATE');
    let results: Awaited<ReturnType<typeof postOrder>>[];
    try {
      const pending = Promise.all([postOrder(h, first, sale.event.slug, body), postOrder(h, second, sale.event.slug, body)]);
      await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBe(2);
      await lock.release();
      results = await pending;
    } catch (err) {
      await lock.release(false);
      throw err;
    }

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(errorOf(loser.body)).toMatchObject({
      code: 'TICKET_TYPE_SOLD_OUT',
      details: { ticketTypeId: tier.id, ticketTypeName: 'Đôi nam' },
    });
    expect(await ordersOfEvent(h, sale.event.id)).toHaveLength(1);
    expect(await inventory(h, tier.id)).toEqual({ capacity: 1, sold: 0, held: 1 });
  });

  it('Đơn nhiều Hạng vé thiếu chỗ ở một hạng (đua với Người mua khác) → không giữ chỗ hạng nào', async () => {
    const [first, second] = (await buyers(2)) as [User, User];
    const sale = await eventOnSale(org, [
      { name: 'Đơn nam', price: 300_000, capacity: 10 },
      { name: 'Đôi nam', price: 500_000, capacity: 2 },
    ]);
    const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];

    const lock = await holdEventLock(sale.event.id, 'UPDATE');
    let results: Awaited<ReturnType<typeof postOrder>>[];
    try {
      const pending = Promise.all([
        postOrder(h, first, sale.event.slug, orderBody([{ ticketTypeId: b.id, quantity: 2 }])),
        postOrder(
          h,
          second,
          sale.event.slug,
          orderBody([
            { ticketTypeId: a.id, quantity: 3 },
            { ticketTypeId: b.id, quantity: 1 },
          ]),
        ),
      ]);
      await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBe(2);
      await lock.release();
      results = await pending;
    } catch (err) {
      await lock.release(false);
      throw err;
    }

    const statuses = results.map((r) => r.status);
    // Thứ tự thắng tùy lịch của Postgres: hoặc Đơn hai hạng thắng (B còn 1 cho người kia → cũng thiếu), hoặc Đơn chỉ B thắng.
    const orders = await ordersOfEvent(h, sale.event.id);
    expect(orders).toHaveLength(1);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const winnerIsMulti = results[1]!.status === 201;
    expect(await inventory(h, a.id)).toMatchObject({ held: winnerIsMulti ? 3 : 0 });
    expect(await inventory(h, b.id)).toMatchObject({ held: winnerIsMulti ? 1 : 2 });
    const loser = results.find((r) => r.status === 409)!;
    expect(errorOf(loser.body)).toMatchObject({ code: 'TICKET_TYPE_SOLD_OUT', details: { ticketTypeId: b.id } });
  });

  it('30 request song song cho 10 chỗ → đúng 10 Đơn, 20 người 409; sold + held ≤ capacity', async () => {
    const list = await buyers(30);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 100_000, capacity: 10 }]);
    const tier = sale.tiers[0]!;
    const body = orderBody([{ ticketTypeId: tier.id, quantity: 1 }]);
    const results = await Promise.all(list.map((buyer) => postOrder(h, buyer, sale.event.slug, body)));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(20);
    for (const r of results.filter((x) => x.status === 409)) expect(errorOf(r.body).code).toBe('TICKET_TYPE_SOLD_OUT');
    const stock = (await inventory(h, tier.id))!;
    expect(stock.sold + stock.held).toBeLessThanOrEqual(stock.capacity);
    expect(stock).toEqual({ capacity: 10, sold: 0, held: 10 });
    expect(await ordersOfEvent(h, sale.event.id)).toHaveLength(10);
  });
});

describe('TX1 kiểm lại trên dữ liệu đã khóa', () => {
  it('tiền kiểm qua, nhưng BTC hạ giới hạn Vé/Đơn xuống 1 (commit sau khi TX1 chờ khóa) → 400 tại items, không giữ chỗ', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const tier = sale.tiers[0]!;
    const lock = await holdEventLock(sale.event.id, 'UPDATE');
    try {
      await lock.client.query('UPDATE events SET max_tickets_per_order = 1 WHERE id = $1', [sale.event.id]);
      const pending = postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity: 2 }])).then(
        (res) => res,
      );
      await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBe(1);
      await lock.release();
      const res = await pending;
      expect(res.status).toBe(400);
      const error = errorOf(res.body);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect((error.details as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual(['items']);
    } finally {
      await lock.release(false);
    }
    expect(await inventory(h, tier.id)).toMatchObject({ held: 0 });
    expect(await ordersOfEvent(h, sale.event.id)).toEqual([]);
  });

  it('một Người mua gửi song song hai Đơn có phí khác khóa cho cùng Sự kiện → một 201, một 409 PENDING_ORDER_EXISTS mã Đơn thắng', async () => {
    const buyer = await signUp(h);
    // Đơn có phí (Đơn 0đ thành `paid` ngay trong TX1, không còn là Đơn chờ: free-order-concurrency.test.ts).
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 100_000, capacity: 5 }]);
    const tier = sale.tiers[0]!;
    const body = orderBody([{ ticketTypeId: tier.id, quantity: 2 }]);

    const lock = await holdEventLock(sale.event.id, 'UPDATE');
    let results: Awaited<ReturnType<typeof postOrder>>[];
    try {
      const pending = Promise.all([postOrder(h, buyer, sale.event.slug, body), postOrder(h, buyer, sale.event.slug, body)]);
      await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBe(2);
      await lock.release();
      results = await pending;
    } catch (err) {
      await lock.release(false);
      throw err;
    }

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = parseOrder(results.find((r) => r.status === 201)!.body);
    const loser = results.find((r) => r.status === 409)!;
    expect(errorOf(loser.body)).toMatchObject({ code: 'PENDING_ORDER_EXISTS', details: { code: winner.code } });
    expect(await ordersOfEvent(h, sale.event.id)).toHaveLength(1);
    expect(await inventory(h, tier.id)).toMatchObject({ held: 2 });
  });
});

describe('TX1 và lệnh ghi của BTC', () => {
  it('BTC đang Ẩn Sự kiện (FOR UPDATE, chưa commit) → TX1 chờ rồi thấy trạng thái đã commit: 409 NOT_ON_SALE hidden', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const tier = sale.tiers[0]!;
    const lock = await holdEventLock(sale.event.id, 'UPDATE');
    try {
      await lock.client.query("UPDATE events SET status = 'hidden' WHERE id = $1", [sale.event.id]);
      // supertest chỉ gửi khi có `then`: gửi ngay, chờ kết quả sau.
      const pending = postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity: 1 }])).then(
        (res) => res,
      );
      await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBe(1);
      await lock.release();
      const res = await pending;
      expect(res.status).toBe(409);
      expect(errorOf(res.body)).toMatchObject({ code: 'NOT_ON_SALE', details: { reason: 'hidden' } });
    } finally {
      await lock.release(false);
    }
    expect(await inventory(h, tier.id)).toMatchObject({ held: 0 });
  });

  it('TX1 đang giữ Sự kiện FOR SHARE → Ẩn, sửa Hạng vé của BTC chờ TX1 xong rồi chạy (không lỗi)', async () => {
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const tier = sale.tiers[0]!;
    const lock = await holdEventLock(sale.event.id, 'SHARE');
    try {
      const edit = h.http
        .patch(`${eventsPath(org, sale.event.id)}/ticket-types/${tier.id}`)
        .set('cookie', org.owner.cookie)
        .send({ name: 'Vé mới', price: 0, capacity: 6 });
      const hide = h.http.post(`${eventsPath(org, sale.event.id)}/hide`).set('cookie', org.owner.cookie);
      const pending = Promise.all([edit, hide]);
      await expect.poll(waitingOnLocks, { timeout: 10_000, interval: 50 }).toBeGreaterThanOrEqual(1);
      await lock.release();
      const [edited, hidden] = await pending;
      expect(edited.status).toBe(200);
      expect(hidden.status).toBe(200);
    } finally {
      await lock.release(false);
    }
  });

  it('nhiều TX1 song song với BTC sửa/xóa Hạng vé, đổi giới hạn, Ẩn → không deadlock, không 500, tồn kho khớp Đơn', async () => {
    const list = await buyers(12);
    const sale = await eventOnSale(org, [
      { name: 'Đơn nam', price: 300_000, capacity: 20 },
      { name: 'Đôi nam', price: 500_000, capacity: 20 },
      { name: 'Sẽ xóa', price: 0, capacity: 5 },
    ]);
    const [a, b, removable] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const owner = org.owner.cookie;
    const path = eventsPath(org, sale.event.id);
    const orderRequests = list.map((buyer, i) =>
      postOrder(
        h,
        buyer,
        sale.event.slug,
        orderBody(
          i % 2 === 0
            ? [
                { ticketTypeId: b.id, quantity: 1 },
                { ticketTypeId: a.id, quantity: 2 },
              ]
            : [{ ticketTypeId: a.id, quantity: 1 }],
        ),
      ),
    );
    const btcRequests = [
      h.http.patch(`${path}/ticket-types/${a.id}`).set('cookie', owner).send({ name: 'Đơn nam', price: 350_000, capacity: 25 }),
      h.http.delete(`${path}/ticket-types/${removable.id}`).set('cookie', owner),
      h.http.patch(`${path}/order-limit`).set('cookie', owner).send({ maxTicketsPerOrder: 8 }),
      h.http.patch(`${path}/ticket-types/${b.id}`).set('cookie', owner).send({ name: 'Đôi nam', price: 500_000, capacity: 15 }),
      h.http.post(`${path}/hide`).set('cookie', owner),
    ];
    const results = await Promise.all([...orderRequests, ...btcRequests]);
    for (const res of results) expect(res.status).toBeLessThan(500);
    for (const res of results.slice(0, list.length)) {
      if (res.status !== 201) expect(errorOf(res.body).code).toBe('NOT_ON_SALE');
    }
    for (const res of results.slice(list.length)) expect([200, 204]).toContain(res.status);

    // Tồn kho khớp tổng các dòng của Đơn pending.
    const { rows } = await h.db.pool.query<{ ticket_type_id: string; held: number }>(
      `SELECT oi.ticket_type_id, sum(oi.quantity)::int AS held
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.event_id = $1 AND o.status = 'pending' GROUP BY oi.ticket_type_id`,
      [sale.event.id],
    );
    const heldByOrders = new Map(rows.map((r) => [r.ticket_type_id, r.held]));
    expect((await inventory(h, a.id))!.held).toBe(heldByOrders.get(a.id) ?? 0);
    expect((await inventory(h, b.id))!.held).toBe(heldByOrders.get(b.id) ?? 0);

    // Hiện lại rồi đặt tiếp: giá đã chốt lúc khóa là giá mới.
    await h.http.post(`${path}/unhide`).set('cookie', owner).expect(200);
    const late = await signUp(h);
    const order = parseOrder(
      (await postOrder(h, late, sale.event.slug, orderBody([{ ticketTypeId: a.id, quantity: 1 }])).expect(201)).body,
    );
    expect(order.items[0]!.unitPrice).toBe(350_000);
  });
});
