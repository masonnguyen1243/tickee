import { createHash } from 'node:crypto';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type Job, type JobResult, type PgBoss, type Queue, type WorkOptions } from 'pg-boss';
import type { z } from 'zod';
import type { Tx } from '../db/index.js';
import { dbErrorSummary, isDatabaseError } from '../logging/index.js';

/*
 * Khung pg-boss dùng chung cho các queue của mô-đun miền: khai báo queue (`defineQueue`), tạo queue lúc khởi động ở vai
 * `api` (`QueueProducer`) và đăng ký handler ở vai `worker` (`registerQueueWorker`). Mỗi file `*-jobs.ts` chỉ còn phần
 * riêng của mình: payload, handler và cấu hình retry.
 */

/** Cấu hình queue ngoài tên và dead-letter: retry, backoff, hạn job… */
export type QueueRetryOptions = Omit<Queue, 'name' | 'deadLetter'>;

/** Work options của worker. Luôn `perJobResults`: mỗi job được chốt riêng, một job lỗi không làm hỏng cả lô. */
export type QueueWorkOptions = WorkOptions & { perJobResults: true };

export interface QueueSpec<S extends z.ZodType> {
  name: string;
  /** Hết lượt retry (hoặc payload hỏng) thì pg-boss chép job sang queue này. Không có: job `failed` hẳn. */
  deadLetter?: string;
  options: QueueRetryOptions;
  work: QueueWorkOptions;
  /** Schema payload: `enqueue` parse trước khi gửi, worker parse lại khi nhận (hỏng thì sang dead-letter ngay). */
  payload: S;
}

export interface EnqueueOptions {
  /** Job chỉ chạy từ mốc này. */
  startAfter?: Date;
  /**
   * Id job cố định (vd. `derivedJobId` từ loại việc và id đối tượng): dòng job cùng id còn trong bảng của pg-boss thì
   * không tạo thêm (`INSERT … ON CONFLICT DO NOTHING`), nên enqueue lặp cho cùng việc chỉ có một job. Chỉ chặn trùng
   * trong khoảng dòng đó còn: job đã xong bị bảo trì của pg-boss xóa sau `deleteAfterSeconds` của queue (mặc định 7
   * ngày), sau đó enqueue lại cùng id sẽ tạo job mới.
   */
  id?: string;
}

export interface QueueDefinition<S extends z.ZodType> {
  readonly name: string;
  readonly deadLetter: string | undefined;
  /** Cấu hình áp cho queue (`createQueue` / `updateQueue`), gồm cả `deadLetter` nếu có. */
  readonly queueOptions: Readonly<Omit<Queue, 'name'>>;
  readonly workOptions: QueueWorkOptions;
  readonly payload: S;
  /**
   * Tạo dead-letter (nếu có) rồi queue (gọi lại không sao). `boss.send` ném lỗi khi queue hoặc dead-letter chưa tồn
   * tại. `createQueue` bỏ qua queue đã có (không đổi cấu hình), nên `updateQueue` áp lại `queueOptions` cho môi trường
   * đã có queue.
   */
  ensure(boss: PgBoss): Promise<void>;
  /**
   * Enqueue bằng chính `tx` của thay đổi: `tx` rollback thì không có job; commit thì job chắc chắn có. Payload được
   * parse trước khi gửi (lưu dạng đã parse). Người gọi đã `QueueProducer.ready()` trước transaction. Có `options.id` mà
   * dòng job cùng id còn trong bảng (chưa bị xóa theo `deleteAfterSeconds`) → không làm gì.
   */
  enqueue(boss: PgBoss, tx: Tx, payload: z.input<S>, options?: EnqueueOptions): Promise<void>;
}

/** Khai báo một queue pg-boss; trả về cấu hình và các thao tác dùng chung (`ensure`, `enqueue`). */
export function defineQueue<S extends z.ZodType>(spec: QueueSpec<S>): QueueDefinition<S> {
  const { name, deadLetter, payload: schema } = spec;
  const queueOptions: Omit<Queue, 'name'> = deadLetter ? { ...spec.options, deadLetter } : { ...spec.options };
  return {
    name,
    deadLetter,
    queueOptions,
    workOptions: spec.work,
    payload: schema,
    async ensure(boss) {
      if (deadLetter) await boss.createQueue(deadLetter);
      await boss.createQueue(name, queueOptions);
      await boss.updateQueue(name, queueOptions);
    },
    async enqueue(boss, tx, payload, options = {}) {
      const data = schema.parse(payload) as object;
      const jobId = await boss.send(name, data, {
        db: fromDrizzle(tx, sql),
        ...(options.startAfter ? { startAfter: options.startAfter } : {}),
        ...(options.id ? { id: options.id } : {}),
      });
      // Id cố định đã có job: `send` trả `null` (ON CONFLICT DO NOTHING), đúng ý người gọi.
      if (!jobId && !options.id) throw new Error(`pg-boss không tạo job ${name}`);
    },
  };
}

/** Phần của một queue mà `QueueProducer` cần. */
export type EnsurableQueue = Pick<QueueDefinition<z.ZodType>, 'name' | 'ensure'>;

/**
 * Vai `api`: start pg-boss (chế độ `producer`) và tạo queue ngay lúc khởi động, không chặn khởi động khi DB chưa sẵn
 * sàng. Trước transaction có thể enqueue, `ready()` chờ việc đó xong (lần trước lỗi thì làm lại). Không đăng ký handler.
 * Lớp con là provider Nest, tiêm `BOSS` rồi gọi `super(boss, QUEUE, 'khi …')`.
 */
export abstract class QueueProducer implements OnApplicationBootstrap {
  private readonly logger = new Logger(this.constructor.name);
  private pending: Promise<void> | null = null;

  /**
   * @param retryHint khi nào thử lại, cho log khi tạo queue lỗi lúc khởi động (vd. `khi mời`).
   */
  protected constructor(
    private readonly boss: PgBoss,
    private readonly queue: EnsurableQueue,
    private readonly retryHint: string,
  ) {}

  onApplicationBootstrap(): void {
    this.ready().catch((err: unknown) =>
      this.logger.warn({ err }, `Chưa tạo được queue ${this.queue.name}; sẽ thử lại ${this.retryHint}`),
    );
  }

  ready(): Promise<void> {
    this.pending ??= (async () => {
      await this.boss.start();
      await this.queue.ensure(this.boss);
    })().catch((err: unknown) => {
      this.pending = null;
      throw err;
    });
    return this.pending;
  }
}

/**
 * Tên lớp của lỗi (`SmtpError`, `Error`…), không bao giờ message: message của lỗi gửi email (SMTP) có thể chứa địa chỉ
 * email, mà lỗi handler ném ra được lưu vào job và log. Handler gửi email ném lại một `Error` mới chỉ mang tên này.
 */
export function errorName(err: unknown): string {
  return (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';
}

/**
 * Lỗi lưu vào job (pg-boss ghi `output` vào DB) và đưa vào log. Lỗi DB chỉ còn `{ type, code }` (message/params có thể
 * mang email, token session). Lỗi khác dùng message của nó: handler chỉ ném lỗi có message đã lọc (tên lớp lỗi, mã
 * HTTP…), không bao giờ có địa chỉ email hay secret.
 */
export function jobErrorMessage(err: unknown): string {
  if (isDatabaseError(err)) return JSON.stringify(dbErrorSummary(err));
  return err instanceof Error ? err.message : 'Lỗi không rõ';
}

/** Kết quả handler: xong, hoặc cần chạy lại (pg-boss retry theo cấu hình queue) kèm lý do lưu vào job. */
export type JobOutcome = { status: 'completed' } | { status: 'retry'; reason: string };

export const JOB_COMPLETED: JobOutcome = { status: 'completed' };

export interface QueueWorkerOptions<T> {
  logger: Logger;
  /** Việc của job, cho log khi lỗi: `{label} thất bại; pg-boss sẽ thử lại`. */
  label: string;
  /** Id lấy từ payload để đưa vào log (không PII). */
  logContext: (payload: T) => Record<string, unknown>;
  /** Xử lý một job đã parse payload. Ném lỗi → `failed` (pg-boss retry), lỗi lưu qua `jobErrorMessage`. */
  handle: (payload: T, job: Job<unknown>) => Promise<JobOutcome>;
  /** Các job trong một lô chạy song song. Mặc định: tuần tự. */
  parallel?: boolean;
  /** Trong một lô, các job cùng khóa chỉ gọi `handle` một lần và nhận chung kết quả. */
  dedupeBy?: (payload: T) => string;
}

type Settled = JobOutcome | { status: 'error'; error: string };

/**
 * Vai `worker`: tạo queue rồi đăng ký handler. Mỗi job:
 * - payload hỏng → `deadletter` ngay (retry vô ích; queue không có dead-letter thì job `failed` hẳn), log error chỉ có
 *   `jobId`;
 * - `handle` trả `completed` → `completed`; trả `retry` → `failed` với lý do (pg-boss retry, hết lượt thì sang
 *   dead-letter);
 * - `handle` ném lỗi → `failed`, lỗi lưu qua `jobErrorMessage`, log warn.
 */
export async function registerQueueWorker<S extends z.ZodType>(
  boss: PgBoss,
  queue: QueueDefinition<S>,
  options: QueueWorkerOptions<z.output<S>>,
): Promise<void> {
  const { logger, label, logContext, handle, parallel = false, dedupeBy } = options;
  await queue.ensure(boss);
  await boss.work<unknown>(queue.name, queue.workOptions, async (jobs) => {
    const runs = new Map<string, Promise<Settled>>();
    const run = (payload: z.output<S>, job: Job<unknown>): Promise<Settled> =>
      handle(payload, job).catch((err: unknown) => ({ status: 'error', error: jobErrorMessage(err) }) as const);

    const settle = async (job: Job<unknown>): Promise<JobResult> => {
      const parsed = queue.payload.safeParse(job.data);
      if (!parsed.success) {
        logger.error({ jobId: job.id }, `Payload job ${queue.name} không hợp lệ`);
        return { id: job.id, status: 'deadletter', output: { error: 'Payload không hợp lệ' } };
      }
      const payload = parsed.data;
      const key = dedupeBy?.(payload);
      let pending = key === undefined ? undefined : runs.get(key);
      if (!pending) {
        pending = run(payload, job);
        if (key !== undefined) runs.set(key, pending);
      }
      const outcome = await pending;
      if (outcome.status === 'completed') return { id: job.id, status: 'completed' };
      if (outcome.status === 'retry') return { id: job.id, status: 'failed', output: { error: outcome.reason } };
      logger.warn({ jobId: job.id, ...logContext(payload), error: outcome.error }, `${label} thất bại; pg-boss sẽ thử lại`);
      return { id: job.id, status: 'failed', output: { error: outcome.error } };
    };

    if (parallel) return Promise.all(jobs.map(settle));
    const results: JobResult[] = [];
    for (const job of jobs) results.push(await settle(job));
    return results;
  });
  logger.log(`Đã đăng ký job ${queue.name}`);
}

/**
 * Id job UUID (dạng v5) suy ra cố định từ một uuid gốc (`baseId`: id job gốc, id Đơn…) và một khóa. Cùng cặp thì cùng id,
 * nên `insert`/`enqueue` với id này bỏ qua job đã có.
 */
export function derivedJobId(baseId: string, key: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(baseId.replace(/-/g, ''), 'hex'))
    .update(key, 'utf8')
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Id của job con: suy ra cố định từ id job gốc và khóa của con (`derivedJobId`). Job gốc chạy lại tạo đúng các id cũ,
 * nên `insert` bỏ qua con đã có.
 */
export const childJobId = (parentJobId: string, key: string): string => derivedJobId(parentJobId, key);

export interface FanOutChild<P> {
  /** Khóa của con trong job gốc (vd. `userId` người nhận); cùng khóa thì cùng id job con. */
  key: string;
  payload: P;
}

/**
 * Job gốc tạo các job con trong cùng queue, mỗi con một khóa (khóa trùng chỉ tạo một con). Id con suy ra cố định từ
 * `parentJobId` và khóa (`childJobId`); `insert` của pg-boss dùng `ON CONFLICT DO NOTHING`, nên job gốc chạy lại không
 * tạo thêm con. Retry và dead-letter của con theo cấu hình queue. Lỗi (DB) thì ném: job gốc `failed` và retry.
 */
export async function fanOut<S extends z.ZodType>(
  boss: PgBoss,
  queue: QueueDefinition<S>,
  parentJobId: string,
  children: readonly FanOutChild<z.input<S>>[],
): Promise<void> {
  const byId = new Map<string, object>();
  for (const child of children) {
    const id = childJobId(parentJobId, child.key);
    if (!byId.has(id)) byId.set(id, queue.payload.parse(child.payload) as object);
  }
  if (byId.size === 0) return;
  await boss.insert(
    queue.name,
    [...byId].map(([id, data]) => ({ id, data })),
  );
}
