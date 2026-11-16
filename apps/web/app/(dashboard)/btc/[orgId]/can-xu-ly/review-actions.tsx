'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DISMISS_REASON_MAX,
  ErrorCode,
  formatVnd,
  OrderStatus,
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
  dismissReasonError,
  isPrimaryReviewAction,
  leftQueue,
  REVIEW_ACTION_FAILURE_TITLE,
  REVIEW_ACTION_LABEL,
  REVIEW_ACTION_RACE_TOAST,
  reviewActionSettledFailure,
  reviewActionToast,
  type ReviewActionFailure,
} from '@/lib/reporting/review-queue';

import { MatchDialog } from './match-dialog';

/** Thao tác đi qua `Dialog` ("Duyệt tay phát Vé" gọi thẳng). */
type DialogAction =
  | typeof ReviewAction.REJECT
  | typeof ReviewAction.REFUND
  | typeof ReviewAction.DISMISS
  | typeof ReviewAction.MATCH;

/** Một lần gửi: khóa chống trùng của lần mở thao tác, thân, và thao tác có đi qua `Dialog` không. */
type Attempt = { key: string; input: ReviewActionInput; inDialog: boolean };

/**
 * Footer thao tác của `Sheet` chi tiết (Story 4.4-a, 4.4-b): nút theo `detail.actions` (máy chủ tính, web chỉ hiển thị),
 * theo thứ tự máy chủ trả; nút đầu là nút chính. "Duyệt tay phát Vé" gọi thẳng; tắt kèm lý do cạnh nút khi
 * `approveBlockedReason` có. "Ghép với Đơn" (mục chưa khớp) mở `MatchDialog` chọn Đơn. "Từ chối", "Đã hoàn tay" và "Bỏ
 * qua" (lý do bắt buộc) đi qua `Dialog` nêu hậu quả; bấm Hủy không gọi API. Mỗi lần mở một thao tác (với "Ghép": mỗi Đơn
 * được chọn) sinh một `Idempotency-Key`, giữ nguyên khi thử lại sau lỗi. Nút đang gọi mạng quay spinner, các nút khác
 * tắt tới khi xong.
 *
 * Kết quả: toast nêu kết quả, làm mới hàng/badge/chi tiết; mục rời hàng (`resolved`) → `onLeft` (nơi gọi đóng `Sheet`,
 * chuyển focus). "Từ chối" giữ mục `open`: `Sheet` ở lại, chi tiết tải lại chỉ còn "Đã hoàn tay". Thua cuộc đua (`409
 * REVIEW_ACTION_NOT_ALLOWED`) → toast info và tải lại. Lỗi dứt khoát (`reviewActionSettledFailure`: hết chỗ, Sự kiện
 * không còn cho phát Vé, Đơn vừa đổi trạng thái) → báo tại chỗ (footer, hoặc trong `Dialog` "Ghép" để chọn Đơn khác),
 * bỏ khóa và tải lại chi tiết cùng ứng viên (nhật ký có dòng "… không thành · Hết chỗ").
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
  const [dialogFailure, setDialogFailure] = useState<ReviewActionFailure | null>(null);
  const [inline, setInline] = useState<ReviewActionFailure | null>(null);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  /**
   * Khóa của lần mở thao tác đang dở (giữ khi thử lại); `null` sau khi có kết quả dứt khoát. "Ghép" gắn thêm Đơn được
   * chọn: chọn Đơn khác là một lần gửi mới.
   */
  const attempt = useRef<{ action: ReviewAction; key: string; orderCode?: string } | null>(null);
  /** Mục vừa rời hàng: `Sheet` đóng và tự chuyển focus, `Dialog` không trả focus về nút của `Sheet`. */
  const leaving = useRef(false);
  /**
   * Vừa "Từ chối" xong: nút "Từ chối" sẽ mất khi chi tiết tải lại (chỉ còn "Đã hoàn tay"), nên `Dialog` không trả focus
   * về đó; focus chuyển sang "Đã hoàn tay" khi nút này hiện.
   */
  const focusRefund = useRef(false);
  const refundButton = useRef<HTMLButtonElement>(null);
  /** Nút "Ghép với Đơn": `Dialog` chọn Đơn đóng (Hủy, Esc, lỗi) thì focus về đây, kể cả khi bấm mở bằng chạm. */
  const matchButton = useRef<HTMLButtonElement>(null);
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
    onError: (error, { input, inDialog }) => {
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
      const show = (failure: ReviewActionFailure) => (inDialog ? setDialogFailure(failure) : setInline(failure));
      const settled =
        error instanceof ApiError
          ? reviewActionSettledFailure(
              { action: input.action, orderCode: input.action === ReviewAction.MATCH ? input.orderCode : undefined },
              error.code,
            )
          : null;
      if (settled) {
        // Kết quả dứt khoát (hết chỗ, Sự kiện không còn cho phát Vé, Đơn vừa đổi trạng thái): lần bấm sau là lần gửi
        // mới; chi tiết (nhật ký, lý do tắt) và ứng viên tải lại.
        attempt.current = null;
        show(settled);
        refresh();
        return;
      }
      // Lỗi khác (mạng, máy chủ, dữ liệu sai): giữ khóa để "thử lại" là cùng một lần gửi.
      show({ title: REVIEW_ACTION_FAILURE_TITLE[input.action], description: messageOf(error) });
    },
  });

  const pendingAction = run.isPending ? run.variables.input.action : null;

  /**
   * Khóa cho lần gửi `action` (kèm Đơn được chọn với "Ghép"): dùng lại khóa của lần mở đang dở cùng thao tác (cùng Đơn),
   * không có thì sinh mới.
   */
  const keyFor = (action: ReviewAction, orderCode?: string): string => {
    if (attempt.current?.action !== action || attempt.current.orderCode !== orderCode) {
      attempt.current = { action, key: newFunnelId(), orderCode };
    }
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

  const confirm = (action: Exclude<DialogAction, typeof ReviewAction.MATCH>) => {
    setDialogFailure(null);
    const input: ReviewActionInput =
      action === ReviewAction.DISMISS ? { action, reason: reason.trim() } : { action };
    run.mutate({ key: keyFor(action), input, inDialog: true });
  };

  const confirmMatch = (orderCode: string) => {
    setDialogFailure(null);
    run.mutate({
      key: keyFor(ReviewAction.MATCH, orderCode),
      input: { action: ReviewAction.MATCH, orderCode },
      inDialog: true,
    });
  };

  const requestClose = () => {
    if (run.isPending) return;
    attempt.current = null;
    closeDialog();
  };

  if (detail.actions.length === 0 && !inline) return null;

  const code = detail.order?.code ?? null;
  const amount = detail.transaction.receivedAmount;
  // "Đã hoàn tay" chuyển Đơn sang `refunded` chỉ khi Đơn đã bị từ chối; mục chỉ hoàn, hoặc mục lệch tiền/mồ côi của Đơn
  // đã thanh toán nhờ ghép giao dịch khác (Story 4.4-b), chỉ đóng mục.
  const refundsOrder =
    !REFUND_ONLY_REVIEW_ITEM_TYPES.includes(detail.type) && detail.order?.status === OrderStatus.CANCELLED;
  const keepFocusOnLeave = (event: Event) => {
    if (leaving.current || focusRefund.current) event.preventDefault();
  };
  const returnFocusToMatch = (event: Event) => {
    event.preventDefault();
    if (!leaving.current) matchButton.current?.focus();
  };
  const reasonError = dismissReasonError(reason);

  const refundDescription = [
    amount === null ? 'Bạn đã hoàn tiền cho khách ngoài Tickee.' : `Bạn đã chuyển trả ${formatVnd(amount)} cho khách ngoài Tickee.`,
    refundsOrder
      ? `Đơn ${code ?? ''} chuyển "Đã hoàn tay", mục rời hàng Cần xử lý.`
      : code
        ? `Mục rời hàng Cần xử lý; Đơn ${code}, Vé và doanh thu giữ nguyên.`
        : 'Mục rời hàng Cần xử lý.',
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
            // Nút đầu (máy chủ xếp: Duyệt tay, Ghép với Đơn, hoặc Đã hoàn tay khi không có hai nút đó) là nút chính.
            const variant = isPrimaryReviewAction(detail.actions, action) ? 'primary-on-light' : 'secondary';
            if (action === ReviewAction.APPROVE) {
              const blocked = detail.approveBlockedReason;
              return (
                <div key={action} className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant={variant}
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
            return (
              <Button
                key={action}
                ref={action === ReviewAction.REFUND ? refundButton : action === ReviewAction.MATCH ? matchButton : undefined}
                type="button"
                variant={variant}
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
        failureTitle={dialogFailure?.title ?? REVIEW_ACTION_FAILURE_TITLE[ReviewAction.REJECT]}
        failure={dialog === ReviewAction.REJECT && dialogFailure?.description}
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
        failureTitle={dialogFailure?.title ?? REVIEW_ACTION_FAILURE_TITLE[ReviewAction.REFUND]}
        failure={dialog === ReviewAction.REFUND && dialogFailure?.description}
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
        failureTitle={dialogFailure?.title ?? REVIEW_ACTION_FAILURE_TITLE[ReviewAction.DISMISS]}
        failure={dialog === ReviewAction.DISMISS && dialogFailure?.description}
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
      {detail.actions.includes(ReviewAction.MATCH) || dialog === ReviewAction.MATCH ? (
        <MatchDialog
          orgId={orgId}
          detail={detail}
          open={dialog === ReviewAction.MATCH}
          onClose={requestClose}
          onConfirm={confirmMatch}
          pending={pendingAction === ReviewAction.MATCH}
          failure={dialog === ReviewAction.MATCH ? dialogFailure : null}
          onCloseAutoFocus={returnFocusToMatch}
        />
      ) : null}
    </section>
  );
}
