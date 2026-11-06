import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EVENT_SLUG_PATTERN, JobQueue, publicEventTag } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type JobResult, type PgBoss, type Queue, type WorkOptions } from 'pg-boss';
import { z } from 'zod';
import type { Tx } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';

/*
 * Revalidate ngay trang Sự kiện công khai `/e/{slug}` (Story 2.11-c, AD-37). Ghi làm đổi phần tĩnh của một Sự kiện đã
 * mở bán enqueue job bằng chính `tx` của thay đổi; worker gọi route nội bộ của web, route đó chạy
 * `revalidateTag(publicEventTag(slug), { expire: 0 })`. Revalidate 30 giây của web vẫn là lưới an toàn: job hết lượt
 * retry thì bỏ (không có dead-letter), cache tự hết hạn.
 */

const QUEUE = JobQueue.EVENT_REVALIDATE_PUBLIC_PAGE;

/** Route nội bộ của web nhận lệnh revalidate (`apps/web/app/api/revalidate/route.ts`). */
export const REVALIDATE_PATH = '/api/revalidate';
/** Web không trả lời trong chừng này mili giây → coi như lỗi, job `failed` để retry. */
export const REVALIDATE_TIMEOUT_MS = 5_000;

/** Retry 3 lần, chờ 2 giây rồi tăng dần (backoff); hết lượt thì job `failed` hẳn, không có dead-letter. */
export const PUBLIC_PAGE_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 2,
  retryBackoff: true,
} as const satisfies Omit<Queue, 'name'>;

/**
 * Lấy tối đa 10 job mỗi lần, lấy tiếp ngay khi lô đầy; các job trong lô chạy song song (mỗi lời gọi tối đa 5 giây) và
 * được chốt riêng.
 */
const WORK_OPTIONS = { batchSize: 10, burstWhenBatchFull: true, perJobResults: true } as const satisfies WorkOptions;

/** Payload của job: chỉ slug của Sự kiện. */
export const RevalidatePublicPagePayload = z.object({ slug: z.string().max(100).regex(EVENT_SLUG_PATTERN) });
export type RevalidatePublicPagePayload = z.infer<typeof RevalidatePublicPagePayload>;

/**
 * Tạo queue revalidate (gọi lại không sao). Cả vai `api` (gửi job) lẫn `worker` (xử lý) gọi lúc khởi động: `boss.send`
 * ném lỗi khi queue chưa tồn tại. `updateQueue` áp lại `PUBLIC_PAGE_QUEUE_OPTIONS` cho môi trường đã có queue.
 */
export async function ensurePublicPageQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, PUBLIC_PAGE_QUEUE_OPTIONS);
  await boss.updateQueue(QUEUE, PUBLIC_PAGE_QUEUE_OPTIONS);
}

/**
 * Enqueue revalidate trang `/e/{slug}` bằng chính `tx` của thay đổi: `tx` rollback thì không có job. Người gọi chỉ gọi
 * khi Sự kiện không còn nháp và phần tĩnh thật sự đổi, và đã `PublicPageQueues.ready()` trước transaction. Dùng lại cho
 * Ẩn/Kết thúc (2.12) và hủy/khóa Sự kiện (Epic 7).
 */
export async function enqueuePublicPageRevalidation(boss: PgBoss, tx: Tx, slug: string): Promise<void> {
  const payload: RevalidatePublicPagePayload = { slug };
  const jobId = await boss.send(QUEUE, payload, { db: fromDrizzle(tx, sql) });
  if (!jobId) throw new Error(`pg-boss không tạo job ${QUEUE}`);
}

export interface PublicPageRevalidator {
  /** Origin web (`WEB_ORIGIN`). */
  webOrigin: string;
  /** `REVALIDATE_SECRET`; chỉ nằm trong header, không bao giờ vào log hay lỗi. */
  secret: string;
  /** Tiêm để test; worker dùng `fetch` toàn cục. */
  fetch: typeof fetch;
}

/** Tên lớp lỗi kèm mã lỗi mạng nếu có (`TypeError: ECONNREFUSED`, `TimeoutError`): không chứa URL hay header. */
function errorKind(err: unknown): string {
  const e = err as { name?: unknown; cause?: { code?: unknown } } | null;
  const name = typeof e?.name === 'string' ? e.name : 'Unknown';
  const code = typeof e?.cause?.code === 'string' ? e.cause.code : undefined;
  return code ? `${name}: ${code}` : name;
}

/**
 * Handler của job: `POST {webOrigin}/api/revalidate` với `Authorization: Bearer {secret}`, body `{ tag: "event:{slug}" }`,
 * timeout 5 giây, không theo redirect (giữ secret ở đúng origin). Không 2xx, lỗi mạng hay hết giờ → ném lỗi để pg-boss
 * retry; lỗi chỉ mang mã HTTP hoặc tên lớp lỗi (job lưu lỗi vào DB).
 */
export async function revalidatePublicPage(revalidator: PublicPageRevalidator, slug: string): Promise<void> {
  let res: Response;
  try {
    res = await revalidator.fetch(`${revalidator.webOrigin}${REVALIDATE_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${revalidator.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tag: publicEventTag(slug) }),
      redirect: 'error',
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Không gọi được web để revalidate (${errorKind(err)})`);
  }
  // Không cần body; hủy để trả kết nối về pool.
  await res.body?.cancel().catch(() => undefined);
  if (!res.ok) throw new Error(`Web trả HTTP ${res.status} khi revalidate`);
}

/**
 * Vai `api`: start pg-boss (chế độ `producer`) và tạo queue ngay lúc khởi động, không chặn khởi động khi DB chưa sẵn
 * sàng. Trước transaction có thể enqueue, `ready()` chờ việc đó xong (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class PublicPageQueues implements OnApplicationBootstrap {
  private readonly logger = new Logger('PublicPageQueues');
  private pending: Promise<void> | null = null;

  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  onApplicationBootstrap(): void {
    this.ready().catch((err: unknown) =>
      this.logger.warn({ err }, `Chưa tạo được queue ${QUEUE}; sẽ thử lại khi BTC sửa Sự kiện`),
    );
  }

  ready(): Promise<void> {
    this.pending ??= (async () => {
      await this.boss.start();
      await ensurePublicPageQueues(this.boss);
    })().catch((err: unknown) => {
      this.pending = null;
      throw err;
    });
    return this.pending;
  }
}

export const EVENT_JOBS_CONFIG = Symbol('EVENT_JOBS_CONFIG');

export interface EventJobsConfig {
  WEB_ORIGIN: string;
  REVALIDATE_SECRET: string;
}

/** Vai `worker`: tạo queue và đăng ký handler revalidate trang Sự kiện công khai. */
@Injectable()
export class PublicPageWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('PublicPageWorker');

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EVENT_JOBS_CONFIG) private readonly config: EventJobsConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensurePublicPageQueues(this.boss);
    const revalidator: PublicPageRevalidator = {
      webOrigin: this.config.WEB_ORIGIN,
      secret: this.config.REVALIDATE_SECRET,
      fetch: (input, init) => fetch(input, init),
    };
    // `failed` → pg-boss retry theo cấu hình queue. Payload hỏng thì retry vô ích: `deadletter` (queue không có
    // dead-letter nên job hỏng hẳn ngay). Cùng slug trong một lô chỉ gọi web một lần.
    await this.boss.work<unknown>(QUEUE, WORK_OPTIONS, async (jobs) => {
      const calls = new Map<string, Promise<string | null>>();
      return Promise.all(
        jobs.map(async (job): Promise<JobResult> => {
          const payload = RevalidatePublicPagePayload.safeParse(job.data);
          if (!payload.success) return { id: job.id, status: 'deadletter', output: { error: 'Payload không hợp lệ' } };
          const { slug } = payload.data;
          let call = calls.get(slug);
          if (!call) {
            call = revalidatePublicPage(revalidator, slug).then(
              () => null,
              (err: unknown) => (err instanceof Error ? err.message : 'Lỗi không rõ'),
            );
            calls.set(slug, call);
          }
          const error = await call;
          if (error === null) return { id: job.id, status: 'completed' };
          this.logger.warn({ jobId: job.id, slug, error }, 'Revalidate trang Sự kiện công khai thất bại; pg-boss sẽ thử lại');
          return { id: job.id, status: 'failed', output: { error } };
        }),
      );
    });
    this.logger.log(`Đã đăng ký job ${QUEUE}`);
  }
}

/** Job nền của `event` cho vai `worker` (revalidate trang Sự kiện công khai). Cần `JobsModule` (toàn cục) ở gốc DI. */
@Module({})
export class EventJobsModule {
  static forRoot(config: EventJobsConfig): DynamicModule {
    return {
      module: EventJobsModule,
      providers: [{ provide: EVENT_JOBS_CONFIG, useValue: config }, PublicPageWorker],
    };
  }
}
