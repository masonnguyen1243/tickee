import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type { Logger } from '@nestjs/common';
import type { Job, JobResult, PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineQueue, JOB_COMPLETED, registerQueueWorker } from '../../src/platform/jobs/index.js';

/*
 * Story 4.6-a, dòng "Job" của I/O Matrix (cột lỗi): worker chốt từng job nên pg-boss không tự đánh dấu span
 * `process <queue>`. `registerQueueWorker` đánh dấu span đang chạy là lỗi (`error.type` là tên lớp lỗi, không message)
 * khi `handle` ném lỗi hay payload hỏng, và vẫn log `warn` kèm ngữ cảnh như trước. Provider trong bộ nhớ; span
 * `process <queue>` do test mở quanh lô job, như pg-boss.
 */

class SecretBearingError extends Error {}

const SECRET = 'bi-mat-trong-message-a@vidu.vn';
const spans = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }));
});
beforeEach(() => spans.reset());
afterAll(() => {
  trace.disable();
  context.disable();
});

const Payload = z.object({ itemId: z.uuid() });
const queue = defineQueue({
  name: 'test.job-span',
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: Payload,
});

interface Captured {
  level: 'log' | 'warn' | 'error';
  fields: unknown;
  message: unknown;
}

/** Đăng ký worker với boss giả; trả hàm chạy một job bên trong span `process <queue>` và các log đã ghi. */
async function workerWith(handle: () => Promise<typeof JOB_COMPLETED>) {
  let handler: ((jobs: Job<unknown>[]) => Promise<JobResult[]>) | undefined;
  const boss = {
    createQueue: async () => undefined,
    updateQueue: async () => undefined,
    work: async (_name: string, _options: unknown, h: typeof handler) => {
      handler = h;
      return 'worker-id';
    },
  };
  const logs: Captured[] = [];
  const logger = {
    log: (fields: unknown, message?: unknown) => logs.push({ level: 'log', fields, message }),
    warn: (fields: unknown, message?: unknown) => logs.push({ level: 'warn', fields, message }),
    error: (fields: unknown, message?: unknown) => logs.push({ level: 'error', fields, message }),
  };
  await registerQueueWorker(boss as unknown as PgBoss, queue, {
    logger: logger as unknown as Logger,
    label: 'Việc thử',
    logContext: ({ itemId }) => ({ itemId }),
    handle,
  });
  const runJob = (data: unknown) =>
    trace.getTracer('pg-boss').startActiveSpan(`process ${queue.name}`, async (span) => {
      try {
        return await handler!([{ id: 'job-1', data } as Job<unknown>]);
      } finally {
        span.end();
      }
    });
  return { runJob, logs };
}

const processSpan = () => spans.getFinishedSpans().find((s) => s.name === `process ${queue.name}`);

describe('span `process <queue>` khi job lỗi', () => {
  it('handle ném lỗi → span ERROR, error.type là tên lớp, không message; log warn vẫn kèm jobId và id payload', async () => {
    const { runJob, logs } = await workerWith(async () => {
      throw new SecretBearingError(SECRET);
    });
    const itemId = crypto.randomUUID();
    const [result] = await runJob({ itemId });
    expect(result?.status).toBe('failed');

    const span = processSpan();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes['error.type']).toBe('SecretBearingError');
    expect(JSON.stringify({ attributes: span?.attributes, status: span?.status })).not.toContain(SECRET);

    const warn = logs.find((l) => l.level === 'warn');
    expect(warn?.fields).toMatchObject({ jobId: 'job-1', itemId });
  });

  it('payload hỏng → span ERROR với error.type = invalid_payload; job vào dead-letter như trước', async () => {
    const { runJob } = await workerWith(async () => JOB_COMPLETED);
    const [result] = await runJob({ itemId: 'khong-phai-uuid' });
    expect(result?.status).toBe('deadletter');
    const span = processSpan();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes['error.type']).toBe('invalid_payload');
  });

  it('job xong → span không bị đánh dấu lỗi', async () => {
    const { runJob } = await workerWith(async () => JOB_COMPLETED);
    const [result] = await runJob({ itemId: crypto.randomUUID() });
    expect(result?.status).toBe('completed');
    const span = processSpan();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(span?.attributes).not.toHaveProperty('error.type');
  });
});
