'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorCode } from '@tickee/contracts';
import { Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';

/**
 * Đọc `me` bằng cookie session vừa đặt ở callback Google rồi đi tiếp bằng `replace` (Back không quay lại đây):
 * chưa đồng ý NĐ 13 → `/dong-y`; đã đồng ý → `returnTo`; không có session (401) → màn đăng nhập.
 */
export function GoogleReturn({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const unauthenticated = hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED);

  useEffect(() => {
    if (unauthenticated) router.replace(withReturnTo(LOGIN_PATH, returnTo));
    else if (me.data) router.replace(me.data.consentedAt ? returnTo : withReturnTo(CONSENT_PATH, returnTo));
  }, [unauthenticated, me.data, returnTo, router]);

  if (me.isError && !unauthenticated) {
    return (
      <div className="flex flex-col gap-section pt-2">
        <StatusBanner tone="danger" title="Chưa đăng nhập được bằng Google. Thử lại hoặc dùng mã qua email." />
        <Button asChild variant="secondary" className="w-full">
          <Link href={withReturnTo(LOGIN_PATH, returnTo)} replace>
            Về màn đăng nhập
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col items-center gap-stack pt-section text-muted-foreground">
      <Loader2Icon aria-hidden="true" className="size-8 animate-spin" />
      <p className="text-body">Đang đăng nhập…</p>
    </div>
  );
}
