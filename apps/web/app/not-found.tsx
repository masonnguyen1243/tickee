import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/tickee/empty-state';
import { ThemeToggle } from '@/components/tickee/theme-toggle';
import { Wordmark } from '@/components/tickee/wordmark';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <header className="flex items-center justify-between gap-3 py-4">
        <Link href="/" aria-label="Tickee — Trang chủ" className="inline-flex shrink-0 rounded-md">
          <Wordmark />
        </Link>
        <ThemeToggle />
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
