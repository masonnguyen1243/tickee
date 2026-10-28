'use client';

import { TriangleAlert } from 'lucide-react';

import { EmptyState } from '@/components/tickee/empty-state';
import { Button } from '@/components/ui/button';

/** Lỗi khi render một trang (trong root layout). Thay màn lỗi tiếng Anh mặc định của Next. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile py-section">
      <EmptyState
        icon={TriangleAlert}
        title="Đã có lỗi xảy ra"
        description="Trang chưa tải được. Vui lòng thử lại."
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            Thử lại
          </Button>
        }
      />
    </main>
  );
}
