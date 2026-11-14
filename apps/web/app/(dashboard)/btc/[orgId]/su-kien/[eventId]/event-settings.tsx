'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EventDraftInput,
  ErrorCode,
  eventPath,
  formatEventDateTime,
  notifiesBuyers,
  PAYMENT_LINK_MINUTES,
  type EventDetail,
} from '@tickee/contracts';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  endEvent,
  eventQueryKey,
  eventsQueryKey,
  fetchEventBuyerCount,
  fetchEventPendingPaymentCount,
  hideEvent,
  unhideEvent,
  updateEvent,
} from '@/lib/event/api';
import { refreshEventSaleStatus } from '@/lib/event/sale-status';

import {
  EventInfoFields,
  fieldErrorsOf,
  inputOf,
  serverFieldErrors,
  valuesOf,
  type EventInfoErrors,
  type EventInfoField,
  type EventInfoValues,
} from '../event-info-form';
import { isEventEnded } from '../event-status';

/*
 * Tab "Cài đặt" của Sự kiện (Story 2.12): form thông tin (dùng chung với wizard bước 1) và hai hành động trạng thái:
 * Ẩn / Hiện lại (không hỏi xác nhận) và "Kết thúc" (qua `Dialog` nêu hậu quả, không hoàn tác). Sự kiện đã hủy: form chỉ
 * đọc kèm lý do. Đã kết thúc: không còn nút nào (Ẩn, Hiện lại, Kết thúc — "Đã kết thúc" thắng "Ẩn" ở `sellability`),
 * hiện "Đã kết thúc lúc …". Chưa bắt đầu: nút "Kết thúc" tắt kèm lý do. Trạng thái đổi giữa chừng (người khác vừa bấm)
 * → toast và tải lại Sự kiện.
 *
 * Story 3.10: lưu lệnh đổi giờ hoặc địa điểm của Sự kiện đã mở bán, theo đồng hồ máy chưa kết thúc sau khi sửa
 * (`notifiesBuyers`), thì đếm Người mua trước; có người → `Dialog` "Email sẽ được gửi tới {n} Người mua." rồi mới lưu,
 * không có ai → lưu luôn. Đếm lỗi → banner "Chưa lưu được thông tin", không lưu.
 *
 * E3-2: bấm "Kết thúc" thì đếm Đơn đang chờ thanh toán trước (nút có spinner, chặn bấm lặp) rồi mới mở `Dialog`; `Dialog`
 * nêu đủ hậu quả (Vé hết hiệu lực) và, khi còn Đơn đang chờ thanh toán, số Đơn đó cùng việc BTC phải hoàn tay khoản
 * chuyển muộn. Đếm lỗi → banner "Chưa kết thúc được", không mở `Dialog`.
 */

const NOT_STARTED_REASON = 'Sự kiện chưa bắt đầu — dùng Ẩn để dừng nhận Đơn.';
/** Sự kiện đang ẩn đã dừng nhận Đơn: không gợi ý "dùng Ẩn". */
const NOT_STARTED_REASON_HIDDEN = 'Sự kiện chưa bắt đầu.';

/** Trạng thái hoặc mốc kết thúc của Sự kiện đổi: nhãn dự phòng theo Sự kiện mới đúng hơn dòng trạng thái bán cũ. */
const saleFieldsChanged = (before: EventDetail | undefined, after: EventDetail) =>
  !before ||
  before.status !== after.status ||
  before.endedManuallyAt !== after.endedManuallyAt ||
  before.effectiveEndAt !== after.effectiveEndAt;

/**
 * Cập nhật cache sau khi Sự kiện đổi (chi tiết + danh sách + trạng thái bán của badge dashboard, Story 4.2-c). Chỉ bỏ dòng
 * trạng thái bán cũ của Sự kiện khi trạng thái hoặc mốc kết thúc đổi (sửa tên, địa điểm của Sự kiện đang "Tạm ngừng bán"
 * không làm badge nháy "Đang mở bán").
 */
function useEventSaved(orgId: string) {
  const queryClient = useQueryClient();
  return {
    saved: (event: EventDetail) => {
      const before = queryClient.getQueryData<EventDetail>(eventQueryKey(orgId, event.id));
      queryClient.setQueryData(eventQueryKey(orgId, event.id), event);
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      void refreshEventSaleStatus(queryClient, orgId, saleFieldsChanged(before, event) ? event.id : undefined);
    },
    reload: (eventId: string) => {
      void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, eventId) });
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      void refreshEventSaleStatus(queryClient, orgId);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Thông tin Sự kiện
// ---------------------------------------------------------------------------------------------------------------

/** Lỗi lưu có chỗ báo riêng: lỗi tại từng ô (`VALIDATION_FAILED`), toast + tải lại (`EVENT_CANCELLED`), nơi khác. */
const saveErrorShownElsewhere = (error: unknown) =>
  hasErrorCode(error, ErrorCode.VALIDATION_FAILED) ||
  hasErrorCode(error, ErrorCode.EVENT_CANCELLED) ||
  handledElsewhere(error);

/** Câu báo trong `Dialog` khi server từ chối dữ liệu: lỗi tại ô nằm sau `Dialog`. */
const INVALID_IN_DIALOG = 'Thông tin chưa hợp lệ. Bấm "Hủy" để sửa các ô được đánh dấu.';

/** Lệnh sửa chờ xác nhận gửi email: body sẽ lưu và số Người mua sẽ nhận email. */
type PendingNotice = { input: EventDraftInput; buyers: number };

function InfoForm({ orgId, event }: { orgId: string; event: EventDetail }) {
  const goToLogin = useGoToLogin();
  const cache = useEventSaved(orgId);
  const [values, setValues] = useState<EventInfoValues>(() => valuesOf(event));
  const [errors, setErrors] = useState<EventInfoErrors>({});
  const [notice, setNotice] = useState<PendingNotice | null>(null);
  const cancelled = event.status === 'cancelled';

  const save = useMutation({
    mutationFn: (body: EventDraftInput) => updateEvent(orgId, event.id, body),
    onSuccess: (saved) => {
      cache.saved(saved);
      setNotice(null);
      toast.success('Đã lưu thông tin Sự kiện.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) setErrors(serverFieldErrors(error, values));
      else if (hasErrorCode(error, ErrorCode.EVENT_CANCELLED)) {
        setNotice(null);
        toast.info('Sự kiện đã hủy, không sửa được. Đã tải lại Sự kiện.');
        cache.reload(event.id);
      }
    },
  });

  // Đếm Người mua trước khi lưu lệnh đổi giờ/địa điểm (Story 3.10); biến của mutation là body sẽ lưu.
  const count = useMutation({
    mutationFn: (_body: EventDraftInput) => fetchEventBuyerCount(orgId, event.id),
    onSuccess: ({ buyers }, body) => {
      if (buyers > 0) setNotice({ input: body, buyers });
      else save.mutate(body);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
    },
  });
  const busy = save.isPending || count.isPending;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || cancelled) return;
    const parsed = EventDraftInput.safeParse(inputOf(values));
    save.reset();
    count.reset();
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error.issues.map((i) => i.path[0]), values));
      return;
    }
    setErrors({});
    if (notifiesBuyers(event, parsed.data, Date.now())) count.mutate(parsed.data);
    else save.mutate(parsed.data);
  };

  const update = (field: EventInfoField, next: string) => {
    setValues((v) => ({ ...v, [field]: next }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const saveFailure = save.error && !saveErrorShownElsewhere(save.error) ? save.error : null;
  const countFailure = count.error && !handledElsewhere(count.error) ? count.error : null;
  // Lỗi của lần lưu từ `Dialog` hiện trong `Dialog`; đóng `Dialog` thì xóa lỗi đó.
  const failure = notice ? null : (saveFailure ?? countFailure);
  const dialogFailure =
    notice && save.error && !hasErrorCode(save.error, ErrorCode.EVENT_CANCELLED) && !handledElsewhere(save.error)
      ? hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED)
        ? INVALID_IN_DIALOG
        : messageOf(save.error)
      : null;

  return (
    <>
      <form noValidate onSubmit={onSubmit} data-slot="event-settings-info">
        <EventInfoFields
          values={values}
          errors={errors}
          onChange={update}
          readOnly={cancelled}
          draft={event.status === 'draft'}
          notice={
            cancelled ? (
              <StatusBanner
                tone="neutral"
                title="Sự kiện đã hủy"
                description="Thông tin chỉ để xem, không sửa được nữa."
              />
            ) : null
          }
          footer={
            cancelled ? null : (
              <div className="flex flex-col gap-stack">
                {failure ? (
                  <StatusBanner
                    tone="danger"
                    title="Chưa lưu được thông tin"
                    description={messageOf(failure)}
                    action={
                      <Button type="submit" variant="link" size="sm">
                        Thử lại
                      </Button>
                    }
                  />
                ) : null}
                <div className="flex justify-end">
                  <Button type="submit" loading={busy}>
                    Lưu thay đổi
                  </Button>
                </div>
              </div>
            )
          }
        />
      </form>

      <ConfirmDialog
        open={notice !== null}
        onOpenChange={(open) => {
          if (open) return;
          save.reset();
          setNotice(null);
        }}
        title="Lưu thay đổi?"
        description={`Email sẽ được gửi tới ${(notice?.buyers ?? 0).toLocaleString('vi-VN')} Người mua.`}
        confirmLabel="Lưu và gửi email"
        confirmVariant="primary-on-light"
        onConfirm={() => {
          if (notice) save.mutate(notice.input);
        }}
        pending={save.isPending}
        failureTitle="Chưa lưu được thông tin"
        failure={dialogFailure}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Ẩn / Hiện lại / Kết thúc
// ---------------------------------------------------------------------------------------------------------------

type StatusAction = 'hide' | 'unhide' | 'end';

const ACTIONS: Record<StatusAction, { call: typeof hideEvent; done: string }> = {
  hide: { call: hideEvent, done: 'Đã ẩn Sự kiện. Link vẫn mở được nhưng không nhận Đơn mới.' },
  unhide: { call: unhideEvent, done: 'Đã hiện lại Sự kiện.' },
  end: { call: endEvent, done: 'Đã kết thúc Sự kiện.' },
};

/**
 * Trạng thái đã đổi ở server (người khác vừa bấm, đã tự kết thúc…): không báo lỗi tại chỗ, tải lại Sự kiện.
 * `EVENT_NOT_STARTED` không thuộc nhóm này (tải lại không đổi gì, vd. đồng hồ máy khách lệch): báo lỗi tại chỗ.
 */
const STALE_CODES = [ErrorCode.EVENT_STATUS_CONFLICT, ErrorCode.EVENT_ALREADY_ENDED];
const STALE_MESSAGE = 'Trạng thái Sự kiện vừa đổi. Đã tải lại.';
const isStale = (error: unknown) => STALE_CODES.some((code) => hasErrorCode(error, code));

/** Hậu quả của "Kết thúc" (E3-2, C2): cạnh nút và trong `Dialog`. */
const END_HINT = 'Kết thúc sớm: ngừng nhận Đơn và Vé hết hiệu lực ngay, không mở lại được.';
const END_CONSEQUENCES =
  'Ngừng nhận Đơn ngay, không mở lại được. Từ lúc này Vé hết hiệu lực: không check-in được, CTV hết quyền, Vé rời “Vé của tôi” và link chia sẻ Vé ngừng hoạt động.';
/** Còn Đơn có link thanh toán chưa hết hạn: Người mua vẫn chuyển được tiền, khoản đó không thành Vé. */
const pendingPaymentsNotice = (orders: number) =>
  `Còn ${orders.toLocaleString('vi-VN')} Đơn đang chờ thanh toán. Người mua đang ở trang thanh toán vẫn có thể chuyển tiền trong tối đa ${PAYMENT_LINK_MINUTES} phút; khoản đó không thành Vé và bạn sẽ phải hoàn tay.`;

function StatusActions({ orgId, event }: { orgId: string; event: EventDetail }) {
  const goToLogin = useGoToLogin();
  const cache = useEventSaved(orgId);
  const titleId = useId();
  const reasonId = useId();
  /** `Dialog` "Kết thúc" đang mở, kèm số Đơn đang chờ thanh toán đếm ngay trước khi mở. */
  const [confirmEnd, setConfirmEnd] = useState<{ pendingOrders: number } | null>(null);

  const change = useMutation({
    mutationFn: (action: StatusAction) => ACTIONS[action].call(orgId, event.id),
    onSuccess: (saved, action) => {
      cache.saved(saved);
      setConfirmEnd(null);
      toast.success(ACTIONS[action].done);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (isStale(error)) {
        setConfirmEnd(null);
        toast.info(STALE_MESSAGE);
        cache.reload(event.id);
      }
    },
  });

  // Đếm Đơn đang chờ thanh toán trước khi mở `Dialog` "Kết thúc" (E3-2).
  const count = useMutation({
    mutationFn: () => fetchEventPendingPaymentCount(orgId, event.id),
    onSuccess: ({ orders }) => setConfirmEnd({ pendingOrders: orders }),
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
    },
  });
  const busy = change.isPending || count.isPending;

  const failure = change.error && !isStale(change.error) && !handledElsewhere(change.error) ? change.error : null;
  const countFailure = count.error && !handledElsewhere(count.error) ? count.error : null;
  const pending = change.isPending ? change.variables : null;
  /** Ẩn / Hiện lại: lỗi đếm của lần bấm "Kết thúc" trước đó không còn đúng chỗ. */
  const changeStatus = (action: 'hide' | 'unhide') => {
    if (busy) return;
    count.reset();
    change.mutate(action);
  };

  const now = Date.now();
  const ended = isEventEnded(event, now);
  const started = new Date(event.startsAt).getTime() <= now;
  const onSale = event.status === 'published' || event.status === 'hidden';

  let body;
  if (event.status === 'draft') {
    body = (
      <p className="text-body text-muted-foreground">
        Sự kiện chưa mở bán.{' '}
        <Link href={eventPath(orgId, event.id, 'thiet-lap')} className="text-brand-text underline-offset-4 hover:underline">
          Tiếp tục thiết lập
        </Link>{' '}
        để mở bán; sau đó mới Ẩn hoặc Kết thúc được.
      </p>
    );
  } else if (event.status === 'cancelled') {
    body = <p className="text-body text-muted-foreground">Sự kiện đã hủy, không đổi trạng thái được nữa.</p>;
  } else if (onSale && ended) {
    body = (
      <p className="text-body tabular-nums" data-slot="event-ended-at">
        Đã kết thúc lúc {formatEventDateTime(event.effectiveEndAt)}. Không nhận Đơn mới.
      </p>
    );
  } else if (onSale) {
    body = (
      <div className="flex flex-col gap-section">
        {event.status === 'hidden' ? (
          <div className="flex flex-col gap-stack">
            <p className="text-body">
              Sự kiện đang ẩn: link vẫn mở được, trang hiện “Sự kiện tạm dừng nhận Đơn”.
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                loading={pending === 'unhide'}
                onClick={() => changeStatus('unhide')}
              >
                Hiện lại
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-stack">
            <p className="text-body">Ẩn để tạm dừng nhận Đơn mới. Link vẫn mở được; hiện lại lúc nào cũng được.</p>
            <div>
              <Button
                type="button"
                variant="secondary"
                loading={pending === 'hide'}
                onClick={() => changeStatus('hide')}
              >
                Ẩn Sự kiện
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-stack">
          <p className="text-body">{END_HINT}</p>
          {!started ? (
            <p id={reasonId} className="text-meta text-muted-foreground">
              {event.status === 'hidden' ? NOT_STARTED_REASON_HIDDEN : NOT_STARTED_REASON}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={!started}
              aria-describedby={!started ? reasonId : undefined}
              loading={count.isPending}
              onClick={() => {
                if (busy) return;
                // Lỗi của Ẩn/Hiện lại trước đó không hiện trong Dialog.
                change.reset();
                count.mutate();
              }}
            >
              Kết thúc
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="event-status-actions"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        Trạng thái bán
      </h2>
      {body}
      {failure && !confirmEnd ? (
        <StatusBanner tone="danger" title="Chưa đổi được trạng thái" description={messageOf(failure)} />
      ) : null}
      {countFailure && !confirmEnd ? (
        <StatusBanner tone="danger" title="Chưa kết thúc được" description={messageOf(countFailure)} />
      ) : null}

      <ConfirmDialog
        open={confirmEnd !== null}
        onOpenChange={(open) => {
          if (open) return;
          change.reset();
          setConfirmEnd(null);
        }}
        title="Kết thúc Sự kiện?"
        descriptionAsChild
        description={
          <div className="flex flex-col gap-2 wrap-break-word" data-slot="end-event-consequences">
            <p>{END_CONSEQUENCES}</p>
            {confirmEnd && confirmEnd.pendingOrders > 0 ? (
              <p data-slot="end-event-pending-payments">{pendingPaymentsNotice(confirmEnd.pendingOrders)}</p>
            ) : null}
          </div>
        }
        confirmLabel="Kết thúc"
        onConfirm={() => change.mutate('end')}
        // Dialog che các nút khác, nên đang chạy chỉ có thể là "Kết thúc".
        pending={change.isPending}
        failureTitle="Chưa kết thúc được"
        failure={failure && messageOf(failure)}
      />
    </section>
  );
}

/** Tab "Cài đặt": thông tin Sự kiện và trạng thái bán. */
export function EventSettings({ orgId, event }: { orgId: string; event: EventDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-section" data-slot="event-settings">
      {/* `key` theo cờ đã hủy: Sự kiện thành đã hủy (tải lại sau 409) thì nạp lại giá trị server vào form chỉ đọc. */}
      <InfoForm key={event.status === 'cancelled' ? 'cancelled' : 'editable'} orgId={orgId} event={event} />
      <StatusActions orgId={orgId} event={event} />
    </div>
  );
}
