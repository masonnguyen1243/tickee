'use client';

import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { CHECKER_INVITE_PATH, checkinScanPath, ErrorCode } from '@tickee/contracts';
import { Link2Off, ScanLine, UserRoundX, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { tokenFromHash } from '@/lib/auth/hash-token';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { acceptCheckerInvite, checkerInvitePreviewQueryKey, previewCheckerInvite } from '@/lib/checkin/api';
import {
  forgetCheckerInviteToken,
  recallCheckerInviteToken,
  rememberCheckerInviteToken,
} from '@/lib/checkin/invite-token';

/** Link hết hạn, bị thu hồi, token sai hoặc thiếu (UX-DR27): không lộ tên Sự kiện. */
const INVALID_TITLE = 'Link mời đã hết hạn.';
const INVALID_DESCRIPTION = 'Liên hệ BTC để nhận link mới.';
/** CTV đã bị thu hồi không tự nhận lại bằng link (UX-DR33). */
const REVOKED_TITLE = 'Bạn không còn quyền soát vé cho Sự kiện này.';

/** `returnTo` luôn là `/loi-moi-ctv`, không bao giờ kèm token. */
const LOGIN_TO_ACCEPT = withReturnTo(LOGIN_PATH, CHECKER_INVITE_PATH);
const CONSENT_TO_ACCEPT = withReturnTo(CONSENT_PATH, CHECKER_INVITE_PATH);

/** Lỗi do `Providers` xử lý (dialog "Xác thực hai lớp", chuyển sang màn đồng ý): chờ, không báo lại tại chỗ. */
const handledByProviders = (error: unknown): boolean =>
  isTotpRequired(error) || hasErrorCode(error, ErrorCode.CONSENT_REQUIRED);

function Screen({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-button text-muted-foreground" />
        <h1 className="text-headline break-words">{title}</h1>
        {description ? <div className="text-body text-muted-foreground break-words">{description}</div> : null}
      </div>
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
 * Đọc token một lần sau khi hydrate: `#token` của link, hoặc token đã giữ khi rời trang để đăng nhập. Giữ được token
 * trong tab thì bỏ `#token` khỏi URL: không còn trên thanh địa chỉ/lịch sử, và không lọt vào `returnTo` mà `Providers`
 * dựng từ URL hiện tại (dialog 2FA "Đăng xuất", chuyển sang màn đồng ý). Không giữ được thì để nguyên `#`.
 */
function useCheckerInviteToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const fromHash = tokenFromHash(window.location.hash);
    if (fromHash && rememberCheckerInviteToken(fromHash)) {
      window.history.replaceState(null, '', CHECKER_INVITE_PATH);
    }
    setToken(fromHash ?? recallCheckerInviteToken());
  }, []);
  return token;
}

/**
 * Nhận lời mời CTV soát vé (FR-26, UX-DR27, UX-DR33). Xem trước công khai: tên Sự kiện, tên BTC, "Nhận soát vé". Chưa
 * đăng nhập → nút sang đăng nhập (quay lại đây, bấm "Nhận soát vé" lần nữa); đã đăng nhập → gọi accept → Màn quét.
 * Người đã quét được Sự kiện (CTV `active`, Owner/Admin) được xem trước trả `scanEventId` → vào thẳng Màn quét, không
 * gọi accept. Token bị bỏ khỏi tab khi nhận xong, khi vào thẳng Màn quét, khi link hỏng và khi CTV đã bị thu hồi.
 * `TOTP_REQUIRED` khi nhận do `Providers` hỏi mã rồi gửi lại.
 */
export function CheckerInviteAcceptance() {
  const router = useRouter();
  const token = useCheckerInviteToken();

  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const preview = useQuery({
    queryKey: checkerInvitePreviewQueryKey(token ?? ''),
    queryFn: token ? ({ signal }) => previewCheckerInvite(token, signal) : skipToken,
  });

  const accept = useMutation({
    mutationFn: acceptCheckerInvite,
    onSuccess: ({ eventId }) => {
      forgetCheckerInviteToken();
      router.replace(checkinScanPath(eventId));
    },
    onError: (error) => {
      // Phiên hết giữa chừng: token vẫn giữ trong tab, đăng nhập xong quay lại nhận tiếp.
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) router.replace(LOGIN_TO_ACCEPT);
      else if (hasErrorCode(error, ErrorCode.CHECKER_INVITE_INVALID) || hasErrorCode(error, ErrorCode.CHECKER_REVOKED)) {
        forgetCheckerInviteToken();
      }
    },
  });

  const signedOut = hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED);
  const needsConsent = Boolean(me.data && !me.data.consentedAt);
  useEffect(() => {
    // Chưa đồng ý NĐ 13 thì chưa nhận được (api trả CONSENT_REQUIRED): sang màn đồng ý rồi quay lại.
    if (needsConsent) router.replace(CONSENT_TO_ACCEPT);
  }, [needsConsent, router]);

  // Đã quét được Sự kiện này (CTV `active`, Owner/Admin): vào thẳng Màn quét, không gọi accept.
  const scanEventId = preview.data?.scanEventId ?? null;
  useEffect(() => {
    if (!scanEventId) return;
    forgetCheckerInviteToken();
    router.replace(checkinScanPath(scanEventId));
  }, [scanEventId, router]);

  const previewInvalid = hasErrorCode(preview.error, ErrorCode.CHECKER_INVITE_INVALID);
  useEffect(() => {
    if (previewInvalid) forgetCheckerInviteToken();
  }, [previewInvalid]);

  if (token === undefined) return <Loading />;

  if (token === null || previewInvalid || hasErrorCode(accept.error, ErrorCode.CHECKER_INVITE_INVALID)) {
    return <Screen icon={Link2Off} title={INVALID_TITLE} description={INVALID_DESCRIPTION} />;
  }

  if (hasErrorCode(accept.error, ErrorCode.CHECKER_REVOKED)) {
    return <Screen icon={UserRoundX} title={REVOKED_TITLE} />;
  }

  // Lỗi tải (mạng, 5xx): banner + "Thử lại". 401 của `me` là "chưa đăng nhập", không phải lỗi.
  const previewError = preview.error && !handledByProviders(preview.error) ? preview.error : null;
  const meError = me.error && !signedOut && !handledByProviders(me.error) ? me.error : null;
  const loadError = previewError ?? meError;
  if (loadError) {
    return (
      <div className="pt-2">
        <StatusBanner
          tone="danger"
          title="Chưa tải được lời mời"
          description={messageOf(loadError)}
          action={
            <Button
              type="button"
              variant="link"
              size="sm"
              loading={preview.isFetching || me.isFetching}
              onClick={() => {
                if (previewError) void preview.refetch();
                if (meError) void me.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  if (!preview.data || scanEventId || (!signedOut && !me.data) || needsConsent) return <Loading />;

  const { eventName, organizationName } = preview.data;
  const title = `Bạn được mời soát vé cho ${eventName}.`;
  const organizer = <p data-slot="checker-invite-organization">BTC: {organizationName}</p>;

  if (signedOut || !me.data) {
    return (
      <Screen icon={ScanLine} title={title} description={organizer}>
        <Button asChild className="w-full sm:w-auto sm:self-start">
          <Link href={LOGIN_TO_ACCEPT}>Nhận soát vé</Link>
        </Button>
      </Screen>
    );
  }

  const acceptFailure =
    accept.error &&
    !handledByProviders(accept.error) &&
    !hasErrorCode(accept.error, ErrorCode.UNAUTHENTICATED)
      ? accept.error
      : null;

  return (
    <Screen
      icon={ScanLine}
      title={title}
      description={
        <>
          {organizer}
          <p className="mt-2">Bạn đang đăng nhập bằng {me.data.email}.</p>
        </>
      }
    >
      {acceptFailure ? (
        <StatusBanner tone="danger" title="Chưa nhận được lời mời" description={messageOf(acceptFailure)} />
      ) : null}
      <Button
        type="button"
        className="w-full sm:w-auto sm:self-start"
        loading={accept.isPending || accept.isSuccess}
        onClick={() => accept.mutate(token)}
      >
        Nhận soát vé
      </Button>
    </Screen>
  );
}
