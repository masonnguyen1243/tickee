import type { Metadata } from 'next';

import { safeReturnTo } from '@/lib/auth/return-to';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Đăng nhập · Tickee', robots: { index: false, follow: false } };

type LoginPageProps = { searchParams: Promise<{ returnTo?: string | string[] }> };

/** Đăng nhập hoặc tạo Tài khoản Tickee bằng mã OTP qua email. */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { returnTo } = await searchParams;
  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-headline">Đăng nhập</h1>
        <p className="text-body text-muted-foreground">
          Nhập email để nhận mã đăng nhập. Lần đầu dùng Tickee, tài khoản được tạo khi bạn nhập đúng mã.
        </p>
      </div>
      <LoginForm returnTo={safeReturnTo(returnTo)} />
    </div>
  );
}
