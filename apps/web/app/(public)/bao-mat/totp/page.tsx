import { ACCOUNT_SECURITY_PATH } from '@tickee/contracts';
import type { Metadata } from 'next';

import { DEFAULT_RETURN_TO, safeReturnTo } from '@/lib/auth/return-to';

import { EnrollForm } from './enroll-form';

export const metadata: Metadata = {
  title: 'Bật xác thực hai lớp · Tickee',
  robots: { index: false, follow: false },
};

type TotpEnrollPageProps = { searchParams: Promise<{ returnTo?: string | string[] }> };

/**
 * Bật xác thực hai lớp (FR-1), vào từ trang Bảo mật tài khoản: toàn màn như `/dong-y`, xong thì về `returnTo`
 * (thiếu, rỗng hoặc không an toàn thì về trang Bảo mật tài khoản).
 */
export default async function TotpEnrollPage({ searchParams }: TotpEnrollPageProps) {
  const { returnTo } = await searchParams;
  const target = safeReturnTo(returnTo);
  // `safeReturnTo` trả trang chủ khi từ chối; chỉ giữ trang chủ khi chính `returnTo` là trang chủ.
  const rejected = target === DEFAULT_RETURN_TO && returnTo !== DEFAULT_RETURN_TO;
  return <EnrollForm returnTo={rejected ? ACCOUNT_SECURITY_PATH : target} />;
}
