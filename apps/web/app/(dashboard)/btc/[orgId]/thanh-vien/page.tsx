import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';
import { OwnerOnly } from '@/components/tickee/owner-only';
import { navSection } from '@/lib/organizer/nav';

const { label } = navSection('members');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Story 2.4 thay bằng trang thật. Chỉ Owner. */
export default function MembersPage() {
  return (
    <OwnerOnly section="members">
      <ComingSoon title={label} description="Owner mời và xóa Admin cùng vận hành BTC." />
    </OwnerOnly>
  );
}
