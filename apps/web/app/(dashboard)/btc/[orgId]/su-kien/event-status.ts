import type { EventStatus } from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';

/** Nhãn và tone `status-badge` của trạng thái Sự kiện (DESIGN.md › status-badge). */
export const EVENT_STATUS_BADGE: Readonly<Record<EventStatus, { label: string; tone: StatusTone }>> = {
  draft: { label: 'Nháp', tone: 'neutral' },
  published: { label: 'Đang mở bán', tone: 'success' },
  hidden: { label: 'Ẩn', tone: 'warning' },
  cancelled: { label: 'Đã hủy', tone: 'danger' },
};
