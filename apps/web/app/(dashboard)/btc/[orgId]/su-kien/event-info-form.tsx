'use client';

import {
  EVENT_DESCRIPTION_MAX,
  EVENT_NAME_MAX,
  EVENT_REFUND_POLICY_MAX,
  EVENT_VENUE_MAX,
  EVENT_YEAR_MAX,
  EVENT_YEAR_MIN,
  eventIsoToLocal,
  eventLocalToIso,
  isEventYearInRange,
  type EventDetail,
} from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { useId, type ChangeEvent, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/errors';

/*
 * Form thông tin Sự kiện dùng chung cho wizard bước 1 (Story 2.7) và tab "Cài đặt" (Story 2.12): tên, thời gian,
 * địa điểm, mô tả, chính sách hoàn vé. Component chỉ hiển thị; trạng thái ô, kiểm và lưu do nơi dùng giữ. Lỗi hiện tại
 * từng ô. Giờ nhập luôn hiểu theo giờ Việt Nam (+07:00), không theo máy.
 */

export type EventInfoField = 'name' | 'startsAt' | 'endsAt' | 'venue' | 'description' | 'refundPolicy';
/** Giá trị ô nhập; giờ là giá trị `datetime-local` (`2026-11-16T07:00`) theo giờ Việt Nam. */
export type EventInfoValues = Record<EventInfoField, string>;
export type EventInfoErrors = Partial<Record<EventInfoField, string>>;

const FIELDS: readonly EventInfoField[] = ['name', 'startsAt', 'endsAt', 'venue', 'description', 'refundPolicy'];

export const EMPTY_EVENT_INFO: EventInfoValues = {
  name: '',
  startsAt: '',
  endsAt: '',
  venue: '',
  description: '',
  refundPolicy: '',
};

export const valuesOf = (event: EventDetail): EventInfoValues => ({
  name: event.name,
  startsAt: eventIsoToLocal(event.startsAt),
  endsAt: eventIsoToLocal(event.endsAt),
  venue: event.venue ?? '',
  description: event.description ?? '',
  refundPolicy: event.refundPolicy ?? '',
});

export const inputOf = (values: EventInfoValues) => ({
  name: values.name,
  startsAt: eventLocalToIso(values.startsAt),
  endsAt: eventLocalToIso(values.endsAt),
  venue: values.venue,
  description: values.description,
  refundPolicy: values.refundPolicy,
});

const YEAR_OUT_OF_RANGE = `Năm phải trong khoảng ${EVENT_YEAR_MIN}–${EVENT_YEAR_MAX}.`;
/** Server từ chối mà không chỉ ra trường form biết: báo chung ở ô đầu tiên, không đoán nguyên nhân. */
export const UNMATCHED_SERVER_ERROR = 'Thông tin chưa hợp lệ. Kiểm tra lại các ô rồi lưu lại.';

function messageFor(field: EventInfoField, values: EventInfoValues): string {
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
export function fieldErrorsOf(paths: readonly unknown[], values: EventInfoValues): EventInfoErrors {
  const errors: EventInfoErrors = {};
  for (const path of paths) {
    const field = FIELDS.find((f) => f === path);
    if (field && !errors[field]) errors[field] = messageFor(field, values);
  }
  return errors;
}

/** Lỗi theo trường từ `400 VALIDATION_FAILED` của api; không khớp ô nào thì báo chung ở ô tên. */
export function serverFieldErrors(error: ApiError, values: EventInfoValues): EventInfoErrors {
  const issues = (error.details as { issues?: { path?: unknown }[] } | null)?.issues;
  const paths = Array.isArray(issues) ? issues.map((i) => String(i.path ?? '').split('.')[0] ?? '') : [];
  const errors = fieldErrorsOf(paths, values);
  return Object.keys(errors).length > 0 ? errors : { name: UNMATCHED_SERVER_ERROR };
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

type EventInfoFieldsProps = {
  values: EventInfoValues;
  errors: EventInfoErrors;
  onChange: (field: EventInfoField, value: string) => void;
  /** Chỉ đọc (Sự kiện đã hủy): mọi ô `readOnly`. */
  readOnly?: boolean;
  /** Nội dung thêm dưới tiêu đề (vd. lý do chỉ đọc). */
  notice?: ReactNode;
  /** Nút lưu… đặt cuối thẻ. */
  footer?: ReactNode;
  /** Sự kiện còn nháp (mặc định): gợi ý chính sách hoàn vé theo mở bán; đã mở bán thì theo bán vé. */
  draft?: boolean;
};

/** Thẻ "Thông tin Sự kiện": các ô kèm nhãn luôn hiện và lỗi tại từng ô. */
export function EventInfoFields({
  values,
  errors,
  onChange,
  readOnly = false,
  notice,
  footer,
  draft = true,
}: EventInfoFieldsProps) {
  const ids = useId();

  const field = (name: EventInfoField) => {
    const id = `${ids}-${name}`;
    const errorId = `${id}-error`;
    return {
      id,
      errorId,
      props: {
        id,
        name,
        value: values[name],
        readOnly,
        onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(name, e.target.value),
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
    <div className="flex flex-col gap-section rounded-lg bg-card p-card-padding shadow-card" data-slot="event-info-form">
      <h2 className="text-title">Thông tin Sự kiện</h2>
      {notice}
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
          {draft
            ? 'Cần có để mở bán. Lưu nháp thì để trống được.'
            : 'Cần có để bán vé. Để trống thì mọi Hạng vé chuyển Tạm ngừng bán.'}
        </p>
        <Textarea
          {...refundPolicy.props}
          rows={4}
          aria-describedby={`${refundPolicy.id}-hint ${refundPolicy.errorId}`}
          placeholder="vd. Hoàn 100% nếu hủy trước ngày diễn ra 7 ngày."
        />
        <FieldError id={refundPolicy.errorId} message={errors.refundPolicy} />
      </div>
      {footer}
    </div>
  );
}
