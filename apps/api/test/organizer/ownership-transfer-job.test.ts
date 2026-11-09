import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue, REAUTH_HEADER, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  enqueueOwnershipTransferred,
  notifyOwnershipTransferred,
  OWNERSHIP_TRANSFER_QUEUE_OPTIONS,
  OwnershipTransferQueues,
  type OwnershipTransferredPayload,
} from '../../src/modules/organizer/ownership-transfer-jobs.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, reauthToken, signUp, type Harness } from '../identity/harness.js';

/*
 * Job `organizer.notify-ownership-transferred` (Story 2.14): sau khi Owner chuyển quyền cho một Admin, worker gửi email
 * cho Owner cũ, Owner mới và mọi Admin khác còn trong BTC lúc gửi. Job enqueue bằng chính `tx` của thay đổi. Email đi
 * qua transport giả.
 */

const QUEUE = JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED;
const DEAD_LETTER = JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED_DEAD_LETTER;
const ORG_NAME = 'CLB <Cờ> & "Vua"';
let orgName: string;
let orgSeq = 0;

type User = Awaited<ReturnType<typeof signUp>>;
let h: Harness;
/** Owner cũ (lúc gửi đã là Admin). */
let previous: User;
/** Admin được chọn (lúc gửi đã là Owner), có tên. */
let next: User;
/** Admin khác của BTC. */
let other: User;
/** Có tài khoản nhưng không thuộc BTC: không bao giờ nhận email. */
let outsider: User;
let orgId: string;
let email: FakeEmailTransport;

beforeAll(async () => {
  h = await createHarness();
  previous = await signUp(h);
  next = await signUp(h);
  other = await signUp(h);
  outsider = await signUp(h);
  await h.db.orm.execute(sql`UPDATE users SET name = ${'Bình <Trần>'} WHERE id = ${next.userId}`);
  await h.app.get(OwnershipTransferQueues).ready();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  email = new FakeEmailTransport();
  orgSeq += 1;
  orgName = `${ORG_NAME} ${orgSeq}`;
  orgId = (await h.http.post('/v1/orgs').set('cookie', previous.cookie).send({ name: orgName }).expect(201)).body
    .id as string;
  for (const admin of [next, other]) {
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
    );
  }
});

/** Đặt vai như sau khi chuyển quyền (không qua api). */
async function applyTransfer() {
  await h.db.orm.execute(
    sql`UPDATE members SET role = ${Role.ADMIN} WHERE organization_id = ${orgId} AND user_id = ${previous.userId}`,
  );
  await h.db.orm.execute(
    sql`UPDATE members SET role = ${Role.OWNER} WHERE organization_id = ${orgId} AND user_id = ${next.userId}`,
  );
}

const payload = (overrides: Partial<OwnershipTransferredPayload> = {}): OwnershipTransferredPayload => ({
  organizationId: orgId,
  previousOwnerUserId: previous.userId,
  newOwnerUserId: next.userId,
  ...overrides,
});
const notifier = () => ({ db: h.db, email });

describe('notifyOwnershipTransferred', () => {
  it('gửi Owner cũ, Owner mới, Admin khác (không ai khác): "{mới} là Owner mới của {BTC}; {cũ} chuyển sang Admin."', async () => {
    await applyTransfer();
    expect(await notifyOwnershipTransferred(notifier(), payload())).toBe(3);
    expect(email.sent.map((m) => m.to)).toEqual([previous.email, next.email, other.email]);
    expect(email.sent.some((m) => m.to === outsider.email)).toBe(false);

    const [message] = email.sent;
    expect(message?.subject).toBe(`Bình <Trần> là Owner mới của ${orgName}`);
    // Owner cũ chưa có tên: hiện email.
    expect(message?.text).toContain(`Bình <Trần> là Owner mới của ${orgName}; ${previous.email} chuyển sang Admin.`);
    expect(message?.html).toContain(`<strong>CLB &lt;Cờ&gt; &amp; &quot;Vua&quot; ${orgSeq}</strong>`);
    expect(message?.html).toContain('<strong>Bình &lt;Trần&gt;</strong>');
    expect(message?.html).not.toContain(ORG_NAME);
  });

  it('Admin đã bị xóa trước khi gửi không nhận; Owner cũ, Owner mới vẫn nhận', async () => {
    await applyTransfer();
    await h.db.orm.execute(sql`DELETE FROM members WHERE organization_id = ${orgId} AND user_id = ${other.userId}`);
    expect(await notifyOwnershipTransferred(notifier(), payload())).toBe(2);
    expect(email.sent.map((m) => m.to)).toEqual([previous.email, next.email]);
  });

  it('Owner cũ đã rời BTC trước lúc gửi vẫn nhận; Owner mới, Admin khác vẫn nhận', async () => {
    await applyTransfer();
    await h.db.orm.execute(sql`DELETE FROM members WHERE organization_id = ${orgId} AND user_id = ${previous.userId}`);
    expect(await notifyOwnershipTransferred(notifier(), payload())).toBe(3);
    expect(email.sent.map((m) => m.to)).toEqual([previous.email, next.email, other.email]);
  });

  it('BTC không còn (hoặc id lạ) → skipped, không gửi gì', async () => {
    expect(await notifyOwnershipTransferred(notifier(), payload({ organizationId: randomUUID() }))).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('SMTP lỗi → ném lỗi (pg-boss retry), lỗi không chứa địa chỉ email', async () => {
    email.failWith = new Error(`SMTP từ chối ${previous.email}`);
    const err = await notifyOwnershipTransferred(notifier(), payload()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('3/3');
    expect((err as Error).message).not.toContain(previous.email);
  });
});

describe('enqueue cùng transaction', () => {
  it('transaction rollback → không có job; commit → đúng một job, payload chỉ id', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    await expect(
      h.db.transaction(async (tx) => {
        await enqueueOwnershipTransferred(boss, tx, payload());
        throw new Error('thao tác lỗi');
      }),
    ).rejects.toThrow('thao tác lỗi');
    expect(await boss.findJobs(QUEUE, { data: { organizationId: orgId } })).toEqual([]);

    await h.db.transaction((tx) => enqueueOwnershipTransferred(boss, tx, payload()));
    const jobs = await boss.findJobs(QUEUE, { data: { organizationId: orgId } });
    expect(jobs.map((j) => j.data)).toEqual([payload()]);
  });

  it('cấu hình queue: có retry (backoff) và dead-letter', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    expect((await boss.getQueue(DEAD_LETTER))?.name).toBe(DEAD_LETTER);
    expect(await boss.getQueue(QUEUE)).toMatchObject({
      name: QUEUE,
      deadLetter: DEAD_LETTER,
      retryLimit: OWNERSHIP_TRANSFER_QUEUE_OPTIONS.retryLimit,
      retryBackoff: true,
    });
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

  const sentForOrg = () => workerEmail.sent.filter((m) => m.subject.endsWith(`là Owner mới của ${orgName}`));

  it('Owner chuyển quyền qua api (có xác nhận lại) → worker gửi đủ 3 người; job completed', async () => {
    const { rows } = await h.db.pool.query<{ id: string }>(
      'SELECT id FROM members WHERE organization_id = $1 AND user_id = $2',
      [orgId, next.userId],
    );
    const token = await reauthToken(h, previous);
    await h.http
      .post(`/v1/orgs/${orgId}/members/${rows[0]!.id}/ownership-transfer`)
      .set('cookie', previous.cookie)
      .set(REAUTH_HEADER, token)
      .expect(204);

    await expect.poll(() => sentForOrg().length, { timeout: 15_000, interval: 100 }).toBe(3);
    expect(sentForOrg().map((m) => m.to).sort()).toEqual([previous.email, next.email, other.email].sort());

    const boss = worker.get<PgBoss>(BOSS);
    const [job] = await boss.findJobs(QUEUE, { data: { organizationId: orgId } });
    expect(job?.data).toEqual(payload());
    await expect.poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 10_000 }).toBe('completed');
  });

  it('payload hỏng → sang dead-letter ngay, không retry', async () => {
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
