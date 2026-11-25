import type { Metadata } from 'next';

import { CheckinEventScreen } from './checkin-event-screen';

export const metadata: Metadata = { title: 'Màn quét · Tickee', robots: { index: false, follow: false } };

type CheckinEventPageProps = { params: Promise<{ eventId: string }> };

/**
 * Màn quét của một Sự kiện `/events/{eventId}` (route group `(checkin)`, Story 5.3): camera, kết quả quét xanh/đỏ và số
 * đã check-in. Đích của nhận lời mời CTV, nút "Mở Màn quét" ở tab Check-in và tab "Quét vé" của dashboard.
 */
export default async function CheckinEventPage({ params }: CheckinEventPageProps) {
  const { eventId } = await params;
  return <CheckinEventScreen eventId={eventId} />;
}
