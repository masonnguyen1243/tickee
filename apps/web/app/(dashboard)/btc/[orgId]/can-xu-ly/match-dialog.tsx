'use client';

import { useQuery } from '@tanstack/react-query';
import { EventStatus, formatVnd, formatVnDateTime, type MatchCandidate, type ReviewItemDetail } from '@tickee/contracts';
import { SearchX } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { EmptyState } from '@/components/tickee/empty-state';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { eventsQueryKey, fetchEvents } from '@/lib/event/api';
import { fetchMatchCandidates, reviewMatchCandidatesQueryKey } from '@/lib/reporting/api';
import { orderStatusBadge, ticketCountLabel } from '@/lib/reporting/overview';
import {
  APPROVE_BLOCKED_LABEL,
  EMPTY_VALUE,
  MATCH_ALL_EVENTS,
  MATCH_CONFIRM_LABEL,
  MATCH_DIALOG_TITLE,
  MATCH_TRUNCATED_NOTE,
  matchEmptyText,
  matchSelectable,
  matchSelection,
  type ReviewActionFailure,
} from '@/lib/reporting/review-queue';
import { cn } from '@/lib/utils';

/** Một Đơn ứng viên: radio kèm mã, trạng thái, Người mua, Sự kiện, số Vé, lúc tạo; bị chặn thì tắt kèm lý do. */
function CandidateOption({
  candidate,
  name,
  checked,
  disabled,
  onSelect,
}: {
  candidate: MatchCandidate;
  name: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const reasonId = useId();
  const selectable = matchSelectable(candidate);
  const badge = orderStatusBadge(candidate.status);
  return (
    <li data-slot="match-candidate" data-selectable={selectable}>
      <label
        className={cn(
          'flex min-h-11 min-w-0 items-start gap-3 py-3',
          selectable && !disabled ? 'cursor-pointer' : 'cursor-not-allowed',
        )}
      >
        <input
          type="radio"
          name={name}
          value={candidate.code}
          checked={checked}
          disabled={!selectable || disabled}
          aria-describedby={selectable ? undefined : reasonId}
          onChange={onSelect}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-btn-on-light disabled:cursor-not-allowed"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('flex min-w-0 flex-col gap-0.5', !selectable && 'opacity-50')}>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-label">{candidate.code}</span>
              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            </span>
            <span className="text-body wrap-break-word">{candidate.buyerName}</span>
            <span className="text-meta wrap-break-word text-muted-foreground">{candidate.event.name}</span>
            <span className="text-meta text-muted-foreground tabular-nums">
              {ticketCountLabel(candidate.ticketCount)} · {formatVnDateTime(candidate.createdAt)}
            </span>
          </span>
          {candidate.blockedReason ? (
            <span id={reasonId} data-slot="match-candidate-blocked" className="text-meta text-danger-text">
              {APPROVE_BLOCKED_LABEL[candidate.blockedReason]}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}

/**
 * `Dialog` "Ghép với Đơn" (Story 4.4-b) mở trên `Sheet` của mục `unmatched`: số tiền nhận, "Mã Đơn trong giao dịch", ô
 * chọn Sự kiện ("Mọi Sự kiện" + Sự kiện của BTC, trừ nháp) và danh sách radio Đơn ứng viên (`GET …/match-candidates`,
 * máy chủ lọc cùng BTC, `expired`/`review`, cùng số tiền) cuộn bên trong để nút xác nhận luôn thấy. Ứng viên bị chặn (Sự
 * kiện đã hủy/kết thúc/bị khóa) tắt kèm lý do. "Ghép và phát Vé" tắt tới khi chọn một Đơn; Đơn đã chọn biến mất sau khi
 * tải lại thì bỏ chọn. Logic gửi (khóa, toast, lỗi) ở `ReviewActions`; lỗi tại chỗ (`failure`) hiện trong `Dialog`.
 */
export function MatchDialog({
  orgId,
  detail,
  open,
  onClose,
  onConfirm,
  pending,
  failure,
  onCloseAutoFocus,
}: {
  orgId: string;
  detail: ReviewItemDetail;
  open: boolean;
  /** Esc, lớp phủ, "Đóng", "Hủy" (không gọi khi đang gửi). */
  onClose: () => void;
  onConfirm: (orderCode: string) => void;
  pending: boolean;
  /** Lỗi của lần gửi gần nhất (tiêu đề và câu mô tả), hiện trên nút xác nhận. */
  failure: ReviewActionFailure | null;
  onCloseAutoFocus?: ComponentProps<typeof ConfirmDialog>['onCloseAutoFocus'];
}) {
  const ids = useId();
  const eventSelectId = `${ids}-event`;
  const listLabelId = `${ids}-list`;
  const [eventId, setEventId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Mỗi lần mở là một lần chọn mới: bỏ bộ lọc và Đơn đã chọn của lần trước.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setEventId(null);
      setSelected(null);
    }
  }

  const events = useQuery({
    queryKey: eventsQueryKey(orgId),
    queryFn: ({ signal }) => fetchEvents(orgId, signal),
    enabled: open,
  });
  const candidates = useQuery({
    queryKey: reviewMatchCandidatesQueryKey(orgId, detail.id, eventId),
    queryFn: ({ signal }) => fetchMatchCandidates(orgId, detail.id, eventId, signal),
    enabled: open,
    // Mỗi lần mở tải lại: Đơn ứng viên đổi (IPN muộn trả Đơn hết hạn, Sự kiện kết thúc/bị khóa) mà không có tín hiệu.
    staleTime: 0,
  });

  const amount = detail.transaction.receivedAmount;
  const list = candidates.data?.candidates;
  const chosen = matchSelection(list, selected);
  // Đơn đã chọn biến mất (vd. vừa được ghép ở nơi khác, đổi bộ lọc Sự kiện) hoặc bị tắt sau khi tải lại: bỏ chọn hẳn,
  // không tự chọn lại khi Đơn đó hiện lại.
  if (list && selected !== null && chosen === null) setSelected(null);
  const eventOptions = (events.data ?? []).filter((event) => event.status !== EventStatus.DRAFT);

  let body;
  if (list) {
    body =
      list.length === 0 ? (
        <EmptyState icon={SearchX} title={matchEmptyText(amount)} className="py-6" />
      ) : (
        // Phần tử con trực tiếp của `<form>` (`min-h-0`): khi `Dialog` chạm chiều cao tối đa, chỉ danh sách co lại (tối
        // thiểu `min-h-20`) và cuộn bên trong, nút xác nhận ở dưới vẫn thấy. Ghi chú "chỉ hiện 100 Đơn" nằm đầu danh
        // sách (cuộn cùng) để không chiếm thêm chiều cao cố định.
        <div
          role="radiogroup"
          aria-labelledby={listLabelId}
          data-slot="match-candidates"
          className="min-h-20 overflow-y-auto overscroll-contain rounded-md border border-border px-3"
        >
          {candidates.data?.truncated ? (
            <p data-slot="match-truncated" className="border-b border-border py-2 text-meta text-muted-foreground">
              {MATCH_TRUNCATED_NOTE}
            </p>
          ) : null}
          <ul className="flex flex-col divide-y divide-border">
            {list.map((candidate) => (
              <CandidateOption
                key={candidate.code}
                candidate={candidate}
                name={`${ids}-order`}
                checked={chosen === candidate.code}
                disabled={pending}
                onSelect={() => setSelected(candidate.code)}
              />
            ))}
          </ul>
        </div>
      );
  } else if (candidates.isError && !handledElsewhere(candidates.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách Đơn"
        description={messageOf(candidates.error)}
        action={
          <Button
            type="button"
            variant="link"
            size="sm"
            loading={candidates.isFetching}
            onClick={() => void candidates.refetch()}
          >
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Đang tải danh sách Đơn</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={MATCH_DIALOG_TITLE}
      descriptionClassName="wrap-break-word"
      description="Đơn được chọn chuyển Đã thanh toán, Người mua nhận Vé qua email. Không hoàn tác được."
      asForm
      formClassName="min-h-0"
      confirmVariant="primary-on-light"
      confirmLabel={MATCH_CONFIRM_LABEL}
      confirmDisabled={chosen === null}
      onConfirm={() => chosen && onConfirm(chosen)}
      pending={pending}
      failureTitle={failure?.title ?? ''}
      failure={failure?.description ?? null}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <dl data-slot="match-transaction" className="flex flex-col gap-1.5 text-label">
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Số tiền nhận</dt>
          <dd className="min-w-0 text-right tabular-nums">{amount === null ? EMPTY_VALUE : formatVnd(amount)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="min-w-0 text-muted-foreground">Mã Đơn trong giao dịch</dt>
          <dd className="min-w-0 text-right font-mono break-all">{detail.transaction.providerOrderId ?? EMPTY_VALUE}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <Label htmlFor={eventSelectId}>Sự kiện</Label>
        <select
          id={eventSelectId}
          name="event"
          data-slot="match-event"
          value={eventId ?? ''}
          disabled={pending}
          onChange={(event) => setEventId(event.target.value || null)}
          className="h-control-height w-full min-w-0 rounded-md border border-transparent bg-muted px-3 text-foreground focus:border-ring"
        >
          <option value="">{MATCH_ALL_EVENTS}</option>
          {eventOptions.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </div>
      <p id={listLabelId} className="-mb-1 text-label">
        Đơn cùng số tiền
      </p>
      {body}
    </ConfirmDialog>
  );
}
