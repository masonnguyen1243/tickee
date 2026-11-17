import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ErrorCode, JobQueue } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HttpTingeeClient,
  PAYMENT_LINK_LATENCY_WINDOW_MS,
  PaymentLinkLatencyMonitor,
  TINGEE_CLIENT,
  TingeeModule,
  type PaymentLinkInput,
  type PaymentLinkLatencyAlertSettings,
  type TingeeClient,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import {
  OPS_ALERT_SYSTEM_SUBJECT,
  OpsAlertEmailWorker,
  OpsAlertKind,
  OpsAlertPayload,
  OpsAlertQueue,
  OpsAlerts,
} from '../../src/platform/alerts/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { createHarness, FakeEmailTransport, type Harness } from '../identity/harness.js';
import { fakeAccount, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 4.6-e, luật `payment_link_slow`: cửa sổ p95 (nearest-rank, 5 phút) thời lượng `create-link` của một instance api,
 * báo kênh `platform/alerts` trên Postgres thật và pg-boss thật (producer). Mỗi dòng của I/O Matrix nạp thẳng số đo vào
 * `PaymentLinkLatencyMonitor` (đồng hồ test); `HttpTingeeClient` trên Tingee fake kiểm chỉ `create-link` được nạp, đúng
 * số đo của histogram, mọi `outcome`; harness api kiểm cách nối từ cấu hình tới kênh. Dấu chống lặp trong DB theo đồng hồ
 * DB: mỗi test xóa dấu `payment_link_slow` trước.
 */

const A: TingeeCredential = { clientId: 'tg-latency-a-3f8d', secretToken: 'tg-latency-a-secret-Wd2Rt6Yp9' };
const account = fakeAccount({ accountName: 'PHAM THI LAN' });
const MIN = 60_000;
const DEFAULTS = { p95Ms: 2_000, minSamples: 20 };

let fake: TingeeFake;
let h: Harness;
let db: Database;
let boss: PgBoss;
let queue: OpsAlertQueue;
/** Đồng hồ (ms) của cửa sổ và của bộ nhớ chống lặp của các monitor dựng trong file. */
let clock = Date.now();
/** Job `payment_link_slow` đã có trước test. */
let seen = new Set<string>();

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...A, accounts: [account] }], hangMs: 5_000 });
  // Ngưỡng của harness chỉ dùng cho test cách nối (cấu hình → `TingeeModule` → adapter → kênh).
  h = await createHarness({ TINGEE_BASE_URL: fake.url, OPS_ALERT_LINK_P95_MS: 100, OPS_ALERT_LINK_MIN_SAMPLES: 2 });
  db = h.app.get<Database>(DATABASE);
  boss = h.app.get<PgBoss>(BOSS);
  queue = h.app.get(OpsAlertQueue);
  await queue.ready();
});
beforeEach(async () => {
  clock += 2 * 60 * MIN;
  const merchant = fake.merchant(A.clientId);
  Object.assign(merchant, { linkReplies: [], orderReplies: [], tokenReplies: [], accountReplies: [], linkDelayMs: 0 });
  await db.pool.query('DELETE FROM ops_alert_marks WHERE kind = $1', [OpsAlertKind.PAYMENT_LINK_SLOW]);
  seen = new Set((await slowJobs(true)).map((job) => job.id));
});
afterAll(async () => {
  await h?.close();
  await fake?.close();
});

/** Job email `payment_link_slow` mới của test (bỏ job có trước test; `all`: mọi job). */
async function slowJobs(all = false) {
  const jobs = await boss.findJobs(JobQueue.OPS_ALERT, { data: { kind: OpsAlertKind.PAYMENT_LINK_SLOW } });
  return jobs.filter((job) => all || !seen.has(job.id)).map((job) => ({ id: job.id, data: OpsAlertPayload.parse(job.data) }));
}

/** Monitor mới (cửa sổ rỗng) với kênh mới (bộ nhớ chống lặp rỗng), cùng đồng hồ test. */
const newMonitor = (settings: Omit<PaymentLinkLatencyAlertSettings, 'now'> = DEFAULTS) =>
  new PaymentLinkLatencyMonitor(new OpsAlerts(db, boss, queue, { cooldownMinutes: 30, now: () => clock }), {
    ...settings,
    now: () => clock,
  });

/** Nạp `seconds` (giây) `count` lần, cách nhau 5 giây. */
async function feed(monitor: PaymentLinkLatencyMonitor, seconds: number, count = 1, outcome = 'ok') {
  for (let i = 0; i < count; i++) {
    await monitor.record(seconds, outcome);
    clock += 5_000;
  }
}

const linkInput = (): PaymentLinkInput => {
  const orderId = `TKLAT${randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    orderId,
    amount: 300_000,
    vaAccountNumber: String(account.vaAccountNumber),
    expireInMinute: 15,
    returnUrl: `http://web.tickee.test/orders/${orderId}`,
    description: `Thanh toán Đơn ${orderId}`,
  };
};

describe('luật payment_link_slow (I/O Matrix)', () => {
  it('Tạo link chậm: 20 lần create_link, 2 lần ≥ 2,5 giây → một email, p95Ms ≥ 2500, samples 20', async () => {
    expect(PAYMENT_LINK_LATENCY_WINDOW_MS).toBe(5 * MIN);
    const monitor = newMonitor();
    for (let i = 0; i < 18; i++) await feed(monitor, 0.2 + i * 0.01);
    await feed(monitor, 2.5, 1, 'ok');
    // 19 lần: p95 đã vượt nhưng chưa đủ 20 mẫu.
    expect(monitor.stats()).toEqual({ samples: 19, p95Ms: 2_500 });
    expect(await slowJobs()).toEqual([]);

    await feed(monitor, 5.0, 1, 'timeout');
    expect(monitor.stats()).toEqual({ samples: 20, p95Ms: 2_500 });
    const jobs = await slowJobs();
    expect(jobs.map((job) => job.data)).toEqual([
      {
        kind: OpsAlertKind.PAYMENT_LINK_SLOW,
        count: 1,
        subjects: [OPS_ALERT_SYSTEM_SUBJECT],
        details: { p95Ms: 2_500, samples: 20, thresholdMs: 2_000, windowMinutes: 5 },
      },
    ]);

    const email = new FakeEmailTransport();
    await new OpsAlertEmailWorker(boss, email, { recipients: ['van-hanh@tickee.test'] }).deliver(jobs[0]!.data);
    expect(email.sent[0]!.subject).toBe('[Tickee vận hành] Tạo link thanh toán chậm');
    for (const part of ['Loại: payment_link_slow', 'p95Ms: 2500', 'samples: 20', OPS_ALERT_SYSTEM_SUBJECT]) {
      expect(email.sent[0]!.text, part).toContain(part);
    }
  });

  it('Ít mẫu: 19 lần đều 3 giây → không báo', async () => {
    const monitor = newMonitor();
    await feed(monitor, 3, 19);
    expect(monitor.stats()).toEqual({ samples: 19, p95Ms: 3_000 });
    expect(await slowJobs()).toEqual([]);
  });

  it('20 lần, chỉ 1 lần chậm (p95 là lần nhanh) hay p95 đúng bằng ngưỡng → không báo: p95 phải vượt ngưỡng', async () => {
    const oneSlow = newMonitor();
    await feed(oneSlow, 0.4, 19);
    await feed(oneSlow, 9);
    expect(oneSlow.stats()).toEqual({ samples: 20, p95Ms: 400 });

    const atThreshold = newMonitor();
    await feed(atThreshold, 2, 20);
    expect(atThreshold.stats()).toEqual({ samples: 20, p95Ms: 2_000 });
    expect(await slowJobs()).toEqual([]);
  });

  it('so p95 chưa làm tròn với ngưỡng: 20 lần 2,0004 giây (p95 2000,4 ms > 2000) → báo, p95Ms làm tròn 2000', async () => {
    const monitor = newMonitor();
    await feed(monitor, 2.0004, 20);
    expect((await slowJobs()).map((job) => job.data.details)).toEqual([
      { p95Ms: 2_000, samples: 20, thresholdMs: 2_000, windowMinutes: 5 },
    ]);
  });

  it('cửa sổ 5 phút: 19 lần chậm, 6 phút sau thêm 1 lần chậm → chỉ 1 mẫu trong cửa sổ, không báo', async () => {
    const monitor = newMonitor();
    await feed(monitor, 3, 19);
    clock += 6 * MIN;
    await feed(monitor, 3);
    expect(monitor.stats()).toEqual({ samples: 1, p95Ms: 3_000 });
    expect(await slowJobs()).toEqual([]);
  });

  it('còn chậm sau khi báo: trong cooldown không gửi thêm (cả instance khác); hết cooldown mà vẫn chậm → báo lại', async () => {
    const monitor = newMonitor();
    await feed(monitor, 3, 20);
    await feed(monitor, 3, 10);
    expect(await slowJobs()).toHaveLength(1);
    const other = newMonitor();
    await feed(other, 3, 20);
    expect(await slowJobs()).toHaveLength(1);

    clock += 31 * MIN;
    await db.pool.query(
      "UPDATE ops_alert_marks SET raised_at = raised_at - interval '31 minutes' WHERE kind = $1 AND subject = $2",
      [OpsAlertKind.PAYMENT_LINK_SLOW, OPS_ALERT_SYSTEM_SUBJECT],
    );
    await feed(monitor, 2.6, 20);
    const jobs = await slowJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[1]!.data.details).toMatchObject({ p95Ms: 2_600, samples: 20 });
  });

  it('ghi nhận không bao giờ ném: kênh lỗi → log warn; số đo không hợp lệ bị bỏ', async () => {
    const monitor = new PaymentLinkLatencyMonitor(
      {
        raise: () => {
          throw new Error('kênh hỏng');
        },
      } as unknown as OpsAlerts,
      { p95Ms: 1, minSamples: 1, now: () => clock },
    );
    const warns = () =>
      h.logs.lines.filter(
        (l) =>
          l.context === 'PaymentLinkLatencyMonitor' &&
          l.msg === 'Không ghi nhận được thời lượng tạo link cho cảnh báo vận hành',
      );
    const before = warns().length;
    await expect(monitor.record(3, 'ok')).resolves.toBeUndefined();
    expect(warns().slice(before)).toEqual([expect.objectContaining({ level: 40, error: { type: 'Error' } })]);
    await monitor.record(Number.NaN, 'ok');
    await monitor.record(-1, 'ok');
    expect(monitor.stats()).toEqual({ samples: 1, p95Ms: 3_000 });
  });
});

describe('HttpTingeeClient nạp cửa sổ p95', () => {
  it('get_order, get_token_balance, get_va_paging chậm (timeout) → không nạp; create_link (cả timeout) → nạp đúng số đo, báo', async () => {
    const monitor = newMonitor({ p95Ms: 50, minSamples: 1 });
    const recorded: { seconds: number; outcome: string }[] = [];
    const pending: Promise<void>[] = [];
    const client = new HttpTingeeClient({
      baseUrl: fake.url,
      paymentLinkTimeoutMs: 300,
      orderStatusTimeoutMs: 300,
      tokenBalanceTimeoutMs: 300,
      serviceStatusTimeoutMs: 300,
      timeoutMs: 300,
      onPaymentLinkDuration: (seconds, outcome) => {
        recorded.push({ seconds, outcome });
        pending.push(monitor.record(seconds, outcome));
      },
    });
    const merchant = fake.merchant(A.clientId);
    merchant.orderReplies = ['hang'];
    merchant.tokenReplies = ['hang'];
    merchant.accountReplies = ['hang', 'hang'];
    await expect(client.getGatewayOrder(A, 'TKLAT0000001')).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    });
    expect(await client.getTokenBalance(A)).toEqual({ status: 'unavailable' });
    expect(await client.getMerchantServiceStatus(A)).toEqual({ status: 'unknown' });
    await expect(client.listAccounts(A)).rejects.toMatchObject({ code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE });
    expect(recorded).toEqual([]);
    expect(monitor.stats()).toEqual({ samples: 0, p95Ms: null });
    expect(await slowJobs()).toEqual([]);

    // create_link treo → timeout (kết quả mơ hồ): vẫn nạp, kèm outcome `timeout`.
    merchant.linkReplies = ['hang'];
    await expect(client.createPaymentLink(A, linkInput())).rejects.toMatchObject({ outcome: 'ambiguous', reason: 'timeout' });
    // create_link bị từ chối và thành công: cũng nạp.
    merchant.linkReplies = [{ code: '1006' }];
    await expect(client.createPaymentLink(A, linkInput())).rejects.toMatchObject({ outcome: 'rejected' });
    expect(await client.createPaymentLink(A, linkInput())).toMatch(/^https?:\/\//);
    await Promise.all(pending);

    expect(recorded.map((r) => r.outcome)).toEqual(['timeout', 'rejected', 'ok']);
    expect(recorded[0]!.seconds).toBeGreaterThanOrEqual(0.29);
    // Đơn vị giây (timeout 300 ms; lời gọi nhanh tới fake): không bao giờ là mili giây.
    for (const { seconds } of recorded) expect(seconds).toBeLessThan(1);
    expect(monitor.stats().samples).toBe(3);
    const jobs = await slowJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data.details).toMatchObject({ samples: 1, thresholdMs: 50 });
    expect(jobs[0]!.data.details.p95Ms).toBeGreaterThanOrEqual(290);
  });

  it('bên nhận số đo ném lỗi → tạo link vẫn trả checkout URL như cũ', async () => {
    const client = new HttpTingeeClient({
      baseUrl: fake.url,
      onPaymentLinkDuration: () => {
        throw new Error('bên nhận hỏng');
      },
    });
    expect(await client.createPaymentLink(A, linkInput())).toMatch(/^https?:\/\//);
  });
});

describe('cách nối', () => {
  it('vai api: TingeeModule có PaymentLinkLatencyMonitor theo OPS_ALERT_LINK_*; adapter của app nạp create_link và báo qua kênh', async () => {
    const monitor = h.app.get(PaymentLinkLatencyMonitor);
    expect(monitor).toBeInstanceOf(PaymentLinkLatencyMonitor);
    const client = h.app.get<TingeeClient>(TINGEE_CLIENT);
    const before = monitor.stats().samples;
    fake.merchant(A.clientId).linkDelayMs = 150;
    await client.createPaymentLink(A, linkInput());
    expect(monitor.stats().samples).toBe(before + 1);
    // Fake hoãn 150 ms: p95 (ms) quanh đó, không lệch đơn vị.
    expect(monitor.stats().p95Ms).toBeGreaterThanOrEqual(150);
    expect(monitor.stats().p95Ms).toBeLessThan(1_000);
    // Ngưỡng của harness: p95 > 100 ms khi có từ 2 lần gọi.
    await client.createPaymentLink(A, linkInput());
    await expect.poll(async () => (await slowJobs()).length, { timeout: 5_000, interval: 50 }).toBe(1);
    expect((await slowJobs())[0]!.data.details).toMatchObject({ thresholdMs: 100 });
  });

  it('không cấu hình linkLatencyAlert (vai worker) → không có cửa sổ p95, adapter vẫn dựng được', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TingeeModule.forRoot({ baseUrl: fake.url })] }).compile();
    try {
      expect(moduleRef.get(TINGEE_CLIENT)).toBeInstanceOf(HttpTingeeClient);
      expect(() => moduleRef.get(PaymentLinkLatencyMonitor)).toThrow();
    } finally {
      await moduleRef.close();
    }
  });
});
