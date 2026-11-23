'use client';

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkerInviteUrl, checkinScanPath, ErrorCode, type EventDetail } from '@tickee/contracts';
import { Copy, ScanLine } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  checkerInviteQueryKey,
  checkerInviteTokenQueryKey,
  createCheckerInvite,
  fetchCheckerInvite,
  type CheckerInviteToken,
} from '@/lib/checkin/api';
import { checkerInviteView, NO_CHECKER_INVITE, REPLACE_INVITE_CONSEQUENCES } from '@/lib/checkin/invite-view';
import { copyWithToast } from '@/lib/clipboard';
import { eventQueryKey, eventsQueryKey } from '@/lib/event/api';

import { isEventEnded } from '../event-status';
import { useOrigin } from '../public-event-link';

/*
 * Tab Check-in của Sự kiện (Story 5.1, FR-26, UX-DR39): thẻ "Màn quét" (Story 5.2: lối vào Màn quét của Owner/Admin, không
 * cần lời mời, FR-29) và khối "Link mời CTV". Một link chung cho mỗi Sự kiện: trạng thái "Còn hạn"/"Đã hết hạn" kèm thời
 * điểm hết hạn (giờ Việt Nam), "Sao chép link" (toast "Đã sao chép") và "Tạo link mới".
 *
 * Link đầy đủ chỉ có ngay sau khi tạo: token nằm trong cache TanStack Query của tab trình duyệt (không `sessionStorage`),
 * gắn với id link. Chuyển tab trong app vẫn sao chép được; tải lại hoặc đóng trang thì "Sao chép link" tắt kèm lý do.
 * Đang có link còn hạn thì "Tạo link mới" hỏi trước bằng `ConfirmDialog` (link cũ chết ngay); lần tạo đầu hay link đã
 * hết hạn thì không hỏi. Sự kiện nháp, đã kết thúc hoặc đã hủy: "Tạo link mới" tắt kèm lý do. Trạng thái Sự kiện đổi
 * ở server giữa chừng (409) → toast và tải lại Sự kiện cùng link.
 */

/** Trạng thái Sự kiện ở server khác thứ đang hiện: tải lại, không báo lỗi tại chỗ. */
const STALE_CODES = [ErrorCode.EVENT_STATUS_CONFLICT, ErrorCode.EVENT_CANCELLED, ErrorCode.EVENT_ALREADY_ENDED];
const STALE_MESSAGE = 'Trạng thái Sự kiện vừa đổi. Đã tải lại.';
const isStale = (error: unknown) => STALE_CODES.some((code) => hasErrorCode(error, code));

function InviteSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="checker-invite-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải link mời CTV</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-control-height w-40" />
    </div>
  );
}

/** Nút kèm lý do tắt hiện ngay dưới nút (luôn đọc được, không chỉ tooltip). */
function ActionWithReason({ reason, children }: { reason: string | null; children: (reasonId?: string) => ReactNode }) {
  const reasonId = useId();
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {children(reason ? reasonId : undefined)}
      {reason ? (
        <p id={reasonId} className="text-meta text-muted-foreground">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

function CheckerInviteBlock({ orgId, event }: { orgId: string; event: EventDetail }) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const origin = useOrigin();
  const [confirming, setConfirming] = useState(false);
  const inviteKey = checkerInviteQueryKey(orgId, event.id);
  const tokenKey = checkerInviteTokenQueryKey(orgId, event.id);

  const query = useQuery({ queryKey: inviteKey, queryFn: ({ signal }) => fetchCheckerInvite(orgId, event.id, signal) });
  // Token chỉ trong bộ nhớ: không bao giờ gọi mạng, không bao giờ dọn khi tab Check-in đóng (chuyển tab vẫn còn).
  const tokenQuery = useQuery<CheckerInviteToken>({
    queryKey: tokenKey,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const create = useMutation({
    mutationFn: () => createCheckerInvite(orgId, event.id),
    onSuccess: async ({ invite, token }) => {
      // GET đang chạy (link cũ) không được ghi đè link vừa tạo.
      await queryClient.cancelQueries({ queryKey: inviteKey });
      queryClient.setQueryData<CheckerInviteToken>(tokenKey, { inviteId: invite.id, token });
      queryClient.setQueryData(inviteKey, { invite });
      setConfirming(false);
      toast.success('Đã tạo link mời CTV mới.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (isStale(error)) {
        setConfirming(false);
        toast.info(STALE_MESSAGE);
        void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, event.id) });
        void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
        void queryClient.invalidateQueries({ queryKey: inviteKey });
      }
    },
  });
  const failure = create.error && !isStale(create.error) && !handledElsewhere(create.error) ? create.error : null;

  const invite = query.data?.invite ?? null;
  const stored = tokenQuery.data;
  const token = invite && stored?.inviteId === invite.id ? stored.token : null;
  const view = checkerInviteView({
    eventStatus: event.status,
    eventEnded: isEventEnded(event),
    effectiveEndAt: event.effectiveEndAt,
    invite,
    hasToken: token !== null,
  });
  const url = view.active && token && origin ? checkerInviteUrl(origin, token) : null;

  const onCreate = () => {
    if (create.isPending) return;
    create.reset();
    if (view.confirmBeforeCreate) setConfirming(true);
    else create.mutate();
  };

  let body;
  if (query.data) {
    body = (
      <>
        {invite ? (
          <div className="flex min-w-0 flex-col gap-1">
            {url ? (
              <p data-slot="checker-invite-url" className="min-w-0 font-mono text-code break-all">
                {url}
              </p>
            ) : null}
            <p data-slot="checker-invite-expiry" className="text-body tabular-nums">
              {view.expiry}
            </p>
          </div>
        ) : (
          <p data-slot="checker-invite-empty" className="text-body text-muted-foreground">
            {NO_CHECKER_INVITE}
          </p>
        )}
        {failure && !confirming ? (
          <StatusBanner tone="danger" title="Chưa tạo được link mời" description={messageOf(failure)} />
        ) : null}
        <div className="flex flex-col gap-stack sm:flex-row sm:items-start">
          {invite ? (
            <ActionWithReason reason={view.copyDisabledReason}>
              {(reasonId) => (
                <Button
                  type="button"
                  variant={view.active ? 'primary-on-light' : 'secondary'}
                  disabled={view.copyDisabledReason !== null}
                  aria-describedby={reasonId}
                  onClick={() => {
                    if (url) void copyWithToast(url);
                  }}
                >
                  <Copy aria-hidden="true" />
                  Sao chép link
                </Button>
              )}
            </ActionWithReason>
          ) : null}
          <ActionWithReason reason={view.createDisabledReason}>
            {(reasonId) => (
              <Button
                type="button"
                variant={view.active ? 'secondary' : 'primary-on-light'}
                disabled={view.createDisabledReason !== null}
                aria-describedby={reasonId}
                loading={create.isPending && !confirming}
                onClick={onCreate}
              >
                Tạo link mới
              </Button>
            )}
          </ActionWithReason>
        </div>
      </>
    );
  } else if (query.isError && !handledElsewhere(query.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được link mời CTV"
        description={messageOf(query.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <InviteSkeleton />;
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="checker-invite"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-stack">
        <h2 id={titleId} className="text-title">
          Link mời CTV
        </h2>
        {view.badge && query.data ? <StatusBadge tone={view.badge.tone}>{view.badge.label}</StatusBadge> : null}
      </div>
      <p className="text-meta text-muted-foreground">
        Một link chung cho mọi CTV soát vé của Sự kiện này. CTV mở link, đăng nhập rồi nhận lời mời để quét Vé.
      </p>
      {body}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (open) return;
          create.reset();
          setConfirming(false);
        }}
        title="Tạo link mới?"
        description={REPLACE_INVITE_CONSEQUENCES}
        confirmLabel="Tạo link mới"
        onConfirm={() => create.mutate()}
        pending={create.isPending}
        failureTitle="Chưa tạo được link mời"
        failure={failure && messageOf(failure)}
      />
    </section>
  );
}

/**
 * Thẻ "Màn quét" (Story 5.2): Owner/Admin mở Màn quét của Sự kiện đang xem mà không cần lời mời. Link luôn có ở mọi trạng
 * thái Sự kiện; Màn quét tự báo khi Sự kiện không còn quét được (Story 5.3/5.6). Nút phụ: hành động chính của tab là link
 * mời CTV.
 */
function ScanScreenCard({ eventId }: { eventId: string }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-slot="scan-screen-card"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        Màn quét
      </h2>
      <p className="text-meta text-muted-foreground">
        Quét Mã QR vé của khách tại cổng. Owner và Admin mở được Màn quét mà không cần link mời.
      </p>
      <Button asChild variant="secondary" className="self-start">
        <Link href={checkinScanPath(eventId)}>
          <ScanLine aria-hidden="true" />
          Mở Màn quét
        </Link>
      </Button>
    </section>
  );
}

/** Tab "Check-in": thẻ "Màn quét" (Story 5.2) rồi khối link mời CTV (Story 5.1). */
export function CheckinTab({ orgId, event }: { orgId: string; event: EventDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-section" data-slot="checkin-tab">
      <ScanScreenCard eventId={event.id} />
      <CheckerInviteBlock orgId={orgId} event={event} />
    </div>
  );
}
