import type { Metadata } from 'next';

import { navSection } from '@/lib/organizer/nav';

import { TokenView } from './token-view';

const { label } = navSection('token');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/**
 * Token của BTC (Story 4.5-a, FR-34): số dư và hạn mức đọc thẳng từ Tingee mỗi lần xem, "Mua thêm Token" mở portal
 * Tingee (chỉ Owner). Owner và Admin (`token.view`); api tự chặn vai khác.
 */
export default function TokenPage() {
  return <TokenView />;
}
