import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';
import { navSection } from '@/lib/organizer/nav';

const { label } = navSection('review-queue');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Epic 4 thay bằng hàng đợi Cần xử lý. */
export default function ReviewQueuePage() {
  return (
    <ComingSoon
      title={label}
      description="Gom các Đơn cần BTC kiểm tra, như chuyển khoản lệch số tiền, để duyệt hoặc hoàn tay."
    />
  );
}
