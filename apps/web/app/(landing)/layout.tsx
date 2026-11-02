import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/** Landing BTC (`/`): khung rộng hơn cột 480px của các trang công khai khác (đăng nhập, đồng ý, bảo mật). */
export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-landing px-gutter-mobile md:px-8">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
