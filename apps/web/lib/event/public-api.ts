import { EventAvailability, PublicEvent, publicEventTag } from '@tickee/contracts';

import { apiRequest, performApiRequest } from '@/lib/api/client';

/** Phần tĩnh của trang `/e/{slug}` cũ tối đa chừng này giây (số vé lấy riêng, xem `fetchAvailability`). */
export const PUBLIC_EVENT_REVALIDATE_SECONDS = 30;

/** Khóa TanStack Query: trạng thái bán + số vé còn của một Sự kiện công khai. */
export const availabilityQueryKey = (slug: string) => ['event', 'availability', slug] as const;

const publicEventPath = (slug: string) => `/events/${encodeURIComponent(slug)}`;

/**
 * Phần tĩnh của Sự kiện công khai, gọi từ server (page, `generateMetadata`, ảnh OG): không gửi cookie, cache
 * `PUBLIC_EVENT_REVALIDATE_SECONDS` giây, gắn tag `event:{slug}` để revalidate ngay khi BTC sửa (2.11-c).
 * Nháp/slug sai → `ApiError` `EVENT_NOT_FOUND`.
 */
export function fetchPublicEvent(slug: string): Promise<PublicEvent> {
  return performApiRequest(publicEventPath(slug), {
    schema: PublicEvent,
    init: { next: { revalidate: PUBLIC_EVENT_REVALIDATE_SECONDS, tags: [publicEventTag(slug)] } },
  });
}

/** Trạng thái bán + số vé còn (gọi từ trình duyệt; API cache tối đa 2 giây). Không bao giờ render ở server. */
export function fetchAvailability(slug: string, signal?: AbortSignal): Promise<EventAvailability> {
  return apiRequest(`${publicEventPath(slug)}/availability`, { schema: EventAvailability, init: { signal } });
}
