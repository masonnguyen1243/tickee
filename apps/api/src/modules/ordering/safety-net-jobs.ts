import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, ORDER_RATE_LIMITS, OrderStatus } from '@tickee/contracts';
import { asc, eq, lt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { OpsAlertKind, OpsAlerts } from '../../platform/alerts/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { BOSS, defineQueue, errorName, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../../platform/logging/index.js';
import { issuedTicketCountsByType } from '../ticketing/index.js';
import { expireOrder, expiryKindOf, overduePending, type ExpireOrderResult, type ExpiryKind } from './order-jobs.js';
import { orderCreateAttempts, orderItems, orders, ticketTypeInventory } from './schema.js';

/*
 * Lưới an toàn định kỳ của `ordering` (Story 4.6-c), chỉ vai worker. Hai cron, không payload, không retry, không
 * dead-letter (lượt kế làm lại), theo mẫu của `organizer/token-alert-jobs.ts`:
 * - `ordering.safety-sweep` mỗi phút: cho hết hạn Đơn `pending` đã quá hạn mà job hoãn `ordering.expire-order` bỏ sót
 *   (không được enqueue, hoặc hết retry), bằng chính `expireOrder`; báo kênh `platform/alerts`; rồi xóa bộ đếm tạo Đơn
 *   đã ra khỏi cửa sổ giới hạn tốc độ.
 * - `ordering.inventory-check` mỗi 10 phút: đối chiếu tồn kho với Đơn `pending` và Vé đã phát (AD-2), báo lệch qua kênh
 *   `platform/alerts`. Không bao giờ sửa tồn kho, không gọi Tingee.
 * Hàm quét (`sweepOverdueOrders`), dọn (`purgeOrderCreateAttempts`) và đối chiếu (`checkInventory`) gọi thẳng được.
 */

/** Lịch của lưới an toàn hết hạn Đơn: mỗi phút. */
export const SAFETY_SWEEP_CRON = '* * * * *';

/** Lịch của đối chiếu tồn kho: mỗi 10 phút. */
export const INVENTORY_CHECK_CRON = '*/10 * * * *';

/**
 * Giây chờ thêm sau mốc hết hạn trước khi lưới an toàn ra tay: job hoãn chạy đúng mốc (poll 2 giây, retry có backoff),
 * nên lưới chạy ngay ở mốc sẽ đua với job, và log "bỏ sót" thành nhiễu sau mỗi lần deploy.
 */
export const SAFETY_SWEEP_GRACE_SECONDS = 120;

/** Số Đơn tối đa mỗi lượt quét (cũ nhất trước); phần còn lại để lượt sau. */
export const SAFETY_SWEEP_LIMIT = 200;

const logger = new Logger('OrderSafetyNet');

/** Kênh và DB mà các hàm của lưới an toàn dùng. */
export interface SafetyNet {
  db: Database;
  alerts: OpsAlerts;
}

/** Lỗi đưa vào log: lỗi DB chỉ còn `{ type, code }` (message/params có thể mang dữ liệu), lỗi khác chỉ tên lớp. */
const errorSummary = (err: unknown) => (isDatabaseError(err) ? dbErrorSummary(err) : { type: errorName(err) });

/** Một Đơn lượt quét đã xét: kết quả của `expireOrder`, hoặc `error` (đã log `warn`; lượt sau thử lại). */
export interface SweptOrder {
  orderId: string;
  orderCode: string;
  kind: ExpiryKind;
  result: ExpireOrderResult | 'error';
}

/**
 * Một lượt quét: tối đa `limit` Đơn `pending` đã quá mốc hết hạn của loại mình thêm `SAFETY_SWEEP_GRACE_SECONDS`
 * (`overduePending`), theo `expires_at` tăng dần. Mỗi Đơn gọi `expireOrder` theo loại (mỗi Đơn một transaction, CAS trên
 * `pending`: đua với job hoãn, IPN hay Đối soát bù thì chỉ một bên thắng). Đơn thực sự chuyển `expired` → log `warn`
 * kèm mã Đơn và loại. Một Đơn lỗi chỉ log `warn` rồi sang Đơn kế. Có Đơn chuyển `expired` thì một lần `raise`
 * `pending_order_overdue` (mỗi mã Đơn một lần), `details: { orders: n }`; `raise` không bao giờ ném.
 */
export async function sweepOverdueOrders(net: SafetyNet, limit = SAFETY_SWEEP_LIMIT): Promise<SweptOrder[]> {
  const overdue = await net.db.orm
    .select({
      id: orders.id,
      code: orders.code,
      organizationId: orders.organizationId,
      paymentLink: orders.paymentLink,
    })
    .from(orders)
    .where(overduePending(SAFETY_SWEEP_GRACE_SECONDS))
    .orderBy(asc(orders.expiresAt), asc(orders.id))
    .limit(limit);

  const swept: SweptOrder[] = [];
  for (const order of overdue) {
    const kind = expiryKindOf(order.paymentLink);
    const context = { orderId: order.id, orderCode: order.code, organizationId: order.organizationId, kind };
    let result: SweptOrder['result'];
    try {
      result = await expireOrder(net.db, order.id, kind);
    } catch (err) {
      result = 'error';
      logger.warn(
        { ...context, error: errorSummary(err) },
        'Lưới an toàn: không cho hết hạn được Đơn quá hạn; lượt sau thử lại',
      );
    }
    if (result === 'expired') {
      logger.warn(
        context,
        'Lưới an toàn: Đơn quá hạn hơn 2 phút mà job hết hạn chưa xử lý (không được enqueue, lỗi đang retry, hoặc worker ngừng); đã cho hết hạn và nhả chỗ',
      );
    }
    swept.push({ orderId: order.id, orderCode: order.code, kind, result });
  }

  const expired = swept.filter((order) => order.result === 'expired');
  if (expired.length > 0) {
    await net.alerts.raise({
      kind: OpsAlertKind.PENDING_ORDER_OVERDUE,
      subjects: expired.map((order) => order.orderCode),
      details: { orders: expired.length },
    });
  }
  return swept;
}

/**
 * Xóa bộ đếm tạo Đơn đã ra khỏi cửa sổ giới hạn tốc độ (cũ hơn `ORDER_RATE_LIMITS.windowSeconds`, đồng hồ DB): giới hạn
 * chỉ đếm lần thử trong cửa sổ, nên dòng cũ hơn không còn tác dụng. Idempotent. Trả số dòng đã xóa.
 */
export async function purgeOrderCreateAttempts(db: Database): Promise<number> {
  const result = await db.orm
    .delete(orderCreateAttempts)
    .where(lt(orderCreateAttempts.createdAt, sql`now() - make_interval(secs => ${ORDER_RATE_LIMITS.windowSeconds})`));
  return result.rowCount ?? 0;
}

/** Một Hạng vé lệch: tồn kho (`held`, `sold`) và số thực tế (tổng Vé của Đơn `pending`, số Vé đã phát). */
export interface InventoryDrift {
  ticketTypeId: string;
  eventId: string;
  held: number;
  pending: number;
  sold: number;
  issued: number;
}

/** Subject chống lặp của một Hạng vé lệch: mang số liệu, nên số đổi thì báo lại, giữ nguyên thì không. */
export const inventoryDriftSubject = (d: InventoryDrift): string =>
  `${d.ticketTypeId}:held=${d.held}/${d.pending}:sold=${d.sold}/${d.issued}`;

/** Snapshot của đối chiếu: mọi câu đọc (của `ordering` và của `ticketing`) cùng nhìn một trạng thái; chỉ đọc. */
const CHECK_TRANSACTION = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * Đối chiếu tồn kho trong một transaction REPEATABLE READ chỉ đọc: mọi dòng `ticket_type_inventory`, tổng
 * `order_items.quantity` của Đơn `pending` theo Hạng vé, và số Vé đã phát theo Hạng vé (mọi trạng thái, qua `ticketing`).
 * Mỗi chuyển trạng thái đổi Đơn, tồn kho và Vé trong cùng transaction, nên snapshot nhất quán không báo lệch giả. Lệch
 * khi `held` ≠ tổng `pending` hoặc `sold` ≠ số Vé đã phát: mỗi Hạng vé lệch log `error` kèm `ticketTypeId`, `eventId` và
 * bốn con số; mọi Hạng vé lệch đi chung một `raise` `inventory_drift` (subject `inventoryDriftSubject`). Không bao giờ
 * sửa tồn kho. Trả các Hạng vé lệch (theo `ticket_type_id`).
 */
export async function checkInventory(net: SafetyNet): Promise<InventoryDrift[]> {
  const drifts = await net.db.orm.transaction(async (tx) => {
    const inventory = await tx
      .select({
        ticketTypeId: ticketTypeInventory.ticketTypeId,
        eventId: ticketTypeInventory.eventId,
        held: ticketTypeInventory.held,
        sold: ticketTypeInventory.sold,
      })
      .from(ticketTypeInventory)
      .orderBy(asc(ticketTypeInventory.ticketTypeId));
    const pendingRows = await tx
      .select({ ticketTypeId: orderItems.ticketTypeId, quantity: sql<number>`sum(${orderItems.quantity})::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orders.status, OrderStatus.PENDING))
      .groupBy(orderItems.ticketTypeId);
    const issued = await issuedTicketCountsByType(tx);
    const pending = new Map(pendingRows.map((row) => [row.ticketTypeId, Number(row.quantity)]));
    return inventory
      .map(
        (row): InventoryDrift => ({
          ...row,
          pending: pending.get(row.ticketTypeId) ?? 0,
          issued: issued.get(row.ticketTypeId) ?? 0,
        }),
      )
      .filter((row) => row.held !== row.pending || row.sold !== row.issued);
  }, CHECK_TRANSACTION);

  for (const drift of drifts) {
    logger.error(drift, 'Đối chiếu tồn kho: Hạng vé lệch với Đơn đang chờ hoặc Vé đã phát; không tự sửa');
  }
  if (drifts.length > 0) {
    await net.alerts.raise({
      kind: OpsAlertKind.INVENTORY_DRIFT,
      subjects: drifts.map(inventoryDriftSubject),
      // Mọi Hạng vé đang lệch ở lượt này (kể cả subject đã báo), khác với số "mục mới" của email.
      details: { driftingTicketTypes: drifts.length },
    });
  }
  return drifts;
}

/** Queue cron của lưới an toàn hết hạn Đơn: không payload (pg-boss gửi `null`), không retry, không dead-letter. */
export const SAFETY_SWEEP_QUEUE = defineQueue({
  name: JobQueue.ORDERING_SAFETY_SWEEP,
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: z.unknown(),
});

/** Queue cron của đối chiếu tồn kho: không payload (pg-boss gửi `null`), không retry, không dead-letter. */
export const INVENTORY_CHECK_QUEUE = defineQueue({
  name: JobQueue.ORDERING_INVENTORY_CHECK,
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: z.unknown(),
});

/**
 * Vai `worker`: tạo hai queue, lên lịch (upsert: nhiều worker vẫn một lịch) và đăng ký handler. Hai lượt chồng nhau
 * (nhiều worker) vẫn đúng: hết hạn là CAS, dọn bộ đếm idempotent, `raise` tự chống lặp.
 */
@Injectable()
export class OrderSafetyNetWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OrderSafetyNetWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(OpsAlerts) private readonly alerts: OpsAlerts,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const net: SafetyNet = { db: this.db, alerts: this.alerts };
    await registerQueueWorker(this.boss, SAFETY_SWEEP_QUEUE, {
      logger: this.logger,
      label: 'Lưới an toàn hết hạn Đơn',
      logContext: () => ({}),
      handle: async () => {
        await sweepOverdueOrders(net);
        await purgeOrderCreateAttempts(this.db);
        return JOB_COMPLETED;
      },
    });
    await this.boss.schedule(SAFETY_SWEEP_QUEUE.name, SAFETY_SWEEP_CRON);
    await registerQueueWorker(this.boss, INVENTORY_CHECK_QUEUE, {
      logger: this.logger,
      label: 'Đối chiếu tồn kho',
      logContext: () => ({}),
      handle: async () => {
        await checkInventory(net);
        return JOB_COMPLETED;
      },
    });
    await this.boss.schedule(INVENTORY_CHECK_QUEUE.name, INVENTORY_CHECK_CRON);
  }
}
