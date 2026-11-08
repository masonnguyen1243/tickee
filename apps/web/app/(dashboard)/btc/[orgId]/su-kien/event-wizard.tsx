'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EventDraftInput, ErrorCode, eventPath, type EventDetail } from '@tickee/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { StatusBanner } from '@/components/tickee/status-banner';
import { WizardStepper } from '@/components/tickee/wizard-stepper';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { createEvent, eventQueryKey, eventsQueryKey, updateEvent } from '@/lib/event/api';

import {
  EMPTY_EVENT_INFO,
  EventInfoFields,
  fieldErrorsOf,
  inputOf,
  serverFieldErrors,
  valuesOf,
  type EventInfoErrors,
  type EventInfoField,
  type EventInfoValues,
} from './event-info-form';
import { handledElsewhere } from './handled-elsewhere';
import { PublishPanel } from './publish-panel';
import { PurchaseFormEditor, PurchaseFormReview } from './purchase-form-editor';
import { TicketTypesEditor } from './ticket-types-editor';

/*
 * Wizard tạo/thiết lập Sự kiện (Story 2.7, UX-DR wizard): 4 bước Thông tin → Hạng vé → Form mua → Xem trước & mở bán.
 * Bước 1 là thông tin Sự kiện (`EventInfoFields`, dùng chung với tab "Cài đặt"); bước 2 là trình sửa Hạng vé (Story
 * 2.8, dùng chung với tab "Hạng vé"); bước 3 là trình sửa form mua (Story 2.9, dùng chung với tab "Form mua"); bước 4 hiện mục "Form mua" (cùng phần xem trước) và phần mở
 * bán (Story 2.10, `PublishPanel`: điều kiện còn thiếu kèm lối sửa nhanh về bước 1–2 hoặc trang khác, nút "Mở bán",
 * link công khai sau khi mở bán). "Lưu nháp" có ở mọi bước; "Tiếp" lưu rồi mới sang bước sau; "Quay lại" giữ nguyên dữ
 * liệu đã nhập. Lưu lần đầu (POST) xong thì URL chuyển sang `su-kien/{id}/thiet-lap`, nên mọi
 * lần lưu sau là PATCH, không tạo Sự kiện thứ hai. Giờ nhập luôn hiểu theo giờ Việt Nam (+07:00), không theo máy.
 */

export const WIZARD_STEPS = ['Thông tin', 'Hạng vé', 'Form mua', 'Xem trước & mở bán'] as const;
const LAST_STEP = WIZARD_STEPS.length - 1;

type SaveIntent = { next: number; kind: 'draft' | 'next' };

type EventWizardProps = {
  orgId: string;
  /** Sự kiện đã có (trang `thiet-lap`); không có = tạo mới. */
  event?: EventDetail;
  /** Bước mở đầu (0–3), vd. sau "Tiếp" ở bước 1 của Sự kiện mới. */
  initialStep?: number;
};

export function EventWizard({ orgId, event, initialStep = 0 }: EventWizardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(() => Math.min(Math.max(initialStep, 0), event ? LAST_STEP : 0));
  const [values, setValues] = useState<EventInfoValues>(() => (event ? valuesOf(event) : EMPTY_EVENT_INFO));
  const [errors, setErrors] = useState<EventInfoErrors>({});
  /** Đã tạo Sự kiện và đang chuyển sang `thiet-lap`: giữ spinner, chặn bấm lặp (không POST lần hai). */
  const [leaving, setLeaving] = useState(false);
  const eventId = event?.id;

  const save = useMutation({
    mutationFn: ({ body }: { body: EventDraftInput; intent: SaveIntent }) =>
      eventId ? updateEvent(orgId, eventId, body) : createEvent(orgId, body),
    onSuccess: (saved, { intent }) => {
      queryClient.setQueryData(eventQueryKey(orgId, saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: eventsQueryKey(orgId) });
      if (intent.kind === 'draft') toast.success('Đã lưu nháp.');
      if (!eventId) {
        // Sự kiện mới: từ đây là trang của Sự kiện đã có, nên lần lưu sau là PATCH.
        setLeaving(true);
        const query = intent.next > 0 ? `?buoc=${intent.next + 1}` : '';
        router.replace(`${eventPath(orgId, saved.id, 'thiet-lap')}${query}`);
        return;
      }
      setStep(intent.next);
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) router.replace(withReturnTo(LOGIN_PATH, pathname));
      else if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) {
        setErrors(serverFieldErrors(error, values));
        setStep(0);
      }
    },
  });

  const busy = save.isPending || leaving;

  /** Kiểm rồi lưu; thành công thì sang bước `next` (Lưu nháp: ở lại bước hiện tại). */
  const submit = (intent: SaveIntent) => {
    if (busy) return;
    const parsed = EventDraftInput.safeParse(inputOf(values));
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error.issues.map((i) => i.path[0]), values));
      setStep(0);
      save.reset();
      return;
    }
    setErrors({});
    save.mutate({ body: parsed.data, intent });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit({ next: Math.min(step + 1, LAST_STEP), kind: 'next' });
  };

  const update = (field: EventInfoField, next: string) => {
    setValues((v) => ({ ...v, [field]: next }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Lỗi không thuộc trường nào (mạng, 5xx…): banner tại chỗ + "Thử lại". Lỗi trường báo tại ô; lỗi xử lý chung ở nơi khác.
  const failure =
    save.error && !hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED) && !handledElsewhere(save.error)
      ? save.error
      : null;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-section" data-slot="event-wizard">
      <WizardStepper steps={WIZARD_STEPS} current={step} label="Các bước thiết lập Sự kiện" />

      {step === 0 ? (
        <EventInfoFields values={values} errors={errors} onChange={update} />
      ) : step === 1 && event ? (
        <TicketTypesEditor orgId={orgId} event={event} />
      ) : step === 2 && event ? (
        <PurchaseFormEditor orgId={orgId} eventId={event.id} />
      ) : step === 3 && event ? (
        <div className="flex min-w-0 flex-col gap-section">
          <PurchaseFormReview orgId={orgId} eventId={event.id} />
          <PublishPanel
            orgId={orgId}
            event={event}
            onGoToStep={(next) => {
              if (!busy) setStep(next);
            }}
          />
        </div>
      ) : null}

      {failure ? (
        <StatusBanner
          tone="danger"
          title="Chưa lưu được Sự kiện"
          description={failure instanceof ApiError ? failure.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
          action={
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                const intent = save.variables?.intent;
                if (intent) submit(intent);
              }}
            >
              Thử lại
            </Button>
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-stack">
        {step > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (!busy) setStep((s) => Math.max(s - 1, 0));
            }}
          >
            Quay lại
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-stack">
          <Button
            type="button"
            variant="secondary"
            loading={busy && save.variables?.intent.kind === 'draft'}
            onClick={() => submit({ next: step, kind: 'draft' })}
          >
            Lưu nháp
          </Button>
          {step < LAST_STEP ? (
            <Button type="submit" loading={busy && save.variables?.intent.kind === 'next'}>
              Tiếp
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
