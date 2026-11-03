import type { Metadata } from 'next';

import { OwnerOnly } from '@/components/tickee/owner-only';
import { navSection } from '@/lib/organizer/nav';

import { PayoutAccountManager } from './payout-account-manager';

const { label } = navSection('payout-account');

export const metadata: Metadata = { title: `${label} · Tickee`, robots: { index: false, follow: false } };

/**
 * Tài khoản nhận tiền (Story 2.6): kết nối tài khoản merchant Tingee của BTC bằng API key, chọn tài khoản nhận tiền,
 * rồi lấy URL IPN để cấu hình portal Tingee. Chỉ Owner; Admin thấy `empty-state` của `OwnerOnly`.
 */
export default function PayoutAccountPage() {
  return (
    <OwnerOnly section="payout-account">
      <PayoutAccountManager />
    </OwnerOnly>
  );
}
