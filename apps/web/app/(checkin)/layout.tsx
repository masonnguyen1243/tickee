import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/**
 * Màn quét của CTV và Owner/Admin (Epic 5), `/events/{eventId}`. Tạm thời là khung một cột có header như bề mặt Người
 * mua, cho trang tạm của Story 5.2; Màn quét thật (Story 5.3) đổi thành toàn màn, dọc, mobile-first. Phiên nằm ở origin
 * API nên server web không biết ai đang xem: trang tự chặn chưa đăng nhập ở trình duyệt.
 */
export default function CheckinLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
