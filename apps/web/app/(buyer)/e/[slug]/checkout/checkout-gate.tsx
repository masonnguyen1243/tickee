'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorCode, FunnelEventType } from '@tickee/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { sendFunnelEvent } from '@/lib/event/funnel';

type CheckoutGateProps = {
  slug: string;
  /** `f` hợp lệ trên URL: tới đây sau một lần "Mua" phải đăng nhập. */
  funnelId: string | null;
  /** URL có tham số `f` (kể cả sai dạng): bỏ khỏi URL sau khi đã xử lý. */
  hasFunnelParam: boolean;
  /** URL Checkout chuẩn (chỉ có `items`), để `router.replace` bỏ `f`. */
  checkoutHref: string;
  children: ReactNode;
};

/**
 * Chặn chưa đăng nhập ở trình duyệt (phiên ở origin API, server web không đọc được): 401 → màn đăng nhập với `returnTo`
 * là URL hiện tại kèm query; đăng nhập rồi mà chưa đồng ý NĐ 13 → màn đồng ý. Đã vào được và URL có `f` → ghi
 * `login_completed` (không chờ) đúng một lần rồi `router.replace` bỏ `f` (tải lại hay Back không ghi lần nữa).
 */
export function CheckoutGate({ slug, funnelId, hasFunnelParam, checkoutHref, children }: CheckoutGateProps) {
  const router = useRouter();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const unauthenticated = hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED);
  const consented = Boolean(me.data?.consentedAt);

  useEffect(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    if (unauthenticated) router.replace(withReturnTo(LOGIN_PATH, here));
    else if (me.data && !me.data.consentedAt) router.replace(withReturnTo(CONSENT_PATH, here));
  }, [unauthenticated, me.data, router]);

  const recorded = useRef(false);
  useEffect(() => {
    if (!consented || !hasFunnelParam || recorded.current) return;
    recorded.current = true;
    if (funnelId) sendFunnelEvent(slug, { type: FunnelEventType.LOGIN_COMPLETED, funnelId });
    router.replace(checkoutHref);
  }, [consented, hasFunnelParam, funnelId, slug, checkoutHref, router]);

  if (consented) return children;

  // `TOTP_REQUIRED`: dialog "Xác thực hai lớp" toàn cục đang mở, qua lớp hai thì `me` tự tải lại.
  if (me.isError && !unauthenticated && !isTotpRequired(me.error)) {
    return (
      <div className="flex flex-col gap-section pt-2">
        <StatusBanner
          tone="danger"
          title="Chưa tải được tài khoản"
          description={me.error instanceof ApiError ? me.error.message : 'Vui lòng thử lại.'}
          action={
            <Button type="button" variant="link" size="sm" onClick={() => void me.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-section pt-2">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" data-slot="skeleton" className="h-16 animate-pulse rounded-lg bg-muted" />
      <div aria-hidden="true" data-slot="skeleton" className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
