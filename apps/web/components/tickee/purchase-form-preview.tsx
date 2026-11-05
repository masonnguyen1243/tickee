import type { FormQuestion } from '@tickee/contracts';
import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/*
 * Form mua vé như Người mua sẽ thấy (FR-9, Story 2.9): ba trường mặc định cố định rồi câu hỏi riêng theo thứ tự.
 * Bản này chỉ đọc (xem trước ở trình sửa form và bước 4 của wizard); Checkout (Epic 3) dùng lại cùng bố cục.
 */

/** Trường mặc định của mọi form mua: cố định, không lưu cùng câu hỏi riêng, BTC không sửa được. */
export const PURCHASE_FORM_DEFAULT_FIELDS = [
  { key: 'name', label: 'Tên', required: true, note: null, placeholder: 'vd. Nguyễn Văn An' },
  {
    key: 'phone',
    label: 'Số điện thoại',
    required: true,
    note: 'Chỉ hỏi nếu tài khoản chưa có',
    placeholder: 'vd. 0912 345 678',
  },
  {
    key: 'email',
    label: 'Email',
    required: false,
    note: 'Tự điền từ tài khoản, không sửa được',
    placeholder: 'Email của tài khoản',
  },
] as const;

/** Dấu `*` của câu bắt buộc; trình đọc màn hình đọc "bắt buộc". */
export function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="text-danger-text">
        *
      </span>
      <span className="sr-only">(bắt buộc)</span>
    </>
  );
}

function FieldLabel({ htmlFor, label, required }: { htmlFor?: string; label: string; required: boolean }) {
  const content = (
    <>
      <span className="min-w-0 wrap-break-word">{label}</span>
      {required ? <RequiredMark /> : null}
    </>
  );
  return htmlFor ? (
    <Label htmlFor={htmlFor} className="items-start gap-1">
      {content}
    </Label>
  ) : (
    content
  );
}

function TextField({
  id,
  label,
  required,
  note,
  placeholder,
}: {
  id: string;
  label: string;
  required: boolean;
  note: string | null;
  placeholder: string;
}) {
  const noteId = `${id}-note`;
  return (
    <div className="flex min-w-0 flex-col gap-stack" data-slot="purchase-form-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      {note ? (
        <p id={noteId} className="text-meta text-muted-foreground">
          {note}
        </p>
      ) : null}
      {/* Chỉ xem trước: không là điểm dừng Tab, Enter không gửi form bao ngoài (vd. form của wizard). */}
      <Input
        id={id}
        readOnly
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-describedby={note ? noteId : undefined}
      />
    </div>
  );
}

function ChoiceField({ id, question }: { id: string; question: FormQuestion }) {
  return (
    // Bắt buộc báo bằng `*` + "(bắt buộc)" trong `legend` (`aria-required` không hợp lệ trên `fieldset`).
    <fieldset className="flex min-w-0 flex-col gap-stack" data-slot="purchase-form-field">
      <legend className="mb-stack flex items-start gap-1 text-label">
        <FieldLabel label={question.label} required={question.required} />
      </legend>
      <div className="flex min-w-0 flex-col gap-1">
        {question.options.map((option) => (
          <label key={option.id} className="flex min-h-11 min-w-0 items-center gap-3 text-body">
            <input type="radio" name={id} value={option.id} disabled className="size-5 shrink-0" />
            <span className="min-w-0 wrap-break-word">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Form mua (chỉ đọc): trường mặc định rồi `questions` theo thứ tự đã nhận. */
export function PurchaseFormPreview({
  questions,
  className,
}: {
  questions: readonly FormQuestion[];
  className?: string;
}) {
  const ids = useId();
  return (
    <div data-slot="purchase-form-preview" className={cn('flex min-w-0 flex-col gap-section', className)}>
      <p className="text-meta text-muted-foreground">
        Dấu <span className="text-danger-text">*</span> là câu bắt buộc.
      </p>
      {PURCHASE_FORM_DEFAULT_FIELDS.map((field) => (
        <TextField
          key={field.key}
          id={`${ids}-${field.key}`}
          label={field.label}
          required={field.required}
          note={field.note}
          placeholder={field.placeholder}
        />
      ))}
      {questions.map((question) =>
        question.kind === 'choice' ? (
          <ChoiceField key={question.id} id={`${ids}-${question.id}`} question={question} />
        ) : (
          <TextField
            key={question.id}
            id={`${ids}-${question.id}`}
            label={question.label}
            required={question.required}
            note={null}
            placeholder="Câu trả lời"
          />
        ),
      )}
    </div>
  );
}
