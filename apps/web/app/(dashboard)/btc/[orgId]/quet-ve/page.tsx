import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';
import { navSection } from '@/lib/organizer/nav';

const { label } = navSection('scan');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Epic 5 thay bằng Màn quét. */
export default function ScanPage() {
  return <ComingSoon title={label} description="Quét Mã QR vé để check-in Người mua tại cửa." />;
}
