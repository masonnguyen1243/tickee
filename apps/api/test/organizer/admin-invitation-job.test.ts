import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue, OrganizationInvitation } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_INVITATION_QUEUE_OPTIONS,
  sendAdminInvitation,
} from '../../src/modules/organizer/invitation-jobs.js';
import { buildAdminInvitationEmail } from '../../src/modules/organizer/invitation-email.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, newEmail, signUp, type Harness } from '../identity/harness.js';

/*
 * Job `organizer.send-admin-invitation` (Story 2.4): worker sinh token, lưu hash, gửi email chứa link; idempotent;
 * retry rồi dead-letter. Email đi qua transport giả.
 */

const QUEUE = JobQueue.ORGANIZER_SEND_ADMIN_INVITATION;
const DEAD_LETTER = JobQueue.ORGANIZER_SEND_ADMIN_INVITATION_DEAD_LETTER;
const LINK = /\/loi-moi-btc#([A-Za-z0-9_-]+)/;

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let email: FakeEmailTransport;

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'Giải Chạy <Bộ> & "Sáng"' }).expect(201))
    .body.id as string;
  email = new FakeEmailTransport();
});

const sender = () => ({ db: h.db, email, webOrigin: TEST_WEB_ORIGIN });
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function invite(to = newEmail()): Promise<OrganizationInvitation> {
  const res = await h.http.post(`/v1/orgs/${orgId}/invitations`).set('cookie', owner.cookie).send({ email: to });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return OrganizationInvitation.parse(res.body);
}

async function invitationRow(id: string) {
  const { rows } = await h.db.pool.query<{ token_hash: string | null; email_sent_at: Date | null }>(
    'SELECT token_hash, email_sent_at FROM organization_invitations WHERE id = $1',
    [id],
  );
  return rows[0]!;
}

const tokenIn = (text: string | undefined) => text?.match(LINK)?.[1];

describe('buildAdminInvitationEmail', () => {
  it('hạn của link theo giờ Việt Nam, dạng HH:mm dd/MM/yyyy kèm "(giờ Việt Nam)"', () => {
    const message = buildAdminInvitationEmail({
      organizationName: 'BTC',
      link: `${TEST_WEB_ORIGIN}/loi-moi-btc#token`,
      expiresAt: new Date('2026-11-08T03:00:00.000Z'),
    });
    expect(message.text).toContain('tới 10:00 08/11/2026 (giờ Việt Nam),');
    expect(message.html).toContain('tới 10:00 08/11/2026 (giờ Việt Nam),');
  });
});

describe('sendAdminInvitation', () => {
  it('gửi một email chứa link {WEB_ORIGIN}/loi-moi-btc#token; DB chỉ lưu hash; chạy lại lần hai không gửi nữa', async () => {
    const invitation = await invite();
    expect(await sendAdminInvitation(sender(), invitation.id)).toBe('sent');
    expect(await sendAdminInvitation(sender(), invitation.id)).toBe('skipped');

    expect(email.sent).toHaveLength(1);
    const [message] = email.sent;
    expect(message!.to).toBe(invitation.email);
    expect(message!.subject).toContain('Admin');
    expect(message!.text).toContain(`${TEST_WEB_ORIGIN}/loi-moi-btc#`);
    expect(message!.text).toContain('Giải Chạy <Bộ> & "Sáng"');
    // Tên BTC được escape trong HTML.
    expect(message!.html).toContain('Giải Chạy &lt;Bộ&gt; &amp; &quot;Sáng&quot;');
    expect(message!.html).not.toContain('<Bộ>');

    const token = tokenIn(message!.text)!;
    // 128 bit ngẫu nhiên, base64url.
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const row = await invitationRow(invitation.id);
    expect(row.token_hash).toBe(sha256(token));
    expect(row.token_hash).not.toContain(token);
    expect(row.email_sent_at).not.toBeNull();
    await h.http.post('/v1/org-invitations/preview').send({ token }).expect(200);
  });

  it('bỏ qua lời mời đã thu hồi, đã nhận, hết hạn hoặc không tồn tại: không gửi email', async () => {
    const revoked = await invite();
    await h.http.delete(`/v1/orgs/${orgId}/invitations/${revoked.id}`).set('cookie', owner.cookie).expect(204);

    const expired = await invite();
    await h.db.orm.execute(sql`UPDATE organization_invitations SET expires_at = now() - interval '1 second' WHERE id = ${expired.id}`);

    const acceptedTo = newEmail();
    const accepted = await invite(acceptedTo);
    expect(await sendAdminInvitation({ ...sender(), email: h.email }, accepted.id)).toBe('sent');
    const token = tokenIn(h.email.sent.findLast((m) => m.to === acceptedTo)?.text)!;
    const invitee = await signUp(h, acceptedTo);
    await h.http.post('/v1/org-invitations/accept').set('cookie', invitee.cookie).send({ token }).expect(200);
    await h.db.orm.execute(sql`UPDATE organization_invitations SET email_sent_at = NULL WHERE id = ${accepted.id}`);

    for (const id of [revoked.id, expired.id, accepted.id, '019a3b2c-0000-7abc-8def-0123456789ab']) {
      expect(await sendAdminInvitation(sender(), id)).toBe('skipped');
    }
    expect(email.sent).toEqual([]);
    expect((await invitationRow(revoked.id)).token_hash).toBeNull();
  });

  it('gửi lỗi → ném lỗi (không lộ email) để retry; lần chạy sau sinh token mới, link của lần lỗi không dùng được', async () => {
    const invitation = await invite();
    email.failWith = new Error(`SMTP từ chối ${invitation.email}`);
    const failure = await sendAdminInvitation(sender(), invitation.id).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(invitation.email);
    const firstHash = (await invitationRow(invitation.id)).token_hash;
    expect(firstHash).not.toBeNull();
    expect((await invitationRow(invitation.id)).email_sent_at).toBeNull();

    email.failWith = null;
    expect(await sendAdminInvitation(sender(), invitation.id)).toBe('sent');
    const row = await invitationRow(invitation.id);
    expect(row.token_hash).not.toBe(firstHash);
    expect(row.token_hash).toBe(sha256(tokenIn(email.sent[0]?.text)!));
    expect(row.email_sent_at).not.toBeNull();
  });
});

describe('queue', () => {
  it('cấu hình queue: có retry (backoff) và dead-letter', async () => {
    const boss = h.app.get<PgBoss>(BOSS);
    await expect.poll(async () => (await boss.getQueue(DEAD_LETTER))?.name, { timeout: 10_000 }).toBe(DEAD_LETTER);
    const queue = await boss.getQueue(QUEUE);
    expect(queue).toMatchObject({
      name: QUEUE,
      deadLetter: DEAD_LETTER,
      retryLimit: ADMIN_INVITATION_QUEUE_OPTIONS.retryLimit,
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

  it('Owner mời qua api → worker xử lý job: đúng một email tới người được mời, lời mời được đánh dấu đã gửi', async () => {
    const to = newEmail();
    const invitation = await invite(to);
    await expect
      .poll(() => workerEmail.sent.filter((m) => m.to === to).length, { timeout: 15_000, interval: 100 })
      .toBe(1);
    const boss = worker.get<PgBoss>(BOSS);
    const [job] = await boss.findJobs(QUEUE, { data: { invitationId: invitation.id } });
    await expect.poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 10_000 }).toBe('completed');
    expect((await invitationRow(invitation.id)).email_sent_at).not.toBeNull();

    // Job chạy lại (vd. gửi trùng) không gửi thêm email: chờ job trùng chạy xong rồi mới đếm.
    const duplicateId = await boss.send(QUEUE, { invitationId: invitation.id });
    await expect
      .poll(async () => (await boss.getJobById(QUEUE, duplicateId!))?.state, { timeout: 15_000, interval: 100 })
      .toBe('completed');
    expect(workerEmail.sent.filter((m) => m.to === to)).toHaveLength(1);

    const token = tokenIn(workerEmail.sent.find((m) => m.to === to)?.text)!;
    const preview = await h.http.post('/v1/org-invitations/preview').send({ token }).expect(200);
    expect(preview.body).toEqual({ organizationName: 'Giải Chạy <Bộ> & "Sáng"' });
  });

  it('gửi email lỗi → job sang trạng thái retry, lời mời chưa đánh dấu đã gửi', async () => {
    workerEmail.failWith = new Error('SMTP tạm hỏng');
    try {
      const invitation = await invite();
      const boss = worker.get<PgBoss>(BOSS);
      const [job] = await boss.findJobs(QUEUE, { data: { invitationId: invitation.id } });
      await expect
        .poll(async () => (await boss.getJobById(QUEUE, job!.id))?.state, { timeout: 15_000, interval: 100 })
        .toBe('retry');
      expect((await invitationRow(invitation.id)).email_sent_at).toBeNull();
    } finally {
      workerEmail.failWith = null;
    }
  });

  it('payload hỏng → sang dead-letter ngay, không retry', async () => {
    const boss = worker.get<PgBoss>(BOSS);
    const data = { invitationId: `khong-phai-uuid-${randomUUID()}` };
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
