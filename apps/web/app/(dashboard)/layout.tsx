import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { AccountMenu } from '@/components/tickee/account-menu';
import { Wordmark } from '@/components/tickee/wordmark';

/**
 * Dashboard BTC (Epic 2+). Tạm một cột với header như bề mặt công khai; sidebar, BTC switcher và bottom-tab-bar
 * thuộc phần B của Story 2.1 (deferred-work.md).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
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
