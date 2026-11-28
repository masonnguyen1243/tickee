import { Inject, Injectable } from '@nestjs/common';
import { BuyerEmailKind, OrderCancelReason, OrderStatus } from '@tickee/contracts';
import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { audit } from '../../platform/audit/index.js';
import type { Tx } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { enqueueSheetRowChanged, SheetRowChangedQueues } from '../ticketing/index.js';
import { BuyerEmailQueues, enqueueBuyerEmail } from './buyer-email-jobs.js';
import { notifyOrderChanged, orderSignalColumns } from './order-changed.js';
import { orders } from './schema.js';

/*
 * Quyết định của BTC trên Đơn `review` (Story 4.4, AD-3): hai chuyển trạng thái mà `payment` gọi từ thao tác trên mục Cần
 * xử lý, trong `tx` của bên gọi (đã khóa mục). Mỗi chuyển là một CAS theo mẫu `markExpired`, thêm `AND organization_id =
 * :ctxOrg` (thành viên BTC chỉ đổi được Đơn của chính BTC mình); thắng thì audit (actor = người bấm), phát
 * `order_changed` + `event_orders_changed` và enqueue `integration.sheet_row_changed` (Story 6.5) trong cùng `tx`. 0 dòng
 * → `false`, không đổi gì (bên gọi trả `409`). Không có `review → refunded`: phải từ chối trước.
 */

/** Thành viên BTC `organizationId` đang ra quyết định trên Đơn `orderId`. */
export interface OrderDecision {
  orderId: string;
  organizationId: string;
  actorUserId: string;
}

@Injectable()
export class OrderReviewDecisions {
  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(BuyerEmailQueues) private readonly emailQueues: BuyerEmailQueues,
    @Inject(SheetRowChangedQueues) private readonly sheetQueues: SheetRowChangedQueues,
  ) {}

  /**
   * pg-boss đã start, queue email Người mua và queue `sheet_row_changed` đã có: `reject` và `refund` enqueue trong `tx` của
   * bên gọi, nên gọi trước transaction.
   */
  async ready(): Promise<void> {
    await Promise.all([this.emailQueues.ready(), this.sheetQueues.ready()]);
  }

  /**
   * "Từ chối": CAS `review → cancelled` kèm `cancel_reason = 'rejected'`, enqueue email `order_rejected` cho Người mua
   * (id job cố định theo Đơn) và `sheet_row_changed`, audit `order.rejected`, tín hiệu Đơn. Chỗ không đổi: Đơn `review`
   * không giữ chỗ.
   */
  async reject(tx: Tx, decision: OrderDecision): Promise<boolean> {
    const [rejected] = await tx
      .update(orders)
      .set({ status: OrderStatus.CANCELLED, cancelReason: OrderCancelReason.REJECTED })
      .where(
        and(
          eq(orders.id, decision.orderId),
          eq(orders.organizationId, decision.organizationId),
          eq(orders.status, OrderStatus.REVIEW),
        ),
      )
      .returning(orderSignalColumns);
    if (!rejected) return false;
    await enqueueBuyerEmail(this.boss, tx, BuyerEmailKind.ORDER_REJECTED, rejected.id);
    await enqueueSheetRowChanged(this.boss, tx, { eventId: rejected.eventId, orderId: rejected.id });
    await audit.record(tx, {
      actorUserId: decision.actorUserId,
      organizationId: rejected.organizationId,
      action: 'order.rejected',
      target: { type: 'order', id: rejected.id },
    });
    await notifyOrderChanged(tx, rejected);
    return true;
  }

  /**
   * "Đã hoàn tay" trên Đơn đã từ chối: CAS `cancelled → refunded` chỉ khi `cancel_reason = 'rejected'` (lý do giữ nguyên),
   * enqueue `sheet_row_changed`, audit `order.refunded`, tín hiệu Đơn. Không email mới: job `order_rejected` enqueue lúc
   * từ chối vẫn gửi khi Đơn đã `refunded` (kể cả khi job chưa chạy xong lúc bấm).
   */
  async refund(tx: Tx, decision: OrderDecision): Promise<boolean> {
    const [refunded] = await tx
      .update(orders)
      .set({ status: OrderStatus.REFUNDED })
      .where(
        and(
          eq(orders.id, decision.orderId),
          eq(orders.organizationId, decision.organizationId),
          eq(orders.status, OrderStatus.CANCELLED),
          eq(orders.cancelReason, OrderCancelReason.REJECTED),
        ),
      )
      .returning(orderSignalColumns);
    if (!refunded) return false;
    await enqueueSheetRowChanged(this.boss, tx, { eventId: refunded.eventId, orderId: refunded.id });
    await audit.record(tx, {
      actorUserId: decision.actorUserId,
      organizationId: refunded.organizationId,
      action: 'order.refunded',
      target: { type: 'order', id: refunded.id },
    });
    await notifyOrderChanged(tx, refunded);
    return true;
  }
}
