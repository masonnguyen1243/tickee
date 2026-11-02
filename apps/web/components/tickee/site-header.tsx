import Link from 'next/link';
import { Suspense } from 'react';

import { AccountMenu } from './account-menu';
import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

/**
 * Header dùng chung (trang công khai, `/tao-btc`, nội dung dashboard): wordmark về trang chủ, menu tài khoản và nút
 * chuyển giao diện (cả khách cũng thấy). Nút nằm sát mép phải để không xê dịch khi menu tài khoản tải xong và đổi rộng.
 */
export function SiteHeader() {
  return (
    <header className="flex min-h-18 items-center justify-between gap-3 py-4">
      <Link href="/" aria-label="Tickee — Trang chủ" className="inline-flex shrink-0 rounded-md">
        <Wordmark />
      </Link>
      <div className="flex min-w-0 items-center gap-1">
        <Suspense fallback={null}>
          <AccountMenu />
        </Suspense>
        <ThemeToggle />
      </div>
    </header>
  );
}
