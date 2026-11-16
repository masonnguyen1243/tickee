import { REVIEW_QUEUE_EVENT_PARAM } from '@tickee/contracts';
import type { Metadata } from 'next';

import { navSection } from '@/lib/organizer/nav';

import { ReviewQueueView } from './review-queue';

const { label } = navSection('review-queue');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/**
 * Hàng Cần xử lý của BTC (Story 4.3, FR-21): mọi mục `open` gộp mọi Sự kiện, mở `Sheet` chi tiết. `?suKien={eventId}`
 * lọc theo một Sự kiện (đích của `needs-action-card`). Owner và Admin (`review_queue.handle`); api tự chặn vai khác.
 */
export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgId }, query] = await Promise.all([params, searchParams]);
  const raw = query[REVIEW_QUEUE_EVENT_PARAM];
  // `?suKien=a&suKien=b` → mảng: lấy phần tử không rỗng đầu tiên.
  const eventId = (Array.isArray(raw) ? raw.find((v) => v !== '') : raw) || null;
  return <ReviewQueueView orgId={orgId} eventId={eventId} />;
}
