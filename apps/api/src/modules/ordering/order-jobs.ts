import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, OrderStatus, PAYMENT_LINK_GRACE_SECONDS } from '@tickee/contracts';
import { and, asc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { BOSS, defineQueue, JOB_COMPLETED, QueueProducer, registerQueueWorker } from '../../platform/jobs/index.js';
import { releaseHeld } from './inventory.service.js';
import { notifyOrderChanged, orderSignalColumns } from './order-changed.js';
import { orderItems, orders } from './schema.js';

/*
 * Hết hạn Giữ chỗ (AD-4), một queue cho hai loại job, phân biệt bằng cờ `linked` của payload:
 * - (a) Đơn chưa có link thanh toán (Story 3.2): TX1 enqueue bằng chính `tx` tạo Đơn, `startAfter = expires_at`.
 * - (c) Đơn đã có link (Story 3.4): TX2 gắn link enqueue bằng chính `tx` của nó, `startAfter = expires_at +
 *   PAYMENT_LINK_GRACE_SECONDS` (chừa thời gian cho IPN của lần trả tiền sát giờ).
 * Worker chạy `expireOrder` theo loại. Tạo Đơn cũng gọi `expireOrder` cho Đơn chờ cũ đã quá hạn của chính Người mua
 * (job chưa chạy) trước TX1, trong transaction riêng.
 */

/**
 * Payload của job: id Đơn và cờ loại job (`linked`: (c) Đơn đã có link; thiếu → (a), như job enqueue trước Story 3.4).
 */
export const ExpireOrderPayload = z.object({ orderId: z.uuid(), linked: z.boolean().default(false) });
export type ExpireOrderPayload = z.infer<typeof ExpireOrderPayload>;

/**
 * Queue hết hạn Đơn. Retry khi chạy sớm (Đơn còn trong hạn) hay lỗi DB: 10 lần, chờ 5 giây rồi tăng gấp đôi (tối đa 5
 * phút). Hết lượt thì pg-boss chép job sang dead-letter; quét định kỳ (Story 4.6) là lưới an toàn. Lấy tối đa 20 job mỗi
 * lần, lấy tiếp ngay khi lô đầy; mỗi job một transaction ngắn, chốt riêng.
 */
export const EXPIRE_ORDER_QUEUE = defineQueue({
  name: JobQueue.ORDERING_EXPIRE_ORDER,
  deadLetter: JobQueue.ORDERING_EXPIRE_ORDER_DEAD_LETTER,
  options: { retryLimit: 10, retryDelay: 5, retryBackoff: true, retryDelayMax: 300 },
  work: { batchSize: 20, burstWhenBatchFull: true, perJobResults: true },
  payload: ExpireOrderPayload,
});
export const EXPIRE_ORDER_QUEUE_OPTIONS = EXPIRE_ORDER_QUEUE.queueOptions;

/** Loại hết hạn: (a) `hold` — Đơn chưa có link; (c) `link` — Đơn đã có link, quá hạn link + thời gian chừa. */
export type ExpiryKind = 'hold' | 'link';

const kindOf = (linked: boolean): ExpiryKind => (linked ? 'link' : 'hold');

/** Tạo queue hết hạn Đơn và dead-letter (gọi lại không sao); `updateQueue` áp lại cấu hình cho môi trường đã có queue. */
export const ensureOrderQueues = (boss: PgBoss): Promise<void> => EXPIRE_ORDER_QUEUE.ensure(boss);

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
  await EXPIRE_ORDER_QUEUE.enqueue(boss, tx, { orderId, linked: kind === 'link' }, { startAfter });
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
 * now()`. Rồi `held -= n` cho từng dòng (theo `ticket_type_id` tăng dần) và `order_changed` (Trang Đơn hiện Hết hạn),
 * cùng transaction. 0 dòng: Đơn còn `pending`, đúng loại và chưa
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
      .returning(orderSignalColumns);
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
    await releaseOrderHeld(tx, orderId);
    await notifyOrderChanged(tx, expired);
    return 'expired';
  });
}

/**
 * Nhả toàn bộ chỗ đang giữ của Đơn vừa rời `pending` (`held -= n` từng dòng, theo `ticket_type_id` tăng dần): hết hạn
 * (job, IPN `expired`/`canceled`) và `pending → review` của `markPaid` (Story 3.6).
 */
export async function releaseOrderHeld(tx: Tx, orderId: string): Promise<void> {
  const lines = await tx
    .select({ ticketTypeId: orderItems.ticketTypeId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.ticketTypeId));
  await releaseHeld(tx, lines);
}

/** Kết quả `markExpired`: Đơn vừa chuyển `expired` và đã nhả chỗ; hoặc bỏ qua (không còn `pending`, không có). */
export type MarkExpiredResult = 'expired' | 'skipped';

/**
 * Hết hạn (b) của AD-4 (Story 3.5): Tingee báo link `expired`/`canceled` (IPN, sau này cả tra trạng thái của Story 4.1).
 * Trong `tx` của bên gọi: CAS `UPDATE orders SET status = 'expired' WHERE id = :id AND status = 'pending'`, không xét
 * hạn (Tingee đã xác nhận link không còn trả được), rồi `held -= n` cho từng dòng và `order_changed`. 0 dòng (Đơn không còn `pending` hoặc
 * không có) → `skipped`, không đổi gì. Gọi song song với job (a)/(c) cho cùng Đơn thì chỉ một bên thắng CAS, nên chỗ
 * chỉ được nhả một lần. Song song với `markPaid` (khóa Đơn rồi đọc lại trạng thái): `markPaid` thắng trước thì Đơn
 * `paid`, hết hạn bỏ qua; hết hạn thắng trước thì chỗ đã nhả, khoản tiền về muộn đi nhánh bán lại có điều kiện của
 * `markPaid` (Story 3.6), nên không bao giờ vượt số suất.
 */
export async function markExpired(tx: Tx, orderId: string): Promise<MarkExpiredResult> {
  const [expired] = await tx
    .update(orders)
    .set({ status: OrderStatus.EXPIRED })
    .where(and(eq(orders.id, orderId), eq(orders.status, OrderStatus.PENDING)))
    .returning(orderSignalColumns);
  if (!expired) return 'skipped';
  await releaseOrderHeld(tx, orderId);
  await notifyOrderChanged(tx, expired);
  return 'expired';
}

/**
 * Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; trước TX1, `ready()` chờ việc đó xong (lần trước lỗi
 * thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class OrderQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, EXPIRE_ORDER_QUEUE, 'khi tạo Đơn');
  }
}

/** Vai `worker`: tạo queue và đăng ký handler hết hạn Đơn. Job chạy sớm (Đơn chưa tới hạn) → retry. */
@Injectable()
export class OrderExpiryWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OrderExpiryWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, EXPIRE_ORDER_QUEUE, {
      logger: this.logger,
      label: 'Hết hạn Đơn',
      logContext: ({ orderId }) => ({ orderId }),
      handle: async ({ orderId, linked }, job) => {
        const kind = kindOf(linked);
        const result = await expireOrder(this.db, orderId, kind);
        if (result === 'not_yet') return { status: 'retry', reason: 'Đơn chưa tới hạn' };
        this.logger.log({ jobId: job.id, orderId, kind, result }, 'Xử lý job hết hạn Đơn');
        return JOB_COMPLETED;
      },
    });
  }
}

/**
 * Job nền của `ordering` cho vai `worker` (hết hạn Giữ chỗ, (a) và (c)). Cần `DbModule` và `JobsModule` (toàn cục) ở gốc
 * DI. Không cần cấu hình Tingee.
 */
@Module({ providers: [OrderExpiryWorker] })
export class OrderingJobsModule {}
