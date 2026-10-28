import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/tickee/empty-state';
import { Wordmark } from '@/components/tickee/wordmark';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <header className="py-4">
        <Link href="/" aria-label="Tickee — Trang chủ" className="inline-flex rounded-md">
          <Wordmark />
        </Link>
      </header>
      <main className="py-section">
        <EmptyState
          icon={SearchX}
          title="Không tìm thấy trang"
          description="Đường dẫn có thể đã sai hoặc trang không còn nữa."
          action={
            <Button asChild variant="secondary">
              <Link href="/">Về trang chủ</Link>
            </Button>
          }
        />
      </main>
    </div>
  );
}
