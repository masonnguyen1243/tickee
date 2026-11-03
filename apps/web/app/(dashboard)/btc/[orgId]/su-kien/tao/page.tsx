import type { Metadata } from 'next';

import { CreateEvent } from './create-event';

export const metadata: Metadata = { title: 'Tạo Sự kiện · Tickee', robots: { index: false, follow: false } };

/** Wizard tạo Sự kiện nháp (Story 2.7): bước 1 "Thông tin"; bước 2–4 làm ở story sau. */
export default function CreateEventPage() {
  return <CreateEvent />;
}
