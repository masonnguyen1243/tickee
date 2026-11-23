import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Job, JobResult, PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineQueue, JOB_COMPLETED, registerQueueWorker } from '../../src/platform/jobs/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 4.6-a, ngữ cảnh log (telemetry tắt, như mọi test khác): sau `PermissionGuard`, mọi log còn lại của request BTC
 * (kể cả dòng kết thúc request) mang `organizationId`; log trong lúc xử lý job mang `queue`, `jobId` và id của payload.
 * Không có SDK nên không có `traceId`.
 */

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('log của request BTC', () => {
  it('Owner gọi route BTC → dòng kết thúc request có requestId và organizationId; không có traceId', async () => {
    const owner = await signUp(h);
    const orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Log' }).expect(201)).body
      .id as string;
    const requestId = `req-org-${randomUUID()}`;
    await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', owner.cookie).set('x-request-id', requestId).expect(200);
    const lines = h.logs.lines.filter((l) => l.requestId === requestId);
    const completed = lines.find((l) => 'res' in l);
    expect(completed).toMatchObject({ requestId, organizationId: orgId });
    for (const line of lines) expect(line).not.toHaveProperty('traceId');
  });

  it('không là thành viên (403) → không gắn organizationId', async () => {
    const owner = await signUp(h);
    const other = await signUp(h);
    const orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Khác' }).expect(201)).body
      .id as string;
    const requestId = `req-org-${randomUUID()}`;
    await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', other.cookie).set('x-request-id', requestId).expect(403);
    const lines = h.logs.lines.filter((l) => l.requestId === requestId);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toHaveProperty('organizationId');
  });

  it('route CTV (Story 5.2): CTV active → dòng kết thúc request mang organizationId của BTC sở hữu; người khác (403 NOT_A_MEMBER) → không', async () => {
    const owner = await signUp(h);
    const ctv = await signUp(h);
    const other = await signUp(h);
    const orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Soát vé' }).expect(201))
      .body.id as string;
    const eventId = (
      await h.http
        .post(`/v1/orgs/${orgId}/events`)
        .set('cookie', owner.cookie)
        .send({
          name: 'Sự kiện log',
          startsAt: '2099-11-16T07:00:00+07:00',
          endsAt: '2099-11-16T17:00:00+07:00',
          refundPolicy: 'Không hoàn vé.',
        })
        .expect(201)
    ).body.id as string;
    await h.db.orm.execute(
      sql`INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES (${orgId}, ${eventId}, ${ctv.userId}, 'active')`,
    );

    const allowed = `req-ctv-${randomUUID()}`;
    await h.http.get(`/v1/checkin/events/${eventId}`).set('cookie', ctv.cookie).set('x-request-id', allowed).expect(200);
    const completed = h.logs.lines.filter((l) => l.requestId === allowed).find((l) => 'res' in l);
    expect(completed).toMatchObject({ requestId: allowed, organizationId: orgId });

    const denied = `req-ctv-${randomUUID()}`;
    const res = await h.http.get(`/v1/checkin/events/${eventId}`).set('cookie', other.cookie).set('x-request-id', denied);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');
    const lines = h.logs.lines.filter((l) => l.requestId === denied);
    expect(lines.find((l) => 'res' in l)).toBeDefined();
    for (const line of lines) expect(line).not.toHaveProperty('organizationId');
  });
});

describe('log trong lúc xử lý job', () => {
  const Payload = z.object({ itemId: z.uuid() });
  const queue = defineQueue({
    name: 'test.log-context',
    options: { retryLimit: 0 },
    work: { batchSize: 5, perJobResults: true },
    payload: Payload,
  });

  it('mọi log bên trong handle (kể cả sau await) mang queue, jobId, id của payload; log ngoài job thì không', async () => {
    let handler: ((jobs: Job<unknown>[]) => Promise<JobResult[]>) | undefined;
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (_name: string, _options: unknown, h: typeof handler) => {
        handler = h;
        return 'worker-id';
      },
    };
    const logger = new Logger('LogContextWorker');
    const marker = `trong-job-${randomUUID()}`;
    await registerQueueWorker(boss as unknown as PgBoss, queue, {
      logger,
      label: 'Việc thử',
      logContext: ({ itemId }) => ({ itemId }),
      handle: async ({ itemId }) => {
        logger.log({ step: 1 }, marker);
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.log({ step: 2, itemId }, marker);
        return JOB_COMPLETED;
      },
      parallel: true,
    });
    const items = [randomUUID(), randomUUID()];
    const results = await handler!(items.map((itemId, i) => ({ id: `job-${i}`, data: { itemId } }) as Job<unknown>));
    expect(results.map((r) => r.status)).toEqual(['completed', 'completed']);

    const lines = h.logs.lines.filter((l) => l.msg === marker);
    expect(lines).toHaveLength(4);
    for (const [i, itemId] of items.entries()) {
      const own = lines.filter((l) => l.itemId === itemId);
      expect(own.map((l) => l.step).sort()).toEqual([1, 2]);
      for (const line of own) expect(line).toMatchObject({ queue: 'test.log-context', jobId: `job-${i}`, itemId });
    }
    const registered = h.logs.lines.find((l) => l.msg === 'Đã đăng ký job test.log-context');
    expect(registered).toBeDefined();
    expect(registered).not.toHaveProperty('queue');
    expect(registered).not.toHaveProperty('jobId');
  });
});
