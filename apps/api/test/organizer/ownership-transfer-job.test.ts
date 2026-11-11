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
  OWNERSHIP_TRANSFER_QUEUE,
  OWNERSHIP_TRANSFER_QUEUE_OPTIONS,
  OwnershipTransferQueues,
  ownershipTransferRecipients,
  sendOwnershipTransferredEmail,
  type OwnershipTransferredPayload,
} from '../../src/modules/organizer/ownership-transfer-jobs.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS, childJobId, fanOut } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, reauthToken, signUp, type Harness } from '../identity/harness.js';

/*
 * Job `organizer.notify-ownership-transferred` (Story 2.14): sau khi Owner chuyển quyền cho một Admin, worker gửi email
 * cho Owner cũ, Owner mới và mọi Admin khác còn trong BTC lúc xử lý. Job gốc enqueue bằng chính `tx` của thay đổi, chốt
 * danh sách người nhận rồi tạo mỗi người một job con (E2-5); job con gửi đúng một email. Email đi qua transport giả.
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

/** Như worker: job gốc tính người nhận, rồi mỗi người một job con (ở đây gọi tuần tự). */
async function notifyAll(p: OwnershipTransferredPayload): Promise<number | 'skipped'> {
  const recipients = await ownershipTransferRecipients(h.db, p);
  if (recipients === 'skipped') return 'skipped';
  let sent = 0;
  for (const userId of recipients) {
    if ((await sendOwnershipTransferredEmail(notifier(), p, userId)) === 'sent') sent += 1;
  }
  return sent;
}

describe('ownershipTransferRecipients (job gốc) và sendOwnershipTransferredEmail (job con)', () => {
  it('người nhận theo thứ tự: Owner cũ, Owner mới, Admin khác (không ai khác)', async () => {
    await applyTransfer();
    expect(await ownershipTransferRecipients(h.db, payload())).toEqual([previous.userId, next.userId, other.userId]);
    expect(email.sent).toEqual([]);
  });

  it('mỗi người một email: "{mới} là Owner mới của {BTC}; {cũ} chuyển sang Admin."', async () => {
    await applyTransfer();
    expect(await notifyAll(payload())).toBe(3);
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

  it('Admin đã bị xóa trước khi xử lý không nhận; Owner cũ, Owner mới vẫn nhận', async () => {
    await applyTransfer();
    await h.db.orm.execute(sql`DELETE FROM members WHERE organization_id = ${orgId} AND user_id = ${other.userId}`);
    expect(await ownershipTransferRecipients(h.db, payload())).toEqual([previous.userId, next.userId]);
    expect(await notifyAll(payload())).toBe(2);
    expect(email.sent.map((m) => m.to)).toEqual([previous.email, next.email]);
  });

  it('Owner cũ đã rời BTC trước lúc xử lý vẫn nhận; Owner mới, Admin khác vẫn nhận', async () => {
    await applyTransfer();
    await h.db.orm.execute(sql`DELETE FROM members WHERE organization_id = ${orgId} AND user_id = ${previous.userId}`);
    expect(await notifyAll(payload())).toBe(3);
    expect(email.sent.map((m) => m.to)).toEqual([previous.email, next.email, other.email]);
  });

  it('BTC không còn (hoặc id lạ) → skipped ở cả job gốc lẫn job con, không gửi gì', async () => {
    const gone = payload({ organizationId: randomUUID() });
    expect(await ownershipTransferRecipients(h.db, gone)).toBe('skipped');
    expect(await sendOwnershipTransferredEmail(notifier(), gone, previous.userId)).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('người nhận không còn tài khoản → job con skipped', async () => {
    expect(await sendOwnershipTransferredEmail(notifier(), payload(), randomUUID())).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('SMTP lỗi → job con ném lỗi (pg-boss retry), lỗi chỉ có tên lớp, không chứa địa chỉ email', async () => {
    email.failFor.set(previous.email, new Error(`SMTP từ chối ${previous.email}`));
    const err = await sendOwnershipTransferredEmail(notifier(), payload(), previous.userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Không gửi được email báo chuyển quyền Owner (Error)');
    // Người khác vẫn gửi được.
    expect(await sendOwnershipTransferredEmail(notifier(), payload(), next.userId)).toBe('sent');
    expect(email.sent.map((m) => m.to)).toEqual([next.email]);
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

  it('job gốc chạy lại (tạo job con lần hai) → không nhân đôi job con: id con cố định theo id gốc và userId', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    const parentJobId = randomUUID();
    const children = [previous, next, other].map((u) => ({
      key: u.userId,
      payload: { ...payload(), recipientUserId: u.userId },
    }));
    await fanOut(boss, OWNERSHIP_TRANSFER_QUEUE, parentJobId, children);
    await fanOut(boss, OWNERSHIP_TRANSFER_QUEUE, parentJobId, children);
    const jobs = await boss.findJobs(QUEUE, { data: { organizationId: orgId } });
    expect(jobs.map((j) => j.id).sort()).toEqual(
      [previous, next, other].map((u) => childJobId(parentJobId, u.userId)).sort(),
    );
    expect(jobs.map((j) => (j.data as OwnershipTransferredPayload).recipientUserId).sort()).toEqual(
      [previous.userId, next.userId, other.userId].sort(),
    );
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

  /** Job gốc (không `recipientUserId`) và các job con của BTC hiện tại. */
  async function jobsForOrg() {
    const jobs = await worker.get<PgBoss>(BOSS).findJobs(QUEUE, { data: { organizationId: orgId } });
    const isChild = (j: (typeof jobs)[number]) => (j.data as OwnershipTransferredPayload).recipientUserId !== undefined;
    return { roots: jobs.filter((j) => !isChild(j)), children: jobs.filter(isChild) };
  }
  const stateOf = async (id: string) => (await worker.get<PgBoss>(BOSS).getJobById(QUEUE, id))?.state;
  const sentTo = (user: User) => sentForOrg().filter((m) => m.to === user.email).length;

  it('Owner chuyển quyền qua api (có xác nhận lại) → job gốc tạo 3 job con, mỗi người đúng một email; mọi job completed', async () => {
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

    const { roots, children } = await jobsForOrg();
    expect(roots.map((j) => j.data)).toEqual([payload()]);
    const root = roots[0]!;
    expect(children.map((j) => j.data).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))).toEqual(
      [previous, next, other]
        .map((u) => ({ ...payload(), recipientUserId: u.userId }))
        .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    );
    for (const child of children) {
      expect(child.id).toBe(childJobId(root.id, (child.data as OwnershipTransferredPayload).recipientUserId!));
    }
    for (const job of [root, ...children]) {
      await expect.poll(() => stateOf(job.id), { timeout: 10_000 }).toBe('completed');
    }
  });

  it('SMTP chỉ lỗi với một địa chỉ → job con của người đó retry, hai người kia mỗi người đúng một email; lần thử lại chỉ gửi người lỗi', async () => {
    workerEmail.failFor.set(other.email, new Error(`SMTP từ chối ${other.email}`));
    try {
      await applyTransfer();
      await h.db.transaction((tx) => enqueueOwnershipTransferred(h.app.get<PgBoss>(BOSS), tx, payload()));

      await expect.poll(async () => (await jobsForOrg()).children.length, { timeout: 15_000, interval: 100 }).toBe(3);
      const { roots, children } = await jobsForOrg();
      const childOf = (user: User) => children.find((j) => (j.data as OwnershipTransferredPayload).recipientUserId === user.userId)!;

      await expect.poll(() => stateOf(childOf(other).id), { timeout: 15_000, interval: 100 }).toBe('retry');
      for (const user of [previous, next]) {
        await expect.poll(() => stateOf(childOf(user).id), { timeout: 15_000, interval: 100 }).toBe('completed');
      }
      expect(await stateOf(roots[0]!.id)).toBe('completed');
      expect([sentTo(previous), sentTo(next), sentTo(other)]).toEqual([1, 1, 0]);
      // Lỗi lưu vào job con chỉ có tên lớp lỗi, không có địa chỉ email.
      const failed = await worker.get<PgBoss>(BOSS).getJobById(QUEUE, childOf(other).id);
      expect(failed?.output).toEqual({ error: 'Không gửi được email báo chuyển quyền Owner (Error)' });
      // Job con tạo bằng `insert` nhận đúng cấu hình retry và dead-letter của queue (không phải mặc định của pg-boss).
      expect(failed?.retryLimit).toBe(OWNERSHIP_TRANSFER_QUEUE_OPTIONS.retryLimit);
      expect(failed?.deadLetter).toBe(DEAD_LETTER);

      // SMTP hết lỗi; kéo lần thử lại lên ngay (thay vì chờ 30 giây): chỉ người bị lỗi nhận email.
      workerEmail.failFor.delete(other.email);
      await worker.get<PgBoss>(BOSS).update(QUEUE, undefined, { id: childOf(other).id, startAfter: new Date() });
      await expect.poll(() => stateOf(childOf(other).id), { timeout: 15_000, interval: 100 }).toBe('completed');
      expect([sentTo(previous), sentTo(next), sentTo(other)]).toEqual([1, 1, 1]);
    } finally {
      workerEmail.failFor.delete(other.email);
    }
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
