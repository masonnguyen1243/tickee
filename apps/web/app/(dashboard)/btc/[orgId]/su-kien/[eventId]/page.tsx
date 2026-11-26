import type { Metadata } from 'next';

import { EventTabs } from './event-tabs';

export const metadata: Metadata = { title: 'Sự kiện · Tickee', robots: { index: false, follow: false } };

/**
 * Một Sự kiện của BTC (Story 2.7): khung tab. `?tab=` chọn tab (mặc định Tổng quan); tab Đơn đọc thêm `trangThai`, `tim`
 * (Story 6.1). Khung tab đọc thẳng các tham số này bằng `useSearchParams` (trang dựng theo request), để link trong trang
 * đổi tab hay bộ lọc mà không remount khung.
 */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventTabs eventId={eventId} />;
}
