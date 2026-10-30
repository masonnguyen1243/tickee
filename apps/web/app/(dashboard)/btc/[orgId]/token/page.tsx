import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';
import { navSection } from '@/lib/organizer/nav';

const { label } = navSection('token');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Story sau thay bằng trang Token thật. */
export default function TokenPage() {
  return <ComingSoon title={label} description="Xem số Token còn lại của BTC; Owner mua thêm Token tại đây." />;
}
