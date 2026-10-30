import Link from 'next/link';
import { Suspense } from 'react';

import { AccountMenu } from './account-menu';
import { Wordmark } from './wordmark';

/** Header dùng chung (trang công khai, `/tao-btc`, nội dung dashboard): wordmark về trang chủ + menu tài khoản. */
export function SiteHeader() {
  return (
    <header className="flex min-h-18 items-center justify-between gap-3 py-4">
      <Link href="/" aria-label="Tickee — Trang chủ" className="inline-flex shrink-0 rounded-md">
        <Wordmark />
      </Link>
      <Suspense fallback={null}>
        <AccountMenu />
      </Suspense>
    </header>
  );
}
