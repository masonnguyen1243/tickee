import type { EventSaleReason, EventSaleStatus, EventStatus, EventSummary } from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';

type Badge = { label: string; tone: StatusTone };

/** Nhãn và tone `status-badge` của trạng thái Sự kiện (DESIGN.md › status-badge). */
export const EVENT_STATUS_BADGE: Readonly<Record<EventStatus, Badge>> = {
  draft: { label: 'Nháp', tone: 'neutral' },
  published: { label: 'Đang mở bán', tone: 'success' },
  hidden: { label: 'Ẩn', tone: 'warning' },
  cancelled: { label: 'Đã hủy', tone: 'danger' },
};

const ENDED_BADGE: Badge = { label: 'Đã kết thúc', tone: 'neutral' };

/** Đủ để biết Sự kiện đã kết thúc: `EventSummary` (danh sách) hoặc `EventDetail` (có thêm `endedManuallyAt`). */
type EndedInput = Pick<EventSummary, 'status' | 'effectiveEndAt'> & { endedManuallyAt?: string | null };

/**
 * Sự kiện đã kết thúc (Story 2.12): `published`/`hidden` và BTC đã bấm "Kết thúc" (`endedManuallyAt` có — không phụ
 * thuộc đồng hồ máy khách, vì `effectiveEndAt` cắt về giây có thể còn "tương lai" nếu đồng hồ chậm) hoặc
 * `effectiveEndAt` ≤ bây giờ (tự kết thúc). "Đã kết thúc" không phải status lưu trong DB.
 */
export const isEventEnded = (event: EndedInput, now: number = Date.now()): boolean =>
  (event.status === 'published' || event.status === 'hidden') &&
  (event.endedManuallyAt != null || new Date(event.effectiveEndAt).getTime() <= now);

/**
 * Badge tính ở máy khách từ `status` và `effectiveEndAt` (Story 2.12): "Đã kết thúc" (neutral) khi đã kết thúc, còn lại
 * theo status. Chỉ còn là dự phòng của `eventSaleBadge` khi chưa có trạng thái bán từ api.
 */
export const eventBadge = (event: EndedInput, now: number = Date.now()): Badge =>
  isEventEnded(event, now) ? ENDED_BADGE : EVENT_STATUS_BADGE[event.status];

/** Nhãn theo lý do bán cấp Sự kiện của `sellability` (Story 4.2-c). */
const SALE_REASON_BADGE: Readonly<Record<EventSaleReason, Badge>> = {
  cancelled: EVENT_STATUS_BADGE.cancelled,
  locked: { label: 'Bị khóa', tone: 'danger' },
  ended: ENDED_BADGE,
  hidden: EVENT_STATUS_BADGE.hidden,
  paused: { label: 'Tạm ngừng bán', tone: 'warning' },
};

/**
 * `paused` mà còn Hạng vé `on_sale` (vd. 0đ còn vé khi dịch vụ thanh toán bị ngắt): khớp câu "một phần" của trang công
 * khai.
 */
const PARTIALLY_PAUSED_BADGE: Badge = { label: 'Tạm ngừng bán một phần', tone: 'warning' };

/**
 * Badge của Sự kiện trên dashboard (thẻ Sự kiện ở trang chủ BTC, thẻ "Thông tin" của tab Tổng quan; Story 4.2-c, retro
 * Epic 2 C5): lấy từ trạng thái bán của api (`GET …/event-sale-status`, cùng luật `sellability` với trang công khai, đồng
 * hồ máy chủ). Nháp → "Nháp" (không cần api). `sale` chưa có (đang tải, lỗi, Sự kiện chưa có trong danh sách) → tính
 * như trước (`eventBadge`), không skeleton, không báo lỗi.
 */
export function eventSaleBadge(
  event: EndedInput,
  sale: Pick<EventSaleStatus, 'reason' | 'partial'> | undefined,
  now: number = Date.now(),
): Badge {
  if (event.status === 'draft') return EVENT_STATUS_BADGE.draft;
  if (!sale) return eventBadge(event, now);
  if (sale.reason === null) return EVENT_STATUS_BADGE.published;
  if (sale.reason === 'paused' && sale.partial) return PARTIALLY_PAUSED_BADGE;
  return SALE_REASON_BADGE[sale.reason];
}
