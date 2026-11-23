'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorCode } from '@tickee/contracts';
import { ScanLine, ShieldX, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { checkinEventQueryKey, fetchCheckinEvent } from '@/lib/checkin/api';

/** Màn quét đang dựng ở Story 5.3. */
const SCAN_SCREEN_PENDING = 'Màn quét đang được hoàn thiện.';

/**
 * `403` của route CTV: người xem không quét được Sự kiện này (`NOT_A_MEMBER`, cả Sự kiện lạ hay id sai dạng), hoặc CTV
 * đã bị thu hồi (`CHECKER_REVOKED`). Hiện câu của api, không lộ tên Sự kiện. Không dùng `handledElsewhere`: ở đây
 * `NOT_A_MEMBER` không có dashboard nào xử lý thay.
 */
const NO_ACCESS_CODES = [ErrorCode.NOT_A_MEMBER, ErrorCode.CHECKER_REVOKED];
const noAccess = (error: unknown): boolean => NO_ACCESS_CODES.some((code) => hasErrorCode(error, code));

/** Lỗi do nơi khác xử lý: 401 (sang đăng nhập ngay dưới), 2FA và đồng ý NĐ 13 (`Providers`). */
const handledByGateOrProviders = (error: unknown): boolean =>
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED);

function Screen({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-button text-muted-foreground" />
      <h1 className="text-headline break-words">{title}</h1>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-section pt-2">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
      <div aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * Màn quét tạm (Story 5.2, `GET /v1/checkin/events/:eventId`): Owner/Admin của BTC hoặc CTV `active` của Sự kiện thấy
 * tên Sự kiện và "Màn quét đang được hoàn thiện."; `401` → màn đăng nhập rồi quay lại đúng trang này; `403` → câu của api.
 * Quyền kiểm lại ở mỗi request phía api.
 */
export function CheckinEventScreen({ eventId }: { eventId: string }) {
  const router = useRouter();
  const event = useQuery({
    queryKey: checkinEventQueryKey(eventId),
    queryFn: ({ signal }) => fetchCheckinEvent(eventId, signal),
  });

  const unauthenticated = hasErrorCode(event.error, ErrorCode.UNAUTHENTICATED);
  useEffect(() => {
    if (unauthenticated) {
      router.replace(withReturnTo(LOGIN_PATH, `${window.location.pathname}${window.location.search}`));
    }
  }, [unauthenticated, router]);

  // Trước `data`: lần tải lại (vd. quay lại tab sau `staleTime`) trả 403 thì bỏ tên Sự kiện đã tải.
  if (noAccess(event.error)) return <Screen icon={ShieldX} title={messageOf(event.error)} />;

  if (event.data) {
    return (
      <Screen icon={ScanLine} title={event.data.eventName}>
        <p className="text-body text-muted-foreground">{SCAN_SCREEN_PENDING}</p>
      </Screen>
    );
  }

  if (event.isError && !handledByGateOrProviders(event.error)) {
    return (
      <div className="pt-2">
        <StatusBanner
          tone="danger"
          title="Chưa tải được Màn quét"
          description={messageOf(event.error)}
          action={
            <Button type="button" variant="link" size="sm" loading={event.isFetching} onClick={() => void event.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  return <Loading />;
}
