import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue } from '@tickee/contracts';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  firstCheckAt,
  RECONCILE_ORDER_QUEUE_OPTIONS,
  ReconcileOrderPayload,
  reconcileJobId,
  reconcileRetryJobId,
} from '../../src/modules/ordering/reconciliation-jobs.js';
import {
  IpnProcessor,
  PAYMENT_RECONCILIATION_STOPPED_ALERT,
  reconciliationSettings,
  ReconciliationWorker,
  type ReconcileOutcome,
} from '../../src/modules/payment/index.js';
import { HttpTingeeClient, type TingeeClient, type TingeeCredential } from '../../src/modules/tingee/index.js';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { Database, DATABASE } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { migrationDatabaseUrl, TEST_CREDENTIAL_KEYS, workerConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  ipnKeyOf,
  linkPayoutAccount,
  orderBody,
  ordersOfEvent,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type PayoutSpec,
  type SaleEvent,
} from '../ordering/order-fixtures.js';
import {
  fakeAccount,
  fakeIpnPayload,
  fakeStatusIpnPayload,
  GET_ORDER_PATH,
  signIpn,
  startTingeeFake,
  type FakeAccount,
  type TingeeFake,
} from '../tingee-fake/server.js';
import { expectInvariants, orderState, paymentEventsOf, postIpn, reviewItemsOf } from './ipn-fixtures.js';

/*
 * Story 4.1: Đối soát bù khi IPN trễ hoặc mất, trên Postgres thật và Tingee fake (server HTTP thật, giả lập hợp đồng tạm
 * của API tra đơn Gateway). Mọi dòng của I/O Matrix gọi thẳng `ReconciliationWorker.reconcile` (dựng trên DB, pg-boss
 * producer và lõi IPN của api: không có worker nền chen vào); lịch tra (phút, giờ) giả lập bằng cách lùi
 * `payment_link_attempt_at`/`expires_at` của Đơn (đồng hồ DB vẫn thật). Khối "worker thật" chạy job của TX2 qua pg-boss.
 * Sau mỗi nhánh: bất biến tồn kho – Vé (`expectInvariants`).
 */

const QUEUE = JobQueue.PAYMENT_RECONCILE_ORDER;
const MIN = 60_000;
const MAIN: TingeeCredential = { clientId: 'tg-recon-main-4d2a', secretToken: 'tg-recon-main-secret-Zx9Cv8Bn7' };
const OLD: TingeeCredential = { clientId: 'tg-recon-old-8b3e', secretToken: 'tg-recon-old-secret-Lk6Jh5Gf4' };
const NEW: TingeeCredential = { clientId: 'tg-recon-new-1c9f', secretToken: 'tg-recon-new-secret-Po3Iu2Yt1' };
const mainAccount = fakeAccount({ accountName: 'LE VAN CUONG' });
const oldAccount = fakeAccount({ accountName: 'HOANG THI MAI' });
const newAccount = fakeAccount({ accountName: 'HOANG THI MAI' });
const payoutOf = (account: FakeAccount): PayoutSpec => ({
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
});
const PRICE = 150_000;

let fake: TingeeFake;
let h: Harness;
let boss: PgBoss;
let org: Org;
let ipnKey: string;
let worker: ReconciliationWorker;
/** Chạy một lần ngay sau lời gọi tra kế tiếp của worker (trước khi xử lý kết quả): chen IPN vào giữa. */
let afterNextLookup: (() => Promise<void>) | null = null;

/**
 * Worker Đối soát bù trên DB, pg-boss và lõi IPN của api; client HTTP thật trỏ vào fake (timeout tra 1 giây).
 * `secretBox`: thay khóa giải mã credential (mặc định khóa của test).
 */
function workerWith(enabled: boolean, secretBox?: SecretBox): ReconciliationWorker {
  const http = new HttpTingeeClient({ baseUrl: fake.url, orderStatusTimeoutMs: 1_000 });
  const client: TingeeClient = {
    listAccounts: (credential) => http.listAccounts(credential),
    createPaymentLink: (credential, input) => http.createPaymentLink(credential, input),
    async getGatewayOrder(credential, orderId) {
      try {
        return await http.getGatewayOrder(credential, orderId);
      } finally {
        const hook = afterNextLookup;
        afterNextLookup = null;
        if (hook) await hook();
      }
    },
  };
  return new ReconciliationWorker(
    h.app.get<Database>(DATABASE),
    boss,
    client,
    h.app.get(IpnProcessor),
    secretBox
      ? { secretBox, orderStatusQuery: enabled }
      : reconciliationSettings({ TINGEE_CREDENTIAL_KEYS: TEST_CREDENTIAL_KEYS, TINGEE_ORDER_STATUS_QUERY: enabled }),
  );
}

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [mainAccount] },
      { ...OLD, accounts: [oldAccount] },
      { ...NEW, accounts: [newAccount] },
    ],
  });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  boss = h.app.get<PgBoss>(BOSS);
  org = await paidReadyOrg(h, { name: 'CLB Bơi lội Quận 1', credential: MAIN, payout: payoutOf(mainAccount) });
  ipnKey = await ipnKeyOf(h, org.orgId);
  worker = workerWith(true);
});
beforeEach(async () => {
  const main = fake.merchant(MAIN.clientId);
  delete main.behavior;
  main.orderReplies = [];
  afterNextLookup = null;
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

interface Placed {
  code: string;
  orderId: string;
  eventId: string;
  tierId: string;
  total: number;
}

const newSale = (owner: Org = org, capacity = 20): Promise<SaleEvent> =>
  eventOnSale(owner, [{ name: 'Bơi 100m', price: PRICE, capacity }]);

/** Người mua mới đặt `quantity` Vé ở `sale`; Đơn `pending` có link thanh toán (TX2 đã chạy). */
async function placeOn(sale: SaleEvent, quantity = 2): Promise<Placed> {
  const buyer = await signUp(h);
  const tierId = sale.tiers[0]!.id;
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity }])).expect(201);
  const order = parseOrder(res.body);
  expect(order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { checkoutUrl: expect.any(String) } });
  const { id } = await orderState(h, order.code);
  return { code: order.code, orderId: id, eventId: sale.event.id, tierId, total: quantity * PRICE };
}

const place = async (quantity = 2, owner: Org = org): Promise<Placed> => placeOn(await newSale(owner), quantity);

interface ReconcileJob {
  id: string;
  data: ReconcileOrderPayload;
  startAfter: Date;
  state: string;
}

/** Job tra của Đơn, theo `startAfter` tăng dần. */
async function reconcileJobs(orderId: string): Promise<ReconcileJob[]> {
  const jobs = await boss.findJobs(QUEUE, { data: { orderId } });
  return jobs
    .map((job) => ({ id: job.id, data: ReconcileOrderPayload.parse(job.data), startAfter: job.startAfter, state: job.state }))
    .sort((a, b) => a.startAfter.getTime() - b.startAfter.getTime());
}

/** Job tra duy nhất của Đơn lúc này (job của TX2). */
async function onlyJob(orderId: string): Promise<ReconcileJob> {
  const jobs = await reconcileJobs(orderId);
  expect(jobs).toHaveLength(1);
  return jobs[0]!;
}

const run = (job: Pick<ReconcileJob, 'id' | 'data'>, on: ReconciliationWorker = worker): Promise<ReconcileOutcome> =>
  on.reconcile(job.data, job.id);

/** `payment_link_attempt_at`, `expires_at` của Đơn. */
async function anchorsOf(orderId: string): Promise<{ attemptAt: Date; expiresAt: Date }> {
  const { rows } = await h.db.pool.query<{ attempt_at: Date; expires_at: Date }>(
    'SELECT payment_link_attempt_at AS attempt_at, expires_at FROM orders WHERE id = $1',
    [orderId],
  );
  return { attemptAt: rows[0]!.attempt_at, expiresAt: rows[0]!.expires_at };
}

/** Giả lập thời gian trôi `seconds` giây: lùi mốc neo của Đơn (đồng hồ DB vẫn thật). */
async function elapse(orderId: string, seconds: number): Promise<void> {
  await h.db.pool.query(
    `UPDATE orders SET payment_link_attempt_at = payment_link_attempt_at - make_interval(secs => $2),
                       expires_at = expires_at - make_interval(secs => $2)
      WHERE id = $1`,
    [orderId, seconds],
  );
}

const lookupsOf = (code: string) => fake.calls(GET_ORDER_PATH).filter((r) => r.body.orderId === code);

async function buyerEmails(orderId: string): Promise<unknown[]> {
  const jobs = await boss.findJobs(JobQueue.ORDERING_SEND_BUYER_EMAIL, { data: { orderId } });
  return jobs.map((job) => job.data);
}

const alertsOf = (code: string) =>
  h.logs.lines.filter((l) => l.orderCode === code && l.alert === PAYMENT_RECONCILIATION_STOPPED_ALERT);

const sendIpn = (payload: Record<string, unknown>, credential: TingeeCredential = MAIN) =>
  postIpn(h, ipnKey, signIpn(credential.secretToken, payload));

/** IPN `expired` tới: Đơn hết hạn, nhả chỗ (link trên fake vẫn chưa trả). */
async function expireByIpn(placed: Placed): Promise<void> {
  await sendIpn(fakeStatusIpnPayload(placed.code, placed.total, 'expired')).expect(200);
  expect((await orderState(h, placed.code)).status).toBe('expired');
}

async function waitingOnLocks(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'tickee-api' AND wait_event_type = 'Lock'`,
  );
  return rows[0]!.n;
}

/** Chạy các việc trong lúc giữ khóa dòng `events`; nhả khi cả `n` đang chờ khóa. */
async function whileEventLocked(eventId: string, n: number, start: () => Promise<unknown>[]): Promise<unknown[]> {
  const client: pg.PoolClient = await h.db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const pending = Promise.all(start());
    await expect.poll(waitingOnLocks, { timeout: 15_000, interval: 50 }).toBe(n);
    await client.query('COMMIT');
    return await pending;
  } finally {
    client.release();
  }
}

describe('TX2 enqueue mốc tra đầu tiên', () => {
  it('TX2 commit → đúng một job tra: startAfter = payment_link_attempt_at + 2 phút, payload { orderId, failures: 0 }, id cố định theo (Đơn, mốc); queue có retry và dead-letter', async () => {
    const placed = await place();
    const { attemptAt } = await anchorsOf(placed.orderId);
    const job = await onlyJob(placed.orderId);
    expect(job).toMatchObject({
      id: reconcileJobId(placed.orderId, firstCheckAt(attemptAt)),
      data: { orderId: placed.orderId, failures: 0 },
      state: 'created',
    });
    expect(job.startAfter.getTime()).toBe(attemptAt.getTime() + 2 * MIN);
    expect(await boss.getQueue(QUEUE)).toMatchObject({
      name: QUEUE,
      deadLetter: JobQueue.PAYMENT_RECONCILE_ORDER_DEAD_LETTER,
      retryLimit: RECONCILE_ORDER_QUEUE_OPTIONS.retryLimit,
      retryBackoff: true,
    });
    expect(await boss.getQueue(JobQueue.PAYMENT_RECONCILE_ORDER_DEAD_LETTER)).toMatchObject({
      name: JobQueue.PAYMENT_RECONCILE_ORDER_DEAD_LETTER,
    });
  });

  it('TX2 rollback (lỗi lúc commit, sau khi đã enqueue) → không job tra, không job (c), không link', async () => {
    // Trigger hoãn tới lúc commit: TX2 đã enqueue cả hai job rồi mới hỏng, cả transaction rollback.
    const migrator = new Database({ connectionString: migrationDatabaseUrl(), max: 1 });
    const price = 777_000;
    try {
      await migrator.pool.query(`
        CREATE OR REPLACE FUNCTION test_reconcile_fail_tx2() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.total_amount = ${price} AND OLD.payment_link IS NULL AND NEW.payment_link IS NOT NULL THEN
            RAISE EXCEPTION 'test: TX2 rollback';
          END IF;
          RETURN NULL;
        END $$`);
      await migrator.pool.query(`
        CREATE CONSTRAINT TRIGGER test_reconcile_fail_tx2 AFTER UPDATE ON orders
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_reconcile_fail_tx2()`);

      const buyer = await signUp(h);
      const sale = await eventOnSale(org, [{ name: 'Bơi 400m', price, capacity: 5 }]);
      const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }]));
      expect(res.status).toBe(500);
      const [row] = await ordersOfEvent(h, sale.event.id);
      const { id } = await orderState(h, row!.code);
      expect(await reconcileJobs(id)).toEqual([]);
      const expiry = await boss.findJobs(JobQueue.ORDERING_EXPIRE_ORDER, { data: { orderId: id } });
      expect(expiry.map((job) => (job.data as { linked?: boolean }).linked ?? false)).toEqual([false]);
      const { rows } = await h.db.pool.query<{ payment_link: string | null }>('SELECT payment_link FROM orders WHERE id = $1', [
        id,
      ]);
      expect(rows[0]!.payment_link).toBeNull();
    } finally {
      await migrator.pool.query('DROP TRIGGER IF EXISTS test_reconcile_fail_tx2 ON orders');
      await migrator.pool.query('DROP FUNCTION IF EXISTS test_reconcile_fail_tx2()');
      await migrator.close();
    }
  });
});

describe('cờ TINGEE_ORDER_STATUS_QUERY tắt', () => {
  it('job tra xong ngay: không request nào tới Tingee, không enqueue mốc kế, Đơn không đổi', async () => {
    const placed = await place();
    fake.markPaid(placed.code);
    const job = await onlyJob(placed.orderId);
    expect(await run(job, workerWith(false))).toEqual({ result: 'disabled' });
    expect(lookupsOf(placed.code)).toEqual([]);
    expect(await reconcileJobs(placed.orderId)).toEqual([job]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 2, sold: 0 });
  });
});

describe('I/O Matrix', () => {
  it('IPN mất: Đơn pending, Tingee báo success đúng số tiền → paid (reconciliation), N Vé, một job email Vé; dừng chuỗi', async () => {
    const placed = await place(2);
    const paid = fake.markPaid(placed.code);
    const job = await onlyJob(placed.orderId);

    expect(await run(job)).toEqual({ result: 'checked', gatewayStatus: 'success', branch: 'paid', next: null });

    const state = await orderState(h, placed.code);
    expect(state).toMatchObject({
      status: 'paid',
      paid_source: 'reconciliation',
      paid_amount: String(placed.total),
      tickets: 2,
    });
    expect(state.paid_at!.toISOString()).toBe(paid.paidAt);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 2, held: 0 });
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toMatchObject([
      {
        kind: 'payment',
        status: 'success',
        order_id: placed.orderId,
        provider_transaction_code: paid.providerTransactionCode,
        paid_amount: String(placed.total),
        request_id: null,
      },
    ]);
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
    expect(await buyerEmails(placed.orderId)).toEqual([{ kind: 'tickets', orderId: placed.orderId }]);
    // Không mốc kế: chỉ còn job vừa chạy.
    expect((await reconcileJobs(placed.orderId)).map((j) => j.id)).toEqual([job.id]);
    // Gọi bằng credential đã chụp ở TX2, ký đúng; secret không vào log.
    expect(lookupsOf(placed.code)).toMatchObject([{ clientId: MAIN.clientId, signatureValid: true }]);
    expect(h.logs.text).not.toContain(MAIN.secretToken);
    expect(h.logs.lines.find((l) => l.orderCode === placed.code && l.source === 'reconciliation')).toMatchObject({
      branch: 'paid',
      organizationId: org.orgId,
    });
    await expectInvariants(h, placed.eventId);
  });

  it('IPN đã tới trước: Đơn paid lúc job chạy → không gọi Tingee, dừng', async () => {
    const placed = await place(1);
    await sendIpn(fakeIpnPayload(placed.code, placed.total)).expect(200);
    const job = await onlyJob(placed.orderId);
    expect(await run(job)).toEqual({ result: 'skipped', reason: 'not_open' });
    expect(lookupsOf(placed.code)).toEqual([]);
    expect(await reconcileJobs(placed.orderId)).toEqual([job]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 1 });
    await expectInvariants(h, placed.eventId);
  });

  it('Đua IPN: IPN và kết quả tra cùng providerTransactionCode, đồng thời → một dòng payment_events, một bộ Vé, một job email; bên thua duplicate', async () => {
    for (let i = 0; i < 2; i++) {
      const placed = await place(3);
      const paid = fake.markPaid(placed.code);
      const ipn = fakeIpnPayload(placed.code, placed.total, {
        providerTransactionCode: paid.providerTransactionCode,
        paidAt: paid.paidAt,
      });
      const job = await onlyJob(placed.orderId);
      const [res, outcome] = (await whileEventLocked(placed.eventId, 2, () => [sendIpn(ipn), run(job)])) as [
        { status: number },
        ReconcileOutcome,
      ];
      expect(res.status).toBe(200);
      expect(outcome).toMatchObject({ result: 'checked', gatewayStatus: 'success', next: null });

      const state = await orderState(h, placed.code);
      expect(state).toMatchObject({ status: 'paid', tickets: 3 });
      expect(['ipn', 'reconciliation']).toContain(state.paid_source);
      expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(1);
      expect(await buyerEmails(placed.orderId)).toEqual([{ kind: 'tickets', orderId: placed.orderId }]);
      expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
      // Log của lõi xử lý (có `source`): một lần phát Vé, bên kia là bản lặp.
      const branches = h.logs.lines.filter((l) => l.orderCode === placed.code && l.source !== undefined).map((l) => l.branch);
      expect(branches.filter((b) => b === 'paid')).toHaveLength(1);
      expect(branches.filter((b) => b === 'duplicate')).toHaveLength(1);
      expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 3, held: 0 });
      await expectInvariants(h, placed.eventId);
    }
  });

  it('Đua khác mã: Đơn vừa paid qua IPN, kết quả tra mang mã khác → already_settled, không mục Cần xử lý, không đổi Đơn', async () => {
    const placed = await place(2);
    const paid = fake.markPaid(placed.code);
    const ipn = fakeIpnPayload(placed.code, placed.total);
    expect(ipn.providerTransactionCode).not.toBe(paid.providerTransactionCode);
    // IPN tới sau khi worker đã đọc Đơn còn pending và đã tra xong, trước khi xử lý kết quả.
    afterNextLookup = async () => {
      await sendIpn(ipn).expect(200);
    };
    const job = await onlyJob(placed.orderId);

    expect(await run(job)).toEqual({ result: 'checked', gatewayStatus: 'success', branch: 'already_settled', next: null });

    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 2 });
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
    const events = await paymentEventsOf(h, org.orgId, placed.code);
    expect(events.map((e) => e.provider_transaction_code).sort()).toEqual(
      [ipn.providerTransactionCode, paid.providerTransactionCode].sort(),
    );
    expect(events.every((e) => e.order_id === placed.orderId)).toBe(true);
    expect(await buyerEmails(placed.orderId)).toHaveLength(1);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 2, held: 0 });
    await expectInvariants(h, placed.eventId);
  });

  it.each(['expired', 'canceled'] as const)(
    'Link hết hạn chưa trả: Đơn pending, Tingee báo %s → markExpired, nhả chỗ; chuỗi sang expires_at + 30 phút',
    async (status) => {
      const placed = await place(2);
      fake.markExpired(placed.code, status);
      const job = await onlyJob(placed.orderId);
      const { expiresAt } = await anchorsOf(placed.orderId);
      const next = new Date(expiresAt.getTime() + 30 * MIN);

      expect(await run(job)).toEqual({ result: 'checked', gatewayStatus: status, branch: 'expired', next });

      expect(await orderState(h, placed.code)).toMatchObject({ status: 'expired', tickets: 0 });
      expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 0, held: 0 });
      expect(await paymentEventsOf(h, org.orgId, placed.code)).toMatchObject([{ kind: 'status', status }]);
      const jobs = await reconcileJobs(placed.orderId);
      expect(jobs).toHaveLength(2);
      expect(jobs[1]).toMatchObject({
        id: reconcileJobId(placed.orderId, next),
        data: { orderId: placed.orderId, failures: 0 },
        startAfter: next,
      });
      await expectInvariants(h, placed.eventId);
    },
  );

  it('Tiền về muộn: Đơn expired, mốc + 2 giờ, Tingee báo success → còn chỗ: bán lại, paid (reconciliation) + Vé; dừng chuỗi', async () => {
    const placed = await place(2);
    await expireByIpn(placed);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 0, held: 0 });
    // Job của mốc expires_at + 2 giờ chạy (trễ vài phút).
    await elapse(placed.orderId, 2 * 3600 + 20 * 60);
    fake.markPaid(placed.code);

    expect(await run({ id: randomUUID(), data: { orderId: placed.orderId, failures: 0 } })).toEqual({
      result: 'checked',
      gatewayStatus: 'success',
      branch: 'paid',
      next: null,
    });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'reconciliation', tickets: 2 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 2, held: 0 });
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
    expect(await buyerEmails(placed.orderId)).toEqual([{ kind: 'tickets', orderId: placed.orderId }]);
    await expectInvariants(h, placed.eventId);
  });

  it('Tiền về muộn: Đơn expired, hết chỗ → Đơn review, mục orphan sold_out, email báo Người mua; Đơn khác giữ nguyên chỗ', async () => {
    const sale = await newSale(org, 2);
    const late = await placeOn(sale, 2);
    await expireByIpn(late);
    const holder = await placeOn(sale, 2);
    expect(await inventory(h, late.tierId)).toEqual({ capacity: 2, sold: 0, held: 2 });
    // Job của mốc expires_at + 30 phút chạy.
    await elapse(late.orderId, 30 * 60 + 15 * 60 + 60);
    fake.markPaid(late.code);

    expect(await run({ id: randomUUID(), data: { orderId: late.orderId, failures: 0 } })).toEqual({
      result: 'checked',
      gatewayStatus: 'success',
      branch: 'orphan',
      next: null,
    });
    expect(await orderState(h, late.code)).toMatchObject({ status: 'review', tickets: 0 });
    const [event] = (await paymentEventsOf(h, org.orgId, late.code)).filter((e) => e.kind === 'payment');
    expect(await reviewItemsOf(h, { orderId: late.orderId })).toMatchObject([
      { type: 'orphan', reason: 'sold_out', status: 'open', payment_event_id: event!.id, organization_id: org.orgId },
    ]);
    expect(await buyerEmails(late.orderId)).toEqual([{ kind: 'orphan_sold_out', orderId: late.orderId }]);
    expect(await orderState(h, holder.code)).toMatchObject({ status: 'pending' });
    expect(await inventory(h, late.tierId)).toEqual({ capacity: 2, sold: 0, held: 2 });
    await expectInvariants(h, sale.event.id);
  });

  it('Lệch tiền: Tingee báo success, paidAmount ≠ total_amount → Đơn review, mục amount_mismatch như IPN; nhả chỗ', async () => {
    const placed = await place(2);
    fake.markPaid(placed.code, { paidAmount: placed.total - 50_000 });
    const job = await onlyJob(placed.orderId);

    expect(await run(job)).toEqual({ result: 'checked', gatewayStatus: 'success', branch: 'mismatch', next: null });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'review', paid_source: null, tickets: 0 });
    const [event] = await paymentEventsOf(h, org.orgId, placed.code);
    expect(event).toMatchObject({ paid_amount: String(placed.total - 50_000), order_id: placed.orderId });
    expect(await reviewItemsOf(h, { orderId: placed.orderId })).toMatchObject([
      { type: 'amount_mismatch', reason: null, status: 'open', payment_event_id: event!.id },
    ]);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 0, held: 0 });
    expect(await reconcileJobs(placed.orderId)).toHaveLength(1);
    await expectInvariants(h, placed.eventId);
  });

  it('Chưa trả: Tingee báo đơn còn mở → không lưu gì, enqueue mốc kế; job chạy lại không tạo job trùng cho cùng mốc', async () => {
    const placed = await place(2);
    const job = await onlyJob(placed.orderId);
    // Job của mốc lượt + 2 phút chạy đúng giờ.
    await elapse(placed.orderId, 150);
    const { attemptAt } = await anchorsOf(placed.orderId);
    const next = new Date(attemptAt.getTime() + 5 * MIN);

    expect(await run(job)).toEqual({ result: 'checked', gatewayStatus: 'pending', branch: null, next });
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 2 });
    let jobs = await reconcileJobs(placed.orderId);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({ id: reconcileJobId(placed.orderId, next), data: { failures: 0 }, startAfter: next });

    // AC: job chạy lại (pg-boss retry sau lỗi DB) sau khi đã enqueue mốc kế → không job trùng.
    expect(await run(job)).toMatchObject({ result: 'checked', next });
    expect(await reconcileJobs(placed.orderId)).toHaveLength(2);

    // Mốc + 5 phút chạy (trễ 30 giây) → mốc + 10 phút.
    await elapse(placed.orderId, 180);
    const shifted = await anchorsOf(placed.orderId);
    expect(await run(jobs[1]!)).toMatchObject({
      result: 'checked',
      next: new Date(shifted.attemptAt.getTime() + 10 * MIN),
    });
    jobs = await reconcileJobs(placed.orderId);
    expect(jobs).toHaveLength(3);
    await expectInvariants(h, placed.eventId);
  });

  it('Key cũ bị thu hồi: tra bằng credential chụp ở TX2 (kể cả đã gỡ mềm); Tingee trả TINGEE_CREDENTIAL_INVALID → dừng chuỗi, log alert credential_invalid', async () => {
    const own = await paidReadyOrg(h, { name: 'CLB Lặn biển', credential: OLD, payout: payoutOf(oldAccount) });
    const placed = await place(1, own);
    // Đổi key (Story 2.13-b): credential và tài khoản cũ gỡ mềm; key mới là credential hiện hành.
    await h.db.pool.query('UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = $1', [
      own.orgId,
    ]);
    await h.db.pool.query('UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = $1', [own.orgId]);
    await linkPayoutAccount(own, NEW, payoutOf(newAccount));

    // Key cũ còn dùng được: vẫn tra bằng key cũ (key của link), không bằng key mới.
    await elapse(placed.orderId, 150);
    const job = await onlyJob(placed.orderId);
    expect(await run(job)).toMatchObject({ result: 'checked', gatewayStatus: 'pending' });
    expect(lookupsOf(placed.code)).toMatchObject([{ clientId: OLD.clientId, signatureValid: true }]);
    const [, next] = await reconcileJobs(placed.orderId);

    // Tingee thu hồi key cũ (97 sai chữ ký).
    fake.merchant(OLD.clientId).secretToken = 'tg-recon-old-secret-da-thu-hoi';
    expect(await run(next!)).toEqual({ result: 'stopped', reason: 'credential_invalid', error: null });
    expect(lookupsOf(placed.code)).toHaveLength(2);
    expect(await reconcileJobs(placed.orderId)).toHaveLength(2);
    expect(alertsOf(placed.code)).toMatchObject([
      { level: 50, reason: 'credential_invalid', organizationId: own.orgId, orderCode: placed.code },
    ]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    // Đơn hết hạn theo job (c) hiện có.
    const expiry = await boss.findJobs(JobQueue.ORDERING_EXPIRE_ORDER, { data: { orderId: placed.orderId } });
    expect(expiry.map((j) => (j.data as { linked?: boolean }).linked ?? false).sort()).toEqual([false, true]);
    expect(h.logs.text).not.toContain(OLD.secretToken);
    await expectInvariants(h, placed.eventId);
  });

  it('Không đọc được credential (Đơn thiếu payout_account_id; giải mã lỗi) → dừng, lý do credential_unreadable; không gọi Tingee', async () => {
    const missing = await place(1);
    await h.db.pool.query('UPDATE orders SET payout_account_id = NULL WHERE id = $1', [missing.orderId]);
    expect(await run({ id: randomUUID(), data: { orderId: missing.orderId, failures: 0 } })).toEqual({
      result: 'stopped',
      reason: 'credential_unreadable',
      error: null,
    });
    expect(alertsOf(missing.code)).toMatchObject([{ reason: 'credential_unreadable' }]);

    const own = await paidReadyOrg(h, { name: 'CLB Bơi mùa đông', credential: MAIN, payout: payoutOf(mainAccount) });
    const broken = await place(1, own);
    // Ciphertext đúng dạng nhưng không mở được bằng khóa của worker (vd. khóa đã bị gỡ khỏi env).
    const ciphertext = 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    await h.db.pool.query('UPDATE tingee_credentials SET secret_token_ciphertext = $2 WHERE organization_id = $1', [
      own.orgId,
      ciphertext,
    ]);
    expect(await run({ id: randomUUID(), data: { orderId: broken.orderId, failures: 0 } })).toEqual({
      result: 'stopped',
      reason: 'credential_unreadable',
      error: null,
    });
    expect(alertsOf(broken.code)).toMatchObject([{ reason: 'credential_unreadable', organizationId: own.orgId }]);
    expect(h.logs.lines.find((l) => l.orderCode === broken.code && l.error === 'SecretBoxError')).toBeDefined();
    for (const placed of [missing, broken]) {
      expect(lookupsOf(placed.code)).toEqual([]);
      expect(await reconcileJobs(placed.orderId)).toHaveLength(1);
      expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending' });
    }
    expect(h.logs.text).not.toContain(ciphertext);
  });

  it('Lỗi khác SecretBoxError khi đọc credential (vd. DB) → ném để pg-boss retry cả job: không dừng chuỗi, không cảnh báo, không gọi Tingee', async () => {
    const placed = await place(1);
    const box = new SecretBox(parseCredentialKeys(TEST_CREDENTIAL_KEYS));
    vi.spyOn(box, 'open').mockImplementation(() => {
      throw new Error('mất kết nối DB');
    });
    const job = await onlyJob(placed.orderId);
    await expect(run(job, workerWith(true, box))).rejects.toThrow('mất kết nối DB');
    expect(alertsOf(placed.code)).toEqual([]);
    expect(lookupsOf(placed.code)).toEqual([]);
    expect(await reconcileJobs(placed.orderId)).toEqual([job]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending' });
  });

  it('Đơn hết hạn sớm (IPN expired trước expires_at): job của mốc pending còn lại → không gọi Tingee, hẹn expires_at + 30 phút', async () => {
    const placed = await place(1);
    await expireByIpn(placed);
    const job = await onlyJob(placed.orderId);
    const { expiresAt } = await anchorsOf(placed.orderId);
    const next = new Date(expiresAt.getTime() + 30 * MIN);

    expect(await run(job)).toEqual({ result: 'skipped', reason: 'before_post_expiry', next });
    expect(lookupsOf(placed.code)).toEqual([]);
    const jobs = await reconcileJobs(placed.orderId);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({ id: reconcileJobId(placed.orderId, next), data: { failures: 0 }, startAfter: next });

    // Mốc expires_at + 30 phút tới: tra Tingee như thường.
    await elapse(placed.orderId, 15 * 60 + 30 * 60 + 30);
    expect(await run(jobs[1]!)).toMatchObject({ result: 'checked', gatewayStatus: 'pending', branch: null });
    expect(lookupsOf(placed.code)).toHaveLength(1);
    await expectInvariants(h, placed.eventId);
  });

  it('Tingee lỗi liên tục: tra lại cùng mốc sau 1, 2, 4 phút; lỗi lần thứ 4 liên tiếp PAYMENT_PROVIDER_UNAVAILABLE → dừng chuỗi, log alert failed', async () => {
    const placed = await place(1);
    fake.merchant(MAIN.clientId).behavior = 'error';
    const job0 = await onlyJob(placed.orderId);
    let parent = job0;
    for (const [failures, delayMin] of [
      [1, 1],
      [2, 2],
      [3, 4],
    ] as const) {
      const before = Date.now();
      const outcome = await run(parent);
      expect(outcome).toMatchObject({ result: 'retry', error: 'PAYMENT_PROVIDER_UNAVAILABLE', failures });
      const { retryAt } = outcome as Extract<ReconcileOutcome, { result: 'retry' }>;
      expect(retryAt.getTime()).toBeGreaterThanOrEqual(before + delayMin * MIN - 5_000);
      expect(retryAt.getTime()).toBeLessThanOrEqual(Date.now() + delayMin * MIN + 5_000);
      const retry = (await reconcileJobs(placed.orderId)).find((j) => j.id === reconcileRetryJobId(parent.id, failures));
      expect(retry).toMatchObject({ data: { orderId: placed.orderId, failures }, startAfter: retryAt, state: 'created' });
      parent = retry!;
    }
    expect(await run(parent)).toEqual({ result: 'stopped', reason: 'failed', error: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    expect(await reconcileJobs(placed.orderId)).toHaveLength(4);
    expect(alertsOf(placed.code)).toMatchObject([
      { level: 50, reason: 'failed', error: 'PAYMENT_PROVIDER_UNAVAILABLE', failures: 4, orderCode: placed.code },
    ]);
    expect(lookupsOf(placed.code)).toHaveLength(4);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    await expectInvariants(h, placed.eventId);
  });

  it('job tra lại chạy lại không nhân đôi chuỗi; tra được thì đếm lỗi về 0 (mốc kế failures 0)', async () => {
    const placed = await place(1);
    fake.merchant(MAIN.clientId).behavior = 'error';
    const job0 = await onlyJob(placed.orderId);
    expect(await run(job0)).toMatchObject({ result: 'retry', failures: 1 });
    expect(await run(job0)).toMatchObject({ result: 'retry', failures: 1 });
    const jobs = await reconcileJobs(placed.orderId);
    expect(jobs.map((j) => j.data.failures).sort()).toEqual([0, 1]);
    const retry = jobs.find((j) => j.data.failures === 1)!;
    expect(retry.id).toBe(reconcileRetryJobId(job0.id, 1));

    delete fake.merchant(MAIN.clientId).behavior;
    await elapse(placed.orderId, 200);
    const { attemptAt } = await anchorsOf(placed.orderId);
    const next = new Date(attemptAt.getTime() + 5 * MIN);
    expect(await run(retry)).toEqual({ result: 'checked', gatewayStatus: 'pending', branch: null, next });
    expect(await reconcileJobs(placed.orderId)).toContainEqual(
      expect.objectContaining({ id: reconcileJobId(placed.orderId, next), data: { orderId: placed.orderId, failures: 0 } }),
    );
  });

  it.each([
    ['không tìm thấy đơn (2004)', { code: '2004' }, 'order_not_found'],
    ['merchant bị khóa (1007)', { code: '1007' }, 'MERCHANT_SUSPENDED'],
    ['mã lạ', { code: '1006' }, 'PAYMENT_PROVIDER_UNAVAILABLE'],
    ['timeout', 'hang', 'PAYMENT_PROVIDER_UNAVAILABLE'],
    ['data không phải object', { code: '00', data: 'ok' }, 'invalid_result'],
    ['success thiếu providerTransactionCode', { code: '00', data: 'success-without-code' }, 'invalid_result'],
    ['kết quả của đơn khác', { code: '00', data: 'other-order' }, 'invalid_result'],
    ['trạng thái lạ', { code: '00', data: 'refunding' }, 'unknown_status'],
  ] as const)('Lỗi khi tra: %s → tra lại cùng mốc (failures 1), không lưu gì, Đơn không đổi', async (_name, reply, error) => {
    const placed = await place(1);
    const dataOf = (marker: unknown): unknown => {
      const base = { orderId: placed.code, amount: placed.total, paidAmount: null, providerTransactionCode: null, paidAt: null };
      if (marker === 'success-without-code') return { ...base, status: 'success', paidAmount: placed.total };
      if (marker === 'other-order') return { ...base, orderId: 'TK00000000', status: 'pending' };
      if (marker === 'refunding') return { ...base, status: 'refunding' };
      return marker;
    };
    fake.merchant(MAIN.clientId).orderReplies = [
      reply === 'hang' ? 'hang' : 'data' in reply ? { code: reply.code, data: dataOf(reply.data) } : { code: reply.code },
    ];
    const job = await onlyJob(placed.orderId);
    expect(await run(job)).toMatchObject({ result: 'retry', error, failures: 1 });
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect((await reconcileJobs(placed.orderId)).map((j) => j.data.failures).sort()).toEqual([0, 1]);
    expect(h.logs.lines.find((l) => l.orderCode === placed.code && l.error === error)).toMatchObject({ failures: 1 });
  });

  it('Lỗi không rõ của adapter → unexpected_error, log warn giữ nguyên nhân gốc (tên lớp lỗi, mã miền nếu có), không credential', async () => {
    const placed = await place(1);
    const failing = workerWith(true);
    // Lỗi lạ (không phải AppError) từ adapter.
    afterNextLookup = () => Promise.reject(new TypeError('hỏng'));
    const job = await onlyJob(placed.orderId);
    expect(await run(job, failing)).toMatchObject({ result: 'retry', error: 'unexpected_error', failures: 1 });
    expect(h.logs.lines.find((l) => l.orderCode === placed.code && l.error === 'TypeError')).toMatchObject({
      level: 40,
      organizationId: org.orgId,
    });
    expect(h.logs.text).not.toContain(MAIN.secretToken);
  });

  it('Hết mốc: mốc + 24 giờ xong, Tingee vẫn báo expired → dừng, không enqueue', async () => {
    const placed = await place(1);
    await expireByIpn(placed);
    fake.markExpired(placed.code);
    await elapse(placed.orderId, 24 * 3600 + 20 * 60);
    const before = await reconcileJobs(placed.orderId);

    // Trạng thái `expired` đã lưu từ IPN: kết quả tra là bản lặp (cùng khóa `(BTC, orderId, status)`).
    expect(await run({ id: randomUUID(), data: { orderId: placed.orderId, failures: 0 } })).toEqual({
      result: 'checked',
      gatewayStatus: 'expired',
      branch: 'duplicate',
      next: null,
    });
    expect(await reconcileJobs(placed.orderId)).toEqual(before);
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(1);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'expired', tickets: 0 });
    await expectInvariants(h, placed.eventId);
  });
});

describe('worker thật (pg-boss)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    // Job tra còn chờ của các test trên (và của lần chạy trước) không được chen vào.
    await boss.deleteQueuedJobs(QUEUE);
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(workerConfig({ TINGEE_BASE_URL: fake.url }))],
    }).compile();
    app = await moduleRef.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('Tingee fake không bao giờ gửi IPN → job tra của TX2 tới hạn → worker phát Vé qua Đối soát bù; job completed, không mốc kế', async () => {
    const placed = await place(2);
    fake.markPaid(placed.code);
    const job = await onlyJob(placed.orderId);
    // Tới hạn ngay thay vì chờ 2 phút.
    await h.db.pool.query('UPDATE pgboss.job SET start_after = now() WHERE name = $1 AND id = $2', [QUEUE, job.id]);

    await expect
      .poll(async () => (await orderState(h, placed.code)).status, { timeout: 20_000, interval: 200 })
      .toBe('paid');
    expect(await orderState(h, placed.code)).toMatchObject({ paid_source: 'reconciliation', tickets: 2 });
    await expect
      .poll(async () => (await reconcileJobs(placed.orderId))[0]?.state, { timeout: 10_000, interval: 200 })
      .toBe('completed');
    expect(await reconcileJobs(placed.orderId)).toHaveLength(1);
    expect(await buyerEmails(placed.orderId)).toEqual([{ kind: 'tickets', orderId: placed.orderId }]);
    expect(lookupsOf(placed.code)).toHaveLength(1);
    await expectInvariants(h, placed.eventId);
  });
});
