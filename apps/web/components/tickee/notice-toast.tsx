'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { NOTICE_PARAM, noticeMessage } from '@/lib/notices';

/**
 * Hiện toast cho `?notice=<mã>` (vd. "Bạn cần đồng ý để dùng Tickee." sau khi từ chối đồng ý) rồi xóa tham số,
 * để tải lại trang không hiện lần nữa. Đặt trong `<Suspense>` vì dùng `useSearchParams`.
 */
export function NoticeToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const notice = searchParams.get(NOTICE_PARAM);

  useEffect(() => {
    if (notice === null) return;
    const message = noticeMessage(notice);
    // `id` cố định: StrictMode chạy effect hai lần cũng chỉ một toast.
    if (message) toast.info(message, { id: `notice-${notice}` });
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete(NOTICE_PARAM);
    const query = rest.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}${window.location.hash}`, { scroll: false });
  }, [notice, pathname, router, searchParams]);

  return null;
}
