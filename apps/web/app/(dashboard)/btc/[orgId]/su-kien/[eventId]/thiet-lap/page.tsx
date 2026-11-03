import type { Metadata } from 'next';

import { EventSetup } from './event-setup';

export const metadata: Metadata = { title: 'Thiết lập Sự kiện · Tickee', robots: { index: false, follow: false } };

/** `?buoc=` (1–4): bước mở đầu của wizard; sai hoặc thiếu thì bước 1. */
function stepOf(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n - 1 : 0;
}

/** Wizard thiết lập Sự kiện đã có (Story 2.7): "Tiếp tục thiết lập" và sau lần lưu đầu của Sự kiện mới. */
export default async function EventSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  return <EventSetup eventId={eventId} initialStep={stepOf(query.buoc)} />;
}
