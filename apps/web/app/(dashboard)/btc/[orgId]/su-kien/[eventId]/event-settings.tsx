'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EventDraftInput, ErrorCode, eventPath, formatEventDateTime, type EventDetail } from '@tickee/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { endEvent, eventQueryKey, eventsQueryKey, hideEvent, unhideEvent, updateEvent } from '@/lib/event/api';

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
import { handledElsewhere } from '../handled-elsewhere';

/*
 * Tab "Cài đặt" của Sự kiện (Story 2.12): form thông tin (dùng chung với wizard bước 1) và hai hành động trạng thái:
 * Ẩn / Hiện lại (không hỏi xác nhận) và "Kết thúc" (qua `Dialog` nêu hậu quả, không hoàn tác). Sự kiện đã hủy: form chỉ
 * đọc kèm lý do. Đã kết thúc: không còn nút nào (Ẩn, Hiện lại, Kết thúc — "Đã kết thúc" thắng "Ẩn" ở `sellability`),
 * hiện "Đã kết thúc lúc …". Chưa bắt đầu: nút "Kết thúc" tắt kèm lý do. Trạng thái đổi giữa chừng (người khác vừa bấm)
 * → toast và tải lại Sự kiện.
 */

const NOT_STARTED_REASON = 'Sự kiện chưa bắt đầu — dùng Ẩn để dừng nhận Đơn.';

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.');

function useGoToLogin() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.replace(withReturnTo(LOGIN_PATH, pathname));
}

/** Cập nhật cache sau khi Sự kiện đổi (chi tiết + danh sách). */
function useEventSaved(orgId: string) {
  const queryClient = useQueryClient();
  return {
    saved: (event: EventDetail) => {
      queryClient.setQueryData(eventQueryKey(orgId, event.id), event);
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
    },
    reload: (eventId: string) => {
      void queryClient.invalidateQueries({ queryKey: eventQueryKey(orgId, eventId) });
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Thông tin Sự kiện
// ---------------------------------------------------------------------------------------------------------------

function InfoForm({ orgId, event }: { orgId: string; event: EventDetail }) {
  const goToLogin = useGoToLogin();
  const cache = useEventSaved(orgId);
  const [values, setValues] = useState<EventInfoValues>(() => valuesOf(event));
  const [errors, setErrors] = useState<EventInfoErrors>({});
  const cancelled = event.status === 'cancelled';

  const save = useMutation({
    mutationFn: (body: EventDraftInput) => updateEvent(orgId, event.id, body),
    onSuccess: (saved) => {
      cache.saved(saved);
      toast.success('Đã lưu thông tin Sự kiện.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) setErrors(serverFieldErrors(error, values));
      else if (hasErrorCode(error, ErrorCode.EVENT_CANCELLED)) {
        toast.info('Sự kiện đã hủy, không sửa được. Đã tải lại Sự kiện.');
        cache.reload(event.id);
      }
    },
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (save.isPending || cancelled) return;
    const parsed = EventDraftInput.safeParse(inputOf(values));
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error.issues.map((i) => i.path[0]), values));
      save.reset();
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const update = (field: EventInfoField, next: string) => {
    setValues((v) => ({ ...v, [field]: next }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const failure =
    save.error &&
    !hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED) &&
    !hasErrorCode(save.error, ErrorCode.EVENT_CANCELLED) &&
    !handledElsewhere(save.error)
      ? save.error
      : null;

  return (
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
                <Button type="submit" loading={save.isPending}>
                  Lưu thay đổi
                </Button>
              </div>
            </div>
          )
        }
      />
    </form>
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

function StatusActions({ orgId, event }: { orgId: string; event: EventDetail }) {
  const goToLogin = useGoToLogin();
  const cache = useEventSaved(orgId);
  const titleId = useId();
  const reasonId = useId();
  const [confirmEnd, setConfirmEnd] = useState(false);

  const change = useMutation({
    mutationFn: (action: StatusAction) => ACTIONS[action].call(orgId, event.id),
    onSuccess: (saved, action) => {
      cache.saved(saved);
      setConfirmEnd(false);
      toast.success(ACTIONS[action].done);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (isStale(error)) {
        setConfirmEnd(false);
        toast.info(STALE_MESSAGE);
        cache.reload(event.id);
      }
    },
  });

  const failure = change.error && !isStale(change.error) && !handledElsewhere(change.error) ? change.error : null;
  const pending = change.isPending ? change.variables : null;

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
                onClick={() => !change.isPending && change.mutate('unhide')}
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
                onClick={() => !change.isPending && change.mutate('hide')}
              >
                Ẩn Sự kiện
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-stack">
          <p className="text-body">Kết thúc sớm: ngừng nhận Đơn ngay, không mở lại được.</p>
          {!started ? (
            <p id={reasonId} className="text-meta text-muted-foreground">
              {NOT_STARTED_REASON}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={!started}
              aria-describedby={!started ? reasonId : undefined}
              onClick={() => {
                if (change.isPending) return;
                // Lỗi của Ẩn/Hiện lại trước đó không hiện trong Dialog.
                change.reset();
                setConfirmEnd(true);
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

      <Dialog
        open={confirmEnd}
        onOpenChange={(open) => {
          if (open || change.isPending) return;
          change.reset();
          setConfirmEnd(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kết thúc Sự kiện?</DialogTitle>
            <DialogDescription>Ngừng nhận Đơn ngay, không mở lại được.</DialogDescription>
          </DialogHeader>
          {failure ? (
            <StatusBanner tone="danger" title="Chưa kết thúc được" description={messageOf(failure)} />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              loading={pending === 'end'}
              onClick={() => change.mutate('end')}
            >
              Kết thúc
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                if (change.isPending) return;
                change.reset();
                setConfirmEnd(false);
              }}
            >
              Hủy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
