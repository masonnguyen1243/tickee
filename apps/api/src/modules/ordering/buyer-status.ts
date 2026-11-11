import { BuyerOrderStatus, OrderStatus } from '@tickee/contracts';

/** Phần của Đơn và Sự kiện mà `buyerStatusOf` cần. */
export interface BuyerStatusInput {
  status: OrderStatus;
  expiresAt: Date;
  /** Sự kiện đã hủy (`events.status = 'cancelled'`). */
  eventCancelled: boolean;
}

/**
 * Trạng thái Đơn phía Người mua (`BuyerOrderView.buyerStatus`, AD-17, Story 3.7) lúc `now` (giờ máy chủ). `pending`
 * quá `expires_at` là `confirming` (job hết hạn chưa chạy, hoặc IPN của lần trả sát giờ đang tới), để mở lại trang sau
 * hạn hiện đúng ngay; chỉ hiện Hết hạn khi Đơn đã `expired`. Sự kiện hủy che mọi trạng thái sau thanh toán
 * (`paid`/`review`/`cancelled`/`refunded`). Không lộ loại Cần xử lý hay số tiền lệch: mọi `review` là `under_review`.
 */
export function buyerStatusOf(order: BuyerStatusInput, now: Date): BuyerOrderStatus {
  switch (order.status) {
    case OrderStatus.PENDING:
      return now.getTime() < order.expiresAt.getTime() ? BuyerOrderStatus.AWAITING_PAYMENT : BuyerOrderStatus.CONFIRMING;
    case OrderStatus.EXPIRED:
      return BuyerOrderStatus.EXPIRED;
    case OrderStatus.PAID:
      return order.eventCancelled ? BuyerOrderStatus.EVENT_CANCELLED : BuyerOrderStatus.PAID;
    case OrderStatus.REVIEW:
      return order.eventCancelled ? BuyerOrderStatus.EVENT_CANCELLED : BuyerOrderStatus.UNDER_REVIEW;
    case OrderStatus.CANCELLED:
    case OrderStatus.REFUNDED:
      return order.eventCancelled ? BuyerOrderStatus.EVENT_CANCELLED : BuyerOrderStatus.CANCELLED_BY_ORGANIZER;
  }
}
