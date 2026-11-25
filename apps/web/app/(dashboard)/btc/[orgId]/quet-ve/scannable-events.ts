import type { EventSummary } from '@tickee/contracts';

import { isEventEnded } from '../su-kien/event-status';

/**
 * Sự kiện còn quét được: đã đăng (`published`/`hidden`) và chưa kết thúc, giờ bắt đầu gần bây giờ nhất trước (Sự kiện
 * đang diễn ra hay sắp diễn ra lên đầu). Hòa thì theo tên.
 */
export function scannableEvents(events: readonly EventSummary[], now: number = Date.now()): EventSummary[] {
  const distance = (event: EventSummary) => Math.abs(new Date(event.startsAt).getTime() - now);
  return events
    .filter((event) => (event.status === 'published' || event.status === 'hidden') && !isEventEnded(event, now))
    .sort((a, b) => distance(a) - distance(b) || a.name.localeCompare(b.name, 'vi'));
}
