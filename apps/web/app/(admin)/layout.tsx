import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/**
 * Khu Quản trị Tingee (`/admin`): desktop, shadcn mặc định, nền `page`/`card` theo theme đang dùng. Header chung (menu
 * tài khoản không có mục "Quản trị": ai có quyền thì tự mở `/admin`).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-gutter-mobile md:px-8">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
