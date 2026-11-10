import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, OrderStatus, PAYMENT_LINK_GRACE_SECONDS } from '@tickee/contracts';
import { and, asc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { fromDrizzle, type JobResult, type PgBoss, type Queue, type WorkOptions } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../../platform/logging/index.js';
import { releaseHeld } from './inventory.service.js';
import { orderItems, orders } from './schema.js';

/*
 * Hết hạn Giữ chỗ (AD-4), một queue cho hai loại job, phân biệt bằng cờ `linked` của payload:
 * - (a) Đơn chưa có link thanh toán (Story 3.2): TX1 enqueue bằng chính `tx` tạo Đơn, `startAfter = expires_at`.
 * - (c) Đơn đã có link (Story 3.4): TX2 gắn link enqueue bằng chính `tx` của nó, `startAfter = expires_at +
 *   PAYMENT_LINK_GRACE_SECONDS` (chừa thời gian cho IPN của lần trả tiền sát giờ).
 * Worker chạy `expireOrder` theo loại. Tạo Đơn cũng gọi `expireOrder` cho Đơn chờ cũ đã quá hạn của chính Người mua
 * (job chưa chạy) trước TX1, trong transaction riêng.
 */

const QUEUE = JobQueue.ORDERING_EXPIRE_ORDER;
const DEAD_LETTER = JobQueue.ORDERING_EXPIRE_ORDER_DEAD_LETTER;

/**
 * Retry khi chạy sớm (Đơn còn trong hạn) hay lỗi DB: 10 lần, chờ 5 giây rồi tăng gấp đôi (tối đa 5 phút). Hết lượt thì
 * pg-boss chép job sang dead-letter; quét định kỳ (Story 4.6) là lưới an toàn.
 */
export const EXPIRE_ORDER_QUEUE_OPTIONS = {
  retryLimit: 10,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 300,
  deadLetter: DEAD_LETTER,
} as const satisfies Omit<Queue, 'name'>;

/** Lấy tối đa 20 job mỗi lần, lấy tiếp ngay khi lô đầy; mỗi job một transaction ngắn, chốt riêng. */
const WORK_OPTIONS = { batchSize: 20, burstWhenBatchFull: true, perJobResults: true } as const satisfies WorkOptions;

/**
 * Payload của job: id Đơn và cờ loại job (`linked`: (c) Đơn đã có link; thiếu → (a), như job enqueue trước Story 3.4).
 */
export const ExpireOrderPayload = z.object({ orderId: z.uuid(), linked: z.boolean().default(false) });
export type ExpireOrderPayload = z.infer<typeof ExpireOrderPayload>;

/** Loại hết hạn: (a) `hold` — Đơn chưa có link; (c) `link` — Đơn đã có link, quá hạn link + thời gian chừa. */
export type ExpiryKind = 'hold' | 'link';

const kindOf = (linked: boolean): ExpiryKind => (linked ? 'link' : 'hold');

/** Tạo queue hết hạn Đơn và dead-letter (gọi lại không sao); `updateQueue` áp lại cấu hình cho môi trường đã có queue. */
export async function ensureOrderQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER);
  await boss.createQueue(QUEUE, EXPIRE_ORDER_QUEUE_OPTIONS);
  await boss.updateQueue(QUEUE, EXPIRE_ORDER_QUEUE_OPTIONS);
}

/**
 * Enqueue job hết hạn bằng chính `tx` của người gọi (`tx` rollback thì không có job), chạy từ `startAfter`: (a) từ TX1
 * với `startAfter = expires_at`; (c) từ TX2 với `startAfter = expires_at + PAYMENT_LINK_GRACE_SECONDS`. Người gọi đã
 * `OrderQueues.ready()` trước transaction. Không có singleton key: (a) và (c) của cùng Đơn cùng tồn tại được.
 */
export async function enqueueOrderExpiry(
  boss: PgBoss,
  tx: Tx,
  orderId: string,
  startAfter: Date,
  kind: ExpiryKind = 'hold',
): Promise<void> {
  const payload: ExpireOrderPayload = { orderId, linked: kind === 'link' };
  const jobId = await boss.send(QUEUE, payload, { db: fromDrizzle(tx, sql), startAfter });
  if (!jobId) throw new Error(`pg-boss không tạo job ${QUEUE}`);
}

/** Hạn của Đơn theo loại: (a) `expires_at`; (c) `expires_at + PAYMENT_LINK_GRACE_SECONDS`. */
const deadlineOf = (kind: ExpiryKind): SQL =>
  kind === 'hold'
    ? sql`${orders.expiresAt}`
    : sql`${orders.expiresAt} + make_interval(secs => ${PAYMENT_LINK_GRACE_SECONDS})`;

/** (a) chỉ chạm Đơn chưa có link; (c) chỉ chạm Đơn đã có link. */
const linkConditionOf = (kind: ExpiryKind): SQL =>
  kind === 'hold' ? isNull(orders.paymentLink) : isNotNull(orders.paymentLink);

/** Kết quả `expireOrder`: đã hết hạn và nhả chỗ; bỏ qua (đã có link, không còn `pending`, không có); còn trong hạn. */
export type ExpireOrderResult = 'expired' | 'skipped' | 'not_yet';

/**
 * Hết hạn trong một transaction. (a) `hold`: `UPDATE orders SET status = 'expired' WHERE id = :id AND status = 'pending'
 * AND payment_link IS NULL AND expires_at < now()`. (c) `link`: `… AND payment_link IS NOT NULL AND expires_at + 5 phút <
 * now()`. Rồi `held -= n` cho từng dòng (theo `ticket_type_id` tăng dần). 0 dòng: Đơn còn `pending`, đúng loại và chưa
 * tới hạn → `not_yet` (job chạy sớm: retry); còn lại (đã có link với (a), chưa có link với (c), không còn `pending`, không
 * có) → `skipped`. Gọi song song cho cùng Đơn thì chỉ một lần nhả chỗ (CAS).
 */
export async function expireOrder(db: Database, orderId: string, kind: ExpiryKind = 'hold'): Promise<ExpireOrderResult> {
  const deadline = deadlineOf(kind);
  return db.transaction(async (tx) => {
    const [expired] = await tx
      .update(orders)
      .set({ status: OrderStatus.EXPIRED })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.status, OrderStatus.PENDING),
          linkConditionOf(kind),
          lt(deadline, sql`now()`),
        ),
      )
      .returning({ id: orders.id });
    if (!expired) {
      const [early] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.status, OrderStatus.PENDING),
            linkConditionOf(kind),
            gte(deadline, sql`now()`),
          ),
        );
      return early ? 'not_yet' : 'skipped';
    }
    const lines = await tx
      .select({ ticketTypeId: orderItems.ticketTypeId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.ticketTypeId));
    await releaseHeld(tx, lines);
    return 'expired';
  });
}

/**
 * Vai `api`: start pg-boss (chế độ `producer`) và tạo queue ngay lúc khởi động, không chặn khởi động khi DB chưa sẵn
 * sàng. Trước TX1, `ready()` chờ việc đó xong (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class OrderQueues implements OnApplicationBootstrap {
  private readonly logger = new Logger('OrderQueues');
  private pending: Promise<void> | null = null;

  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  onApplicationBootstrap(): void {
    this.ready().catch((err: unknown) =>
      this.logger.warn({ err }, `Chưa tạo được queue ${QUEUE}; sẽ thử lại khi tạo Đơn`),
    );
  }

  ready(): Promise<void> {
    this.pending ??= (async () => {
      await this.boss.start();
      await ensureOrderQueues(this.boss);
    })().catch((err: unknown) => {
      this.pending = null;
      throw err;
    });
    return this.pending;
  }
}

/** Vai `worker`: tạo queue và đăng ký handler hết hạn Đơn. */
@Injectable()
export class OrderExpiryWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OrderExpiryWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureOrderQueues(this.boss);
    // `failed` → pg-boss retry theo cấu hình queue, hết lượt thì sang dead-letter. Payload hỏng thì retry vô ích: sang
    // dead-letter ngay.
    await this.boss.work<unknown>(QUEUE, WORK_OPTIONS, async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        const payload = ExpireOrderPayload.safeParse(job.data);
        if (!payload.success) {
          results.push({ id: job.id, status: 'deadletter', output: { error: 'Payload không hợp lệ' } });
          continue;
        }
        const { orderId, linked } = payload.data;
        const kind = kindOf(linked);
        try {
          const result = await expireOrder(this.db, orderId, kind);
          if (result === 'not_yet') {
            results.push({ id: job.id, status: 'failed', output: { error: 'Đơn chưa tới hạn' } });
            continue;
          }
          this.logger.log({ jobId: job.id, orderId, kind, result }, 'Xử lý job hết hạn Đơn');
          results.push({ id: job.id, status: 'completed' });
        } catch (err) {
          // Lỗi DB chỉ ghi `{ type, code }` (job lưu `output` vào DB, log không được mang tham số truy vấn).
          const error = isDatabaseError(err)
            ? JSON.stringify(dbErrorSummary(err))
            : err instanceof Error
              ? err.message
              : 'Lỗi không rõ';
          this.logger.warn({ jobId: job.id, orderId, error }, 'Hết hạn Đơn thất bại; pg-boss sẽ thử lại');
          results.push({ id: job.id, status: 'failed', output: { error } });
        }
      }
      return results;
    });
    this.logger.log(`Đã đăng ký job ${QUEUE}`);
  }
}

/**
 * Job nền của `ordering` cho vai `worker` (hết hạn Giữ chỗ, (a) và (c)). Cần `DbModule` và `JobsModule` (toàn cục) ở gốc
 * DI. Không cần cấu hình Tingee.
 */
@Module({ providers: [OrderExpiryWorker] })
export class OrderingJobsModule {}
