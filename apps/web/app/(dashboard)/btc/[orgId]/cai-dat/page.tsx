import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';
import { navSection } from '@/lib/organizer/nav';

const { label } = navSection('settings');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Story sau thay bằng trang thật. */
export default function SettingsPage() {
  return <ComingSoon title={label} description="Sửa tên và kênh liên hệ của BTC." />;
}
