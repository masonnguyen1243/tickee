import type { Metadata } from 'next';

import { CheckinEventScreen } from './checkin-event-screen';

export const metadata: Metadata = { title: 'Màn quét · Tickee', robots: { index: false, follow: false } };

type CheckinEventPageProps = { params: Promise<{ eventId: string }> };

/**
 * Màn quét của một Sự kiện `/events/{eventId}` (route group `(checkin)`). Story 5.2 chỉ dựng trang tạm (tên Sự kiện),
 * để nhận lời mời CTV và nút "Mở Màn quét" ở tab Check-in có đích; camera, kết quả quét và số check-in thuộc Story 5.3.
 */
export default async function CheckinEventPage({ params }: CheckinEventPageProps) {
  const { eventId } = await params;
  return <CheckinEventScreen eventId={eventId} />;
}
