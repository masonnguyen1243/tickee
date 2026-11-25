import type { Viewport } from 'next';
import type { ReactNode } from 'react';

/**
 * `viewport-fit=cover` chỉ cho Màn quét (Story 5.3): nội dung vẽ tới mép màn (tai thỏ, thanh home), layout tự chừa
 * `env(safe-area-inset-*)`. Các trang khác giữ viewport gốc (`app/layout.tsx`), nên safe-area ở đó vẫn bằng 0.
 */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

/**
 * Màn quét của CTV và Owner/Admin (Epic 5), `/events/{eventId}`: toàn màn hình, dọc, mobile-first, không `SiteHeader`,
 * theo theme đang dùng; padding safe-area ở cả bốn phía. Phiên nằm ở origin API nên server web không biết ai đang xem:
 * trang tự chặn chưa đăng nhập ở trình duyệt.
 */
export default function CheckinLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-content-max-buyer flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      {children}
    </main>
  );
}
