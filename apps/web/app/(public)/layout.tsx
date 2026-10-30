import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/** Bề mặt công khai: trang chủ, đăng nhập, trang Sự kiện (Epic 2–3). Một cột mobile-first. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
