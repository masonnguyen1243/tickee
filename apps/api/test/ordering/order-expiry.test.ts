import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORDER_HOLD } from '../../src/modules/ordering/index.js';
import { EXPIRE_ORDER_QUEUE_OPTIONS, expireOrder } from '../../src/modules/ordering/order-jobs.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { workerConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  orderBody,
  orderRow,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
} from './order-fixtures.js';

/*
 * Story 3.2, AD-4 (a): Đơn chưa có link quá `expires_at` → `expired`, nhả chỗ. Hạn Giữ chỗ tiêm 1 giây (`ORDER_HOLD`) để
 * worker thật chạy job hoãn trong vài giây.
 */

const QUEUE = JobQueue.ORDERING_EXPIRE_ORDER;
const DEAD_LETTER = JobQueue.ORDERING_EXPIRE_ORDER_DEAD_LETTER;

let h: Harness;
let org: Org;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [{ provide: ORDER_HOLD, useValue: 1 }, rejectingTingee] });
  org = await paidReadyOrg(h);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

/** Đơn `pending` mới: Hạng vé 5 suất, Đơn giữ `quantity` chỗ. */
async function pendingOrder(quantity = 2) {
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Đơn nam', price: 300_000, capacity: 5 }]);
  const tier = sale.tiers[0]!;
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity }])).expect(201);
  const order = parseOrder(res.body);
  const row = (await orderRow(h, order.code))!;
  return { buyer, sale, tier, order, row };
}

async function pastDeadline(orderId: string): Promise<boolean> {
  const { rows } = await h.db.pool.query<{ past: boolean }>('SELECT expires_at < now() AS past FROM orders WHERE id = $1', [
    orderId,
  ]);
  return rows[0]!.past;
}

describe('expireOrder (hàm của job, cũng dùng trước TX1)', () => {
  it('quá hạn, chưa có link → expired, held -= n; gọi lại → skipped, không nhả thêm', async () => {
    const { tier, order, row } = await pendingOrder(2);
    // Chờ theo đồng hồ của Postgres (cùng mốc với `now()` của câu CAS), không theo đồng hồ máy chạy test.
    await expect.poll(() => pastDeadline(row.id), { timeout: 5_000, interval: 100 }).toBe(true);
    expect(await expireOrder(h.db, row.id)).toBe('expired');
    expect((await orderRow(h, order.code))!.status).toBe('expired');
    expect(await inventory(h, tier.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await expireOrder(h.db, row.id)).toBe('skipped');
    expect(await inventory(h, tier.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
  });

  it('còn trong hạn → not_yet (job chạy sớm: retry), không đổi gì', async () => {
    const { tier, order, row } = await pendingOrder(1);
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() + interval '1 hour' WHERE id = ${row.id}`);
    expect(await expireOrder(h.db, row.id)).toBe('not_yet');
    expect((await orderRow(h, order.code))!.status).toBe('pending');
    expect(await inventory(h, tier.id)).toMatchObject({ held: 1 });
  });

  it('đã có link thanh toán, hoặc không còn pending → skipped, giữ nguyên chỗ', async () => {
    const withLink = await pendingOrder(1);
    await h.db.orm.execute(
      sql`UPDATE orders SET payment_link = 'https://pay.tingee.test/x', expires_at = now() - interval '1 second' WHERE id = ${withLink.row.id}`,
    );
    expect(await expireOrder(h.db, withLink.row.id)).toBe('skipped');
    expect((await orderRow(h, withLink.order.code))!.status).toBe('pending');
    expect(await inventory(h, withLink.tier.id)).toMatchObject({ held: 1 });

    const notPending = await pendingOrder(1);
    await h.db.orm.execute(
      sql`UPDATE orders SET status = 'cancelled', expires_at = now() - interval '1 second' WHERE id = ${notPending.row.id}`,
    );
    expect(await expireOrder(h.db, notPending.row.id)).toBe('skipped');
    expect(await inventory(h, notPending.tier.id)).toMatchObject({ held: 1 });
  });

  it('hai lần gọi song song cho cùng Đơn → nhả chỗ đúng một lần', async () => {
    const { tier, row } = await pendingOrder(3);
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = ${row.id}`);
    const results = await Promise.all([expireOrder(h.db, row.id), expireOrder(h.db, row.id)]);
    expect(results.sort()).toEqual(['expired', 'skipped']);
    expect(await inventory(h, tier.id)).toMatchObject({ held: 0 });
  });
});

describe('queue', () => {
  it('có retry (backoff) và dead-letter', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    await pendingOrder(1);
    await expect.poll(async () => (await boss.getQueue(DEAD_LETTER))?.name, { timeout: 10_000 }).toBe(DEAD_LETTER);
    expect(await boss.getQueue(QUEUE)).toMatchObject({
      name: QUEUE,
      deadLetter: DEAD_LETTER,
      retryLimit: EXPIRE_ORDER_QUEUE_OPTIONS.retryLimit,
      retryBackoff: true,
    });
  });
});

describe('worker thật', () => {
  let worker: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] }).compile();
    worker = await moduleRef.init();
  });
  afterAll(async () => {
    await worker.close();
  });

  it('Đơn chưa có link quá hạn → worker chuyển expired và nhả chỗ; GET trả expired', async () => {
    const { buyer, tier, order, row } = await pendingOrder(2);
    expect(await inventory(h, tier.id)).toMatchObject({ held: 2 });
    await expect
      .poll(async () => (await orderRow(h, order.code))!.status, { timeout: 20_000, interval: 200 })
      .toBe('expired');
    expect(await inventory(h, tier.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
    const boss = worker.get<PgBoss>(BOSS);
    const [job] = await boss.findJobs(QUEUE, { data: { orderId: row.id } });
    await expect.poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 10_000 }).toBe('completed');
    const res = await h.http.get(`/v1/me/orders/${order.code}`).set('cookie', buyer.cookie).expect(200);
    expect(parseOrder(res.body).buyerStatus).toBe('expired');
  });

  it('Đơn đã có link khi job chạy → bỏ qua (completed), Đơn vẫn pending, chỗ vẫn giữ', async () => {
    const { tier, order, row } = await pendingOrder(1);
    await h.db.orm.execute(sql`UPDATE orders SET payment_link = 'https://pay.tingee.test/y' WHERE id = ${row.id}`);
    const boss = worker.get<PgBoss>(BOSS);
    const [job] = await boss.findJobs(QUEUE, { data: { orderId: row.id } });
    await expect
      .poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 20_000, interval: 200 })
      .toBe('completed');
    expect((await orderRow(h, order.code))!.status).toBe('pending');
    expect(await inventory(h, tier.id)).toMatchObject({ held: 1 });
  });

  it('job chạy sớm (Đơn được gia hạn) → retry, Đơn vẫn pending', async () => {
    const { order, row } = await pendingOrder(1);
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() + interval '1 hour' WHERE id = ${row.id}`);
    const boss = worker.get<PgBoss>(BOSS);
    const [job] = await boss.findJobs(QUEUE, { data: { orderId: row.id } });
    await expect
      .poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 20_000, interval: 200 })
      .toBe('retry');
    expect((await orderRow(h, order.code))!.status).toBe('pending');
  });
});
