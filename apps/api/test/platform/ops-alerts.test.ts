import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue } from '@tickee/contracts';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXPIRE_ORDER_QUEUE } from '../../src/modules/ordering/order-jobs.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import {
  deadLetterRule,
  OPS_ALERT_QUEUE,
  OPS_ALERT_SCAN_CRON,
  OpsAlertEmailWorker,
  OpsAlertKind,
  OpsAlertPayload,
  OpsAlertQueue,
  OpsAlertRules,
  OpsAlerts,
  OpsAlertScanWorker,
  platformOpsAlertRules,
  type OpsAlertDetails,
} from '../../src/platform/alerts/index.js';
import { DATABASE, Database } from '../../src/platform/db/index.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS, JOB_COMPLETED } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { migrationDatabaseUrl, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, type Harness } from '../identity/harness.js';
import { ipnKeyOf, paidReadyOrg, type Org } from '../ordering/order-fixtures.js';
import { ACK_TEXT, paymentEventsOf, postIpn, reviewItemsOf } from '../payment/ipn-fixtures.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 4.6-b: kênh cảnh báo vận hành trên Postgres thật và pg-boss thật (vai api: producer, không worker nền chen vào).
 * `raise` (dấu chống lặp `once` / `cooldown`, bộ nhớ của instance, không bao giờ ném), email (`OpsAlertEmailWorker.deliver`
 * gọi thẳng), job quét (`OpsAlertScanWorker.scan` gọi thẳng, luật pg-boss và registry) và mọi dòng của I/O Matrix; dòng
 * link chia sẻ (hai instance, DB lỗi) ở `ticketing/qr-key-rotation.test.ts`. Mốc thời gian lùi bằng `now() - interval`
 * trên DB (đồng hồ DB vẫn thật); đồng hồ của bộ nhớ chống lặp (`OpsAlertSettings.now`) do test tự tiến. Khối cuối chạy
 * worker thật (lịch cron, job email xong không retry).
 */

const MAIN: TingeeCredential = { clientId: 'tg-ops-main-5c1e', secretToken: 'tg-ops-main-secret-Wq3Er5Ty7' };
const account = fakeAccount({ accountName: 'TRAN VAN BINH' });
const OPS_RECIPIENTS = ['van-hanh@tickee.test', 'truc-dem@tickee.test'];
const WARN_NO_RECIPIENTS = 'Chưa đặt OPS_ALERT_EMAILS: không gửi email cảnh báo vận hành';
const WARN_RAISE_FAILED = 'Không ghi được cảnh báo vận hành; bỏ qua lần báo này';
const MIN = 60_000;

let fake: TingeeFake;
let h: Harness;
let boss: PgBoss;
let db: Database;
let queue: OpsAlertQueue;
let org: Org;
let ipnKey: string;
/** Đồng hồ (ms) của bộ nhớ chống lặp mọi `OpsAlerts` của file này. */
let clock = Date.now();

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  boss = h.app.get<PgBoss>(BOSS);
  db = h.app.get<Database>(DATABASE);
  queue = h.app.get(OpsAlertQueue);
  await queue.ready();
  org = await paidReadyOrg(h, {
    name: 'CLB Cầu lông Thủ Đức',
    credential: MAIN,
    payout: {
      vaAccountNumber: String(account.vaAccountNumber),
      accountName: String(account.accountName),
      bankName: String(account.bankName),
    },
  });
  ipnKey = await ipnKeyOf(h, org.orgId);
});
beforeEach(() => {
  clock = Date.now();
});
afterAll(async () => {
  await h?.close();
  await fake?.close();
});

/** Một instance mới của kênh (bộ nhớ chống lặp rỗng), như một tiến trình api/worker khác. */
const newAlerts = (cooldownMinutes = 30) => new OpsAlerts(db, boss, queue, { cooldownMinutes, now: () => clock });

/** Job quét trên DB và pg-boss của test, với kênh `alerts` và registry `rules` (mặc định hai luật pg-boss). */
const newScanner = (alerts = newAlerts(), rules = platformOpsAlertRules({ queueWaitMinutes: 5 })) =>
  new OpsAlertScanWorker(db, boss, alerts, rules);

/** Job email cảnh báo vận hành có `data` chứa `filter`, theo thứ tự tạo. */
async function alertJobs(filter: Record<string, unknown>) {
  const jobs = await boss.findJobs(JobQueue.OPS_ALERT, { data: filter });
  return jobs.map((job) => ({ id: job.id, state: job.state, data: OpsAlertPayload.parse(job.data) }));
}

/** `raised_at` của dấu `(kind, subject)`; `null` khi chưa có dấu. */
async function markOf(kind: string, subject: string): Promise<Date | null> {
  const { rows } = await db.pool.query<{ raised_at: Date }>(
    'SELECT raised_at FROM ops_alert_marks WHERE kind = $1 AND subject = $2',
    [kind, subject],
  );
  return rows[0]?.raised_at ?? null;
}

/** Giả lập thời gian trôi cho dấu: lùi `raised_at` `minutes` phút (đồng hồ DB vẫn thật). */
const backdateMark = (kind: string, subject: string, minutes: number) =>
  db.pool.query(
    'UPDATE ops_alert_marks SET raised_at = raised_at - make_interval(mins => $3) WHERE kind = $1 AND subject = $2',
    [kind, subject, minutes],
  );

/** Lùi `start_after` của job pg-boss `minutes` phút (âm: đẩy về tương lai), đổi trạng thái nếu cần. */
const shiftJob = (name: string, id: string, minutes: number, state: 'created' | 'retry' = 'created') =>
  db.pool.query(
    `UPDATE pgboss.job SET start_after = now() - make_interval(mins => $3), state = $4::pgboss.job_state
      WHERE name = $1 AND id = $2`,
    [name, id, minutes, state],
  );

/** Dòng log `error` kèm `alert` của kênh (không phải marker của mô-đun). */
const channelAlertLogs = (kind: string) => h.logs.lines.filter((l) => l.context === 'OpsAlerts' && l.alert === kind);

/** Thu/cấp lại INSERT của `tickee_app` trên bảng dấu: giả DB lỗi chỉ cho `raise`. */
async function withMarksInsertRevoked<T>(fn: () => Promise<T>): Promise<T> {
  const migrator = new pg.Client({ connectionString: migrationDatabaseUrl() });
  await migrator.connect();
  try {
    await migrator.query('REVOKE INSERT ON TABLE ops_alert_marks FROM tickee_app');
    return await fn();
  } finally {
    await migrator.query('GRANT INSERT ON TABLE ops_alert_marks TO tickee_app');
    await migrator.end();
  }
}

/** Queue thử của test (xóa ở cuối test). */
async function testQueue(suffix = ''): Promise<string> {
  const name = `test.ops-alert-${randomUUID()}${suffix}`;
  await boss.createQueue(name);
  return name;
}

const sendJob = async (name: string, data: object = {}): Promise<string> => {
  const id = await boss.send(name, data);
  if (!id) throw new Error('pg-boss không tạo job');
  return id;
};

describe('raise', () => {
  it('once: mỗi subject chỉ báo một lần (cả với instance khác); job mang details, số subject mới, tối đa 20 subject mới; log error kèm alert', async () => {
    const alerts = newAlerts();
    const subjects = Array.from({ length: 25 }, () => randomUUID()).sort();
    const details: OpsAlertDetails = { queue: `test.once-${randomUUID()}.dead-letter` };
    // Trùng và rỗng bị bỏ.
    expect(await alerts.raise({ kind: OpsAlertKind.DEAD_LETTER, subjects: [...subjects, subjects[3]!, ''], details })).toEqual(
      subjects,
    );
    const first = { kind: OpsAlertKind.DEAD_LETTER, count: 25, subjects: subjects.slice(0, 20), details };
    expect((await alertJobs({ details })).map((job) => job.data)).toEqual([first]);
    for (const subject of subjects) expect(await markOf(OpsAlertKind.DEAD_LETTER, subject)).not.toBeNull();
    const logged = channelAlertLogs(OpsAlertKind.DEAD_LETTER).filter(
      (l) => (l.details as { queue?: string } | undefined)?.queue === details.queue,
    );
    expect(logged).toEqual([
      expect.objectContaining({
        level: 50,
        msg: 'Cảnh báo vận hành: Job vào dead-letter',
        count: 25,
        subjects: subjects.slice(0, 20),
        details,
        notify: true,
      }),
    ]);

    // Chỉ subject mới; instance khác cũng thấy dấu trong DB.
    const extra = randomUUID();
    expect(await alerts.raise({ kind: OpsAlertKind.DEAD_LETTER, subjects: [...subjects, extra], details })).toEqual([extra]);
    expect(await newAlerts().raise({ kind: OpsAlertKind.DEAD_LETTER, subjects: [...subjects, extra], details })).toEqual([]);
    // Loại `once` không có bộ nhớ: dấu cũ bao lâu cũng không báo lại.
    await backdateMark(OpsAlertKind.DEAD_LETTER, extra, 24 * 60);
    expect(await alerts.raise({ kind: OpsAlertKind.DEAD_LETTER, subjects: [extra], details })).toEqual([]);
    expect((await alertJobs({ details })).map((job) => job.data)).toEqual([
      first,
      { kind: OpsAlertKind.DEAD_LETTER, count: 1, subjects: [extra], details },
    ]);
    expect(channelAlertLogs(OpsAlertKind.DEAD_LETTER).filter((l) => (l.details as { queue?: string }).queue === details.queue)).toHaveLength(2);
  });

  it('nhiều hơn 1.000 subject (nhiều câu INSERT dấu): trả đủ, một job với số đếm đủ và 20 subject, đủ dấu', async () => {
    const subjects = Array.from({ length: 1_001 }, () => randomUUID()).sort();
    const details: OpsAlertDetails = { queue: `test.chunk-${randomUUID()}.dead-letter` };
    expect(await newAlerts().raise({ kind: OpsAlertKind.DEAD_LETTER, subjects, details })).toEqual(subjects);
    expect((await alertJobs({ details })).map((job) => job.data)).toEqual([
      { kind: OpsAlertKind.DEAD_LETTER, count: 1_001, subjects: subjects.slice(0, 20), details },
    ]);
    const { rows } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ops_alert_marks WHERE kind = 'dead_letter' AND subject = ANY($1::text[])",
      [subjects],
    );
    expect(rows[0]!.n).toBe(1_001);
  });

  it('cooldown: instance vừa raise bỏ qua trong bộ nhớ (không ghi DB); instance khác bỏ qua theo dấu DB; hết cooldown thì gửi lại', async () => {
    const kind = OpsAlertKind.TICKET_QR_KEY_MISSING;
    const subject = `test-${randomUUID()}`;
    const details: OpsAlertDetails = { qrKeyVersion: 1, currentVersion: 2, ticketId: randomUUID() };
    const a = newAlerts();
    const b = newAlerts();
    expect(await a.raise({ kind, subjects: [subject], details })).toEqual([subject]);
    // Instance khác, dấu còn trong cooldown: bỏ.
    expect(await b.raise({ kind, subjects: [subject], details })).toEqual([]);

    // Dấu đã quá cooldown, nhưng hai instance vừa raise subject này: bỏ ngay trong bộ nhớ, dấu không đổi.
    await backdateMark(kind, subject, 31);
    const old = await markOf(kind, subject);
    expect(await a.raise({ kind, subjects: [subject], details })).toEqual([]);
    expect(await b.raise({ kind, subjects: [subject], details })).toEqual([]);
    expect(await markOf(kind, subject)).toEqual(old);
    // Không chạm DB: xóa dấu cũng không làm instance vừa raise báo lại.
    await db.pool.query('DELETE FROM ops_alert_marks WHERE kind = $1 AND subject = $2', [kind, subject]);
    expect(await a.raise({ kind, subjects: [subject], details })).toEqual([]);
    expect(await markOf(kind, subject)).toBeNull();
    await db.pool.query('INSERT INTO ops_alert_marks (kind, subject, raised_at) VALUES ($1, $2, $3)', [kind, subject, old]);

    // 31 phút sau (bộ nhớ hết hạn, dấu quá cooldown): gửi lại, dấu cập nhật; instance kia thấy dấu mới thì bỏ.
    clock += 31 * MIN;
    expect(await a.raise({ kind, subjects: [subject], details })).toEqual([subject]);
    expect((await markOf(kind, subject))!.getTime()).toBeGreaterThan(old!.getTime());
    expect(await b.raise({ kind, subjects: [subject], details })).toEqual([]);
    expect((await alertJobs({ kind, subjects: [subject] })).map((job) => job.data)).toEqual([
      { kind, count: 1, subjects: [subject], details },
      { kind, count: 1, subjects: [subject], details },
    ]);
  });

  it('Hai instance (I/O Matrix): cùng raise đồng thời một subject cooldown → đúng một subject mới, một email', async () => {
    const kind = OpsAlertKind.TICKET_QR_KEY_MISSING;
    const subject = `test-${randomUUID()}`;
    const results = await Promise.all(
      [newAlerts(), newAlerts(), newAlerts()].map((alerts) => alerts.raise({ kind, subjects: [subject] })),
    );
    expect(results.flat()).toEqual([subject]);
    expect(await alertJobs({ kind, subjects: [subject] })).toHaveLength(1);
  });

  it('notify: false → chỉ ghi dấu và log error (notify false), không enqueue email', async () => {
    const subject = randomUUID();
    const details: OpsAlertDetails = { queue: JobQueue.OPS_ALERT_DEAD_LETTER };
    expect(await newAlerts().raise({ kind: OpsAlertKind.DEAD_LETTER, subjects: [subject], details, notify: false })).toEqual([
      subject,
    ]);
    expect(await markOf(OpsAlertKind.DEAD_LETTER, subject)).not.toBeNull();
    expect(await alertJobs({ subjects: [subject] })).toEqual([]);
    expect(channelAlertLogs(OpsAlertKind.DEAD_LETTER).find((l) => (l.subjects as string[]).includes(subject))).toMatchObject({
      level: 50,
      notify: false,
    });
  });

  it('không bao giờ ném: DB không kết nối được, chi tiết sai dạng → trả [], log warn (không giá trị); không dấu, không email', async () => {
    const broken = new Database({ connectionString: 'postgresql://tickee_app:sai@127.0.0.1:1/tickee_test', max: 1 });
    try {
      const subject = randomUUID();
      const alerts = new OpsAlerts(broken, boss, queue, { cooldownMinutes: 30 });
      await expect(alerts.raise({ kind: OpsAlertKind.PAYMENT_UNMATCHED, subjects: [subject] })).resolves.toEqual([]);
      const secret = `bi-mat-${randomUUID()}`;
      await expect(
        newAlerts().raise({ kind: OpsAlertKind.PAYMENT_RECONCILIATION_STOPPED, subjects: [subject], details: { 'khóa lạ': secret } }),
      ).resolves.toEqual([]);
      const warns = h.logs.lines.filter((l) => l.msg === WARN_RAISE_FAILED);
      expect(warns.find((l) => l.kind === OpsAlertKind.PAYMENT_UNMATCHED)).toMatchObject({ level: 40, context: 'OpsAlerts' });
      expect(warns.find((l) => l.kind === OpsAlertKind.PAYMENT_RECONCILIATION_STOPPED)).toMatchObject({
        level: 40,
        error: { type: 'ZodError' },
      });
      expect(h.logs.text).not.toContain(secret);
      expect(await markOf(OpsAlertKind.PAYMENT_UNMATCHED, subject)).toBeNull();
      expect(await markOf(OpsAlertKind.PAYMENT_RECONCILIATION_STOPPED, subject)).toBeNull();
      expect(await alertJobs({ subjects: [subject] })).toEqual([]);
    } finally {
      await broken.close();
    }
  });
});

describe('email', () => {
  const payload: OpsAlertPayload = {
    kind: OpsAlertKind.DEAD_LETTER,
    count: 23,
    subjects: Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    details: { queue: 'test.<b>&.dead-letter', note: null },
  };

  it('tiêu đề [Tickee vận hành] <tiêu đề loại>; loại, chi tiết, số mục mới, tối đa 20 subject; HTML escape; một email cho mọi người nhận', async () => {
    const email = new FakeEmailTransport();
    const worker = new OpsAlertEmailWorker(boss, email, { recipients: OPS_RECIPIENTS });
    expect(await worker.deliver(payload)).toEqual(JOB_COMPLETED);
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0]!;
    expect(message.to).toBe(OPS_RECIPIENTS.join(', '));
    expect(message.subject).toBe('[Tickee vận hành] Job vào dead-letter');
    for (const part of ['Loại: dead_letter', 'queue: test.<b>&.dead-letter', '23 mục mới', '… và 3 mục khác', ...payload.subjects]) {
      expect(message.text, part).toContain(part);
    }
    // Chi tiết `null` không hiện.
    expect(message.text).not.toContain('note');
    expect(message.html).toContain('test.&lt;b&gt;&amp;.dead-letter');
    expect(message.html).not.toContain('<b>&');
    for (const subject of payload.subjects) expect(message.html).toContain(subject);
  });

  it('Không người nhận (I/O Matrix): job dead-letter mới → có dấu, log error kèm alert, rồi job chỉ log warn và xong; worker warn một lần lúc khởi động', async () => {
    const deadLetter = await testQueue('.dead-letter');
    try {
      const jobId = await sendJob(deadLetter);
      await newScanner().scan();
      expect(await markOf(OpsAlertKind.DEAD_LETTER, jobId)).not.toBeNull();
      expect(channelAlertLogs(OpsAlertKind.DEAD_LETTER).find((l) => (l.subjects as string[]).includes(jobId))).toMatchObject({
        level: 50,
        details: { queue: deadLetter },
      });
      const [job] = await alertJobs({ details: { queue: deadLetter } });
      expect(job?.data).toEqual({ kind: OpsAlertKind.DEAD_LETTER, count: 1, subjects: [jobId], details: { queue: deadLetter } });

      const email = new FakeEmailTransport();
      const warnsBefore = h.logs.lines.filter((l) => l.msg === WARN_NO_RECIPIENTS).length;
      expect(await new OpsAlertEmailWorker(boss, email, { recipients: [] }).deliver(job!.data)).toEqual(JOB_COMPLETED);
      expect(email.sent).toEqual([]);
      const warns = h.logs.lines.filter((l) => l.msg === WARN_NO_RECIPIENTS);
      expect(warns).toHaveLength(warnsBefore + 1);
      expect(warns.at(-1)).toMatchObject({ level: 40, count: 1 });
    } finally {
      await boss.deleteQueue(deadLetter);
    }

    // Warn lúc khởi động chỉ khi không có người nhận (boss giả: chỉ đăng ký, không nhận job).
    const fakeBoss = { createQueue: async () => undefined, updateQueue: async () => undefined, work: async () => 'w' };
    const startupWarns = () =>
      h.logs.lines.filter((l) => l.msg === 'Chưa đặt OPS_ALERT_EMAILS: cảnh báo vận hành chỉ ghi log, không gửi email').length;
    const before = startupWarns();
    await new OpsAlertEmailWorker(fakeBoss as unknown as PgBoss, new FakeEmailTransport(), { recipients: [] }).onApplicationBootstrap();
    expect(startupWarns()).toBe(before + 1);
    await new OpsAlertEmailWorker(fakeBoss as unknown as PgBoss, new FakeEmailTransport(), {
      recipients: OPS_RECIPIENTS,
    }).onApplicationBootstrap();
    expect(startupWarns()).toBe(before + 1);
  });

  it('gửi lỗi → ném lỗi chỉ mang tên lớp (không địa chỉ email) để pg-boss retry; queue retryLimit 8, có dead-letter', async () => {
    const email = new FakeEmailTransport();
    email.failWith = new Error(`SMTP tạm hỏng ${OPS_RECIPIENTS[0]}`);
    const failure = await new OpsAlertEmailWorker(boss, email, { recipients: OPS_RECIPIENTS })
      .deliver(payload)
      .catch((err: unknown) => err as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Không gửi được email cảnh báo vận hành (Error)');
    expect((failure as Error).message).not.toContain(OPS_RECIPIENTS[0]);

    expect(await boss.getQueue(JobQueue.OPS_ALERT)).toMatchObject({
      name: JobQueue.OPS_ALERT,
      deadLetter: JobQueue.OPS_ALERT_DEAD_LETTER,
      retryLimit: 8,
      retryBackoff: true,
    });
    expect(OPS_ALERT_QUEUE.queueOptions).toMatchObject({ retryLimit: 8, deadLetter: JobQueue.OPS_ALERT_DEAD_LETTER });
    expect((await boss.getQueue(JobQueue.OPS_ALERT_DEAD_LETTER))?.name).toBe(JobQueue.OPS_ALERT_DEAD_LETTER);
  });
});

describe('job quét', () => {
  it('Dead-letter (I/O Matrix): 3 job vào ordering.send-buyer-email.dead-letter → email nêu 3 jobId; lượt kế không gửi; thêm 1 job → email chỉ nêu job mới', async () => {
    const deadLetter = JobQueue.ORDERING_SEND_BUYER_EMAIL_DEAD_LETTER;
    await boss.createQueue(deadLetter);
    const scanner = newScanner();
    // Job dead-letter còn lại của file khác: lượt đầu báo hết, để các bước dưới chỉ thấy job của test này.
    await scanner.scan();
    const before = (await alertJobs({ details: { queue: deadLetter } })).length;
    const ids: string[] = [];
    try {
      for (let i = 0; i < 3; i++) ids.push(await sendJob(deadLetter, { kind: 'tickets', orderId: randomUUID() }));
      await scanner.scan();
      let jobs = await alertJobs({ details: { queue: deadLetter } });
      expect(jobs).toHaveLength(before + 1);
      expect(jobs.at(-1)!.data).toEqual({
        kind: OpsAlertKind.DEAD_LETTER,
        count: 3,
        subjects: [...ids].sort(),
        details: { queue: deadLetter },
      });

      await scanner.scan();
      await newScanner().scan();
      expect(await alertJobs({ details: { queue: deadLetter } })).toHaveLength(before + 1);

      const fourth = await sendJob(deadLetter, { kind: 'tickets', orderId: randomUUID() });
      ids.push(fourth);
      await scanner.scan();
      jobs = await alertJobs({ details: { queue: deadLetter } });
      expect(jobs).toHaveLength(before + 2);
      expect(jobs.at(-1)!.data).toMatchObject({ count: 1, subjects: [fourth] });
    } finally {
      await boss.deleteJob(deadLetter, ids);
    }
  });

  it('Kênh tự lỗi (I/O Matrix): job platform.ops-alert vào dead-letter → quét chỉ log error (một lần), không gửi email', async () => {
    const jobId = await sendJob(JobQueue.OPS_ALERT_DEAD_LETTER, { kind: 'dead_letter' });
    try {
      const scanner = newScanner();
      await scanner.scan();
      await scanner.scan();
      expect(await markOf(OpsAlertKind.DEAD_LETTER, jobId)).not.toBeNull();
      const logged = channelAlertLogs(OpsAlertKind.DEAD_LETTER).filter((l) => (l.subjects as string[]).includes(jobId));
      expect(logged).toEqual([
        expect.objectContaining({ level: 50, notify: false, details: { queue: JobQueue.OPS_ALERT_DEAD_LETTER } }),
      ]);
      expect(await alertJobs({ subjects: [jobId] })).toEqual([]);
      expect(await alertJobs({ details: { queue: JobQueue.OPS_ALERT_DEAD_LETTER } })).toEqual([]);
    } finally {
      await boss.deleteJob(JobQueue.OPS_ALERT_DEAD_LETTER, jobId);
    }
  });

  it('Hàng đợi ùn (I/O Matrix): job ordering.expire-order tới hạn 6 phút chưa chạy → một email nêu tên queue; lượt kế không gửi; 30 phút sau gửi lại nếu vẫn ùn', async () => {
    const name = JobQueue.ORDERING_EXPIRE_ORDER;
    await EXPIRE_ORDER_QUEUE.ensure(boss);
    await db.pool.query("DELETE FROM ops_alert_marks WHERE kind = 'queue_backlog' AND subject = $1", [name]);
    const before = (await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] })).length;
    const jobId = await sendJob(name, { orderId: randomUUID() });
    try {
      await shiftJob(name, jobId, 6);
      const scanner = newScanner();
      await scanner.scan();
      let jobs = await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] });
      expect(jobs).toHaveLength(before + 1);
      const { details } = jobs.at(-1)!.data;
      expect(jobs.at(-1)!.data).toMatchObject({ count: 1, subjects: [name], details: { queue: name, thresholdMinutes: 5 } });
      expect(details.waiting).toBeGreaterThanOrEqual(1);
      expect(details.waitMinutes).toBeGreaterThanOrEqual(6);

      await scanner.scan();
      await newScanner().scan();
      expect(await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] })).toHaveLength(before + 1);

      // 30 phút sau (dấu và bộ nhớ quá cooldown), vẫn ùn.
      await backdateMark(OpsAlertKind.QUEUE_BACKLOG, name, 31);
      clock += 31 * MIN;
      await scanner.scan();
      jobs = await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] });
      expect(jobs).toHaveLength(before + 2);
    } finally {
      await boss.deleteJob(name, jobId);
    }
  });

  it('Job hoãn (I/O Matrix): retry có start_after ở tương lai, job chưa quá ngưỡng, queue dead-letter → không báo ùn; retry quá ngưỡng → báo', async () => {
    const deferred = await testQueue();
    const recent = await testQueue();
    const overdue = await testQueue();
    const deadLetter = await testQueue('.dead-letter');
    try {
      await shiftJob(deferred, await sendJob(deferred), -10, 'retry');
      await shiftJob(recent, await sendJob(recent), 4);
      await shiftJob(overdue, await sendJob(overdue), 6, 'retry');
      await shiftJob(deadLetter, await sendJob(deadLetter), 60);
      await newScanner().scan();
      for (const name of [deferred, recent, deadLetter]) {
        expect(await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] }), name).toEqual([]);
        expect(await markOf(OpsAlertKind.QUEUE_BACKLOG, name), name).toBeNull();
      }
      expect((await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [overdue] })).map((j) => j.data)).toEqual([
        {
          kind: OpsAlertKind.QUEUE_BACKLOG,
          count: 1,
          subjects: [overdue],
          details: { queue: overdue, waiting: 1, waitMinutes: 6, thresholdMinutes: 5 },
        },
      ]);
    } finally {
      for (const name of [deferred, recent, overdue, deadLetter]) await boss.deleteQueue(name);
    }
  });

  it('dead-letter nhiều queue trong một lượt: mỗi queue một email chỉ nêu job của nó; platform.ops-alert.dead-letter chỉ log', async () => {
    const first = await testQueue('.dead-letter');
    const second = await testQueue('.dead-letter');
    const own = await sendJob(JobQueue.OPS_ALERT_DEAD_LETTER, { kind: 'dead_letter' });
    try {
      const firstIds = [await sendJob(first), await sendJob(first)].sort();
      const secondIds = [await sendJob(second)];
      const before = (await alertJobs({ details: { queue: JobQueue.OPS_ALERT_DEAD_LETTER } })).length;
      await newScanner().scan();
      expect((await alertJobs({ details: { queue: first } })).map((job) => job.data)).toEqual([
        { kind: OpsAlertKind.DEAD_LETTER, count: 2, subjects: firstIds, details: { queue: first } },
      ]);
      expect((await alertJobs({ details: { queue: second } })).map((job) => job.data)).toEqual([
        { kind: OpsAlertKind.DEAD_LETTER, count: 1, subjects: secondIds, details: { queue: second } },
      ]);
      expect(await markOf(OpsAlertKind.DEAD_LETTER, own)).not.toBeNull();
      expect(await alertJobs({ subjects: [own] })).toEqual([]);
      expect(await alertJobs({ details: { queue: JobQueue.OPS_ALERT_DEAD_LETTER } })).toHaveLength(before);
      expect(channelAlertLogs(OpsAlertKind.DEAD_LETTER).find((l) => (l.subjects as string[]).includes(own))).toMatchObject({
        notify: false,
        details: { queue: JobQueue.OPS_ALERT_DEAD_LETTER },
      });
    } finally {
      await boss.deleteJob(JobQueue.OPS_ALERT_DEAD_LETTER, own);
      for (const name of [first, second]) await boss.deleteQueue(name);
    }
  });

  it('chính platform.ops-alert ùn → chỉ ghi dấu và log error (notify false), không enqueue email vào queue đang ùn', async () => {
    const name = JobQueue.OPS_ALERT;
    await db.pool.query("DELETE FROM ops_alert_marks WHERE kind = 'queue_backlog' AND subject = $1", [name]);
    const before = await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] });
    const jobId = await sendJob(name, {
      kind: OpsAlertKind.DEAD_LETTER,
      count: 1,
      subjects: [randomUUID()],
      details: { queue: `test.backlog-${randomUUID()}.dead-letter` },
    });
    try {
      await shiftJob(name, jobId, 6);
      await newScanner().scan();
      expect(await markOf(OpsAlertKind.QUEUE_BACKLOG, name)).not.toBeNull();
      expect(await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [name] })).toEqual(before);
      expect(
        channelAlertLogs(OpsAlertKind.QUEUE_BACKLOG).findLast((l) => (l.subjects as string[]).includes(name)),
      ).toMatchObject({ level: 50, notify: false, details: { queue: name } });
    } finally {
      await boss.deleteJob(name, jobId);
    }
  });

  it('một luật lỗi chỉ log warn, các luật còn lại vẫn chạy; tên luật không trùng', async () => {
    const rules = new OpsAlertRules();
    const ran: string[] = [];
    rules.register({
      name: 'test_broken',
      check: async () => {
        throw new Error('luật hỏng');
      },
    });
    rules.register({
      name: 'test_ok',
      check: async ({ alerts }) => {
        ran.push('test_ok');
        await alerts.raise({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [`test-${randomUUID()}`] });
      },
    });
    rules.register(deadLetterRule);
    expect(() => rules.register({ name: 'test_ok', check: async () => undefined })).toThrow('đã đăng ký');

    const outcomes = await newScanner(newAlerts(), rules).scan();
    expect([...outcomes]).toEqual([
      ['test_broken', 'error'],
      ['test_ok', 'ok'],
      ['dead_letter', 'ok'],
    ]);
    expect(ran).toEqual(['test_ok']);
    expect(h.logs.lines.find((l) => l.rule === 'test_broken')).toMatchObject({
      level: 40,
      context: 'OpsAlertScanWorker',
      error: { type: 'Error' },
      msg: 'Luật cảnh báo vận hành lỗi; lượt quét sau chạy lại',
    });
  });

  it('mỗi lượt quét xóa dấu cũ hơn 30 ngày', async () => {
    const old = randomUUID();
    const kept = randomUUID();
    await db.pool.query(
      `INSERT INTO ops_alert_marks (kind, subject, raised_at)
       VALUES ('dead_letter', $1, now() - interval '31 days'), ('dead_letter', $2, now() - interval '29 days')`,
      [old, kept],
    );
    await newScanner(newAlerts(), new OpsAlertRules()).scan();
    expect(await markOf(OpsAlertKind.DEAD_LETTER, old)).toBeNull();
    expect(await markOf(OpsAlertKind.DEAD_LETTER, kept)).not.toBeNull();
  });
});

describe('Tiền không khớp (I/O Matrix)', () => {
  const unmatchedCode = () => `TK${randomUUID().replace(/[^0-9]/g, '').slice(0, 8).padEnd(8, '7')}`;

  it('IPN order_not_found → log như cũ, kèm một email có organizationId, id payment_events và mã Đơn; IPN lặp không gửi thêm', async () => {
    const code = unmatchedCode();
    const payload = fakeIpnPayload(code, 75_000);
    const signed = signIpn(MAIN.secretToken, payload);
    const res = await postIpn(h, ipnKey, signed).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    const [event] = await paymentEventsOf(h, org.orgId, code);
    expect(event).toBeDefined();
    // Marker giữ nguyên: một dòng error có `alert`, nhánh và mục Cần xử lý.
    expect(h.logs.lines.filter((l) => l.paymentEventId === event!.id)).toEqual([
      expect.objectContaining({ level: 50, alert: 'payment_unmatched', branch: 'order_not_found', organizationId: org.orgId }),
    ]);
    expect(channelAlertLogs(OpsAlertKind.PAYMENT_UNMATCHED).filter((l) => (l.subjects as string[]).includes(event!.id))).toHaveLength(1);

    const jobs = await alertJobs({ kind: OpsAlertKind.PAYMENT_UNMATCHED, subjects: [event!.id] });
    expect(jobs.map((job) => job.data)).toEqual([
      {
        kind: OpsAlertKind.PAYMENT_UNMATCHED,
        count: 1,
        subjects: [event!.id],
        details: {
          organizationId: org.orgId,
          paymentEventId: event!.id,
          orderCode: code,
          providerTransactionCode: String(payload.providerTransactionCode),
          source: 'ipn',
          reason: 'order_not_found',
        },
      },
    ]);
    const email = new FakeEmailTransport();
    await new OpsAlertEmailWorker(boss, email, { recipients: OPS_RECIPIENTS }).deliver(jobs[0]!.data);
    const message = email.sent[0]!;
    expect(message.subject).toBe('[Tickee vận hành] Tiền về không khớp Đơn');
    for (const part of [org.orgId, event!.id, code, String(payload.providerTransactionCode)]) {
      expect(message.text, part).toContain(part);
    }
    for (const secret of [MAIN.secretToken, ipnKey, String(payload.customerEmail), signed.headers['x-signature']]) {
      expect(`${message.subject}${message.text}${message.html}`, 'không secret, chữ ký hay email').not.toContain(secret);
    }

    // IPN lặp: `duplicate`, không tạo mục, không gửi thêm.
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, payload)).expect(200);
    expect(await alertJobs({ kind: OpsAlertKind.PAYMENT_UNMATCHED, subjects: [event!.id] })).toHaveLength(1);
  });

  it('DB lỗi khi raise (I/O Matrix): IPN vẫn trả 200 00 như cũ, vẫn tạo mục Cần xử lý; raise chỉ log warn', async () => {
    const code = unmatchedCode();
    const res = await withMarksInsertRevoked(() =>
      postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload(code, 50_000))),
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe(ACK_TEXT);
    const [event] = await paymentEventsOf(h, org.orgId, code);
    expect(await reviewItemsOf(h, { paymentEventId: event!.id })).toEqual([
      expect.objectContaining({ organization_id: org.orgId, order_id: null, type: 'unmatched', status: 'open' }),
    ]);
    expect(h.logs.lines.filter((l) => l.paymentEventId === event!.id)).toEqual([
      expect.objectContaining({ level: 50, alert: 'payment_unmatched' }),
    ]);
    expect(
      h.logs.lines.filter((l) => l.msg === WARN_RAISE_FAILED && l.kind === OpsAlertKind.PAYMENT_UNMATCHED).at(-1),
    ).toMatchObject({ level: 40, error: { code: '42501' } });
    expect(await markOf(OpsAlertKind.PAYMENT_UNMATCHED, event!.id)).toBeNull();
    expect(await alertJobs({ subjects: [event!.id] })).toEqual([]);
  });
});

describe('worker thật', () => {
  let app: INestApplicationContext;
  /** Transport giả của worker: nhận mọi email cảnh báo vận hành worker gửi. */
  const workerEmail = new FakeEmailTransport();
  /** Email worker đã gửi có nhắc `text` (vd. id job dead-letter của test). */
  const sentWith = (text: string) => workerEmail.sent.filter((m) => m.text.includes(text));

  beforeAll(async () => {
    // Job email còn chờ của các test trên và của file khác: không để worker gửi lẫn vào.
    await boss.deleteQueuedJobs(JobQueue.OPS_ALERT);
    const config = workerConfig({ OPS_ALERT_EMAILS: OPS_RECIPIENTS, OPS_ALERT_QUEUE_WAIT_MINUTES: 10 });
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(config)] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(workerEmail)
      .compile();
    app = await moduleRef.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('lịch platform.ops-alert-scan mỗi phút; job email gửi tới OPS_ALERT_EMAILS rồi xong, không retry', async () => {
    const schedules = await boss.getSchedules();
    expect(schedules.find((s) => s.name === JobQueue.OPS_ALERT_SCAN)).toMatchObject({ cron: OPS_ALERT_SCAN_CRON });
    expect(OPS_ALERT_SCAN_CRON).toBe('* * * * *');
    expect(await boss.getQueue(JobQueue.OPS_ALERT_SCAN)).toMatchObject({ retryLimit: 0 });

    const details: OpsAlertDetails = { queue: `test.worker-${randomUUID()}.dead-letter` };
    const [subject] = await newAlerts().raise({ kind: OpsAlertKind.DEAD_LETTER, subjects: [randomUUID()], details });
    expect(subject).toBeDefined();
    const [job] = await alertJobs({ details });
    await expect
      .poll(async () => (await boss.getJobById(JobQueue.OPS_ALERT, job!.id))?.state, { timeout: 20_000, interval: 200 })
      .toBe('completed');
    expect((await boss.getJobById(JobQueue.OPS_ALERT, job!.id))?.retryCount).toBe(0);
    expect(sentWith(subject!).map((m) => m.to)).toEqual([OPS_RECIPIENTS.join(', ')]);
  });

  it('cron thật: job platform.ops-alert-scan (payload null) → quét → dấu cho job dead-letter mới → đúng một email tới OPS_ALERT_EMAILS', async () => {
    const deadLetter = await testQueue('.dead-letter');
    try {
      const jobId = await sendJob(deadLetter);
      const scanJobId = await boss.send(JobQueue.OPS_ALERT_SCAN, null);
      expect(scanJobId).toBeTruthy();
      await expect
        .poll(async () => (await boss.getJobById(JobQueue.OPS_ALERT_SCAN, scanJobId!))?.state, {
          timeout: 20_000,
          interval: 200,
        })
        .toBe('completed');
      expect(await markOf(OpsAlertKind.DEAD_LETTER, jobId)).not.toBeNull();
      await expect.poll(() => sentWith(jobId).length, { timeout: 20_000, interval: 200 }).toBe(1);
      const [message] = sentWith(jobId);
      expect(message).toMatchObject({ to: OPS_RECIPIENTS.join(', '), subject: '[Tickee vận hành] Job vào dead-letter' });
      expect(message!.text).toContain(deadLetter);
    } finally {
      await boss.deleteQueue(deadLetter);
    }
  });

  it('OPS_ALERT_QUEUE_WAIT_MINUTES của worker (10): job tới hạn 6 phút chưa báo ùn; 11 phút thì báo', async () => {
    const recent = await testQueue();
    const overdue = await testQueue();
    try {
      await shiftJob(recent, await sendJob(recent), 6);
      await shiftJob(overdue, await sendJob(overdue), 11);
      await app.get(OpsAlertScanWorker).scan();
      expect(await markOf(OpsAlertKind.QUEUE_BACKLOG, recent)).toBeNull();
      expect(await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [recent] })).toEqual([]);
      expect(await markOf(OpsAlertKind.QUEUE_BACKLOG, overdue)).not.toBeNull();
      expect((await alertJobs({ kind: OpsAlertKind.QUEUE_BACKLOG, subjects: [overdue] })).map((j) => j.data)).toMatchObject([
        { details: { queue: overdue, thresholdMinutes: 10 } },
      ]);
    } finally {
      for (const name of [recent, overdue]) await boss.deleteQueue(name);
    }
  });
});
