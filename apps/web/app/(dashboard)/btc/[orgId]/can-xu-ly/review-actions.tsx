'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DISMISS_REASON_MAX,
  ErrorCode,
  formatVnd,
  REFUND_ONLY_REVIEW_ITEM_TYPES,
  ReviewAction,
  type ReviewItemDetail,
} from '@tickee/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { FieldError } from '@/components/tickee/field-error';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/errors';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { newFunnelId } from '@/lib/event/funnel';
import { postReviewAction, reviewQueueQueryPrefix, type ReviewActionInput } from '@/lib/reporting/api';
import {
  APPROVE_BLOCKED_LABEL,
  APPROVE_SOLD_OUT_DESCRIPTION,
  APPROVE_SOLD_OUT_TITLE,
  approveBlockedByError,
  dismissReasonError,
  leftQueue,
  REVIEW_ACTION_LABEL,
  REVIEW_ACTION_RACE_TOAST,
  reviewActionToast,
} from '@/lib/reporting/review-queue';

/** Thao tác đi qua `Dialog` xác nhận ("Duyệt tay phát Vé" gọi thẳng). */
type DialogAction = typeof ReviewAction.REJECT | typeof ReviewAction.REFUND | typeof ReviewAction.DISMISS;

/** Một lần gửi: khóa chống trùng của lần mở thao tác, thân, và thao tác có đi qua `Dialog` không. */
type Attempt = { key: string; input: ReviewActionInput; inDialog: boolean };

/** Lỗi tại chỗ của footer (ngoài `Dialog`): hết chỗ, Sự kiện không còn cho duyệt, lỗi khác của "Duyệt tay". */
type InlineError = { title: string; description?: string };

/**
 * Footer thao tác của `Sheet` chi tiết (Story 4.4-a): nút theo `detail.actions` (máy chủ tính, web chỉ hiển thị), theo
 * thứ tự máy chủ trả. "Duyệt tay phát Vé" gọi thẳng; tắt kèm lý do cạnh nút khi `approveBlockedReason` có. "Từ chối",
 * "Đã hoàn tay" và "Bỏ qua" (lý do bắt buộc) đi qua `Dialog` nêu hậu quả; bấm Hủy không gọi API. Mỗi lần mở một thao tác
 * sinh một `Idempotency-Key`, giữ nguyên khi thử lại sau lỗi. Nút đang gọi mạng quay spinner, các nút khác tắt tới khi
 * xong.
 *
 * Kết quả: toast nêu kết quả, làm mới hàng/badge/chi tiết; mục rời hàng (`resolved`) → `onLeft` (nơi gọi đóng `Sheet`,
 * chuyển focus). "Từ chối" giữ mục `open`: `Sheet` ở lại, chi tiết tải lại chỉ còn "Đã hoàn tay". Thua cuộc đua (`409
 * REVIEW_ACTION_NOT_ALLOWED`) → toast info và tải lại; hết chỗ hay Sự kiện không còn cho duyệt → báo tại chỗ và tải lại
 * chi tiết (nhật ký có dòng "Duyệt tay không thành · Hết chỗ").
 */
export function ReviewActions({
  orgId,
  detail,
  onLeft,
}: {
  orgId: string;
  detail: ReviewItemDetail;
  /** Mục vừa rời hàng (thao tác trả `resolved`). Gọi trước khi làm mới hàng. */
  onLeft: () => void;
}) {
  const ids = useId();
  const blockedId = `${ids}-approve-blocked`;
  const reasonInputId = `${ids}-dismiss-reason`;
  const reasonHintId = `${ids}-dismiss-hint`;
  const reasonErrorId = `${ids}-dismiss-error`;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();

  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [dialogFailure, setDialogFailure] = useState<string | null>(null);
  const [inline, setInline] = useState<InlineError | null>(null);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  /** Khóa của lần mở thao tác đang dở (giữ khi thử lại); `null` sau khi có kết quả dứt khoát. */
  const attempt = useRef<{ action: ReviewAction; key: string } | null>(null);
  /** Mục vừa rời hàng: `Sheet` đóng và tự chuyển focus, `Dialog` không trả focus về nút của `Sheet`. */
  const leaving = useRef(false);
  /**
   * Vừa "Từ chối" xong: nút "Từ chối" sẽ mất khi chi tiết tải lại (chỉ còn "Đã hoàn tay"), nên `Dialog` không trả focus
   * về đó; focus chuyển sang "Đã hoàn tay" khi nút này hiện.
   */
  const focusRefund = useRef(false);
  const refundButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focusRefund.current) return;
    // Chi tiết chưa tải lại (còn "Từ chối") hoặc không còn "Đã hoàn tay" (thành viên khác vừa xử lý): chờ / bỏ.
    if (detail.actions.includes(ReviewAction.REJECT)) return;
    focusRefund.current = false;
    refundButton.current?.focus();
  }, [detail.actions]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: reviewQueueQueryPrefix(orgId) });
  const closeDialog = () => {
    setDialog(null);
    setDialogFailure(null);
    setReason('');
    setReasonTouched(false);
  };

  // Xử lý kết quả trên `useMutation` (không trong `mutate(…, {})`): lần gửi lại sau 2FA cũng chạy các callback này.
  const run = useMutation({
    mutationFn: ({ key, input }: Attempt) => postReviewAction(orgId, detail.id, key, input),
    onSuccess: (result) => {
      attempt.current = null;
      toast.success(reviewActionToast(result));
      if (result.action === ReviewAction.REJECT) focusRefund.current = true;
      if (leftQueue(result)) {
        leaving.current = true;
        onLeft();
      }
      closeDialog();
      refresh();
    },
    onError: (error, { inDialog }) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) {
        goToLogin();
        return;
      }
      if (handledElsewhere(error)) return;
      if (hasErrorCode(error, ErrorCode.REVIEW_ACTION_NOT_ALLOWED)) {
        // Thành viên khác vừa xử lý mục (hoặc Đơn đã đổi): thao tác này không còn đúng.
        attempt.current = null;
        closeDialog();
        toast.info(REVIEW_ACTION_RACE_TOAST);
        refresh();
        return;
      }
      if (hasErrorCode(error, ErrorCode.TICKET_TYPE_SOLD_OUT)) {
        attempt.current = null;
        setInline({ title: APPROVE_SOLD_OUT_TITLE, description: APPROVE_SOLD_OUT_DESCRIPTION });
        refresh();
        return;
      }
      const blocked = error instanceof ApiError ? approveBlockedByError(error.code) : null;
      if (blocked) {
        attempt.current = null;
        setInline({ title: 'Chưa duyệt tay được', description: `${APPROVE_BLOCKED_LABEL[blocked]}.` });
        refresh();
        return;
      }
      // Lỗi khác (mạng, máy chủ, dữ liệu sai): giữ khóa để "thử lại" là cùng một lần gửi.
      if (inDialog) setDialogFailure(messageOf(error));
      else setInline({ title: 'Chưa duyệt tay được', description: messageOf(error) });
    },
  });

  const pendingAction = run.isPending ? run.variables.input.action : null;

  /** Khóa cho lần gửi `action`: dùng lại khóa của lần mở đang dở cùng thao tác, không có thì sinh mới. */
  const keyFor = (action: ReviewAction): string => {
    if (attempt.current?.action !== action) attempt.current = { action, key: newFunnelId() };
    return attempt.current.key;
  };

  const openDialog = (action: DialogAction) => {
    // Mỗi lần mở là một lần thao tác mới: khóa mới.
    attempt.current = { action, key: newFunnelId() };
    setInline(null);
    setDialogFailure(null);
    setDialog(action);
  };

  const approve = () => {
    setInline(null);
    run.mutate({ key: keyFor(ReviewAction.APPROVE), input: { action: ReviewAction.APPROVE }, inDialog: false });
  };

  const confirm = (action: DialogAction) => {
    setDialogFailure(null);
    const input: ReviewActionInput =
      action === ReviewAction.DISMISS ? { action, reason: reason.trim() } : { action };
    run.mutate({ key: keyFor(action), input, inDialog: true });
  };

  const requestClose = () => {
    if (run.isPending) return;
    attempt.current = null;
    closeDialog();
  };

  if (detail.actions.length === 0 && !inline) return null;

  const code = detail.order?.code ?? null;
  const amount = detail.transaction.receivedAmount;
  const refundOnly = REFUND_ONLY_REVIEW_ITEM_TYPES.includes(detail.type);
  const keepFocusOnLeave = (event: Event) => {
    if (leaving.current || focusRefund.current) event.preventDefault();
  };
  const reasonError = dismissReasonError(reason);

  const refundDescription = [
    amount === null ? 'Bạn đã hoàn tiền cho khách ngoài Tickee.' : `Bạn đã chuyển trả ${formatVnd(amount)} cho khách ngoài Tickee.`,
    refundOnly
      ? code
        ? `Mục rời hàng Cần xử lý; Đơn ${code}, Vé và doanh thu giữ nguyên.`
        : 'Mục rời hàng Cần xử lý.'
      : `Đơn ${code ?? ''} chuyển "Đã hoàn tay", mục rời hàng Cần xử lý.`,
    'Không hoàn tác được.',
  ].join(' ');

  return (
    <section aria-label="Thao tác" data-slot="review-actions" className="flex flex-col gap-stack border-t border-border pt-4">
      {inline ? (
        <div data-slot="review-action-error">
          <StatusBanner tone="danger" title={inline.title} description={inline.description} />
        </div>
      ) : null}
      {detail.actions.length > 0 ? (
        <div className="flex flex-col gap-2">
          {detail.actions.map((action) => {
            const busy = pendingAction === action;
            const othersBusy = pendingAction !== null && !busy;
            if (action === ReviewAction.APPROVE) {
              const blocked = detail.approveBlockedReason;
              return (
                <div key={action} className="flex flex-col gap-1">
                  <Button
                    type="button"
                    className="w-full"
                    data-slot="review-action-approve"
                    loading={busy}
                    disabled={blocked !== null || othersBusy}
                    aria-describedby={blocked ? blockedId : undefined}
                    onClick={approve}
                  >
                    {REVIEW_ACTION_LABEL[action]}
                  </Button>
                  {blocked ? (
                    <p id={blockedId} data-slot="review-approve-blocked" className="text-meta text-muted-foreground">
                      {APPROVE_BLOCKED_LABEL[blocked]}
                    </p>
                  ) : null}
                </div>
              );
            }
            // "Đã hoàn tay" là nút chính khi không có "Duyệt tay" (mục chỉ hoàn, hay Đơn đã từ chối).
            const primary = action === ReviewAction.REFUND && !detail.actions.includes(ReviewAction.APPROVE);
            return (
              <Button
                key={action}
                ref={action === ReviewAction.REFUND ? refundButton : undefined}
                type="button"
                variant={primary ? 'primary-on-light' : 'secondary'}
                className="w-full"
                data-slot={`review-action-${action}`}
                loading={busy}
                disabled={othersBusy}
                onClick={() => openDialog(action)}
              >
                {REVIEW_ACTION_LABEL[action]}
              </Button>
            );
          })}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog === ReviewAction.REJECT}
        onOpenChange={(open) => !open && requestClose()}
        title="Từ chối khoản tiền này?"
        descriptionClassName="wrap-break-word"
        description={`Đơn ${code ?? ''} sẽ bị hủy. Người mua nhận email báo BTC đã hủy Đơn và liên hệ BTC để được hoàn tiền. Mục ở lại hàng Cần xử lý tới khi bạn bấm "Đã hoàn tay".`}
        confirmLabel={REVIEW_ACTION_LABEL[ReviewAction.REJECT]}
        onConfirm={() => confirm(ReviewAction.REJECT)}
        pending={pendingAction === ReviewAction.REJECT}
        failureTitle="Chưa từ chối được"
        failure={dialog === ReviewAction.REJECT && dialogFailure}
        onCloseAutoFocus={keepFocusOnLeave}
      />
      <ConfirmDialog
        open={dialog === ReviewAction.REFUND}
        onOpenChange={(open) => !open && requestClose()}
        title="Ghi nhận đã hoàn tay?"
        descriptionClassName="wrap-break-word"
        description={refundDescription}
        confirmLabel={REVIEW_ACTION_LABEL[ReviewAction.REFUND]}
        onConfirm={() => confirm(ReviewAction.REFUND)}
        pending={pendingAction === ReviewAction.REFUND}
        failureTitle="Chưa ghi nhận được"
        failure={dialog === ReviewAction.REFUND && dialogFailure}
        onCloseAutoFocus={keepFocusOnLeave}
      />
      <ConfirmDialog
        open={dialog === ReviewAction.DISMISS}
        onOpenChange={(open) => !open && requestClose()}
        title="Bỏ qua mục này?"
        descriptionClassName="wrap-break-word"
        description="Mục rời hàng Cần xử lý mà không ghi nhận hoàn tiền. Lý do được lưu vào nhật ký. Không hoàn tác được."
        asForm
        confirmLabel={REVIEW_ACTION_LABEL[ReviewAction.DISMISS]}
        confirmDisabled={reasonError !== null}
        onConfirm={() => confirm(ReviewAction.DISMISS)}
        pending={pendingAction === ReviewAction.DISMISS}
        failureTitle="Chưa bỏ qua được"
        failure={dialog === ReviewAction.DISMISS && dialogFailure}
        onCloseAutoFocus={keepFocusOnLeave}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={reasonInputId}>Lý do</Label>
          <Textarea
            id={reasonInputId}
            name="reason"
            data-slot="review-dismiss-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonTouched(true);
            }}
            onBlur={() => setReasonTouched(true)}
            aria-invalid={reasonTouched && reasonError !== null ? true : undefined}
            aria-describedby={`${reasonHintId} ${reasonErrorId}`}
          />
          <p id={reasonHintId} className="text-meta text-muted-foreground tabular-nums">
            Bắt buộc, tối đa {DISMISS_REASON_MAX} ký tự · {reason.trim().length}/{DISMISS_REASON_MAX}
          </p>
          <FieldError id={reasonErrorId} message={reasonTouched ? reasonError : null} />
        </div>
      </ConfirmDialog>
    </section>
  );
}
