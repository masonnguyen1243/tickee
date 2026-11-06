import type { EventStatus, EventSummary } from '@tickee/contracts';

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

/**
 * Sự kiện đã kết thúc (Story 2.12): `published`/`hidden` và `effectiveEndAt` ≤ bây giờ (tự kết thúc hoặc BTC bấm
 * "Kết thúc"). "Đã kết thúc" không phải status lưu trong DB.
 */
export const isEventEnded = (
  event: Pick<EventSummary, 'status' | 'effectiveEndAt'>,
  now: number = Date.now(),
): boolean =>
  (event.status === 'published' || event.status === 'hidden') && new Date(event.effectiveEndAt).getTime() <= now;

/** Badge của Sự kiện (Tổng quan, danh sách): "Đã kết thúc" (neutral) khi đã kết thúc, còn lại theo status. */
export const eventBadge = (event: Pick<EventSummary, 'status' | 'effectiveEndAt'>, now: number = Date.now()): Badge =>
  isEventEnded(event, now) ? ENDED_BADGE : EVENT_STATUS_BADGE[event.status];
