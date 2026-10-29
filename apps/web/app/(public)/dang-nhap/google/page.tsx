import type { Metadata } from 'next';

import { safeReturnTo } from '@/lib/auth/return-to';

import { GoogleReturn } from './google-return';

export const metadata: Metadata = { title: 'Đang đăng nhập · Tickee', robots: { index: false, follow: false } };

type GoogleReturnPageProps = { searchParams: Promise<{ returnTo?: string | string[] }> };

/** Trang trung gian Google quay về sau khi đăng nhập thành công: chọn màn đồng ý hoặc `returnTo`. */
export default async function GoogleReturnPage({ searchParams }: GoogleReturnPageProps) {
  const { returnTo } = await searchParams;
  return <GoogleReturn returnTo={safeReturnTo(returnTo)} />;
}
