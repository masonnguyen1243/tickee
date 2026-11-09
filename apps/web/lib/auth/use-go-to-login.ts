'use client';

import { usePathname, useRouter } from 'next/navigation';

import { LOGIN_PATH, withReturnTo } from './return-to';

/** 401 khi đang thao tác: sang đăng nhập rồi quay lại đúng trang này. */
export function useGoToLogin() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.replace(withReturnTo(LOGIN_PATH, pathname));
}
