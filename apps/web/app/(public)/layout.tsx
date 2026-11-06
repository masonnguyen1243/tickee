import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/**
 * Bề mặt công khai: đăng nhập, trang Sự kiện (Epic 2–3). Một cột mobile-first. Trang nào cần 2 cột ở ≥ `lg` (trang
 * Sự kiện) đánh dấu `data-layout="wide"` trên phần tử gốc để khung nở tới `content-max-landing`.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile lg:has-[[data-layout=wide]]:max-w-content-max-landing">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
