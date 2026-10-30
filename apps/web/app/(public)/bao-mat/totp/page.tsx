import type { Metadata } from 'next';

import { safeReturnTo } from '@/lib/auth/return-to';

import { EnrollForm } from './enroll-form';

export const metadata: Metadata = {
  title: 'Bật xác thực hai lớp · Tickee',
  robots: { index: false, follow: false },
};

type TotpEnrollPageProps = { searchParams: Promise<{ returnTo?: string | string[] }> };

/** Đăng ký TOTP cho Owner (FR-1): chặn toàn màn như `/dong-y`, xong thì về `returnTo`. */
export default async function TotpEnrollPage({ searchParams }: TotpEnrollPageProps) {
  const { returnTo } = await searchParams;
  return <EnrollForm returnTo={safeReturnTo(returnTo)} />;
}
