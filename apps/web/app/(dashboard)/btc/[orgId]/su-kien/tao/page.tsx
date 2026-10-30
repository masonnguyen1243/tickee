import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';

export const metadata: Metadata = { title: 'Tạo Sự kiện · Tickee', robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Story 2.7 thay bằng wizard tạo Sự kiện. */
export default function CreateEventPage() {
  return (
    <ComingSoon
      title="Tạo Sự kiện"
      description="Tạo Sự kiện nháp theo từng bước: thông tin, Hạng vé, form mua vé rồi mở bán."
    />
  );
}
