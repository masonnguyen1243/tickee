import {
  formatVnd,
  formatVnDayTime,
  formatVnTime,
  isSameVnDay,
  OrderStatus,
  ReviewItemType,
  type RecentOrder,
} from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';

/*
 * Tổng quan Sự kiện (Story 3.11, FR-31, UX-DR35): nhãn, tone và dòng phụ của `stat-card` doanh thu và
 * `recent-orders-block`. Hàm thuần, kiểm bằng Vitest môi trường node; giờ luôn theo giờ Việt Nam (không theo múi giờ máy).
 */

/** Polling khi SSE chưa kết nối (AD-17: 10 giây ở dashboard). */
export const EVENT_OVERVIEW_POLL_MS = 10_000;

/** Chu kỳ polling của Tổng quan khi SSE chưa kết nối: luôn 10 giây. */
export const eventOverviewPollInterval = (): number => EVENT_OVERVIEW_POLL_MS;

/** Toast mất mạng (một lần mỗi lần mất mạng, `id` cố định). */
export const OVERVIEW_OFFLINE_TOAST = 'Mất kết nối. Đang thử lại…';
export const OVERVIEW_OFFLINE_TOAST_ID = 'event-overview-offline';

type Badge = { label: string; tone: StatusTone };

/** `status-badge` của Đơn phía BTC (DESIGN.md › status-badge: bảng tone Đơn). */
export const ORDER_STATUS_BADGE: Readonly<Record<OrderStatus, Badge>> = {
  [OrderStatus.PENDING]: { label: 'Chờ thanh toán', tone: 'warning' },
  [OrderStatus.PAID]: { label: 'Đã thanh toán', tone: 'success' },
  [OrderStatus.EXPIRED]: { label: 'Hết hạn', tone: 'neutral' },
  [OrderStatus.CANCELLED]: { label: 'Đã hủy', tone: 'neutral' },
  [OrderStatus.REFUNDED]: { label: 'Đã hoàn tay', tone: 'neutral' },
  [OrderStatus.REVIEW]: { label: 'Cần xử lý', tone: 'danger' },
};

/** Badge của một trạng thái Đơn. */
export const orderStatusBadge = (status: OrderStatus): Badge => ORDER_STATUS_BADGE[status];

/** Tên loại Cần xử lý (EXPERIENCE › needs-action-row). */
export const REVIEW_TYPE_LABEL: Readonly<Record<ReviewItemType, string>> = {
  [ReviewItemType.AMOUNT_MISMATCH]: 'Lệch số tiền',
  [ReviewItemType.ORPHAN]: 'Thanh toán mồ côi',
  [ReviewItemType.UNMATCHED]: 'Giao dịch chưa khớp',
  [ReviewItemType.DUPLICATE_PAYMENT]: 'Thanh toán trùng',
  [ReviewItemType.EVENT_CANCELLED]: 'Sự kiện đã hủy',
};

/**
 * Dòng loại dưới badge "Cần xử lý": lệch số tiền → "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ" (không rõ số tiền nhận
 * → chỉ tên loại); loại khác → tên loại. Đơn không ở `review`, hay `review` mà không còn mục mở → `null`.
 */
export function reviewLine(order: Pick<RecentOrder, 'status' | 'review' | 'totalAmount'>): string | null {
  if (order.status !== OrderStatus.REVIEW || !order.review) return null;
  const label = REVIEW_TYPE_LABEL[order.review.type];
  if (order.review.type !== ReviewItemType.AMOUNT_MISMATCH || order.review.receivedAmount === null) return label;
  return `${label} · nhận ${formatVnd(order.review.receivedAmount)} / Đơn ${formatVnd(order.totalAmount)}`;
}

/** Cột Thời gian: "HH:mm" nếu cùng ngày với `now` (giờ Việt Nam), còn lại "dd/MM · HH:mm". */
export function orderTimeLabel(createdAt: string, now: number | Date = Date.now()): string {
  return isSameVnDay(createdAt, now) ? formatVnTime(createdAt) : formatVnDayTime(createdAt);
}

/** Cột Vé: "{n} Vé". */
export const ticketCountLabel = (count: number): string => `${count} Vé`;

/** Dòng phụ của `stat-card` doanh thu: "Chỉ tính Đơn Đã thanh toán · {n} Đơn". */
export const revenueCaption = (paidOrders: number): string => `Chỉ tính Đơn Đã thanh toán · ${paidOrders} Đơn`;

/** Nhãn khi mất mạng: "Cập nhật lúc HH:MM" theo lần tải thành công gần nhất (giờ Việt Nam). */
export const updatedAtLabel = (updatedAt: number): string => `Cập nhật lúc ${formatVnTime(updatedAt)}`;
