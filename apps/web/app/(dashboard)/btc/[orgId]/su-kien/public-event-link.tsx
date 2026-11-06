'use client';

import { Copy } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { copyWithToast } from '@/lib/clipboard';

/** `window.location.origin` sau khi hydrate (server render ra chuỗi rỗng). */
const subscribeNoop = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => '',
  );
}

/**
 * Link trang Sự kiện công khai `/e/{slug}` (mở tab mới) kèm "Sao chép link". Dùng ở bước 4 của wizard sau khi mở bán và
 * ở tab Tổng quan của Sự kiện không còn nháp.
 */
export function PublicEventLink({ slug }: { slug: string }) {
  const url = `${useOrigin()}/e/${slug}`;
  return (
    <div className="flex min-w-0 flex-col gap-stack sm:flex-row sm:items-center">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 break-all text-body text-brand-text underline underline-offset-2"
        data-slot="public-event-link"
      >
        {url}
      </a>
      <Button type="button" variant="secondary" className="self-start sm:self-auto" onClick={() => void copyWithToast(url)}>
        <Copy aria-hidden="true" />
        Sao chép link
      </Button>
    </div>
  );
}
