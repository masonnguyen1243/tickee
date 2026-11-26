import {
  formatVnd,
  formatVnDayTime,
  formatVnTime,
  isSameVnDay,
  OrderStatus,
  ReviewItemType,
  type EventOverviewTicketType,
  type RecentOrder,
} from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';
import { CHECKIN_PROGRESS_LIVE } from '@/lib/checkin/progress-view';
import { priceLabel } from '@/lib/event/selection';

/*
 * Tổng quan Sự kiện (Story 3.11, FR-31, UX-DR35): nhãn, tone và dòng phụ của `stat-card` doanh thu,
 * `recent-orders-block`, thẻ check-in và khối "Vé theo Hạng vé" (Story 6.2). Hàm thuần, kiểm bằng Vitest môi trường
 * node; giờ luôn theo giờ Việt Nam (không theo múi giờ máy).
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
 * Dòng loại của mục Cần xử lý `open` của một Đơn, ở mọi trạng thái Đơn (tab Đơn, Story 6.1: vd. trả trùng cho Đơn Đã
 * thanh toán): lệch số tiền → "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ" (không rõ số tiền nhận → chỉ tên loại); loại
 * khác → tên loại. Không có mục mở → `null`.
 */
export function reviewItemLine(order: Pick<RecentOrder, 'review' | 'totalAmount'>): string | null {
  if (!order.review) return null;
  const label = REVIEW_TYPE_LABEL[order.review.type];
  if (order.review.type !== ReviewItemType.AMOUNT_MISMATCH || order.review.receivedAmount === null) return label;
  return `${label} · nhận ${formatVnd(order.review.receivedAmount)} / Đơn ${formatVnd(order.totalAmount)}`;
}

/**
 * Dòng loại dưới badge "Cần xử lý" của "Đơn gần đây" (`reviewItemLine` chỉ cho Đơn `review`). Đơn không ở `review`, hay
 * `review` mà không còn mục mở → `null`.
 */
export function reviewLine(order: Pick<RecentOrder, 'status' | 'review' | 'totalAmount'>): string | null {
  return order.status === OrderStatus.REVIEW ? reviewItemLine(order) : null;
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

/**
 * Dòng phụ của thẻ check-in trên Tổng quan (Story 6.2): "Cập nhật liên tục" khi SSE đang nối và số liệu không cũ. Số
 * liệu có thể đã cũ (`stale`) → không có dòng phụ, vì nhãn "Cập nhật lúc HH:MM" ở đầu khối đã báo; chưa nối SSE (đang
 * polling) → cũng không có.
 */
export const checkinCardCaption = ({ connected, stale }: { connected: boolean; stale: boolean }): string | null =>
  connected && !stale ? CHECKIN_PROGRESS_LIVE : null;

/** Tiêu đề khối Hạng vé của Tổng quan (`card` sáng, Story 6.2). */
export const TICKET_TYPES_TITLE = 'Vé theo Hạng vé';

/** Chữ đi kèm Hạng vé không còn suất nào (không chỉ dựa vào màu). */
export const SOLD_OUT_LABEL = 'Hết vé';

type TicketTypeStock = Pick<EventOverviewTicketType, 'capacity' | 'sold' | 'held' | 'remaining'>;

/** Tóm tắt bên phải tiêu đề khối: "{tổng đã bán}/{tổng sức chứa} Vé đã bán" (vd. "66/72 Vé đã bán"). */
export function ticketTypesSoldSummary(types: readonly Pick<EventOverviewTicketType, 'sold' | 'capacity'>[]): string {
  let sold = 0;
  let capacity = 0;
  for (const type of types) {
    sold += type.sold;
    capacity += type.capacity;
  }
  return `${sold}/${capacity} Vé đã bán`;
}

/** Hạng vé đã hết suất (bán + giữ chỗ = sức chứa). */
export const isSoldOut = (type: Pick<EventOverviewTicketType, 'remaining'>): boolean => type.remaining === 0;

/** Cột "Còn lại": "{còn lại} / {sức chứa}" (vd. "2 / 32"). */
export const remainingLabel = (type: Pick<EventOverviewTicketType, 'remaining' | 'capacity'>): string =>
  `${type.remaining} / ${type.capacity}`;

/** Giá của Hạng vé trong khối: như trang Sự kiện ("150.000đ", 0đ → "Miễn phí"). */
export const ticketTypePriceLabel = (type: Pick<EventOverviewTicketType, 'price'>): string => priceLabel(type.price);

/**
 * Dòng số liệu của một Hạng vé dưới `md`: "Đã bán 30 · Đang giữ 0 · Còn 2 / 32". Hết vé thì nơi render thêm
 * " · Hết vé" (`SOLD_OUT_LABEL`, không ngắt dòng giữa chữ).
 */
export const ticketTypeStockLine = (type: TicketTypeStock): string =>
  `Đã bán ${type.sold} · Đang giữ ${type.held} · Còn ${remainingLabel(type)}`;
