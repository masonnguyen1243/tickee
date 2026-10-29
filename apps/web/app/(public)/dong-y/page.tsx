import type { Metadata } from 'next';

import { safeReturnTo } from '@/lib/auth/return-to';

import { ConsentForm } from './consent-form';

export const metadata: Metadata = {
  title: 'Đồng ý xử lý dữ liệu cá nhân · Tickee',
  robots: { index: false, follow: false },
};

type ConsentPageProps = { searchParams: Promise<{ returnTo?: string | string[] }> };

/** Màn đồng ý NĐ 13/2023, bắt buộc trước khi Tài khoản mới được dùng. */
export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { returnTo } = await searchParams;
  return <ConsentForm returnTo={safeReturnTo(returnTo)} />;
}
