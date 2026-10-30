import type { Metadata } from 'next';

import { ComingSoon } from '@/components/tickee/coming-soon';
import { OwnerOnly } from '@/components/tickee/owner-only';
import { navSection } from '@/lib/organizer/nav';

const { label } = navSection('payout-account');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/** Trang tạm "Sắp có": Story 2.6 thay bằng trang thật. Chỉ Owner. */
export default function PayoutAccountPage() {
  return (
    <OwnerOnly section="payout-account">
      <ComingSoon title={label} description="Owner liên kết tài khoản ngân hàng nhận tiền bán vé qua Tingee." />
    </OwnerOnly>
  );
}
