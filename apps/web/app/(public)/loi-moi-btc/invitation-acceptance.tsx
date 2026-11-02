'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  InvitationEmailMismatchDetails,
  ORGANIZATION_INVITATION_PATH,
  organizationDashboardPath,
} from '@tickee/contracts';
import { Link2Off, UserRoundPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, hasErrorCode, ME_QUERY_KEY, signOut } from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { acceptInvitation, MEMBERSHIPS_QUERY_KEY, previewInvitation } from '@/lib/organizer/api';
import {
  forgetInvitationToken,
  recallInvitationToken,
  rememberInvitationToken,
  tokenFromHash,
} from '@/lib/organizer/invitation-token';

/** Lỗi khiến link không dùng được nữa (xem trước hoặc nhận). */
const UNUSABLE: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.INVITATION_INVALID]: 'Link mời không hợp lệ.',
  [ErrorCode.INVITATION_EXPIRED]: 'Link mời đã hết hạn.',
  [ErrorCode.INVITATION_USED]: 'Link mời đã được dùng.',
};

const unusableTitle = (error: unknown): string | null =>
  error instanceof ApiError ? (UNUSABLE[error.code] ?? null) : null;

const LOGIN_TO_ACCEPT = withReturnTo(LOGIN_PATH, ORGANIZATION_INVITATION_PATH);

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
function useInvitationToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const fromHash = tokenFromHash(window.location.hash);
    if (fromHash && rememberInvitationToken(fromHash)) {
      window.history.replaceState(null, '', ORGANIZATION_INVITATION_PATH);
    }
    setToken(fromHash ?? recallInvitationToken());
  }, []);
  return token;
}

/**
 * Nhận lời mời làm Admin (FR-2). Xem trước công khai (tên BTC hoặc lý do link không dùng được); chưa đăng nhập →
 * "Đăng nhập để nhận" (quay lại đây sau đăng nhập); đã đăng nhập → "Nhận lời mời" → dashboard của BTC. Email khác
 * email lời mời → email đã che + "Đăng xuất". `TOTP_REQUIRED` khi nhận do `Providers` hỏi mã rồi gửi lại.
 */
export function InvitationAcceptance() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useInvitationToken();

  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const preview = useQuery({
    queryKey: ['organizer', 'invitation-preview', token],
    queryFn: () => previewInvitation(token!),
    enabled: Boolean(token),
  });

  const accept = useMutation({
    mutationFn: acceptInvitation,
    onSuccess: (result) => {
      forgetInvitationToken();
      void queryClient.invalidateQueries({ queryKey: MEMBERSHIPS_QUERY_KEY });
      router.replace(organizationDashboardPath(result.organizationId));
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) router.replace(LOGIN_TO_ACCEPT);
      else if (unusableTitle(error)) forgetInvitationToken();
    },
  });

  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      // Token vẫn giữ trong tab: đăng nhập đúng email xong quay lại nhận tiếp.
      router.replace(LOGIN_TO_ACCEPT);
    },
  });

  const signedOut = hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED);
  const needsConsent = Boolean(me.data && !me.data.consentedAt);
  useEffect(() => {
    // Chưa đồng ý NĐ 13 thì chưa nhận được (api trả CONSENT_REQUIRED): sang màn đồng ý rồi quay lại.
    if (needsConsent) router.replace(withReturnTo(CONSENT_PATH, ORGANIZATION_INVITATION_PATH));
  }, [needsConsent, router]);

  const previewUnusable = unusableTitle(preview.error);
  useEffect(() => {
    if (previewUnusable) forgetInvitationToken();
  }, [previewUnusable]);

  if (token === undefined) return <Loading />;

  const unusable = token === null ? UNUSABLE.INVITATION_INVALID : (previewUnusable ?? unusableTitle(accept.error));
  if (token === null || unusable) {
    return (
      <Screen icon={Link2Off} title={unusable ?? 'Link mời không hợp lệ.'} description="Liên hệ Owner để nhận link mới." />
    );
  }

  if (hasErrorCode(accept.error, ErrorCode.INVITATION_EMAIL_MISMATCH)) {
    const details = InvitationEmailMismatchDetails.safeParse(accept.error.details);
    const masked = details.success ? details.data.maskedEmail : 'một email khác';
    return (
      <Screen
        icon={Link2Off}
        title={`Lời mời này gửi tới ${masked}.`}
        description={
          me.data
            ? `Bạn đang đăng nhập bằng ${me.data.email}. Đăng xuất rồi đăng nhập bằng email nhận lời mời để nhận.`
            : 'Đăng xuất rồi đăng nhập bằng email nhận lời mời để nhận.'
        }
      >
        {logout.isError ? <StatusBanner tone="danger" title="Chưa đăng xuất được. Vui lòng thử lại." /> : null}
        <Button
          type="button"
          className="self-start"
          loading={logout.isPending || logout.isSuccess}
          onClick={() => logout.mutate()}
        >
          Đăng xuất
        </Button>
      </Screen>
    );
  }

  // Lỗi tải (mạng, 5xx): banner + "Thử lại". 401 của `me` là "chưa đăng nhập", không phải lỗi.
  const loadError = preview.error ?? (signedOut ? null : me.error);
  if (loadError) {
    return (
      <div className="pt-2">
        <StatusBanner
          tone="danger"
          title="Chưa tải được lời mời"
          description={loadError instanceof ApiError ? loadError.message : 'Vui lòng thử lại.'}
          action={
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                void preview.refetch();
                void me.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  if (!preview.data || (!signedOut && !me.data) || needsConsent) return <Loading />;

  const title = `Bạn được mời làm Admin của ${preview.data.organizationName}.`;
  const role = 'Admin cùng Owner tạo và quản lý Sự kiện, xem Đơn và doanh thu của BTC.';

  if (signedOut || !me.data) {
    return (
      <Screen icon={UserRoundPlus} title={title} description={`${role} Đăng nhập bằng email nhận lời mời để nhận.`}>
        <Button asChild className="self-start">
          <Link href={LOGIN_TO_ACCEPT}>Đăng nhập để nhận</Link>
        </Button>
      </Screen>
    );
  }

  const acceptFailure =
    accept.error && !isTotpRequired(accept.error) && !hasErrorCode(accept.error, ErrorCode.CONSENT_REQUIRED)
      ? accept.error
      : null;

  return (
    <Screen
      icon={UserRoundPlus}
      title={title}
      description={
        <>
          <p>{role}</p>
          <p className="mt-2">Bạn đang đăng nhập bằng {me.data.email}.</p>
        </>
      }
    >
      {acceptFailure && !hasErrorCode(acceptFailure, ErrorCode.UNAUTHENTICATED) ? (
        <StatusBanner
          tone="danger"
          title="Chưa nhận được lời mời"
          description={acceptFailure instanceof ApiError ? acceptFailure.message : 'Vui lòng thử lại.'}
        />
      ) : null}
      <Button
        type="button"
        className="self-start"
        loading={accept.isPending || accept.isSuccess}
        onClick={() => accept.mutate(token)}
      >
        Nhận lời mời
      </Button>
    </Screen>
  );
}
