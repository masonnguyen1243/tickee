import { Inject, Injectable, Logger, Module, type DynamicModule, type OnApplicationBootstrap } from '@nestjs/common';
import { EVENT_SLUG_PATTERN, JobQueue, publicEventTag } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { Tx } from '../../platform/db/index.js';
import { BOSS, defineQueue, JOB_COMPLETED, QueueProducer, registerQueueWorker } from '../../platform/jobs/index.js';

/*
 * Revalidate ngay trang Sự kiện công khai `/e/{slug}` (Story 2.11-c, AD-37). Ghi làm đổi phần tĩnh của một Sự kiện đã
 * mở bán enqueue job bằng chính `tx` của thay đổi; worker gọi route nội bộ của web, route đó chạy
 * `revalidateTag(publicEventTag(slug), { expire: 0 })`. Revalidate 30 giây của web vẫn là lưới an toàn: job hết lượt
 * retry thì bỏ (không có dead-letter), cache tự hết hạn.
 */

/** Route nội bộ của web nhận lệnh revalidate (`apps/web/app/api/revalidate/route.ts`). */
export const REVALIDATE_PATH = '/api/revalidate';
/** Web không trả lời trong chừng này mili giây → coi như lỗi, job `failed` để retry. */
export const REVALIDATE_TIMEOUT_MS = 5_000;

/** Payload của job: chỉ slug của Sự kiện. */
export const RevalidatePublicPagePayload = z.object({ slug: z.string().max(100).regex(EVENT_SLUG_PATTERN) });
export type RevalidatePublicPagePayload = z.infer<typeof RevalidatePublicPagePayload>;

/**
 * Queue revalidate. Retry 3 lần, chờ 2 giây rồi tăng dần (backoff); hết lượt thì job `failed` hẳn, không có dead-letter.
 * Lấy tối đa 10 job mỗi lần, lấy tiếp ngay khi lô đầy; các job trong lô chạy song song (mỗi lời gọi tối đa 5 giây) và
 * được chốt riêng.
 */
export const PUBLIC_PAGE_QUEUE = defineQueue({
  name: JobQueue.EVENT_REVALIDATE_PUBLIC_PAGE,
  options: { retryLimit: 3, retryDelay: 2, retryBackoff: true },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: RevalidatePublicPagePayload,
});
export const PUBLIC_PAGE_QUEUE_OPTIONS = PUBLIC_PAGE_QUEUE.queueOptions;

/**
 * Tạo queue revalidate (gọi lại không sao). Cả vai `api` (gửi job) lẫn `worker` (xử lý) gọi lúc khởi động: `boss.send`
 * ném lỗi khi queue chưa tồn tại.
 */
export const ensurePublicPageQueues = (boss: PgBoss): Promise<void> => PUBLIC_PAGE_QUEUE.ensure(boss);

/**
 * Enqueue revalidate trang `/e/{slug}` bằng chính `tx` của thay đổi: `tx` rollback thì không có job. Người gọi chỉ gọi
 * khi Sự kiện không còn nháp và phần tĩnh thật sự đổi, và đã `PublicPageQueues.ready()` trước transaction. Dùng lại cho
 * Ẩn/Kết thúc (2.12) và hủy/khóa Sự kiện (Epic 7).
 */
export async function enqueuePublicPageRevalidation(boss: PgBoss, tx: Tx, slug: string): Promise<void> {
  await PUBLIC_PAGE_QUEUE.enqueue(boss, tx, { slug });
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
 * Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước transaction có thể enqueue
 * (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class PublicPageQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, PUBLIC_PAGE_QUEUE, 'khi BTC sửa Sự kiện');
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
    const revalidator: PublicPageRevalidator = {
      webOrigin: this.config.WEB_ORIGIN,
      secret: this.config.REVALIDATE_SECRET,
      fetch: (input, init) => fetch(input, init),
    };
    // Payload hỏng: `deadletter` (queue không có dead-letter nên job hỏng hẳn ngay). Cùng slug trong một lô chỉ gọi web
    // một lần.
    await registerQueueWorker(this.boss, PUBLIC_PAGE_QUEUE, {
      logger: this.logger,
      label: 'Revalidate trang Sự kiện công khai',
      logContext: ({ slug }) => ({ slug }),
      parallel: true,
      dedupeBy: ({ slug }) => slug,
      handle: async ({ slug }) => {
        await revalidatePublicPage(revalidator, slug);
        return JOB_COMPLETED;
      },
    });
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
