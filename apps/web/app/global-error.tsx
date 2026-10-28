'use client';

import { TriangleAlert } from 'lucide-react';

import { EmptyState } from '@/components/tickee/empty-state';
import { Button } from '@/components/ui/button';

import './globals.css';

/** Lỗi ở chính root layout: thay cả <html>, nên tự khai báo `lang="vi"`. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body>
        <main className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile py-section">
          <EmptyState
            icon={TriangleAlert}
            title="Đã có lỗi xảy ra"
            description="Tickee chưa tải được. Vui lòng thử lại."
            action={
              <Button type="button" variant="secondary" onClick={reset}>
                Thử lại
              </Button>
            }
          />
        </main>
      </body>
    </html>
  );
}
