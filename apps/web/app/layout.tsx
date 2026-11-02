import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';

import { NoticeToast } from '@/components/tickee/notice-toast';
import { Toaster } from '@/components/ui/sonner';
import { THEME_SCRIPT } from '@/lib/theme';

import { Providers } from './providers';
import './globals.css';

// Một họ font duy nhất (DESIGN.md § Typography). Biến `--font-sans` được Tailwind dùng cho `font-sans`.
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Tickee',
  description: 'Mua vé sự kiện',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Không khai `colorScheme` và `themeColor` (meta theo hệ thống): `color-scheme` do globals.css đặt theo `data-theme`,
  // `<meta name="theme-color">` do script theme đặt theo theme đang dùng (lib/theme.ts).
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning`: script theme đặt `data-theme` lên <html> trước khi React hydrate.
    <html lang="vi" className={beVietnamPro.variable} suppressHydrationWarning>
      <head>
        {/* Chặn vẽ cho tới khi áp theme (lựa chọn đã lưu hoặc theo hệ thống): không nhấp nháy sai màu. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster />
        <Suspense fallback={null}>
          <NoticeToast />
        </Suspense>
      </body>
    </html>
  );
}
