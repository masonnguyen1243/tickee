import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/**
 * Bề mặt Người mua cần đăng nhập (Checkout, Trang Đơn, Vé của tôi — Epic 3), slug tiếng Anh (`/e/{slug}/checkout`,
 * `/orders`, `/tickets`). Một cột mobile-first, cột căn giữa tối đa `content-max-buyer` ở mọi cỡ màn. Phiên nằm ở origin API nên
 * server web không biết ai đang xem: từng trang tự chặn chưa đăng nhập ở trình duyệt.
 */
export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
