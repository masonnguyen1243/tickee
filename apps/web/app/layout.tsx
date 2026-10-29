import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';

import { NoticeToast } from '@/components/tickee/notice-toast';
import { Toaster } from '@/components/ui/sonner';

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
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F3F2' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0809' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
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
