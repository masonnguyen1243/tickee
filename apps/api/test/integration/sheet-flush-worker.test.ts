import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GOOGLE_SHEET_ORDER_STATUSES, JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleSheetsClient, type CellBlock } from '../../src/modules/integration/google-client.js';
import { IntegrationJobsModule } from '../../src/modules/integration/index.js';
import { GOOGLE_SHEETS_CLIENT } from '../../src/modules/integration/integration.config.js';
import { sheetOrderRow } from '../../src/modules/integration/sheet-rows.js';
import { answerColumnsOf, answersOfOrders, eventOrdersPageOf } from '../../src/modules/ordering/index.js';
import { checkinCountsOfOrders, enqueueSheetRowChanged, SHEET_ROW_CHANGED_QUEUE } from '../../src/modules/ticketing/index.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { SlidingWindow } from '../../src/platform/alerts/index.js';
import { DATABASE, DbModule, type Database } from '../../src/platform/db/index.js';
import { BOSS, JobsModule } from '../../src/platform/jobs/index.js';
import { startGoogleFake, type GoogleFake } from '../google-fake/server.js';
import { databaseUrl, workerConfig } from '../helpers.js';
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
} from '../ordering/order-fixtures.js';
import { orderState, postIpn } from '../payment/ipn-fixtures.js';
import { sleep } from '../platform/sse-client.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';
import {
  connectionStateOf,
  connectSheet,
  dirtyOf,
  discardPendingSheetJobs,
  flushJobsOf,
  freeSheetEvent,
  googleUrlsOf,
  randomOrderCode,
  SHEETS_CLIENT_ID,
  SHEETS_CLIENT_SECRET,
  type SheetEnv,
} from './sheet-fixtures.js';

/*
 * Story 6.5 với worker pg-boss thật (chỉ `IntegrationJobsModule`, cửa sổ debounce rút ngắn còn `W` = 3 giây qua tùy chọn
 * của module) và Google fake: AC thanh toán qua IPN (Tingee fake) lên Sheet trong `W` + 10 giây; debounce (nhiều thay đổi
 * trong một cửa sổ → hai lượt flush, không mất gì); policy `singleton` (không hai lượt flush cùng kết nối song song);
 * dead-letter khi hết lượt retry; P95 từ lúc Đơn `paid` tới lúc dòng xuất hiện ≤ `W` + 5 giây.
 */

/** Cửa sổ debounce rút ngắn của test (giây). */
const W = 3;

const MAIN: TingeeCredential = { clientId: 'tg-sheet-worker-9b2d', secretToken: 'tg-sheet-worker-secret-Zx3Cv2Bn1' };
const account = fakeAccount({ accountName: 'VO MINH KHOA' });
const PAYOUT: PayoutSpec = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};

/**
 * Client Google ghi lại lượt flush: từ lúc đọc cột Mã Đơn (chỉ flush đọc) tới lúc ghi ô xong, theo spreadsheet. Đếm số
 * lượt đang chạy cùng lúc lớn nhất; `writeDelayMs` làm chậm lần ghi để hai khe chồng lên nhau.
 */
class TracingClient extends GoogleSheetsClient {
  readonly inFlight = new Map<string, number>();
  readonly maxInFlight = new Map<string, number>();
  readonly passes = new Map<string, number>();
  writeDelayMs = new Map<string, number>();

  override async readColumn(...args: Parameters<GoogleSheetsClient['readColumn']>): Promise<string[]> {
    const [, spreadsheetId] = args;
    const now = (this.inFlight.get(spreadsheetId) ?? 0) + 1;
    this.inFlight.set(spreadsheetId, now);
    this.maxInFlight.set(spreadsheetId, Math.max(now, this.maxInFlight.get(spreadsheetId) ?? 0));
    this.passes.set(spreadsheetId, (this.passes.get(spreadsheetId) ?? 0) + 1);
    return super.readColumn(...args);
  }

  override async writeCells(accessToken: string, spreadsheetId: string, blocks: readonly CellBlock[]): Promise<void> {
    try {
      const delay = this.writeDelayMs.get(spreadsheetId);
      if (delay) await sleep(delay);
      await super.writeCells(accessToken, spreadsheetId, blocks);
    } finally {
      this.inFlight.set(spreadsheetId, (this.inFlight.get(spreadsheetId) ?? 1) - 1);
    }
  }
}

let google: GoogleFake;
let tingee: TingeeFake;
let h: Harness;
let org: Org;
let env: SheetEnv;
let tracing: TracingClient;
let worker: INestApplicationContext;
let workerBoss: PgBoss;

beforeAll(async () => {
  google = await startGoogleFake({ clientId: SHEETS_CLIENT_ID, clientSecret: SHEETS_CLIENT_SECRET });
  tingee = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: tingee.url, ...googleUrlsOf(google) });
  org = await paidReadyOrg(h, { name: 'CLB Bơi Phú Mỹ Hưng', credential: MAIN, payout: PAYOUT });
  env = { h, fake: google, org };
  await SHEET_ROW_CHANGED_QUEUE.ensure(h.app.get<PgBoss>(BOSS));
  // Job tồn đọng của các file test trước không được chạy trước job của file này.
  await discardPendingSheetJobs(h);

  tracing = new TracingClient({
    clientId: SHEETS_CLIENT_ID,
    clientSecret: SHEETS_CLIENT_SECRET,
    authorizeUrl: google.authorizeUrl,
    tokenUrl: google.tokenUrl,
    sheetsApiUrl: google.url,
  });
  const connectionString = databaseUrl();
  const moduleRef = await Test.createTestingModule({
    imports: [
      DbModule.forRoot({ connectionString, applicationName: 'tickee-worker-sheets-test' }),
      JobsModule.forRoot({ connectionString, applicationName: 'tickee-worker-sheets-test' }),
      IntegrationJobsModule.forRoot(workerConfig(googleUrlsOf(google)), { flushWindowSeconds: W }),
    ],
  })
    .overrideProvider(GOOGLE_SHEETS_CLIENT)
    .useValue(tracing)
    .compile();
  worker = await moduleRef.init();
  workerBoss = worker.get<PgBoss>(BOSS);
}, 180_000);
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await worker.close();
  await h.close();
  await tingee.close();
  await google.close();
});

/** Kết nối qua api; worker đẩy đầu xong (`active`): id kết nối, id spreadsheet và refresh token của grant. */
async function connected(eventId: string): Promise<{ connectionId: string; spreadsheetId: string; grant: string }> {
  const connectionId = await connectSheet(env, eventId);
  const grant = google.issued.refreshTokens.at(-1)!;
  await expect.poll(async () => (await connectionStateOf(h, connectionId))?.status, { timeout: 25_000, interval: 200 }).toBe(
    'active',
  );
  return { connectionId, spreadsheetId: (await connectionStateOf(h, connectionId))!.spreadsheet_id!, grant };
}

/** Mã Đơn đang có trên Sheet (cột A của Sheet mới), bỏ tiêu đề. */
const codesOn = (spreadsheetId: string): string[] =>
  google
    .values(spreadsheetId)
    .slice(1)
    .map((row) => String(row[0] ?? ''));

/**
 * Một Đơn `paid` mới (chèn bằng SQL) và job `sheet_row_changed` của nó trong cùng transaction, như `markPaid` enqueue:
 * trả mã Đơn và mốc commit (ms).
 */
async function paidOrder(eventId: string): Promise<{ code: string; id: string; committedAt: number }> {
  const db = h.app.get<Database>(DATABASE);
  const boss = h.app.get<PgBoss>(BOSS);
  const id = randomUUID();
  const code = randomOrderCode();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO orders (id, code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                          buyer_email, idempotency_key, expires_at, paid_at, paid_amount, paid_source)
      VALUES (${id}, ${code}, gen_random_uuid(), ${eventId}, ${org.orgId}, 'paid', 0, 'Người mua thử tải',
              '+84987654321', 'tai@vidu.vn', gen_random_uuid(), now(), now(), 0, 'free')`);
    await enqueueSheetRowChanged(boss, tx, { eventId, orderId: id });
  });
  return { code, id, committedAt: Date.now() };
}

/** Chờ tới đầu khe debounce kế tiếp (+ `afterMs`), để các thay đổi gửi liền nhau cùng nằm trong một khe. */
async function atSlotStart(afterMs = 100): Promise<void> {
  const windowMs = W * 1_000;
  await sleep(windowMs - (Date.now() % windowMs) + afterMs);
}

describe('worker thật: flush theo debounce', () => {
  it('cấu hình queue: flush policy singleton, retry như lần đẩy đầu, có dead-letter; sheet_row_changed có dead-letter', async () => {
    expect(await workerBoss.getQueue(JobQueue.INTEGRATION_SHEET_FLUSH)).toMatchObject({
      policy: 'singleton',
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      deadLetter: JobQueue.INTEGRATION_SHEET_FLUSH_DEAD_LETTER,
    });
    expect(await workerBoss.getQueue(JobQueue.INTEGRATION_SHEET_ROW_CHANGED)).toMatchObject({
      deadLetter: JobQueue.INTEGRATION_SHEET_ROW_CHANGED_DEAD_LETTER,
    });
  });

  it(`AC: Đơn thanh toán qua IPN (Tingee fake) → dòng của Đơn xuất hiện ở cuối Sheet trong W + 10 giây, giá trị như lần đẩy đầu`, async () => {
    const sale = await eventOnSale(org, [{ name: 'Vé bơi', price: 90_000, capacity: 10 }]);
    const { spreadsheetId } = await connected(sale.event.id);
    const buyer = await signUp(h);
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 2 }]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const placed = parseOrder(res.body);

    const ipnKey = await ipnKeyOf(h, org.orgId);
    const paidAt = Date.now();
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload(placed.code, placed.totalAmount))).expect(200);
    const { id, status } = await orderState(h, placed.code);
    expect(status).toBe('paid');
    await expect.poll(() => codesOn(spreadsheetId).at(-1), { timeout: (W + 10) * 1_000, interval: 100 }).toBe(placed.code);
    expect(Date.now() - paidAt).toBeLessThanOrEqual((W + 10) * 1_000);

    // Cùng hàm dựng dòng với lần đẩy đầu, trên trạng thái hiện tại qua read model.
    const scope = { organizationId: org.orgId };
    const page = await eventOrdersPageOf(h.db.orm, scope, sale.event.id, {
      orderIds: [id],
      statuses: GOOGLE_SHEET_ORDER_STATUSES,
      limit: 1,
    });
    const [answers, checkins, columns] = await Promise.all([
      answersOfOrders(h.db.orm, [id]),
      checkinCountsOfOrders(h.db.orm, scope, sale.event.id, [id]),
      answerColumnsOf(h.db.orm, scope, sale.event.id),
    ]);
    const expected = sheetOrderRow(page.orders[0]!, { answers: answers.get(id), checkin: checkins.get(id) }, columns);
    expect(google.values(spreadsheetId).at(-1)).toEqual(expected);
    expect(expected.slice(5, 8)).toEqual([180000, 180000, 'Đã thanh toán']);
  }, 60_000);

  it('nhiều thay đổi trong một cửa sổ → hai lượt flush (khe hiện tại rồi khe kế), không mất thay đổi nào', async () => {
    const sale = await freeSheetEvent(org);
    const { connectionId, spreadsheetId } = await connected(sale.event.id);
    await atSlotStart();
    const orders = [];
    for (let i = 0; i < 10; i++) orders.push(await paidOrder(sale.event.id));
    await expect
      .poll(() => new Set(codesOn(spreadsheetId)), { timeout: (2 * W + 10) * 1_000, interval: 200 })
      .toEqual(new Set(orders.map((order) => order.code)));
    await expect
      .poll(async () => (await flushJobsOf(h, connectionId)).map((job) => job.state), { timeout: 15_000, interval: 200 })
      .toEqual(['completed', 'completed']);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
    expect(codesOn(spreadsheetId)).toHaveLength(10);
  }, 60_000);

  it('không bao giờ hai lượt flush của cùng kết nối chạy song song (lượt khe kế chờ lượt đang ghi chậm)', async () => {
    const sale = await freeSheetEvent(org);
    const { connectionId, spreadsheetId } = await connected(sale.event.id);
    // Mỗi lần ghi dài hơn một cửa sổ: job của khe kế tới hạn khi lượt trước vẫn đang chạy.
    tracing.writeDelayMs.set(spreadsheetId, (W + 1.5) * 1_000);
    try {
      const first = await paidOrder(sale.event.id);
      await expect.poll(() => tracing.inFlight.get(spreadsheetId) ?? 0, { timeout: 10_000, interval: 50 }).toBe(1);
      const second = await paidOrder(sale.event.id);
      await sleep(1_500);
      const third = await paidOrder(sale.event.id);
      await expect
        .poll(() => new Set(codesOn(spreadsheetId)), { timeout: 40_000, interval: 200 })
        .toEqual(new Set([first.code, second.code, third.code]));
      expect(tracing.maxInFlight.get(spreadsheetId)).toBe(1);
      expect(tracing.passes.get(spreadsheetId)).toBeGreaterThanOrEqual(2);
      // Mỗi Đơn đúng một dòng: không lượt nào thêm trùng một Đơn vào cuối Sheet.
      expect(codesOn(spreadsheetId)).toHaveLength(3);
      await expect.poll(async () => dirtyOf(h, connectionId), { timeout: 15_000, interval: 200 }).toEqual(new Map());
    } finally {
      tracing.writeDelayMs.delete(spreadsheetId);
    }
  }, 60_000);

  it('Google lỗi tạm thời hết lượt retry → job flush vào dead-letter; kết nối retrying, dòng bẩn còn', async () => {
    const sale = await freeSheetEvent(org);
    const { connectionId, grant } = await connected(sale.event.id);
    const { rows } = await h.db.pool.query<{ id: string }>(
      `INSERT INTO orders (id, code, user_id, event_id, organization_id, status, total_amount, buyer_name, buyer_phone,
                           buyer_email, idempotency_key, expires_at, paid_at, paid_amount, paid_source)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, $3, 'paid', 0, 'Người mua', '+84987654321', 'a@vidu.vn',
               gen_random_uuid(), now(), now(), 0, 'free') RETURNING id`,
      [randomOrderCode(), sale.event.id, org.orgId],
    );
    const orderId = rows[0]!.id;
    await h.db.pool.query('INSERT INTO sheet_dirty_rows (connection_id, order_id) VALUES ($1, $2)', [connectionId, orderId]);
    google.scriptSheets(grant, { status: 500 }, { status: 500 });
    // Job cùng việc với 0 lượt retry (như job thật đã dùng hết 5 lượt).
    const jobId = await workerBoss.send(JobQueue.INTEGRATION_SHEET_FLUSH, { connectionId }, { retryLimit: 0, singletonKey: connectionId });
    expect(jobId).toBeTruthy();
    await expect
      .poll(async () => (await workerBoss.getJobById(JobQueue.INTEGRATION_SHEET_FLUSH, jobId!))?.state, {
        timeout: 15_000,
        interval: 100,
      })
      .toBe('failed');
    expect(JSON.stringify((await workerBoss.getJobById(JobQueue.INTEGRATION_SHEET_FLUSH, jobId!))?.output)).toContain(
      'server_error',
    );
    await expect
      .poll(
        async () =>
          (await workerBoss.findJobs(JobQueue.INTEGRATION_SHEET_FLUSH_DEAD_LETTER, { data: { connectionId } })).length,
        { timeout: 10_000, interval: 100 },
      )
      .toBe(1);
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'retrying', last_error_code: 'server_error' });
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[orderId, 1]]));
  }, 60_000);

  it(`P95 từ lúc Đơn paid tới lúc dòng xuất hiện ≤ W + 5 giây: 30 Đơn rải ngẫu nhiên qua 3 cửa sổ`, async () => {
    const sale = await freeSheetEvent(org);
    const { spreadsheetId } = await connected(sale.event.id);
    const seen = new Map<string, number>();
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        const now = Date.now();
        for (const code of codesOn(spreadsheetId)) if (!seen.has(code)) seen.set(code, now);
        await sleep(50);
      }
    })();
    try {
      const offsets = Array.from({ length: 30 }, () => Math.random() * 3 * W * 1_000).sort((a, b) => a - b);
      const start = Date.now();
      const orders: { code: string; committedAt: number }[] = [];
      await Promise.all(
        offsets.map(async (offset) => {
          await sleep(Math.max(0, start + offset - Date.now()));
          orders.push(await paidOrder(sale.event.id));
        }),
      );
      await expect.poll(() => orders.every((order) => seen.has(order.code)), { timeout: (W + 15) * 1_000, interval: 100 }).toBe(true);
      const latencies = new SlidingWindow({ windowMs: 3_600_000 });
      for (const order of orders) latencies.add('flush', seen.get(order.code)! - order.committedAt);
      const p95 = latencies.percentile(95)!;
      expect(p95, `P95 = ${p95} ms`).toBeLessThanOrEqual((W + 5) * 1_000);
      expect(codesOn(spreadsheetId)).toHaveLength(30);
    } finally {
      watching = false;
      await watcher;
    }
  }, 90_000);
});
