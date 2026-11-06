'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_NAME_MAX,
  EVENT_REFUND_POLICY_MAX,
  EVENT_VENUE_MAX,
  EVENT_YEAR_MAX,
  EVENT_YEAR_MIN,
  EventDraftInput,
  ErrorCode,
  eventIsoToLocal,
  eventLocalToIso,
  eventPath,
  isEventYearInRange,
  type EventDetail,
} from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'sonner';

import { StatusBanner } from '@/components/tickee/status-banner';
import { WizardStepper } from '@/components/tickee/wizard-stepper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { createEvent, eventQueryKey, eventsQueryKey, updateEvent } from '@/lib/event/api';

import { handledElsewhere } from './handled-elsewhere';
import { PublishPanel } from './publish-panel';
import { PurchaseFormEditor, PurchaseFormReview } from './purchase-form-editor';
import { TicketTypesEditor } from './ticket-types-editor';

/*
 * Wizard tạo/thiết lập Sự kiện (Story 2.7, UX-DR wizard): 4 bước Thông tin → Hạng vé → Form mua → Xem trước & mở bán.
 * Bước 1 là thông tin Sự kiện; bước 2 là trình sửa Hạng vé (Story 2.8, dùng chung với tab "Hạng vé"); bước 3 là trình
 * sửa form mua (Story 2.9, dùng chung với tab "Form mua"); bước 4 hiện mục "Form mua" (cùng phần xem trước) và phần mở
 * bán (Story 2.10, `PublishPanel`: điều kiện còn thiếu kèm lối sửa nhanh về bước 1–2 hoặc trang khác, nút "Mở bán",
 * link công khai sau khi mở bán). "Lưu nháp" có ở mọi bước; "Tiếp" lưu rồi mới sang bước sau; "Quay lại" giữ nguyên dữ
 * liệu đã nhập. Lưu lần đầu (POST) xong thì URL chuyển sang `su-kien/{id}/thiet-lap`, nên mọi
 * lần lưu sau là PATCH, không tạo Sự kiện thứ hai. Giờ nhập luôn hiểu theo giờ Việt Nam (+07:00), không theo máy.
 */

export const WIZARD_STEPS = ['Thông tin', 'Hạng vé', 'Form mua', 'Xem trước & mở bán'] as const;
const LAST_STEP = WIZARD_STEPS.length - 1;

type Field = 'name' | 'startsAt' | 'endsAt' | 'venue' | 'description' | 'refundPolicy';
/** Giá trị ô nhập; giờ là giá trị `datetime-local` (`2026-11-16T07:00`) theo giờ Việt Nam. */
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly Field[] = ['name', 'startsAt', 'endsAt', 'venue', 'description', 'refundPolicy'];

const EMPTY: Values = { name: '', startsAt: '', endsAt: '', venue: '', description: '', refundPolicy: '' };

export const valuesOf = (event: EventDetail): Values => ({
  name: event.name,
  startsAt: eventIsoToLocal(event.startsAt),
  endsAt: eventIsoToLocal(event.endsAt),
  venue: event.venue ?? '',
  description: event.description ?? '',
  refundPolicy: event.refundPolicy ?? '',
});

const inputOf = (values: Values) => ({
  name: values.name,
  startsAt: eventLocalToIso(values.startsAt),
  endsAt: eventLocalToIso(values.endsAt),
  venue: values.venue,
  description: values.description,
  refundPolicy: values.refundPolicy,
});

const YEAR_OUT_OF_RANGE = `Năm phải trong khoảng ${EVENT_YEAR_MIN}–${EVENT_YEAR_MAX}.`;
/** Server từ chối mà không chỉ ra trường wizard biết: báo chung ở ô đầu tiên, không đoán nguyên nhân. */
const UNMATCHED_SERVER_ERROR = 'Thông tin chưa hợp lệ. Kiểm tra lại các ô rồi lưu lại.';

function messageFor(field: Field, values: Values): string {
  switch (field) {
    case 'name':
      return values.name.trim() === '' ? 'Nhập tên Sự kiện.' : `Tên Sự kiện tối đa ${EVENT_NAME_MAX} ký tự.`;
    case 'startsAt':
      if (values.startsAt !== '' && !isEventYearInRange(eventLocalToIso(values.startsAt))) return YEAR_OUT_OF_RANGE;
      return 'Chọn ngày và giờ bắt đầu.';
    case 'endsAt':
      if (values.endsAt === '') return 'Chọn ngày và giờ kết thúc.';
      if (!isEventYearInRange(eventLocalToIso(values.endsAt))) return YEAR_OUT_OF_RANGE;
      return 'Giờ kết thúc phải sau giờ bắt đầu.';
    case 'venue':
      return `Địa điểm tối đa ${EVENT_VENUE_MAX} ký tự.`;
    case 'description':
      return `Mô tả tối đa ${EVENT_DESCRIPTION_MAX.toLocaleString('vi-VN')} ký tự.`;
    case 'refundPolicy':
      return `Chính sách hoàn vé tối đa ${EVENT_REFUND_POLICY_MAX.toLocaleString('vi-VN')} ký tự.`;
  }
}

/** Lỗi theo trường từ danh sách đường dẫn trường (Zod phía web hoặc `details.issues` của api). */
function fieldErrorsOf(paths: readonly unknown[], values: Values): FieldErrors {
  const errors: FieldErrors = {};
  for (const path of paths) {
    const field = FIELDS.find((f) => f === path);
    if (field && !errors[field]) errors[field] = messageFor(field, values);
  }
  return errors;
}

function serverIssuePaths(error: ApiError): string[] {
  const issues = (error.details as { issues?: { path?: unknown }[] } | null)?.issues;
  return Array.isArray(issues) ? issues.map((i) => String(i.path ?? '').split('.')[0] ?? '') : [];
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p id={id} role="alert" className="flex min-h-0 items-start gap-1.5 text-meta text-danger-text empty:hidden">
      {message ? (
        <>
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}

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
  const ids = useId();
  const [step, setStep] = useState(() => Math.min(Math.max(initialStep, 0), event ? LAST_STEP : 0));
  const [values, setValues] = useState<Values>(() => (event ? valuesOf(event) : EMPTY));
  const [errors, setErrors] = useState<FieldErrors>({});
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
        const fieldErrors = fieldErrorsOf(serverIssuePaths(error), values);
        setErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { name: UNMATCHED_SERVER_ERROR });
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

  const update = (field: Field) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValues((v) => ({ ...v, [field]: next }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Lỗi không thuộc trường nào (mạng, 5xx…): banner tại chỗ + "Thử lại". Lỗi trường báo tại ô; lỗi xử lý chung ở nơi khác.
  const failure =
    save.error && !hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED) && !handledElsewhere(save.error)
      ? save.error
      : null;

  const field = (name: Field) => {
    const id = `${ids}-${name}`;
    const errorId = `${id}-error`;
    return {
      id,
      errorId,
      props: {
        id,
        name,
        value: values[name],
        onChange: update(name),
        'aria-invalid': errors[name] ? true : undefined,
        'aria-describedby': errorId,
      },
    };
  };

  const name = field('name');
  const startsAt = field('startsAt');
  const endsAt = field('endsAt');
  const venue = field('venue');
  const description = field('description');
  const refundPolicy = field('refundPolicy');

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-section" data-slot="event-wizard">
      <WizardStepper steps={WIZARD_STEPS} current={step} label="Các bước thiết lập Sự kiện" />

      {step === 0 ? (
        <div className="flex flex-col gap-section rounded-lg bg-card p-card-padding shadow-card">
          <h2 className="text-title">Thông tin Sự kiện</h2>
          <div className="flex flex-col gap-stack">
            <Label htmlFor={name.id}>Tên Sự kiện</Label>
            <Input {...name.props} autoComplete="off" placeholder="vd. Giải chạy Hà Nội 2026" />
            <FieldError id={name.errorId} message={errors.name} />
          </div>

          <fieldset className="flex min-w-0 flex-col gap-stack">
            <legend className="text-label">Thời gian</legend>
            <p className="text-meta text-muted-foreground">Giờ Việt Nam (GMT+7).</p>
            <div className="grid min-w-0 gap-stack sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-stack">
                <Label htmlFor={startsAt.id}>Bắt đầu</Label>
                <Input {...startsAt.props} type="datetime-local" />
                <FieldError id={startsAt.errorId} message={errors.startsAt} />
              </div>
              <div className="flex min-w-0 flex-col gap-stack">
                <Label htmlFor={endsAt.id}>Kết thúc</Label>
                <Input {...endsAt.props} type="datetime-local" />
                <FieldError id={endsAt.errorId} message={errors.endsAt} />
              </div>
            </div>
          </fieldset>

          <div className="flex flex-col gap-stack">
            <Label htmlFor={venue.id}>Địa điểm (không bắt buộc)</Label>
            <Input {...venue.props} autoComplete="off" placeholder="vd. Hồ Gươm, Hoàn Kiếm, Hà Nội" />
            <FieldError id={venue.errorId} message={errors.venue} />
          </div>

          <div className="flex flex-col gap-stack">
            <Label htmlFor={description.id}>Mô tả (không bắt buộc)</Label>
            <Textarea {...description.props} rows={5} />
            <FieldError id={description.errorId} message={errors.description} />
          </div>

          <div className="flex flex-col gap-stack">
            <Label htmlFor={refundPolicy.id}>Chính sách hoàn vé</Label>
            <p id={`${refundPolicy.id}-hint`} className="text-meta text-muted-foreground">
              Cần có để mở bán. Lưu nháp thì để trống được.
            </p>
            <Textarea
              {...refundPolicy.props}
              rows={4}
              aria-describedby={`${refundPolicy.id}-hint ${refundPolicy.errorId}`}
              placeholder="vd. Hoàn 100% nếu hủy trước ngày diễn ra 7 ngày."
            />
            <FieldError id={refundPolicy.errorId} message={errors.refundPolicy} />
          </div>
        </div>
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
