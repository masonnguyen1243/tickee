import type { Metadata } from 'next';

import { EventTabs } from './event-tabs';
import { DEFAULT_EVENT_TAB, isEventTab } from './event-tab-list';

export const metadata: Metadata = { title: 'Sự kiện · Tickee', robots: { index: false, follow: false } };

/** Một Sự kiện của BTC (Story 2.7): khung tab, `?tab=` chọn tab (mặc định Tổng quan). */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  return <EventTabs eventId={eventId} initialTab={isEventTab(query.tab) ? query.tab : DEFAULT_EVENT_TAB} />;
}
