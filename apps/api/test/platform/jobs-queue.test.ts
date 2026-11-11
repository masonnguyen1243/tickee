import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import type { Job, JobResult, PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Tx } from '../../src/platform/db/index.js';
import {
  childJobId,
  defineQueue,
  fanOut,
  JOB_COMPLETED,
  jobErrorMessage,
  QueueProducer,
  registerQueueWorker,
  type EnsurableQueue,
  type JobOutcome,
} from '../../src/platform/jobs/index.js';

/*
 * Khung pg-boss dùng chung (`platform/jobs/queue.ts`, E2-5): lỗi lưu vào job, id job con cố định, `ready()` của vai
 * `api` chạy lại được sau khi lỗi, và vòng lặp worker (payload hỏng, retry, lỗi DB, song song + gộp theo khóa). Dùng
 * boss giả; hành vi với pg-boss thật nằm ở test của từng queue.
 */

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const pgError = (code: string): pg.DatabaseError =>
  Object.assign(new pg.DatabaseError('duplicate key value a@vidu.vn', 0, 'error'), { code });

const TestPayload = z.object({ itemId: z.uuid(), recipientUserId: z.uuid().optional() });

const testQueue = (deadLetter?: string) =>
  defineQueue({
    name: 'test.queue',
    ...(deadLetter ? { deadLetter } : {}),
    options: { retryLimit: 2, retryDelay: 1, retryBackoff: true },
    work: { batchSize: 10, perJobResults: true },
    payload: TestPayload,
  });

describe('jobErrorMessage', () => {
  it('lỗi DB (chính nó hay ở tầng cause) → chỉ { type, code }, không message hay params', () => {
    const drizzle = new DrizzleQueryError('select * from users where email = $1', ['a@vidu.vn'], pgError('23505'));
    expect(JSON.parse(jobErrorMessage(drizzle))).toEqual({ type: 'DrizzleQueryError', code: '23505' });
    expect(JSON.parse(jobErrorMessage(pgError('57P01')))).toEqual({ type: 'DatabaseError', code: '57P01' });
    const wrapped = jobErrorMessage(new Error('bọc a@vidu.vn', { cause: drizzle }));
    expect(JSON.parse(wrapped)).toEqual({ type: 'Error', code: '23505' });
    for (const message of [jobErrorMessage(drizzle), wrapped]) expect(message).not.toContain('a@vidu.vn');
  });

  it('lỗi khác → message (handler đã lọc); không phải Error → "Lỗi không rõ"', () => {
    expect(jobErrorMessage(new Error('Web trả HTTP 500 khi revalidate'))).toBe('Web trả HTTP 500 khi revalidate');
    expect(jobErrorMessage('chuỗi')).toBe('Lỗi không rõ');
    expect(jobErrorMessage(null)).toBe('Lỗi không rõ');
  });
});

describe('childJobId / fanOut', () => {
  it('id job con cố định theo id job gốc và khóa; khác gốc hoặc khác khóa thì khác id; dạng UUID v5', () => {
    const parent = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    expect(childJobId(parent, userA)).toBe(childJobId(parent, userA));
    expect(childJobId(parent, userA)).not.toBe(childJobId(parent, userB));
    expect(childJobId(randomUUID(), userA)).not.toBe(childJobId(parent, userA));
    expect(childJobId(parent, userA)).toMatch(UUID_V5);
    expect(z.uuid().safeParse(childJobId(parent, userA)).success).toBe(true);
    // Giá trị cố định giữa các lần chạy và các bản deploy (đổi thuật toán thì job gốc chạy lại sẽ nhân đôi job con).
    expect(childJobId('00000000-0000-4000-8000-000000000000', 'a')).toBe('7ba866a2-e6fd-56dc-93b5-1b32c1b91d67');
  });

  it('fanOut: insert một lần, mỗi khóa một job con (khóa trùng chỉ một), id suy từ id gốc; gọi lại tạo đúng id cũ', async () => {
    const insert = vi.fn().mockResolvedValue(null);
    const boss = { insert } as unknown as PgBoss;
    const queue = testQueue('test.queue.dead-letter');
    const parent = randomUUID();
    const itemId = randomUUID();
    const [a, b] = [randomUUID(), randomUUID()];
    const children = [a, b, a].map((userId) => ({ key: userId, payload: { itemId, recipientUserId: userId } }));

    await fanOut(boss, queue, parent, children);
    await fanOut(boss, queue, parent, children);

    expect(insert).toHaveBeenCalledTimes(2);
    const expected = [
      { id: childJobId(parent, a), data: { itemId, recipientUserId: a } },
      { id: childJobId(parent, b), data: { itemId, recipientUserId: b } },
    ];
    expect(insert.mock.calls[0]).toEqual(['test.queue', expected]);
    expect(insert.mock.calls[1]).toEqual(['test.queue', expected]);
  });

  it('fanOut: không có con → không gọi insert; payload con hỏng → ném lỗi trước khi insert', async () => {
    const insert = vi.fn().mockResolvedValue(null);
    const boss = { insert } as unknown as PgBoss;
    await fanOut(boss, testQueue(), randomUUID(), []);
    await expect(
      fanOut(boss, testQueue(), randomUUID(), [{ key: 'x', payload: { itemId: 'khong-phai-uuid' } }]),
    ).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('defineQueue', () => {
  it('queueOptions có deadLetter khi khai báo, không có khóa deadLetter khi không; ensure tạo dead-letter trước', async () => {
    expect(testQueue('test.queue.dead-letter').queueOptions).toEqual({
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      deadLetter: 'test.queue.dead-letter',
    });
    expect(Object.keys(testQueue().queueOptions)).not.toContain('deadLetter');

    const boss = { createQueue: vi.fn().mockResolvedValue(undefined), updateQueue: vi.fn().mockResolvedValue(undefined) };
    await testQueue('test.queue.dead-letter').ensure(boss as unknown as PgBoss);
    expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual(['test.queue.dead-letter', 'test.queue']);
    expect(boss.updateQueue.mock.calls.map(([name]) => name)).toEqual(['test.queue']);
  });

  it('enqueue parse payload trước khi gửi (hỏng → ném, không gửi); pg-boss không trả id → ném', async () => {
    const send = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(randomUUID());
    const boss = { send } as unknown as PgBoss;
    const tx = {} as Tx;
    await expect(testQueue().enqueue(boss, tx, { itemId: 'khong-phai-uuid' })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();

    const itemId = randomUUID();
    await expect(testQueue().enqueue(boss, tx, { itemId })).rejects.toThrow('pg-boss không tạo job test.queue');
    const startAfter = new Date('2026-11-11T00:00:00Z');
    await testQueue().enqueue(boss, tx, { itemId }, { startAfter });
    expect(send.mock.calls[1]?.[0]).toBe('test.queue');
    expect(send.mock.calls[1]?.[1]).toEqual({ itemId });
    expect(send.mock.calls[1]?.[2]).toMatchObject({ startAfter });
    expect(send.mock.calls[1]?.[2]).toHaveProperty('db');
  });
});

class TestQueues extends QueueProducer {
  constructor(boss: PgBoss, queue: EnsurableQueue) {
    super(boss, queue, 'khi thử');
  }
}

describe('QueueProducer.ready', () => {
  it('lần đầu lỗi (DB chưa sẵn sàng) → reject; lần sau start lại và tạo queue; xong rồi thì không làm lại', async () => {
    const boss = {
      start: vi.fn().mockRejectedValueOnce(new Error('DB chưa sẵn sàng')).mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      updateQueue: vi.fn().mockResolvedValue(undefined),
    };
    const queues = new TestQueues(boss as unknown as PgBoss, testQueue('test.queue.dead-letter'));

    await expect(queues.ready()).rejects.toThrow('DB chưa sẵn sàng');
    expect(boss.createQueue).not.toHaveBeenCalled();

    await expect(queues.ready()).resolves.toBeUndefined();
    expect(boss.start).toHaveBeenCalledTimes(2);
    expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual(['test.queue.dead-letter', 'test.queue']);

    await queues.ready();
    expect(boss.start).toHaveBeenCalledTimes(2);
    expect(boss.createQueue).toHaveBeenCalledTimes(2);
  });

  it('tạo queue lỗi (sau khi start được) → reject; lần sau làm lại cả hai bước', async () => {
    const boss = { start: vi.fn().mockResolvedValue(undefined) };
    const ensure = vi.fn().mockRejectedValueOnce(new Error('tạo queue lỗi')).mockResolvedValue(undefined);
    const queues = new TestQueues(boss as unknown as PgBoss, { name: 'test.queue', ensure });

    await expect(queues.ready()).rejects.toThrow('tạo queue lỗi');
    await expect(queues.ready()).resolves.toBeUndefined();
    expect(boss.start).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('gọi đồng thời → dùng chung một lần start', async () => {
    const boss = {
      start: vi.fn().mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      updateQueue: vi.fn().mockResolvedValue(undefined),
    };
    const queues = new TestQueues(boss as unknown as PgBoss, testQueue());
    await Promise.all([queues.ready(), queues.ready(), queues.ready()]);
    expect(boss.start).toHaveBeenCalledTimes(1);
  });
});

describe('registerQueueWorker', () => {
  type Handler = (jobs: Job<unknown>[]) => Promise<JobResult[]>;

  /** Boss giả: ghi lại handler đăng ký bằng `work` để gọi tay với một lô job. */
  async function register(
    handle: (payload: z.output<typeof TestPayload>) => Promise<JobOutcome>,
    extra: { parallel?: boolean; dedupeBy?: (payload: z.output<typeof TestPayload>) => string } = {},
  ) {
    let handler: Handler | undefined;
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      updateQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(async (_name: string, _options: unknown, h: Handler) => {
        handler = h;
        return 'worker-id';
      }),
    };
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const queue = testQueue('test.queue.dead-letter');
    await registerQueueWorker(boss as unknown as PgBoss, queue, {
      logger: logger as unknown as Logger,
      label: 'Việc thử',
      logContext: ({ itemId }) => ({ itemId }),
      handle: (payload) => handle(payload),
      ...extra,
    });
    expect(boss.createQueue).toHaveBeenCalledWith('test.queue', queue.queueOptions);
    expect(boss.work).toHaveBeenCalledWith('test.queue', queue.workOptions, expect.any(Function));
    const run = (data: unknown[]) => handler!(data.map((d, i) => ({ id: `job-${i}`, data: d }) as Job<unknown>));
    return { run, logger };
  }

  it('payload hỏng → deadletter, log error chỉ có jobId; completed → completed; retry → failed kèm lý do', async () => {
    const ok = randomUUID();
    const later = randomUUID();
    const { run, logger } = await register(async ({ itemId }) =>
      itemId === later ? { status: 'retry', reason: 'Chưa tới hạn' } : JOB_COMPLETED,
    );
    expect(await run([{ itemId: 'hong' }, { itemId: ok }, { itemId: later }])).toEqual([
      { id: 'job-0', status: 'deadletter', output: { error: 'Payload không hợp lệ' } },
      { id: 'job-1', status: 'completed' },
      { id: 'job-2', status: 'failed', output: { error: 'Chưa tới hạn' } },
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toEqual({ jobId: 'job-0' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('handler ném lỗi DB → failed, output { type, code } (không message/params); log warn kèm id', async () => {
    const itemId = randomUUID();
    const { run, logger } = await register(async () => {
      throw new DrizzleQueryError('select $1', ['a@vidu.vn'], pgError('57P01'));
    });
    const [result] = await run([{ itemId }]);
    expect(result).toEqual({
      id: 'job-0',
      status: 'failed',
      output: { error: JSON.stringify({ type: 'DrizzleQueryError', code: '57P01' }) },
    });
    expect(JSON.stringify(result)).not.toContain('a@vidu.vn');
    expect(logger.warn.mock.calls[0]?.[0]).toEqual({ jobId: 'job-0', itemId, error: result?.output.error });
    expect(logger.warn.mock.calls[0]?.[1]).toBe('Việc thử thất bại; pg-boss sẽ thử lại');
  });

  it('tuần tự mặc định; parallel + dedupeBy → cùng khóa trong lô chỉ gọi handle một lần, mỗi job nhận chung kết quả', async () => {
    const shared = randomUUID();
    const other = randomUUID();
    const calls: string[] = [];
    const { run } = await register(
      async ({ itemId }) => {
        calls.push(itemId);
        if (itemId === shared) throw new Error('Web trả HTTP 500 khi revalidate');
        return JOB_COMPLETED;
      },
      { parallel: true, dedupeBy: ({ itemId }) => itemId },
    );
    expect(await run([{ itemId: shared }, { itemId: other }, { itemId: shared }])).toEqual([
      { id: 'job-0', status: 'failed', output: { error: 'Web trả HTTP 500 khi revalidate' } },
      { id: 'job-1', status: 'completed' },
      { id: 'job-2', status: 'failed', output: { error: 'Web trả HTTP 500 khi revalidate' } },
    ]);
    expect(calls.sort()).toEqual([shared, other].sort());
  });

  /** Handler chờ 5 ms mỗi job, ghi thứ tự gọi và số job chạy cùng lúc nhiều nhất. */
  function slowHandler() {
    const calls: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const handle = async ({ itemId }: z.output<typeof TestPayload>): Promise<JobOutcome> => {
      calls.push(itemId);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return JOB_COMPLETED;
    };
    return { handle, calls, maxRunning: () => maxRunning };
  }

  it('mặc định tuần tự, không dedupeBy → mỗi job gọi handle đúng một lần, theo thứ tự trong lô (cả id trùng)', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const slow = slowHandler();
    const { run } = await register(slow.handle);
    await run([{ itemId: a }, { itemId: b }, { itemId: a }]);
    expect(slow.calls).toEqual([a, b, a]);
    expect(slow.maxRunning()).toBe(1);
  });

  it('parallel, không dedupeBy → các job trong lô chạy cùng lúc, mỗi job một lần', async () => {
    const items = [randomUUID(), randomUUID(), randomUUID()];
    const slow = slowHandler();
    const { run } = await register(slow.handle, { parallel: true });
    const results = await run(items.map((itemId) => ({ itemId })));
    expect(results.map((r) => r.status)).toEqual(['completed', 'completed', 'completed']);
    expect(slow.calls.sort()).toEqual([...items].sort());
    expect(slow.maxRunning()).toBeGreaterThan(1);
  });
});
