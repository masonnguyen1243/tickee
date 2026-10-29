import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { AccountMenu } from '@/components/tickee/account-menu';
import { Wordmark } from '@/components/tickee/wordmark';

/** Bề mặt công khai: trang chủ, đăng nhập, trang Sự kiện (Epic 2–3). Một cột mobile-first. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <header className="flex min-h-18 items-center justify-between gap-3 py-4">
        <Link href="/" aria-label="Tickee — Trang chủ" className="inline-flex shrink-0 rounded-md">
          <Wordmark />
        </Link>
        <Suspense fallback={null}>
          <AccountMenu />
        </Suspense>
      </header>
      <main className="pb-section">{children}</main>
    </div>
  );
}
