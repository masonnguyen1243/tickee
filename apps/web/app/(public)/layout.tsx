import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/tickee/wordmark';

/** Bề mặt công khai: trang chủ, trang Sự kiện (Epic 2–3). Một cột mobile-first. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <header className="py-4">
        <Link href="/" aria-label="Tickee — Trang chủ" className="inline-flex rounded-md">
          <Wordmark />
        </Link>
      </header>
      <main className="pb-section">{children}</main>
    </div>
  );
}
