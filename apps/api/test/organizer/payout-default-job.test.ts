import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue, REAUTH_HEADER, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PAYOUT_QUEUE_OPTIONS,
  DefaultPayoutChangedPayload,
  DefaultPayoutQueues,
  enqueueDefaultPayoutChanged,
  notifyDefaultPayoutChanged,
} from '../../src/modules/organizer/payout-default-jobs.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, reauthToken, signUp, type Harness } from '../identity/harness.js';

/*
 * Job `organizer.notify-default-payout-changed` (Story 2.13-a, 2.13-b): mỗi lần tài khoản nhận tiền mặc định đổi (kể
 * cả đổi key Tingee khi BTC đã hủy hết tài khoản: `previousAccountId` null), worker gửi email cảnh báo cho Owner và mọi
 * Admin của BTC (tên BTC, 4 số cuối cũ → mới, người đổi, giờ Việt Nam). Job enqueue bằng chính `tx` của thay đổi:
 * rollback thì không có job, không có email. Email đi qua transport giả.
 */

const QUEUE = JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED;
const DEAD_LETTER = JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED_DEAD_LETTER;
/** Tên BTC có ký tự HTML; mỗi test một tên riêng (worker có thể gửi cả job còn lại của test trước, cùng người nhận). */
const ORG_NAME = 'CLB <Cờ> & "Vua"';
let orgName: string;
let orgSeq = 0;

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admins: Awaited<ReturnType<typeof signUp>>[];
/** Có tài khoản nhưng không thuộc BTC: không bao giờ nhận email. */
let outsider: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
/** MB ••••1111 (mặc định), ACB ••••2222, VCB ••••3333. */
let accounts: { mb: string; acb: string; vcb: string };
let email: FakeEmailTransport;

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  admins = [await signUp(h), await signUp(h)];
  outsider = await signUp(h);
  await h.app.get(DefaultPayoutQueues).ready();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  email = new FakeEmailTransport();
  orgSeq += 1;
  orgName = `${ORG_NAME} ${orgSeq}`;
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: orgName }).expect(201)).body
    .id as string;
  for (const admin of admins) {
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
    );
  }
  // Credential và tài khoản chèn thẳng (không qua Tingee): job chỉ đọc DB.
  const credential = await h.db.orm.execute<{ id: string }>(
    sql`INSERT INTO tingee_credentials (organization_id, client_id, secret_token_ciphertext, created_by)
        VALUES (${orgId}, 'tg-client-job', 'v1:khong-dung', ${owner.userId}) RETURNING id`,
  );
  const insert = async (va: string, bankName: string, last4: string, isDefault: boolean) => {
    const { rows } = await h.db.orm.execute<{ id: string }>(
      sql`INSERT INTO payout_accounts (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name,
            account_type, account_last4, account_name, created_by, is_default)
          VALUES (${orgId}, ${credential.rows[0]!.id}, ${va}, '970422', ${bankName}, 'personal-account', ${last4},
            'CLB CO VUA', ${owner.userId}, ${isDefault}) RETURNING id`,
    );
    return rows[0]!.id;
  };
  accounts = {
    mb: await insert('9600001111', 'MB Bank', '1111', true),
    acb: await insert('9600002222', 'ACB', '2222', false),
    vcb: await insert('9600003333', 'Vietcombank', '3333', false),
  };
});

const payload = (overrides: Partial<DefaultPayoutChangedPayload> = {}): DefaultPayoutChangedPayload => ({
  organizationId: orgId,
  previousAccountId: accounts.mb,
  nextAccountId: accounts.acb,
  actorUserId: owner.userId,
  changedAt: '2026-11-08T03:04:00.000Z',
  ...overrides,
});
const notifier = () => ({ db: h.db, email });
const recipients = () => [owner.email, ...admins.map((a) => a.email)];

describe('notifyDefaultPayoutChanged', () => {
  it('gửi Owner và mọi Admin (không ai khác): tên BTC, ••••cũ → ••••mới, người đổi, giờ Việt Nam, lời khuyên', async () => {
    expect(await notifyDefaultPayoutChanged(notifier(), payload())).toBe(3);
    expect(email.sent.map((m) => m.to)).toEqual(recipients());
    expect(email.sent.some((m) => m.to === outsider.email)).toBe(false);

    const [message] = email.sent;
    expect(message?.subject).toBe(`Tài khoản nhận tiền mặc định của ${orgName} vừa đổi`);
    expect(message?.text).toContain(`Tài khoản nhận tiền mặc định của BTC ${orgName} trên Tickee vừa đổi:`);
    expect(message?.text).toContain('MB Bank ••••1111 → ACB ••••2222');
    expect(message?.text).toContain('Đơn mới sẽ nhận tiền vào ACB ••••2222.');
    // Tài khoản OTP chưa có tên: hiện email của người đổi.
    expect(message?.text).toContain(`Người đổi: ${owner.email}`);
    expect(message?.text).toContain('Thời điểm: 10:04 08/11/2026 (giờ Việt Nam)');
    expect(message?.text).toContain('Nếu không phải bạn hay Owner của BTC thực hiện thay đổi này');
    // HTML escape dữ liệu người dùng nhập.
    expect(message?.html).toContain(`CLB &lt;Cờ&gt; &amp; &quot;Vua&quot; ${orgSeq}`);
    expect(message?.html).not.toContain(ORG_NAME);
    expect(message?.html).toContain('MB Bank ••••1111 → ACB ••••2222');
    // Không bao giờ có số VA / số tài khoản đầy đủ.
    for (const m of email.sent) expect(`${m.text}${m.html}`).not.toMatch(/960000\d{4}/);
  });

  it('hủy tài khoản mặc định cuối cùng: "→ không còn tài khoản nhận tiền"; tài khoản đã hủy liên kết vẫn đọc được', async () => {
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET retired_at = now(), is_default = false WHERE organization_id = ${orgId}`,
    );
    expect(await notifyDefaultPayoutChanged(notifier(), payload({ nextAccountId: null }))).toBe(3);
    const [message] = email.sent;
    expect(message?.text).toContain('MB Bank ••••1111 → không còn tài khoản nhận tiền');
    expect(message?.text).toContain('BTC chưa bán được Vé có phí cho tới khi liên kết một tài khoản nhận tiền khác.');
  });

  it('đổi key Tingee khi BTC đã hủy hết (Story 2.13-b): "chưa có tài khoản nhận tiền → ACB ••••2222"', async () => {
    expect(await notifyDefaultPayoutChanged(notifier(), payload({ previousAccountId: null }))).toBe(3);
    const [message] = email.sent;
    expect(message?.text).toContain('chưa có tài khoản nhận tiền → ACB ••••2222');
    expect(message?.text).toContain('Đơn mới sẽ nhận tiền vào ACB ••••2222.');
    expect(message?.html).toContain('chưa có tài khoản nhận tiền → ACB ••••2222');
    expect(message?.text).not.toContain('MB Bank');
  });

  it('đổi key Tingee (reason tingee_key_replaced): tiêu đề và câu mở đầu nói key Tingee vừa đổi, mọi tài khoản cũ bị hủy liên kết; giữ dòng ••••cũ → ••••mới', async () => {
    expect(await notifyDefaultPayoutChanged(notifier(), payload({ reason: 'tingee_key_replaced' }))).toBe(3);
    expect(email.sent.map((m) => m.to)).toEqual(recipients());
    const [message] = email.sent;
    expect(message?.subject).toBe(`Key Tingee của ${orgName} vừa đổi`);
    expect(message?.text).toContain(
      `Key Tingee của BTC ${orgName} trên Tickee vừa đổi. Mọi tài khoản nhận tiền cũ đã bị hủy liên kết; tài khoản nhận tiền mặc định:`,
    );
    expect(message?.text).toContain('MB Bank ••••1111 → ACB ••••2222');
    expect(message?.text).toContain('Đơn mới sẽ nhận tiền vào ACB ••••2222.');
    expect(message?.text).not.toContain('Tài khoản nhận tiền mặc định của BTC');
    expect(message?.html).toContain(`Key Tingee của BTC <strong>CLB &lt;Cờ&gt; &amp; &quot;Vua&quot; ${orgSeq}</strong>`);
    expect(message?.html).toContain('Mọi tài khoản nhận tiền cũ đã bị hủy liên kết');
    expect(message?.html).toContain('MB Bank ••••1111 → ACB ••••2222');

    // BTC đã hủy hết rồi mới đổi key: "chưa có tài khoản nhận tiền → …".
    email.sent.length = 0;
    await notifyDefaultPayoutChanged(notifier(), payload({ reason: 'tingee_key_replaced', previousAccountId: null }));
    expect(email.sent[0]?.text).toContain('chưa có tài khoản nhận tiền → ACB ••••2222');
  });

  it('payload: reason mặc định default_changed (job tạo trước 2.13-b vẫn hợp lệ); reason lạ bị từ chối', () => {
    expect(DefaultPayoutChangedPayload.parse(payload()).reason).toBe('default_changed');
    expect(DefaultPayoutChangedPayload.parse(payload({ reason: 'tingee_key_replaced' })).reason).toBe(
      'tingee_key_replaced',
    );
    expect(DefaultPayoutChangedPayload.safeParse({ ...payload(), reason: 'khac' }).success).toBe(false);
  });

  it('payload: previousAccountId null được nhận; cả hai null thì không (không có gì đổi)', () => {
    expect(DefaultPayoutChangedPayload.safeParse(payload({ previousAccountId: null })).success).toBe(true);
    expect(DefaultPayoutChangedPayload.safeParse(payload({ nextAccountId: null })).success).toBe(true);
    expect(
      DefaultPayoutChangedPayload.safeParse(payload({ previousAccountId: null, nextAccountId: null })).success,
    ).toBe(false);
  });

  it('BTC hay tài khoản không còn (hoặc của BTC khác) → skipped, không gửi gì', async () => {
    expect(await notifyDefaultPayoutChanged(notifier(), payload({ organizationId: randomUUID() }))).toBe('skipped');
    expect(await notifyDefaultPayoutChanged(notifier(), payload({ previousAccountId: randomUUID() }))).toBe('skipped');
    expect(await notifyDefaultPayoutChanged(notifier(), payload({ nextAccountId: randomUUID() }))).toBe('skipped');
    expect(
      await notifyDefaultPayoutChanged(notifier(), payload({ previousAccountId: null, nextAccountId: randomUUID() })),
    ).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('SMTP lỗi → ném lỗi (pg-boss retry), lỗi không chứa địa chỉ email', async () => {
    email.failWith = new Error(`SMTP từ chối ${owner.email}`);
    const err = await notifyDefaultPayoutChanged(notifier(), payload()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('3/3');
    expect((err as Error).message).not.toContain(owner.email);
  });
});

describe('enqueue cùng transaction', () => {
  it('transaction rollback → không có job (nên không có email); commit → đúng một job', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    await expect(
      h.db.transaction(async (tx) => {
        await enqueueDefaultPayoutChanged(boss, tx, payload());
        throw new Error('thao tác lỗi');
      }),
    ).rejects.toThrow('thao tác lỗi');
    expect(await boss.findJobs(QUEUE, { data: { organizationId: orgId } })).toEqual([]);

    await h.db.transaction((tx) => enqueueDefaultPayoutChanged(boss, tx, payload()));
    const jobs = await boss.findJobs(QUEUE, { data: { organizationId: orgId } });
    // Payload lưu dạng đã parse: thiếu `reason` → `default_changed`.
    expect(jobs.map((j) => j.data)).toEqual([{ ...payload(), reason: 'default_changed' }]);
  });

  it('cấu hình queue: có retry (backoff) và dead-letter', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    expect((await boss.getQueue(DEAD_LETTER))?.name).toBe(DEAD_LETTER);
    const queue = await boss.getQueue(QUEUE);
    expect(queue).toMatchObject({
      name: QUEUE,
      deadLetter: DEAD_LETTER,
      retryLimit: DEFAULT_PAYOUT_QUEUE_OPTIONS.retryLimit,
      retryBackoff: true,
    });
    expect(queue?.retryLimit).toBeGreaterThan(0);
  });
});

describe('worker', () => {
  let worker: INestApplicationContext;
  let workerEmail: FakeEmailTransport;

  beforeAll(async () => {
    workerEmail = new FakeEmailTransport();
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(workerEmail)
      .compile();
    worker = await moduleRef.init();
  });
  afterAll(async () => {
    await worker.close();
  });

  /** Email cảnh báo của BTC hiện tại mà worker đã gửi (worker có thể xử lý job của test khác trong DB dùng chung). */
  const sentForOrg = () =>
    workerEmail.sent.filter((m) => m.subject === `Tài khoản nhận tiền mặc định của ${orgName} vừa đổi`);

  it('Owner đổi mặc định qua api (có xác nhận lại) → worker gửi Owner + 2 Admin, đúng 4 số cuối; job completed', async () => {
    const token = await reauthToken(h, owner);
    await h.http
      .post(`/v1/orgs/${orgId}/payout-account/${accounts.vcb}/default`)
      .set('cookie', owner.cookie)
      .set(REAUTH_HEADER, token)
      .expect(200);
    // Một job khác bị rollback trong lúc đó: không bao giờ thành email.
    await h.db
      .transaction(async (tx) => {
        await enqueueDefaultPayoutChanged(h.app.get<PgBoss>(BOSS), tx, payload({ nextAccountId: accounts.acb }));
        throw new Error('rollback');
      })
      .catch(() => undefined);

    await expect.poll(() => sentForOrg().length, { timeout: 15_000, interval: 100 }).toBe(3);
    expect(sentForOrg().map((m) => m.to).sort()).toEqual(recipients().sort());
    for (const m of sentForOrg()) expect(m.text).toContain('MB Bank ••••1111 → Vietcombank ••••3333');
    expect(sentForOrg().some((m) => m.text.includes('ACB ••••2222'))).toBe(false);

    const boss = worker.get<PgBoss>(BOSS);
    const [job] = await boss.findJobs(QUEUE, { data: { organizationId: orgId } });
    expect(job?.data).toMatchObject({ previousAccountId: accounts.mb, nextAccountId: accounts.vcb, actorUserId: owner.userId });
    await expect.poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 10_000 }).toBe('completed');
  });

  it('gửi email lỗi → job sang trạng thái retry (pg-boss thử lại), không mất cảnh báo', async () => {
    workerEmail.failWith = new Error(`SMTP tạm hỏng ${owner.email}`);
    try {
      const token = await reauthToken(h, owner);
      await h.http
        .post(`/v1/orgs/${orgId}/payout-account/${accounts.acb}/default`)
        .set('cookie', owner.cookie)
        .set(REAUTH_HEADER, token)
        .expect(200);
      const boss = worker.get<PgBoss>(BOSS);
      const [job] = await boss.findJobs(QUEUE, { data: { organizationId: orgId } });
      expect(job).toBeDefined();
      await expect
        .poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 15_000, interval: 100 })
        .toBe('retry');
      expect(sentForOrg()).toEqual([]);
      // Lỗi lưu vào job chỉ có tên lớp lỗi, không có địa chỉ email.
      expect(JSON.stringify((await boss.getJobById(QUEUE, job!.id))?.output)).not.toContain(owner.email);
    } finally {
      workerEmail.failWith = null;
    }
  });

  it('payload hỏng → sang dead-letter ngay, không retry, không gửi gì', async () => {
    const boss = worker.get<PgBoss>(BOSS);
    const data = { organizationId: `khong-phai-uuid-${randomUUID()}` };
    const jobId = await boss.send(QUEUE, data);
    await expect
      .poll(async () => (await boss.getJobById(QUEUE, jobId!))?.state, { timeout: 15_000, interval: 100 })
      .toBe('failed');
    expect((await boss.getJobById(QUEUE, jobId!))?.retryCount).toBe(0);
    await expect
      .poll(async () => (await boss.findJobs(DEAD_LETTER, { data })).length, { timeout: 10_000, interval: 100 })
      .toBe(1);
  });
});
