import type { Metadata } from 'next';

import { navSection } from '@/lib/organizer/nav';

import { ScanEventPicker } from './scan-event-picker';

const { label } = navSection('scan');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Tab "Quét vé" (Story 5.3): chọn Sự kiện còn quét được rồi mở Màn quét `/events/{eventId}`. */
export default function ScanPage() {
  return <ScanEventPicker title={label} />;
}
