import { JobQueue, OrderStatus } from '@tickee/contracts';
import { and, asc, eq, gt, isNotNull, or } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { dbClock, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { defineQueue, derivedJobId } from '../../platform/jobs/index.js';
import { orders } from './schema.js';

/*
 * Queue và lịch của Đối soát bù (Story 4.1, FR-20, AD-8). `payment` sở hữu việc tra (worker gọi Tingee rồi đưa kết quả
 * vào đường xử lý IPN); `ordering` khai báo queue, lịch tra và read model Đơn để TX2 gắn link (`payment-link.ts`)
 * enqueue job đầu bằng chính `tx` mà không import `payment`. Trạng thái chuỗi nằm trong job pg-boss (payload
 * `{ orderId, failures }`), không có cột hay bảng riêng.
 *
 * Lịch tra theo đồng hồ DB, neo vào cột của Đơn (`expires_at` = `payment_link_attempt_at` + 15 phút sau TX2):
 * - Đơn `pending`: `payment_link_attempt_at` + 2, + 5, + 10 phút, rồi `expires_at` (và các mốc sau hết hạn bên dưới, khi
 *   job (c) chưa kịp hết hạn Đơn).
 * - Đơn `expired` từng có link: `expires_at` + 30 phút, + 2 giờ, + 24 giờ.
 * Mỗi job xong thì enqueue mốc kế tiếp lớn hơn đồng hồ DB (mốc đã qua vì worker chậm thì bỏ); hết mốc, hay Đơn không còn
 * `pending`/`expired`, thì dừng. Tra lỗi thì tra lại cùng mốc sau 1, 2, 4 phút; lỗi lần thứ 4 liên tiếp thì dừng.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Mốc tra của Đơn `pending`, tính từ `payment_link_attempt_at`. */
export const RECONCILE_AFTER_ATTEMPT_MS = [2 * MINUTE_MS, 5 * MINUTE_MS, 10 * MINUTE_MS] as const;

/** Mốc tra sau khi Đơn hết hạn, tính từ `expires_at`. */
export const RECONCILE_AFTER_EXPIRY_MS = [30 * MINUTE_MS, 2 * HOUR_MS, 24 * HOUR_MS] as const;

/** Tra lỗi lần thứ n (1, 2, 3) thì tra lại cùng mốc sau `RECONCILE_RETRY_DELAYS_MS[n - 1]`. */
export const RECONCILE_RETRY_DELAYS_MS = [MINUTE_MS, 2 * MINUTE_MS, 4 * MINUTE_MS] as const;

/** Lỗi liên tiếp lần thứ này thì dừng chuỗi và cảnh báo vận hành. */
export const RECONCILE_MAX_FAILURES = RECONCILE_RETRY_DELAYS_MS.length + 1;

/**
 * Payload job tra: id Đơn và số lần tra lỗi liên tiếp trước job này (0 = job của một mốc; 1–3 = tra lại cùng mốc). Không
 * credential, không PII.
 */
export const ReconcileOrderPayload = z.object({
  orderId: z.uuid(),
  failures: z
    .int()
    .min(0)
    .max(RECONCILE_MAX_FAILURES - 1)
    .default(0),
});
export type ReconcileOrderPayload = z.infer<typeof ReconcileOrderPayload>;

/**
 * Queue tra trạng thái đơn Gateway. Lỗi Tingee không đi retry của pg-boss (worker tự enqueue lần tra lại theo lịch
 * riêng); retry ở đây chỉ cho lỗi DB khi xử lý: 5 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 10 phút), hết lượt thì sang
 * dead-letter. Worker tra tuần tự (không song song trong lô): việc này chỉ giới hạn số lời gọi đồng thời, không bảo đảm
 * dưới giới hạn 20 request/10 giây của Tingee (Tingee trả nhanh vẫn vượt, nhân thêm số instance worker). Giới hạn tốc độ
 * chưa được thực thi; tải đo ở Story 5.8 (`deferred-work.md`).
 */
export const RECONCILE_ORDER_QUEUE = defineQueue({
  name: JobQueue.PAYMENT_RECONCILE_ORDER,
  deadLetter: JobQueue.PAYMENT_RECONCILE_ORDER_DEAD_LETTER,
  options: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: ReconcileOrderPayload,
});
export const RECONCILE_ORDER_QUEUE_OPTIONS = RECONCILE_ORDER_QUEUE.queueOptions;

/** Phần của Đơn quyết định lịch tra. `attemptAt`: `payment_link_attempt_at` (luôn có sau TX2). */
export interface ReconcileSchedule {
  status: OrderStatus;
  attemptAt: Date | null;
  expiresAt: Date;
}

const plus = (at: Date, ms: number): Date => new Date(at.getTime() + ms);

/** Mọi mốc tra của Đơn theo trạng thái hiện tại, tăng dần; Đơn không còn `pending`/`expired` → rỗng. */
export function reconcileCheckpoints({ status, attemptAt, expiresAt }: ReconcileSchedule): Date[] {
  const afterExpiry = RECONCILE_AFTER_EXPIRY_MS.map((ms) => plus(expiresAt, ms));
  if (status === OrderStatus.EXPIRED) return afterExpiry;
  if (status !== OrderStatus.PENDING) return [];
  const afterAttempt = attemptAt ? RECONCILE_AFTER_ATTEMPT_MS.map((ms) => plus(attemptAt, ms)) : [];
  return [...afterAttempt, expiresAt, ...afterExpiry].sort((a, b) => a.getTime() - b.getTime());
}

/** Mốc tra kế tiếp: mốc đầu tiên lớn hơn `now` (đồng hồ DB); không còn mốc → `null`. Hàm thuần. */
export function nextCheckAt(order: ReconcileSchedule, now: Date): Date | null {
  return reconcileCheckpoints(order).find((at) => at.getTime() > now.getTime()) ?? null;
}

/** Mốc tra đầu tiên của một link vừa gắn (TX2): `payment_link_attempt_at` + 2 phút. */
export const firstCheckAt = (attemptAt: Date): Date => plus(attemptAt, RECONCILE_AFTER_ATTEMPT_MS[0]);

/** Id job cố định của mốc `checkAt` (chưa lỗi lần nào) cho Đơn `orderId`. */
export const reconcileJobId = (orderId: string, checkAt: Date): string =>
  derivedJobId(orderId, `${JobQueue.PAYMENT_RECONCILE_ORDER}:${checkAt.toISOString()}:0`);

/**
 * Id job cố định của lần tra lại thứ `failures` sau job `parentJobId` (cùng mốc). Job gốc của mốc có id cố định theo
 * (Đơn, mốc), nên chuỗi tra lại cũng cố định theo (Đơn, mốc, số lần lỗi): job chạy lại không tạo thêm job.
 */
export const reconcileRetryJobId = (parentJobId: string, failures: number): string =>
  derivedJobId(parentJobId, `${JobQueue.PAYMENT_RECONCILE_ORDER}:failures:${failures}`);

/**
 * Enqueue job tra của mốc `checkAt` bằng chính `tx` của người gọi (`tx` rollback thì không có job), id cố định theo (Đơn,
 * mốc): đã có thì không làm gì. TX2 gọi với mốc đầu; người gọi đã `OrderQueues.ready()` trước transaction.
 */
export async function enqueueReconciliation(boss: PgBoss, tx: Tx, orderId: string, checkAt: Date): Promise<void> {
  await RECONCILE_ORDER_QUEUE.enqueue(
    boss,
    tx,
    { orderId, failures: 0 },
    { startAfter: checkAt, id: reconcileJobId(orderId, checkAt) },
  );
}

/** Phần của Đơn mà job tra cần (Story 4.1). Không có PII. */
export interface OrderForReconciliation extends ReconcileSchedule {
  id: string;
  code: string;
  organizationId: string;
  /** Tài khoản nhận tiền chụp ở TX2: credential của nó ký lời gọi tra. */
  payoutAccountId: string | null;
}

/** Đơn theo id cho job tra, không khóa; không có → `null`. */
export async function orderForReconciliation(db: DbExecutor, orderId: string): Promise<OrderForReconciliation | null> {
  const [row] = await db
    .select({
      id: orders.id,
      code: orders.code,
      organizationId: orders.organizationId,
      status: orders.status,
      payoutAccountId: orders.payoutAccountId,
      attemptAt: orders.paymentLinkAttemptAt,
      expiresAt: orders.expiresAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  return row ?? null;
}

/** Đơn `expired` còn được Đối soát bù khi mở lại dịch vụ: `expires_at` trong chừng này trước (mốc sau hết hạn cuối cùng). */
export const RECONCILE_RESUMED_EXPIRED_WINDOW_MS = RECONCILE_AFTER_EXPIRY_MS[RECONCILE_AFTER_EXPIRY_MS.length - 1]!;

/**
 * Đơn còn mở của BTC để Đối soát bù khi dịch vụ thanh toán mở lại (Story 4.2): Đơn đã có link (`payment_link`), còn
 * `pending`, hoặc `expired` với `expires_at` trong `RECONCILE_RESUMED_EXPIRED_WINDOW_MS` trước `now` (đồng hồ DB của người
 * gọi). Theo lúc tạo rồi id. Không có index `(organization_id, status)`: quét theo BTC, chỉ chạy mỗi lần mở lại.
 */
export async function reconcilableOrderIdsOf(db: DbExecutor, organizationId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - RECONCILE_RESUMED_EXPIRED_WINDOW_MS);
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, organizationId),
        isNotNull(orders.paymentLink),
        or(
          eq(orders.status, OrderStatus.PENDING),
          and(eq(orders.status, OrderStatus.EXPIRED), gt(orders.expiresAt, since)),
        ),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(orders.id));
  return rows.map((row) => row.id);
}

/**
 * Sau một lần tra được: đọc lại Đơn và đồng hồ DB rồi enqueue mốc kế (`nextCheckAt`, chưa lỗi lần nào), trong một
 * transaction. Trả mốc đã enqueue; Đơn không còn `pending`/`expired`, hết mốc, hay không có Đơn → `null` (dừng chuỗi).
 */
export async function scheduleNextReconciliation(boss: PgBoss, db: Database, orderId: string): Promise<Date | null> {
  return db.transaction(async (tx) => {
    const order = await orderForReconciliation(tx, orderId);
    if (!order) return null;
    const next = nextCheckAt(order, await dbClock(tx));
    if (next) await enqueueReconciliation(boss, tx, orderId, next);
    return next;
  });
}

/**
 * Sau lần tra lỗi thứ `failures` (1–3) của job `parentJobId`: enqueue lần tra lại cùng mốc sau
 * `RECONCILE_RETRY_DELAYS_MS[failures - 1]` theo đồng hồ DB, id cố định (`reconcileRetryJobId`). Trả mốc chạy.
 */
export async function scheduleReconciliationRetry(
  boss: PgBoss,
  db: Database,
  input: { parentJobId: string; orderId: string; failures: number },
): Promise<Date> {
  const delay = RECONCILE_RETRY_DELAYS_MS[input.failures - 1];
  if (delay === undefined) throw new Error(`Đối soát bù: không có lần tra lại thứ ${input.failures}`);
  return db.transaction(async (tx) => {
    const startAfter = plus(await dbClock(tx), delay);
    await RECONCILE_ORDER_QUEUE.enqueue(
      boss,
      tx,
      { orderId: input.orderId, failures: input.failures },
      { startAfter, id: reconcileRetryJobId(input.parentJobId, input.failures) },
    );
    return startAfter;
  });
}
