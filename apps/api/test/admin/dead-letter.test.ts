import { randomUUID } from 'node:crypto';
import { DeadLetterJobList, ErrorResponse, JobQueue, type DeadLetterJob } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPIRE_ORDER_QUEUE } from '../../src/modules/ordering/order-jobs.js';
import { audit } from '../../src/platform/audit/index.js';
import { BOSS, DEAD_LETTER_SUFFIX } from '../../src/platform/jobs/index.js';
import { createHarness, signIn, signUp, signUpWithTotp, type Harness } from '../identity/harness.js';
import { setPlatformAdminFlag, signUpPlatformAdmin } from './platform-admin.js';

/*
 * Story 4.6-d: dead-letter của pg-boss ở `/v1/admin/*` trên Postgres thật. Mỗi dòng của I/O Matrix (trừ danh sách rỗng:
 * DB dùng chung nên chỉ e2e web kiểm được). Queue gốc là queue test tên ngẫu nhiên, không worker nào nhặt job của nó;
 * job dead-letter tạo bằng `boss.send('<q>.dead-letter', data)` rồi ghi tay các cột `source_*` như pg-boss ghi khi chép
 * job hết retry. DB dùng chung: chỉ assert theo id của chính test; mọi queue test bị xóa khi xong.
 */

let h: Harness;
let boss: PgBoss;
let admin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
/** Queue test đã tạo, theo thứ tự tạo (dead-letter trước queue gốc): xóa theo thứ tự ngược. */
const createdQueues: string[] = [];

beforeAll(async () => {
  h = await createHarness();
  boss = h.app.get<PgBoss>(BOSS);
  await boss.start();
  admin = await signUpPlatformAdmin(h);
});
afterAll(async () => {
  for (const name of [...createdQueues].reverse()) await boss.deleteQueue(name);
  await h.close();
});

const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;

function expectError(res: Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(errorOf(res).code).toBe(code);
}

const list = (cookie = admin.cookie) => h.http.get('/v1/admin/dead-letters').set('cookie', cookie);
const requeue = (id: string, cookie = admin.cookie) =>
  h.http.post(`/v1/admin/dead-letters/${id}/requeue`).set('cookie', cookie);

async function listJobs(cookie = admin.cookie): Promise<DeadLetterJobList> {
  const res = await list(cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  // Lý do lỗi và payload của job nhiều BTC: không cho cache.
  expect(res.headers['cache-control']).toBe('no-store');
  return DeadLetterJobList.parse(res.body);
}

const findJob = async (id: string): Promise<DeadLetterJob | undefined> =>
  (await listJobs()).items.find((j) => j.id === id);

/** Cặp queue test: queue gốc (khai dead-letter như `defineQueue`) và queue dead-letter của nó. */
async function queuePair(): Promise<{ source: string; deadLetter: string }> {
  const source = `test.dead-letter-admin-${randomUUID()}`;
  const deadLetter = `${source}${DEAD_LETTER_SUFFIX}`;
  await boss.createQueue(deadLetter);
  await boss.createQueue(source, { deadLetter });
  createdQueues.push(deadLetter, source);
  return { source, deadLetter };
}

interface Provenance {
  sourceName: string | null;
  sourceId?: string;
  retryCount?: number;
  output?: unknown;
}

/**
 * Job `created` trong queue dead-letter, kèm dấu vết `source_*` như pg-boss ghi khi chép job hết retry (`sourceName`
 * `null`: job chép tay, không có dấu vết). Trả id job dead-letter và id job gốc.
 */
async function deadLetterJob(
  deadLetter: string,
  data: object,
  { sourceName, sourceId = randomUUID(), retryCount = 8, output = { message: 'SmtpError' } }: Provenance,
): Promise<{ id: string; sourceId: string }> {
  const id = await boss.send(deadLetter, data);
  if (!id) throw new Error('pg-boss không tạo job');
  if (sourceName !== null) {
    await h.db.pool.query(
      `UPDATE pgboss.job SET source_name = $3, source_id = $4, source_retry_count = $5, source_output = $6::jsonb
        WHERE name = $1 AND id = $2`,
      [deadLetter, id, sourceName, sourceId, retryCount, JSON.stringify(output)],
    );
  }
  return { id, sourceId };
}

async function jobsIn(queue: string) {
  const { rows } = await h.db.pool.query<{
    id: string;
    data: unknown;
    state: string;
    retry_count: number;
    source_root_id: string | null;
  }>('SELECT id, data, state, retry_count, source_root_id FROM pgboss.job WHERE name = $1 ORDER BY created_on, id', [
    queue,
  ]);
  return rows;
}

async function auditRows(action: string, where: { actor?: string; targetId?: string } = {}) {
  const { rows } = await h.db.pool.query<{
    actor_user_id: string | null;
    organization_id: string | null;
    target_type: string;
    target_id: string;
    changed_fields: string[];
  }>(
    `SELECT actor_user_id, organization_id, target_type, target_id, changed_fields FROM audit_events
      WHERE action = $1 AND ($2::uuid IS NULL OR actor_user_id = $2) AND ($3::text IS NULL OR target_id = $3)
      ORDER BY created_at, id`,
    [action, where.actor ?? null, where.targetId ?? null],
  );
  return rows;
}

describe('ai được vào (như mọi route /v1/admin/*)', () => {
  it('chưa đăng nhập → 401 UNAUTHENTICATED', async () => {
    expectError(await h.http.get('/v1/admin/dead-letters'), 401, 'UNAUTHENTICATED');
    expectError(await h.http.post(`/v1/admin/dead-letters/${randomUUID()}/requeue`), 401, 'UNAUTHENTICATED');
  });

  it('tài khoản thường, Owner, tài khoản đã bật 2FA không có cờ → 403 FORBIDDEN_ROLE; có cờ chưa bật 2FA → TWO_FACTOR_NOT_ENABLED; chưa qua lớp hai → TOTP_REQUIRED; job không đổi, không audit', async () => {
    const { source, deadLetter } = await queuePair();
    const job = await deadLetterJob(deadLetter, { n: 1 }, { sourceName: source });

    const plain = await signUp(h);
    const owner = await signUp(h);
    await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Dead-letter' }).expect(201);
    const withTotp = await signUpWithTotp(h);
    for (const user of [plain, owner, withTotp]) {
      expectError(await list(user.cookie), 403, 'FORBIDDEN_ROLE');
      expectError(await requeue(job.id, user.cookie), 403, 'FORBIDDEN_ROLE');
      expect(await auditRows('platform_admin.read', { actor: user.userId })).toEqual([]);
    }

    const flagged = await signUp(h);
    await setPlatformAdminFlag(flagged.userId, true);
    expectError(await list(flagged.cookie), 403, 'TWO_FACTOR_NOT_ENABLED');
    expectError(await requeue(job.id, flagged.cookie), 403, 'TWO_FACTOR_NOT_ENABLED');

    const fresh = await signIn(h, admin.email);
    expectError(await list(fresh), 403, 'TOTP_REQUIRED');
    expectError(await requeue(job.id, fresh), 403, 'TOTP_REQUIRED');

    expect((await jobsIn(deadLetter)).map((j) => j.id)).toEqual([job.id]);
    expect(await jobsIn(source)).toEqual([]);
    expect(await auditRows('dead_letter_job.requeued', { targetId: `${deadLetter}:${job.id}` })).toEqual([]);
  });
});

describe('GET /v1/admin/dead-letters', () => {
  it('job ở hai queue dead-letter khác nhau: thấy cả hai (mới nhất trước) với queue gốc, id job gốc, số lần thử, lý do, payload; job thường không có; thêm đúng một dòng audit platform_admin.read', async () => {
    const first = await queuePair();
    const second = await queuePair();
    const a = await deadLetterJob(first.deadLetter, { orderId: 'a' }, { sourceName: first.source, retryCount: 10 });
    const b = await deadLetterJob(
      second.deadLetter,
      { userId: 'b' },
      { sourceName: second.source, retryCount: 3, output: { error: 'Payload không hợp lệ' } },
    );
    // Job thường ở queue gốc (không phải dead-letter) không bao giờ có trong danh sách.
    const plain = await boss.send(first.source, { orderId: 'thuong' }, { startAfter: new Date(Date.now() + 86_400_000) });

    const readsBefore = await auditRows('platform_admin.read', { actor: admin.userId });
    const { items, total } = await listJobs();
    const readsAfter = await auditRows('platform_admin.read', { actor: admin.userId });
    expect(readsAfter).toHaveLength(readsBefore.length + 1);
    expect(readsAfter.at(-1)).toEqual({
      actor_user_id: admin.userId,
      organization_id: null,
      target_type: 'dead_letter_jobs',
      target_id: 'all',
      changed_fields: [],
    });

    const jobA = items.find((j) => j.id === a.id);
    const jobB = items.find((j) => j.id === b.id);
    expect(jobA).toEqual({
      id: a.id,
      queue: first.deadLetter,
      sourceQueue: first.source,
      sourceJobId: a.sourceId,
      retryCount: 10,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      reason: 'SmtpError',
      payload: '{"orderId":"a"}',
    });
    expect(Math.abs(Date.parse(jobA!.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(jobB).toMatchObject({
      queue: second.deadLetter,
      sourceQueue: second.source,
      sourceJobId: b.sourceId,
      retryCount: 3,
      reason: '{"error":"Payload không hợp lệ"}',
      payload: '{"userId":"b"}',
    });
    // Mới vào dead-letter nhất trước.
    expect(items.indexOf(jobB!)).toBeLessThan(items.indexOf(jobA!));
    expect(items.some((j) => j.id === plain)).toBe(false);
    expect(total).toBeGreaterThanOrEqual(items.length);
  });

  it('lý do có PII kèm stack: email và chuỗi ≥ 9 chữ số thành [REDACTED], không stack, tối đa 300 ký tự; payload tối đa 300 ký tự', async () => {
    const { source, deadLetter } = await queuePair();
    const filler = 'x'.repeat(400);
    const pii = await deadLetterJob(
      deadLetter,
      { note: 'y'.repeat(400) },
      {
        sourceName: source,
        output: {
          name: 'SmtpError',
          message: `Gửi tới a@b.vn thất bại, gọi 0912345678 ${filler}`,
          stack: 'SmtpError: Gửi tới a@b.vn thất bại\n    at send (/app/dist/email.js:10:5)',
        },
      },
    );
    const job = await findJob(pii.id);
    expect(job?.reason).toBe(`Gửi tới [REDACTED] thất bại, gọi [REDACTED] ${filler}`.slice(0, 300));
    expect(job?.reason).toHaveLength(300);
    for (const leaked of ['a@b.vn', '0912345678', 'at send', 'email.js']) expect(job?.reason).not.toContain(leaked);
    expect(job?.payload).toBe(JSON.stringify({ note: 'y'.repeat(400) }).slice(0, 300));
    expect(job?.payload).toHaveLength(300);

    // Không có `message`: JSON của cả output, bỏ mọi `stack`, vẫn che PII.
    const noMessage = await deadLetterJob(
      deadLetter,
      {},
      {
        sourceName: source,
        output: { error: 'Lỗi', stack: 'trace', detail: { stack: 'trace', note: 'liên hệ c.d@vi-du.com hoặc 84912345678' } },
      },
    );
    expect((await findJob(noMessage.id))?.reason).toBe('{"error":"Lỗi","detail":{"note":"liên hệ [REDACTED] hoặc [REDACTED]"}}');

    // Ngưỡng che số: đúng 9 chữ số thành [REDACTED], 8 chữ số giữ nguyên.
    const boundary = await deadLetterJob(
      deadLetter,
      {},
      { sourceName: source, output: { message: 'Mã 123456789 và 12345678 lỗi' } },
    );
    expect((await findJob(boundary.id))?.reason).toBe('Mã [REDACTED] và 12345678 lỗi');

    // `message` rỗng: dùng JSON của cả output (không để ô lý do trống).
    const emptyMessage = await deadLetterJob(
      deadLetter,
      {},
      { sourceName: source, output: { message: '', error: 'Lỗi' } },
    );
    expect((await findJob(emptyMessage.id))?.reason).toBe('{"error":"Lỗi","message":""}');

    // Job chép tay vào dead-letter: không có dấu vết nguồn, không có lý do.
    const manual = await deadLetterJob(deadLetter, {}, { sourceName: null });
    expect(await findJob(manual.id)).toMatchObject({
      sourceQueue: null,
      sourceJobId: null,
      retryCount: null,
      reason: null,
      payload: '{}',
    });
  });
});

describe('POST /v1/admin/dead-letters/:id/requeue', () => {
  it('job dead-letter created → 204: queue gốc có job mới cùng data (lượt thử từ 0), dòng dead-letter biến mất, audit dead_letter_job.requeued', async () => {
    const { source, deadLetter } = await queuePair();
    const data = { orderId: randomUUID(), linked: true };
    const job = await deadLetterJob(deadLetter, data, { sourceName: source });

    await requeue(job.id).expect(204);

    const moved = await jobsIn(source);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ data, state: 'created', retry_count: 0, source_root_id: job.sourceId });
    expect(moved[0]!.id).not.toBe(job.id);
    expect(await jobsIn(deadLetter)).toEqual([]);
    expect(await findJob(job.id)).toBeUndefined();
    expect(await auditRows('dead_letter_job.requeued', { targetId: `${deadLetter}:${job.id}` })).toEqual([
      {
        actor_user_id: admin.userId,
        organization_id: null,
        target_type: 'dead_letter_job',
        target_id: `${deadLetter}:${job.id}`,
        changed_fields: [],
      },
    ]);

    // Lần nữa: job không còn trong dead-letter.
    expectError(await requeue(job.id), 409, 'DEAD_LETTER_JOB_GONE');
    expect(await jobsIn(source)).toHaveLength(1);
    expect(await auditRows('dead_letter_job.requeued', { targetId: `${deadLetter}:${job.id}` })).toHaveLength(1);
  });

  it('hai request đua nhau trên cùng job → một 204, một 409 DEAD_LETTER_JOB_GONE; đúng một job mới và một audit', async () => {
    const { source, deadLetter } = await queuePair();
    const job = await deadLetterJob(deadLetter, { race: true }, { sourceName: source });

    const results = await Promise.all([requeue(job.id), requeue(job.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(errorOf(results.find((r) => r.status === 409)!).code).toBe('DEAD_LETTER_JOB_GONE');
    expect(await jobsIn(source)).toHaveLength(1);
    expect(await jobsIn(deadLetter)).toEqual([]);
    expect(await auditRows('dead_letter_job.requeued', { targetId: `${deadLetter}:${job.id}` })).toHaveLength(1);
  });

  it('id của job thường ở ordering.expire-order → 409 DEAD_LETTER_JOB_GONE, job thường không đổi', async () => {
    await EXPIRE_ORDER_QUEUE.ensure(boss);
    const startAfter = new Date(Date.now() + 86_400_000);
    const id = await boss.send(JobQueue.ORDERING_EXPIRE_ORDER, { orderId: randomUUID(), linked: false }, { startAfter });
    if (!id) throw new Error('pg-boss không tạo job');
    try {
      const before = await h.db.pool.query('SELECT name, state, data, retry_count FROM pgboss.job WHERE id = $1', [id]);
      expectError(await requeue(id), 409, 'DEAD_LETTER_JOB_GONE');
      const after = await h.db.pool.query('SELECT name, state, data, retry_count FROM pgboss.job WHERE id = $1', [id]);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows).toMatchObject([{ name: JobQueue.ORDERING_EXPIRE_ORDER, state: 'created' }]);
      expect(await auditRows('dead_letter_job.requeued', { actor: admin.userId })).not.toContainEqual(
        expect.objectContaining({ target_id: expect.stringContaining(id) }),
      );
    } finally {
      await boss.deleteJob(JobQueue.ORDERING_EXPIRE_ORDER, id);
    }
  });

  it('ghi audit lỗi → 500 và requeue rollback cùng transaction: dòng dead-letter vẫn created, queue gốc không có job mới', async () => {
    const { source, deadLetter } = await queuePair();
    const job = await deadLetterJob(deadLetter, { tx: true }, { sourceName: source });
    const record = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (tx, event) => {
      if (event.action === 'dead_letter_job.requeued') throw new Error('audit hỏng (test)');
      return record(tx, event);
    });
    try {
      expectError(await requeue(job.id), 500, 'INTERNAL_ERROR');
    } finally {
      spy.mockRestore();
    }
    expect((await jobsIn(deadLetter)).map((j) => [j.id, j.state])).toEqual([[job.id, 'created']]);
    expect(await jobsIn(source)).toEqual([]);
    expect(await auditRows('dead_letter_job.requeued', { targetId: `${deadLetter}:${job.id}` })).toEqual([]);

    // Audit lành lại thì requeue được như thường.
    await requeue(job.id).expect(204);
    expect(await jobsIn(source)).toHaveLength(1);
  });

  it('pg-boss chuyển 0 job (không ghi queue gốc, hoặc queue gốc không còn) hay id lạ → 409, dòng dead-letter giữ nguyên, không audit', async () => {
    const { deadLetter } = await queuePair();
    const manual = await deadLetterJob(deadLetter, {}, { sourceName: null });
    const orphan = await deadLetterJob(deadLetter, {}, { sourceName: `test.khong-ton-tai-${randomUUID()}` });
    for (const id of [manual.id, orphan.id, randomUUID()]) expectError(await requeue(id), 409, 'DEAD_LETTER_JOB_GONE');
    const rows = await jobsIn(deadLetter);
    expect(rows.map((r) => [r.id, r.state]).sort()).toEqual(
      [
        [manual.id, 'created'],
        [orphan.id, 'created'],
      ].sort(),
    );
    for (const id of [manual.id, orphan.id]) {
      expect(await auditRows('dead_letter_job.requeued', { targetId: `${deadLetter}:${id}` })).toEqual([]);
    }
  });

  it('id sai dạng → 400 VALIDATION_FAILED', async () => {
    expectError(await requeue('khong-phai-uuid'), 400, 'VALIDATION_FAILED');
  });
});

describe('giới hạn danh sách', () => {
  it('quá 200 job: trả 200 job mới nhất, total là số job thật', async () => {
    const { deadLetter } = await queuePair();
    await boss.insert(
      deadLetter,
      Array.from({ length: 201 }, (_, i) => ({ data: { i } })),
    );
    const { items, total } = await listJobs();
    expect(items).toHaveLength(200);
    expect(items.every((j) => j.queue === deadLetter)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(201);
  });
});
