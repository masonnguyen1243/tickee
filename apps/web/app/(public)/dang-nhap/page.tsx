import type { Metadata } from 'next';

import { GoogleSignInButton } from '@/components/tickee/google-signin-button';
import { safeReturnTo } from '@/lib/auth/return-to';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Đăng nhập · Tickee', robots: { index: false, follow: false } };

type LoginPageProps = { searchParams: Promise<{ returnTo?: string | string[]; error?: string | string[] }> };

/**
 * Đăng nhập hoặc tạo Tài khoản Tickee bằng Google hoặc mã OTP qua email. `?error=<mã>` do luồng Google gắn khi
 * quay về thất bại (hủy, email chưa xác minh, state sai…).
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { returnTo: rawReturnTo, error } = await searchParams;
  const returnTo = safeReturnTo(rawReturnTo);
  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-headline">Đăng nhập</h1>
        <p className="text-body text-muted-foreground">
          Tiếp tục với Google hoặc nhập email để nhận mã đăng nhập. Lần đầu dùng Tickee, tài khoản được tạo ngay khi
          bạn đăng nhập.
        </p>
      </div>
      <LoginForm
        returnTo={returnTo}
        googleError={Array.isArray(error) ? error[0] : error}
        alternativeSignIn={<GoogleSignInButton returnTo={returnTo} />}
      />
    </div>
  );
}
