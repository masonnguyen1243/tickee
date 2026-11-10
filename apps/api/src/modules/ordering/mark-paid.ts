import { Inject, Injectable } from '@nestjs/common';
import { FunnelEventType, OrderStatus } from '@tickee/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { audit } from '../../platform/audit/index.js';
import type { Tx } from '../../platform/db/index.js';
import { lockEventByIdForShare } from '../event/index.js';
import { TicketsService } from '../ticketing/index.js';
import { checkoutFunnelEvents, orderItems, orders, type PaidSource } from './schema.js';

/**
 * Kết quả `markPaid` (AD-1): `paid` — Đơn vừa chuyển `paid` và Vé đã phát; `lost_race` — Đơn không còn `pending` (một
 * lần gọi khác đã chuyển trước), không phát gì. `orphan`, `mismatch`, `event_cancelled` thuộc nhánh có phí (Story
 * 3.5/3.6): bên gọi tạo `review_item` trong cùng `tx`. Story 3.3 chỉ trả `paid` hoặc `lost_race`.
 */
export type MarkPaidResult = 'paid' | 'orphan' | 'mismatch' | 'event_cancelled' | 'lost_race';

/*
 * Đường duy nhất phát Vé (AD-1, Story 3.3): mọi nguồn ghi nhận thanh toán (`PAID_SOURCES`) đi qua `markPaid` trong `tx`
 * của bên gọi. Một transaction: khóa Sự kiện `FOR SHARE` → CAS Đơn `pending` → `paid` (kèm `paid_at`, `paid_amount`,
 * `paid_source`) → phép tồn kho theo nguồn → phát N Vé (`ticketing`) → audit `order.paid` → phễu `paid`. Không bao giờ
 * phát Vé từ request của trình duyệt hay `returnUrl`. Email Vé (Story 3.8) sẽ enqueue ở đây cho mọi nguồn.
 */
@Injectable()
export class OrderPayments {
  constructor(@Inject(TicketsService) private readonly tickets: TicketsService) {}

  /**
   * Chuyển Đơn `orderId` sang `paid` và phát Vé trong `tx`. Nguồn `free` (Đơn tổng 0đ, TX1 đã bán có điều kiện): không
   * đụng tồn kho, `paidAmount` phải là 0. Nguồn có phí chưa làm (Story 3.5) → ném lỗi. Đơn không còn `pending` →
   * `lost_race`, không phát Vé. Lỗi bất kỳ (phát Vé, audit…) → ném, cả `tx` rollback.
   */
  async markPaid(tx: Tx, orderId: string, source: PaidSource, paidAmount: number): Promise<MarkPaidResult> {
    if (source !== 'free') throw new Error(`markPaid: nguồn ${source} chưa hỗ trợ (Story 3.5)`);
    if (paidAmount !== 0) throw new Error('markPaid: Đơn 0đ chỉ ghi nhận 0đ');

    const [current] = await tx
      .select({ eventId: orders.eventId, totalAmount: orders.totalAmount })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!current) throw new Error('markPaid: không có Đơn này');
    if (current.totalAmount !== 0) throw new Error('markPaid: nguồn free chỉ dành cho Đơn tổng 0đ');

    // Thứ tự khóa: Sự kiện → Đơn (→ tồn kho theo id ở nhánh có phí). TX1 đã khóa Sự kiện thì khóa lại không chờ.
    await lockEventByIdForShare(tx, current.eventId);
    const [order] = await tx
      .update(orders)
      .set({ status: OrderStatus.PAID, paidAt: sql`clock_timestamp()`, paidAmount, paidSource: source })
      .where(and(eq(orders.id, orderId), eq(orders.status, OrderStatus.PENDING)))
      .returning({
        id: orders.id,
        code: orders.code,
        userId: orders.userId,
        eventId: orders.eventId,
        organizationId: orders.organizationId,
        buyerName: orders.buyerName,
        funnelId: orders.funnelId,
        paidAt: orders.paidAt,
      });
    if (!order) return 'lost_race';

    const lines = await tx
      .select({
        ticketTypeId: orderItems.ticketTypeId,
        ticketTypeName: orderItems.ticketTypeName,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.ticketTypeId));
    await this.tickets.issueTickets(tx, {
      orderId: order.id,
      orderCode: order.code,
      eventId: order.eventId,
      organizationId: order.organizationId,
      userId: order.userId,
      holderName: order.buyerName,
      issuedAt: order.paidAt!,
      lines,
    });
    await audit.record(tx, {
      actorUserId: null,
      organizationId: order.organizationId,
      action: 'order.paid',
      target: { type: 'order', id: order.id },
    });
    if (order.funnelId) {
      await tx
        .insert(checkoutFunnelEvents)
        .values({ eventId: order.eventId, type: FunnelEventType.PAID, funnelId: order.funnelId })
        .onConflictDoNothing({ target: [checkoutFunnelEvents.funnelId, checkoutFunnelEvents.type] });
    }
    return 'paid';
  }
}
