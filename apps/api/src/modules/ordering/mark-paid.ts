import { Inject, Injectable, Module } from '@nestjs/common';
import { EventStatus, FunnelEventType, OrderStatus } from '@tickee/contracts';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { audit } from '../../platform/audit/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { lockEventByIdForShare } from '../event/index.js';
import { TicketsService } from '../ticketing/index.js';
import { settleHeld } from './inventory.service.js';
import { checkoutFunnelEvents, orderItems, orders, type PaidSource } from './schema.js';

/**
 * Kết quả `markPaid` (AD-1): `paid` — Đơn vừa chuyển `paid` và Vé đã phát; `lost_race` — Đơn không còn `pending` (một
 * lần gọi khác đã chuyển trước), không phát gì. Nguồn có phí (Story 3.5) còn: `event_cancelled` — Sự kiện đã hủy;
 * `mismatch` — số tiền ghi nhận khác `total_amount`; `orphan` — tiền về sau `effective_end_at`. Ba kết quả này không đổi
 * gì trong DB; bên gọi tạo `review_item` trong cùng `tx` (Story 3.6).
 */
export type MarkPaidResult = 'paid' | 'orphan' | 'mismatch' | 'event_cancelled' | 'lost_race';

/** Tùy chọn của nguồn có phí. `paidAt`: lúc Tingee báo tiền về; thiếu → đồng hồ DB. Nguồn `free` bỏ qua. */
export interface MarkPaidOptions {
  paidAt?: Date | null;
}

/** Phần của Đơn mà `payment` cần để chọn nhánh xử lý IPN (Story 3.5); không có PII. */
export interface OrderForPayment {
  id: string;
  organizationId: string;
  status: OrderStatus;
  totalAmount: number;
  /**
   * Tài khoản nhận tiền của link thanh toán (chụp ở TX2, không đổi sau đó); `null` khi Đơn chưa có link. `payment` ràng
   * IPN ký bằng secret của credential đã thay với Đơn có link tạo bằng chính credential đó (AD-35).
   */
  payoutAccountId: string | null;
}

/** Đơn theo mã (`orders.code`), không khóa; không có → `null`. Người gọi đã kiểm mã đúng `ORDER_CODE_PATTERN`. */
export async function orderForPayment(db: DbExecutor, code: string): Promise<OrderForPayment | null> {
  const [row] = await db
    .select({
      id: orders.id,
      organizationId: orders.organizationId,
      status: orders.status,
      totalAmount: orders.totalAmount,
      payoutAccountId: orders.payoutAccountId,
    })
    .from(orders)
    .where(eq(orders.code, code));
  return row ?? null;
}

/** Đồng hồ DB (`clock_timestamp()`): `issued_at` của Vé, `paid_at` khi Tingee không báo, mốc so `effective_end_at`. */
async function dbClock(tx: Tx): Promise<Date> {
  const { rows } = await tx.execute<{ now: string | Date }>(sql`SELECT clock_timestamp() AS now`);
  return new Date(rows[0]!.now);
}

/*
 * Đường duy nhất phát Vé (AD-1, Story 3.3): mọi nguồn ghi nhận thanh toán (`PAID_SOURCES`) đi qua `markPaid` trong `tx`
 * của bên gọi. Một transaction: khóa Sự kiện `FOR SHARE` → (nguồn có phí: kiểm hủy / lệch tiền / đã kết thúc) → CAS Đơn
 * `pending` → `paid` (kèm `paid_at`, `paid_amount`, `paid_source`) → phép tồn kho theo nguồn → phát N Vé (`ticketing`)
 * → audit `order.paid` → phễu `paid`. Không bao giờ phát Vé từ request của trình duyệt hay `returnUrl`. Email Vé (Story
 * 3.8) sẽ enqueue ở đây cho mọi nguồn.
 */
@Injectable()
export class OrderPayments {
  constructor(@Inject(TicketsService) private readonly tickets: TicketsService) {}

  /**
   * Chuyển Đơn `orderId` sang `paid` và phát Vé trong `tx`.
   *
   * - `free` (Đơn tổng 0đ, TX1 đã bán có điều kiện): không đụng tồn kho, `paidAmount` phải là 0, `paid_at` = Vé
   *   `issued_at` = đồng hồ DB.
   * - `ipn` (Story 3.5): khóa Sự kiện rồi khóa Đơn (`FOR NO KEY UPDATE`); Đơn không còn `pending` → `lost_race` trước mọi kiểm
   *   khác. Rồi kiểm theo thứ tự Sự kiện đã hủy → `event_cancelled`; `paidAmount ≠ total_amount` → `mismatch`; đồng hồ DB
   *   đã quá `effective_end_at` → `orphan` (không đổi gì). Qua cả ba: CAS, `paid_at` = `options.paidAt` (thiếu → đồng hồ
   *   DB), `held -= n, sold += n`, Vé `issued_at` = đồng hồ DB. Sự kiện bị khóa không chặn (Đơn đã trả tiền khi còn bán).
   * - `reconciliation`, `manual`: chưa làm (Story 4.1, 4.4) → ném lỗi.
   *
   * Đơn không còn `pending` → `lost_race`, không phát Vé. Lỗi bất kỳ (phát Vé, audit…) → ném, cả `tx` rollback.
   */
  async markPaid(
    tx: Tx,
    orderId: string,
    source: PaidSource,
    paidAmount: number,
    options: MarkPaidOptions = {},
  ): Promise<MarkPaidResult> {
    if (source !== 'free' && source !== 'ipn') throw new Error(`markPaid: nguồn ${source} chưa hỗ trợ`);
    if (source === 'free' && paidAmount !== 0) throw new Error('markPaid: Đơn 0đ chỉ ghi nhận 0đ');

    const [current] = await tx
      .select({ eventId: orders.eventId, totalAmount: orders.totalAmount })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!current) throw new Error('markPaid: không có Đơn này');
    if (source === 'free' && current.totalAmount !== 0) throw new Error('markPaid: nguồn free chỉ dành cho Đơn tổng 0đ');

    // Thứ tự khóa: Sự kiện → Đơn → tồn kho theo id. TX1 đã khóa Sự kiện thì khóa lại không chờ.
    const event = await lockEventByIdForShare(tx, current.eventId);
    let paidAt: Date | SQL = sql`clock_timestamp()`;
    let issuedAt: Date | null = null;
    if (source === 'ipn') {
      // Khóa Đơn trước khi kiểm: IPN khác mã vừa thắng thì Đơn đã `paid` → `lost_race`, không phải `mismatch`/
      // `event_cancelled`/`orphan` của một Đơn đã trả. `NO KEY UPDATE` (đúng khóa mà CAS bên dưới lấy), không phải
      // `UPDATE`: INSERT `payment_events` của bên gọi đã giữ `KEY SHARE` trên Đơn (khóa ngoại), `FOR UPDATE` sẽ deadlock
      // giữa hai IPN cùng Đơn.
      const [locked] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('no key update');
      if (locked?.status !== OrderStatus.PENDING) return 'lost_race';
      if (event.status === EventStatus.CANCELLED) return 'event_cancelled';
      if (paidAmount !== current.totalAmount) return 'mismatch';
      const now = await dbClock(tx);
      if (now.getTime() > event.effectiveEndAt.getTime()) return 'orphan';
      paidAt = options.paidAt ?? now;
      issuedAt = now;
    }

    const [order] = await tx
      .update(orders)
      .set({ status: OrderStatus.PAID, paidAt, paidAmount, paidSource: source })
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
    // Đơn có phí: chốt bán phần đang giữ từ TX1. Đơn 0đ đã bán (`sold += n`) ngay trong TX1.
    if (source === 'ipn') await settleHeld(tx, lines);
    await this.tickets.issueTickets(tx, {
      orderId: order.id,
      orderCode: order.code,
      eventId: order.eventId,
      organizationId: order.organizationId,
      userId: order.userId,
      holderName: order.buyerName,
      issuedAt: issuedAt ?? order.paidAt!,
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

/**
 * `OrderPayments` (`markPaid`) cho mọi vai: `OrderingModule` (api, Đơn 0đ), `payment` (IPN ở api, Đối soát bù ở worker).
 * Không controller, không cấu hình; cần `TicketingModule` (toàn cục: `TicketsService`) và `DbModule` ở gốc DI.
 */
@Module({ providers: [OrderPayments], exports: [OrderPayments] })
export class OrderPaymentsModule {}
