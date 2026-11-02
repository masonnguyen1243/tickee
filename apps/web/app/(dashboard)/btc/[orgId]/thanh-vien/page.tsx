import type { Metadata } from 'next';

import { OwnerOnly } from '@/components/tickee/owner-only';
import { navSection } from '@/lib/organizer/nav';

import { MembersManager } from './members-manager';

const { label } = navSection('members');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Thành viên của BTC (Story 2.4): mời, thu hồi lời mời, xóa Admin. Chỉ Owner; Admin thấy `empty-state` của `OwnerOnly`. */
export default function MembersPage() {
  return (
    <OwnerOnly section="members">
      <MembersManager />
    </OwnerOnly>
  );
}
