'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckerAction, ErrorCode, type CheckerListItem, type EventDetail } from '@tickee/contracts';
import { useId, useState } from 'react';
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
import { checkersQueryKey, fetchCheckers, restoreChecker, revokeChecker } from '@/lib/checkin/api';
import {
  CHECKER_GONE_MESSAGE,
  checkerDialogView,
  checkerName,
  checkerRowView,
  isCheckerGone,
  isRestoreEnded,
  NO_CHECKERS,
  RESTORE_ENDED_MESSAGE,
} from '@/lib/checkin/checker-view';
import { eventQueryKey, eventsQueryKey } from '@/lib/event/api';

import { isEventEnded } from '../event-status';
import { ActionWithReason } from './action-with-reason';

/*
 * Khối "CTV soát vé" của tab Check-in (Story 5.6, FR-26, UX-DR39): mọi CTV đã nhận lời mời của Sự kiện, theo lúc nhận
 * (hàng không đổi chỗ khi đổi trạng thái). Mỗi hàng: tên (không có thì email), email, "Nhận lúc …", trạng thái và nút
 * "Thu hồi" (`destructive`) hoặc "Khôi phục" (`secondary`). Sự kiện đã kết thúc (cùng nguồn `isEventEnded` với "Tạo link
 * mới"): "Khôi phục" tắt kèm lý do, "Thu hồi" vẫn bấm được. Cả hai thao tác hỏi trước bằng `ConfirmDialog` nêu hậu quả.
 * Không realtime: Màn quét đang mở của CTV đổi ở lượt request kế tiếp.
 */

type Target = { checker: CheckerListItem; action: CheckerAction };

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="checker-list-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải danh sách CTV</span>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-6 w-40" />
    </div>
  );
}

function CheckerRow({
  checker,
  eventEnded,
  onAction,
}: {
  checker: CheckerListItem;
  eventEnded: boolean;
  onAction: (target: Target) => void;
}) {
  const view = checkerRowView(checker, eventEnded);
  return (
    <li className="flex items-center gap-3 py-3" data-slot="checker-row">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span data-slot="checker-name" className="text-body break-words">
          {view.label}
        </span>
        {view.email ? (
          <span data-slot="checker-email" className="text-meta break-all text-muted-foreground">
            {view.email}
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge tone={view.badge.tone}>{view.badge.label}</StatusBadge>
          <span data-slot="checker-accepted" className="text-meta text-muted-foreground tabular-nums">
            {view.accepted}
          </span>
        </div>
      </div>
      <ActionWithReason reason={view.disabledReason} className="max-w-32 shrink-0 items-end text-right">
        {(reasonId) => (
          <Button
            type="button"
            variant={view.action === CheckerAction.REVOKE ? 'destructive' : 'secondary'}
            size="sm"
            disabled={view.disabledReason !== null}
            aria-label={`${view.actionLabel} ${view.label}`}
            aria-describedby={reasonId}
            onClick={() => onAction({ checker, action: view.action })}
          >
            {view.actionLabel}
          </Button>
        )}
      </ActionWithReason>
    </li>
  );
}

/**
 * Hộp xác nhận "Thu hồi" / "Khôi phục" (mẫu `RemoveDialog`): xử lý kết quả đặt trên `useMutation` (session chưa qua lớp
 * hai thì `Providers` gửi lại đúng mutation này). Xong → đóng, toast, tải lại danh sách. `404` (CTV hay Sự kiện không còn)
 * → đóng, toast, tải lại danh sách; `409 EVENT_ALREADY_ENDED` khi khôi phục → đóng, toast, tải lại Sự kiện và danh sách;
 * `401` → đăng nhập; lỗi khác hiện trong `Dialog`. `target` giữ lần mở gần nhất để nội dung không đổi khi đang đóng.
 */
function CheckerActionDialog({
  orgId,
  eventId,
  target,
  open,
  onClose,
}: {
  orgId: string;
  eventId: string;
  target: Target | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const listKey = checkersQueryKey(orgId, eventId);

  const mutation = useMutation({
    mutationFn: ({ checker, action }: Target) =>
      action === CheckerAction.REVOKE
        ? revokeChecker(orgId, eventId, checker.id)
        : restoreChecker(orgId, eventId, checker.id),
    onSuccess: (_data, { checker, action }) => {
      onClose();
      toast.success(checkerDialogView(action, checkerName(checker)).success);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (isCheckerGone(error)) {
        onClose();
        toast.info(CHECKER_GONE_MESSAGE);
        void queryClient.invalidateQueries({ queryKey: listKey });
      } else if (isRestoreEnded(error)) {
        onClose();
        toast.info(RESTORE_ENDED_MESSAGE);
        void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, eventId) });
        void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
        void queryClient.invalidateQueries({ queryKey: listKey });
      }
    },
  });
  const error = mutation.error;
  const failure = error && !handledElsewhere(error) && !isCheckerGone(error) && !isRestoreEnded(error) ? error : null;
  const view = target ? checkerDialogView(target.action, checkerName(target.checker)) : null;

  return (
    <ConfirmDialog
      open={open && target !== null}
      onOpenChange={(next) => {
        if (next) return;
        mutation.reset();
        onClose();
      }}
      title={view?.title ?? ''}
      titleClassName="break-words"
      description={view?.description ?? ''}
      descriptionClassName="break-words"
      confirmLabel={view?.confirmLabel ?? ''}
      confirmVariant={view?.confirmVariant}
      onConfirm={() => target && mutation.mutate(target)}
      pending={mutation.isPending}
      failureTitle={view?.failureTitle ?? ''}
      failure={failure && messageOf(failure)}
    />
  );
}

/** Khối "CTV soát vé", đặt sau khối "Link mời CTV". */
export function CheckerList({ orgId, event }: { orgId: string; event: EventDetail }) {
  const titleId = useId();
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: checkersQueryKey(orgId, event.id),
    queryFn: ({ signal }) => fetchCheckers(orgId, event.id, signal),
  });
  const eventEnded = isEventEnded(event);

  const onAction = (next: Target) => {
    setTarget(next);
    setOpen(true);
  };

  let body;
  if (query.data) {
    const { checkers } = query.data;
    body =
      checkers.length === 0 ? (
        <p data-slot="checker-list-empty" className="text-body text-muted-foreground">
          {NO_CHECKERS}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border">
          {checkers.map((checker) => (
            <CheckerRow key={checker.id} checker={checker} eventEnded={eventEnded} onAction={onAction} />
          ))}
        </ul>
      );
  } else if (query.isError && !handledElsewhere(query.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách CTV"
        description={messageOf(query.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <ListSkeleton />;
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="checker-list"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        CTV soát vé
      </h2>
      <p className="text-meta text-muted-foreground">
        CTV đã nhận lời mời của Sự kiện này. Thu hồi có hiệu lực từ lượt quét kế tiếp của CTV.
      </p>
      {body}
      <CheckerActionDialog
        orgId={orgId}
        eventId={event.id}
        target={target}
        open={open}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
