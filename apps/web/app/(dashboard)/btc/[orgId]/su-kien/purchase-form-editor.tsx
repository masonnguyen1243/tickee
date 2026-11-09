'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  FORM_OPTION_LABEL_MAX,
  FORM_OPTIONS_MAX,
  FORM_OPTIONS_MIN,
  FORM_QUESTION_LABEL_MAX,
  FORM_QUESTIONS_MAX,
  FormQuestionInput,
  FormQuestionKind,
  formOptionKey,
  type EventForm,
  type FormQuestion,
} from '@tickee/contracts';
import { ArrowDown, ArrowUp, ListChecks, Lock, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { EmptyState } from '@/components/tickee/empty-state';
import { FieldError } from '@/components/tickee/field-error';
import { PURCHASE_FORM_DEFAULT_FIELDS, PurchaseFormPreview, RequiredMark } from '@/components/tickee/purchase-form-preview';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  addFormQuestion,
  deleteFormQuestion,
  eventFormQueryKey,
  fetchEventForm,
  reorderFormQuestions,
  updateFormQuestion,
} from '@/lib/event/api';

/*
 * Trình sửa form mua vé (Story 2.9) dùng chung cho wizard bước 3 và tab "Form mua": ba trường mặc định chỉ đọc, danh
 * sách câu hỏi riêng (thêm/sửa qua `Dialog`, xóa qua `Dialog` nêu hậu quả, sắp thứ tự bằng nút "Lên"/"Xuống") và phần
 * xem trước giống form Người mua sẽ thấy. Mỗi `Dialog` lưu ngay qua API, nên "Tiếp" ở bước 3 không cần lưu gì thêm.
 */

function serverIssuePaths(error: ApiError): string[] {
  const issues = (error.details as { issues?: { path?: unknown }[] } | null)?.issues;
  return Array.isArray(issues) ? issues.map((i) => String(i.path ?? '')) : [];
}

/** Câu hỏi của form trong cache, thứ tự mới, `position` đánh lại từ 0. */
const withPositions = (questions: readonly FormQuestion[]): FormQuestion[] =>
  questions.map((q, position) => ({ ...q, position }));

const KIND_TEXT: Record<FormQuestion['kind'], string> = {
  text: 'Văn bản',
  choice: 'Lựa chọn (chọn một)',
};
const LIMIT_MESSAGE = `Mỗi Sự kiện tối đa ${FORM_QUESTIONS_MAX} câu hỏi. Xóa bớt câu hỏi để thêm câu mới.`;
/** Server từ chối mà không chỉ ra ô nào trình sửa biết: báo chung ở ô câu hỏi. */
const UNMATCHED_SERVER_ERROR = 'Thông tin chưa hợp lệ. Kiểm tra lại các ô rồi lưu lại.';

// ---------------------------------------------------------------------------------------------------------------
// Form câu hỏi
// ---------------------------------------------------------------------------------------------------------------

/** Một ô phương án: `id` = phương án đã lưu (giữ id khi sửa); `key` chỉ để React giữ đúng ô. */
type OptionDraft = { key: string; id?: string; label: string };
type Values = { label: string; kind: FormQuestion['kind']; required: boolean; options: OptionDraft[] };
type Errors = { label?: string; options?: string; optionLabels?: Partial<Record<number, string>> };

let nextOptionKey = 0;
const blankOption = (): OptionDraft => ({ key: `new-${nextOptionKey++}`, label: '' });

/** Form trống; câu văn bản vẫn giữ sẵn hai ô phương án để đổi sang "Lựa chọn" không phải thêm lại. */
const emptyValues = (): Values => ({
  label: '',
  kind: FormQuestionKind.TEXT,
  required: false,
  options: [blankOption(), blankOption()],
});

const valuesOf = (q: FormQuestion): Values => ({
  label: q.label,
  kind: q.kind,
  required: q.required,
  options:
    q.kind === FormQuestionKind.CHOICE
      ? q.options.map((o) => ({ key: o.id, id: o.id, label: o.label }))
      : [blankOption(), blankOption()],
});

const inputOf = (values: Values) => ({
  label: values.label,
  kind: values.kind,
  required: values.required,
  options:
    values.kind === FormQuestionKind.CHOICE
      ? values.options.map((o) => (o.id ? { id: o.id, label: o.label } : { label: o.label }))
      : [],
});

/** Lỗi của danh sách phương án (`options`): số phương án, hoặc ô trùng nhãn (báo tại từng ô trùng). */
function optionsErrorsOf(values: Values): Pick<Errors, 'options' | 'optionLabels'> {
  const count = values.options.length;
  if (count < FORM_OPTIONS_MIN) return { options: `Câu lựa chọn cần ít nhất ${FORM_OPTIONS_MIN} phương án.` };
  if (count > FORM_OPTIONS_MAX) return { options: `Tối đa ${FORM_OPTIONS_MAX} phương án.` };
  const seen = new Set<string>();
  const optionLabels: Partial<Record<number, string>> = {};
  values.options.forEach((o, index) => {
    if (o.label.trim() === '') return;
    const key = formOptionKey(o.label);
    if (seen.has(key)) optionLabels[index] = 'Trùng với một phương án ở trên.';
    seen.add(key);
  });
  return Object.keys(optionLabels).length > 0
    ? { options: 'Các phương án không được trùng nhau.', optionLabels }
    : { options: 'Kiểm tra lại các phương án.' };
}

/** Lỗi theo ô từ đường dẫn trường (Zod phía web hoặc `details.issues` của api: `label`, `options`, `options.1.label`). */
function errorsOf(paths: readonly (readonly PropertyKey[])[], values: Values): Errors {
  const errors: Errors = {};
  for (const path of paths) {
    const [head, index, leaf] = path;
    if (head === 'label' && !errors.label) {
      errors.label =
        values.label.trim() === '' ? 'Nhập câu hỏi.' : `Câu hỏi tối đa ${FORM_QUESTION_LABEL_MAX} ký tự.`;
    } else if (head === 'options' && leaf === 'label' && Number.isInteger(Number(index))) {
      const i = Number(index);
      const label = values.options[i]?.label ?? '';
      errors.optionLabels = {
        ...errors.optionLabels,
        [i]:
          label.trim() === ''
            ? 'Nhập phương án hoặc xóa ô này.'
            : `Phương án tối đa ${FORM_OPTION_LABEL_MAX} ký tự.`,
      };
    } else if (head === 'options' && !errors.options) {
      const optionErrors = optionsErrorsOf(values);
      errors.options = optionErrors.options;
      errors.optionLabels = { ...optionErrors.optionLabels, ...errors.optionLabels };
    }
  }
  return errors;
}

const hasErrors = (errors: Errors) =>
  Boolean(errors.label || errors.options || Object.keys(errors.optionLabels ?? {}).length > 0);

/**
 * Form trong `Dialog` Thêm/Sửa câu hỏi. Giữ câu hỏi đang sửa từ lúc mở. Submit không lan ra form ngoài (wizard):
 * `Dialog` render qua portal nhưng sự kiện React vẫn nổi theo cây React.
 */
function QuestionForm({
  orgId,
  eventId,
  target,
  onDone,
  onCancel,
}: {
  orgId: string;
  eventId: string;
  target: FormQuestion | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [editing] = useState(target);
  const [values, setValues] = useState<Values>(() => (editing ? valuesOf(editing) : emptyValues()));
  const [errors, setErrors] = useState<Errors>({});
  /** Ô cần focus sau lần render tới (thêm hoặc xóa phương án). */
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [values.options]);

  const save = useMutation({
    mutationFn: (body: FormQuestionInput) =>
      editing ? updateFormQuestion(orgId, eventId, editing.id, body) : addFormQuestion(orgId, eventId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<EventForm>(eventFormQueryKey(orgId, eventId), (form) => {
        if (!form) return { questions: [saved] };
        const questions = editing
          ? form.questions.map((q) => (q.id === saved.id ? saved : q))
          : [...form.questions, saved];
        return { questions };
      });
      void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
      toast.success(editing ? 'Đã lưu câu hỏi.' : 'Đã thêm câu hỏi.');
      onDone();
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) return goToLogin();
      if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) {
        const paths = serverIssuePaths(error).map((p) => p.split('.'));
        const fieldErrors = errorsOf(paths, values);
        return setErrors(hasErrors(fieldErrors) ? fieldErrors : { label: UNMATCHED_SERVER_ERROR });
      }
      if (hasErrorCode(error, ErrorCode.FORM_QUESTION_LIMIT_REACHED)) {
        void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
        return;
      }
      if (hasErrorCode(error, ErrorCode.FORM_QUESTION_NOT_FOUND)) {
        toast.info('Câu hỏi này không còn nữa.');
        void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
        onDone();
      }
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const parsed = FormQuestionInput.safeParse(inputOf(values));
    if (!parsed.success) {
      setErrors(errorsOf(parsed.error.issues.map((i) => i.path), values));
      save.reset();
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  /**
   * Đổi phương án bất kỳ thì bỏ mọi lỗi theo ô và lỗi chung của danh sách (lỗi trùng liên quan nhiều ô); lần lưu sau
   * kiểm lại.
   */
  const clearOptionErrors = () =>
    setErrors((prev) =>
      prev.options || prev.optionLabels ? { ...prev, options: undefined, optionLabels: undefined } : prev,
    );

  const optionInputId = (key: string) => `${ids}-option-${key}`;
  const addOptionId = `${ids}-add-option`;

  const addOption = () => {
    const option = blankOption();
    pendingFocus.current = optionInputId(option.key);
    setValues((v) => ({ ...v, options: [...v.options, option] }));
    clearOptionErrors();
  };

  const removeOption = (index: number) => {
    const rest = values.options.filter((_, i) => i !== index);
    const focus = rest[Math.max(index - 1, 0)];
    pendingFocus.current = focus ? optionInputId(focus.key) : addOptionId;
    setValues((v) => ({ ...v, options: v.options.filter((_, i) => i !== index) }));
    // Chỉ số các ô sau đổi: bỏ hết lỗi theo ô, lần lưu sau kiểm lại.
    clearOptionErrors();
  };

  const failure =
    save.error &&
    !handledElsewhere(save.error) &&
    !hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED) &&
    !hasErrorCode(save.error, ErrorCode.FORM_QUESTION_NOT_FOUND)
      ? save.error
      : null;

  const labelId = `${ids}-label`;
  const labelErrorId = `${labelId}-error`;
  const requiredId = `${ids}-required`;
  const optionsHintId = `${ids}-options-hint`;
  const optionsErrorId = `${ids}-options-error`;
  const choice = values.kind === FormQuestionKind.CHOICE;
  const full = values.options.length >= FORM_OPTIONS_MAX;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-section" data-slot="form-question-form">
      <DialogHeader>
        <DialogTitle>{editing ? 'Sửa câu hỏi' : 'Thêm câu hỏi'}</DialogTitle>
        <DialogDescription>Người mua trả lời câu này khi đặt vé, một lần cho mỗi Đơn.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-stack">
        <Label htmlFor={labelId}>Câu hỏi</Label>
        <Input
          id={labelId}
          name="label"
          autoComplete="off"
          placeholder="vd. Trình độ"
          value={values.label}
          onChange={(e) => {
            const label = e.target.value;
            setValues((v) => ({ ...v, label }));
            if (errors.label) setErrors((prev) => ({ ...prev, label: undefined }));
          }}
          aria-invalid={errors.label ? true : undefined}
          aria-describedby={labelErrorId}
        />
        <FieldError id={labelErrorId} message={errors.label} />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-stack text-label">Loại câu trả lời</legend>
        {[FormQuestionKind.TEXT, FormQuestionKind.CHOICE].map((kind) => (
          <label key={kind} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-body">
            <input
              type="radio"
              name={`${ids}-kind`}
              value={kind}
              checked={values.kind === kind}
              onChange={() => {
                setValues((v) => ({
                  ...v,
                  kind,
                  options:
                    kind === FormQuestionKind.CHOICE && v.options.length === 0
                      ? [blankOption(), blankOption()]
                      : v.options,
                }));
                clearOptionErrors();
              }}
              className="size-5 shrink-0 cursor-pointer accent-btn-on-light"
            />
            <span>{KIND_TEXT[kind]}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex min-h-11 items-center gap-3">
        <Checkbox
          id={requiredId}
          checked={values.required}
          onCheckedChange={(checked) => setValues((v) => ({ ...v, required: checked === true }))}
        />
        <Label htmlFor={requiredId} className="cursor-pointer text-body">
          Bắt buộc trả lời
        </Label>
      </div>

      {choice ? (
        <fieldset
          className="flex min-w-0 flex-col gap-stack"
          data-slot="form-question-options"
          aria-describedby={`${optionsHintId} ${optionsErrorId}`}
        >
          <legend className="mb-1 text-label">Phương án</legend>
          <p id={optionsHintId} className="text-meta text-muted-foreground">
            Người mua chọn một phương án. Từ {FORM_OPTIONS_MIN} đến {FORM_OPTIONS_MAX} phương án, không trùng nhau.
          </p>
          <ol className="flex min-w-0 flex-col gap-stack">
            {values.options.map((option, index) => {
              const inputId = optionInputId(option.key);
              const errorId = `${inputId}-error`;
              const message = errors.optionLabels?.[index];
              return (
                <li key={option.key} className="flex min-w-0 flex-col gap-1" data-slot="form-question-option">
                  <Label htmlFor={inputId}>Phương án {index + 1}</Label>
                  <div className="flex min-w-0 items-center gap-2">
                    <Input
                      id={inputId}
                      autoComplete="off"
                      value={option.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        setValues((v) => ({
                          ...v,
                          options: v.options.map((o, i) => (i === index ? { ...o, label } : o)),
                        }));
                        clearOptionErrors();
                      }}
                      aria-invalid={message ? true : undefined}
                      aria-describedby={errorId}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Xóa phương án ${index + 1}`}
                      onClick={() => removeOption(index)}
                    >
                      Xóa
                    </Button>
                  </div>
                  <FieldError id={errorId} message={message} />
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-stack">
            <Button
              id={addOptionId}
              type="button"
              variant="secondary"
              size="sm"
              disabled={full}
              aria-describedby={full ? `${addOptionId}-full` : undefined}
              onClick={addOption}
            >
              <Plus aria-hidden="true" className="size-4" />
              Thêm phương án
            </Button>
            {full ? (
              <span id={`${addOptionId}-full`} className="text-meta text-muted-foreground">
                Đã đủ {FORM_OPTIONS_MAX} phương án.
              </span>
            ) : null}
          </div>
          <FieldError id={optionsErrorId} message={errors.options} />
        </fieldset>
      ) : null}

      {failure ? (
        <StatusBanner
          tone="danger"
          title="Chưa lưu được câu hỏi"
          description={hasErrorCode(failure, ErrorCode.FORM_QUESTION_LIMIT_REACHED) ? LIMIT_MESSAGE : messageOf(failure)}
        />
      ) : null}

      <DialogFooter>
        <Button type="submit" className="w-full" loading={save.isPending}>
          {editing ? 'Lưu' : 'Thêm'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (!save.isPending) onCancel();
          }}
        >
          Hủy
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Xóa câu hỏi
// ---------------------------------------------------------------------------------------------------------------

function DeleteDialog({
  orgId,
  eventId,
  target,
  returnFocusId,
  onClose,
}: {
  orgId: string;
  eventId: string;
  target: FormQuestion | null;
  /** Nút nhận focus khi hàng vừa bị xóa (nút "Xóa" của hàng không còn trong DOM). */
  returnFocusId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  /** Hàng đã bị gỡ khỏi danh sách: khi đóng, focus sang `returnFocusId` thay vì nút "Xóa" đã mất (focus rơi về `body`). */
  const removed = useRef(false);

  const remove = useMutation({
    mutationFn: (q: FormQuestion) => deleteFormQuestion(orgId, eventId, q.id),
    onSuccess: (_data, q) => {
      queryClient.setQueryData<EventForm>(eventFormQueryKey(orgId, eventId), (form) =>
        form ? { questions: withPositions(form.questions.filter((x) => x.id !== q.id)) } : form,
      );
      void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
      toast.success('Đã xóa câu hỏi.');
      removed.current = true;
      onClose();
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.FORM_QUESTION_NOT_FOUND)) {
        toast.info('Câu hỏi này không còn nữa.');
        void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
        removed.current = true;
        onClose();
      }
    },
  });

  const failure =
    remove.error && !handledElsewhere(remove.error) && !hasErrorCode(remove.error, ErrorCode.FORM_QUESTION_NOT_FOUND)
      ? remove.error
      : null;

  const close = () => {
    if (remove.isPending) return;
    remove.reset();
    onClose();
  };

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && close()}
      onCloseAutoFocus={(e) => {
        if (!removed.current) return;
        removed.current = false;
        e.preventDefault();
        document.getElementById(returnFocusId)?.focus();
      }}
      titleClassName="wrap-break-word"
      title={`Xóa câu hỏi ${target?.label}?`}
      description="Câu hỏi bị xóa khỏi form mua, Người mua đặt vé sau đây không còn thấy câu này. Đơn đã đặt vẫn giữ câu trả lời cũ."
      confirmLabel="Xóa"
      onConfirm={() => target && remove.mutate(target)}
      pending={remove.isPending}
      failureTitle="Chưa xóa được"
      failure={failure && messageOf(failure)}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------------------------------------------

type Direction = 'up' | 'down';
type Move = { questionId: string; direction: Direction; questionIds: string[] };

function QuestionRow({
  question: q,
  index,
  count,
  buttonId,
  moving,
  onMove,
  onEdit,
  onDelete,
}: {
  question: FormQuestion;
  index: number;
  count: number;
  buttonId: (questionId: string, direction: Direction) => string;
  /** Nút "Lên"/"Xuống" đang gửi của hàng này (spinner). */
  moving: Direction | null;
  onMove: (q: FormQuestion, direction: Direction) => void;
  onEdit: (q: FormQuestion) => void;
  onDelete: (q: FormQuestion) => void;
}) {
  const choice = q.kind === FormQuestionKind.CHOICE;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-slot="form-question-row">
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <span className="flex items-start gap-1 text-body font-semibold" data-slot="form-question-label">
          <span className="min-w-0 wrap-break-word">{q.label}</span>
          {q.required ? <RequiredMark /> : null}
        </span>
        <span className="text-meta text-muted-foreground">
          {KIND_TEXT[q.kind]} · {q.required ? 'Bắt buộc' : 'Không bắt buộc'}
        </span>
        {choice ? (
          <span className="text-meta wrap-break-word text-muted-foreground">
            {q.options.map((o) => o.label).join(' · ')}
          </span>
        ) : null}
      </div>
      {/* Bốn nút: ở màn hẹp nhóm co lại và xuống dòng (không `shrink-0`, nếu không 320px sẽ cuộn ngang). */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          id={buttonId(q.id, 'up')}
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Lên ${q.label}`}
          disabled={index === 0}
          loading={moving === 'up'}
          onClick={() => onMove(q, 'up')}
        >
          <ArrowUp aria-hidden="true" className="size-4" />
          Lên
        </Button>
        <Button
          id={buttonId(q.id, 'down')}
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Xuống ${q.label}`}
          disabled={index === count - 1}
          loading={moving === 'down'}
          onClick={() => onMove(q, 'down')}
        >
          <ArrowDown aria-hidden="true" className="size-4" />
          Xuống
        </Button>
        <Button type="button" variant="secondary" size="sm" aria-label={`Sửa ${q.label}`} onClick={() => onEdit(q)}>
          Sửa
        </Button>
        <Button type="button" variant="secondary" size="sm" aria-label={`Xóa ${q.label}`} onClick={() => onDelete(q)}>
          Xóa
        </Button>
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/** Trường mặc định: cố định, chỉ đọc, kèm ghi chú cách hỏi. */
function DefaultFields() {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-slot="purchase-form-defaults"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        Trường mặc định
      </h2>
      <p className="text-meta text-muted-foreground">Luôn có trong form mua, không sửa được.</p>
      <ul className="flex flex-col divide-y divide-border">
        {PURCHASE_FORM_DEFAULT_FIELDS.map((field) => (
          <li key={field.key} className="flex items-start gap-3 py-3" data-slot="purchase-form-default-field">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-body font-semibold">{field.label}</span>
              <span className="text-meta text-muted-foreground">{field.note ?? 'Bắt buộc'}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Editing = { kind: 'new' } | { kind: 'edit'; question: FormQuestion } | null;

/** Trình sửa form mua của một Sự kiện: trường mặc định, câu hỏi riêng và phần xem trước. */
export function PurchaseFormEditor({ orgId, eventId }: { orgId: string; eventId: string }) {
  const ids = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<FormQuestion | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const form = useQuery({
    queryKey: eventFormQueryKey(orgId, eventId),
    queryFn: ({ signal }) => fetchEventForm(orgId, eventId, signal),
  });

  const buttonId = (questionId: string, direction: Direction) => `${ids}-${questionId}-${direction}`;

  const move = useMutation({
    mutationFn: ({ questionIds }: Move) => reorderFormQuestions(orgId, eventId, { questionIds }),
    onSuccess: (saved, { questionId, direction }) => {
      queryClient.setQueryData(eventFormQueryKey(orgId, eventId), saved);
      // GET cũ còn đang chạy (từ lần invalidate trước) không được ghi đè thứ tự mới.
      void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
      const index = saved.questions.findIndex((q) => q.id === questionId);
      const question = saved.questions[index];
      if (question) setAnnouncement(`Đã chuyển ${question.label} tới vị trí ${index + 1}.`);
      // React dời DOM của hàng (`insertBefore`) nên focus rơi về `body`: focus lại nút vừa bấm, hoặc nút còn lại của
      // hàng khi nút vừa bấm bị tắt (câu hỏi đã lên đầu/xuống cuối).
      const atEdge = direction === 'up' ? index === 0 : index === saved.questions.length - 1;
      const target = buttonId(questionId, atEdge ? (direction === 'up' ? 'down' : 'up') : direction);
      requestAnimationFrame(() => document.getElementById(target)?.focus());
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) {
        // Danh sách vừa đổi ở nơi khác (thêm/xóa câu hỏi): tải lại rồi sắp lại.
        toast.info('Danh sách câu hỏi vừa thay đổi. Đã tải lại, hãy thử lại.');
        void queryClient.invalidateQueries({ queryKey: eventFormQueryKey(orgId, eventId) });
      }
    },
  });

  const onMove = (q: FormQuestion, direction: Direction) => {
    const questions = form.data?.questions;
    if (move.isPending || !questions) return;
    const index = questions.findIndex((x) => x.id === q.id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= questions.length) return;
    const questionIds = questions.map((x) => x.id);
    [questionIds[index], questionIds[target]] = [questionIds[target]!, questionIds[index]!];
    move.mutate({ questionId: q.id, direction, questionIds });
  };

  const moveFailure =
    move.error && !handledElsewhere(move.error) && !hasErrorCode(move.error, ErrorCode.VALIDATION_FAILED)
      ? move.error
      : null;

  const questions = form.data?.questions;
  const full = (questions?.length ?? 0) >= FORM_QUESTIONS_MAX;
  const addHintId = `${ids}-add-hint`;

  let body;
  if (questions) {
    body =
      questions.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Chưa có câu hỏi riêng."
          description="Thêm câu hỏi như “Trình độ” hay “Size áo” để hỏi Người mua khi đặt vé."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {questions.map((q, index) => (
            <QuestionRow
              key={q.id}
              question={q}
              index={index}
              count={questions.length}
              buttonId={buttonId}
              moving={move.isPending && move.variables.questionId === q.id ? move.variables.direction : null}
              onMove={onMove}
              onEdit={(question) => setEditing({ kind: 'edit', question })}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      );
  } else if (form.isError && !handledElsewhere(form.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được form mua"
        description={messageOf(form.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void form.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <Skeleton />;
  }

  // Giữ nội dung form trong lúc `Dialog` đóng (hiệu ứng thoát); mở lại thì form mount mới.
  const [shownEditing, setShownEditing] = useState<Editing>(editing);
  if (editing && editing !== shownEditing) setShownEditing(editing);
  const closeForm = () => setEditing(null);
  const formTarget = shownEditing?.kind === 'edit' ? shownEditing.question : null;

  return (
    <div
      className="grid min-w-0 items-start gap-section lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
      data-slot="purchase-form-editor"
    >
      <div className="flex min-w-0 flex-col gap-section">
        <DefaultFields />

        <section
          aria-labelledby={`${ids}-questions-title`}
          className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-stack">
            <h2 id={`${ids}-questions-title`} className="text-title">
              Câu hỏi riêng
            </h2>
            <Button
              id={`${ids}-add`}
              type="button"
              variant="primary-on-light"
              size="sm"
              disabled={full}
              aria-describedby={full ? addHintId : undefined}
              onClick={() => setEditing({ kind: 'new' })}
            >
              Thêm câu hỏi
            </Button>
          </div>
          {full ? (
            <p id={addHintId} className="text-meta text-muted-foreground">
              Đã đủ {FORM_QUESTIONS_MAX} câu hỏi. Xóa bớt để thêm câu mới.
            </p>
          ) : null}
          {moveFailure ? (
            <StatusBanner
              tone="danger"
              title="Chưa đổi được thứ tự"
              description={messageOf(moveFailure)}
              action={
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => {
                    const q = questions?.find((x) => x.id === move.variables?.questionId);
                    if (q && move.variables) onMove(q, move.variables.direction);
                  }}
                >
                  Thử lại
                </Button>
              }
            />
          ) : null}
          {body}
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </section>
      </div>

      <section
        aria-labelledby={`${ids}-preview-title`}
        data-slot="purchase-form-preview-card"
        className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
      >
        <h2 id={`${ids}-preview-title`} className="text-title">
          Xem trước
        </h2>
        <p className="text-meta text-muted-foreground">Người mua thấy form này khi đặt vé.</p>
        {questions ? <PurchaseFormPreview questions={questions} /> : <Skeleton />}
      </section>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent>
          {shownEditing ? (
            <QuestionForm
              key={formTarget?.id ?? 'new'}
              orgId={orgId}
              eventId={eventId}
              target={formTarget}
              onDone={closeForm}
              onCancel={closeForm}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <DeleteDialog
        orgId={orgId}
        eventId={eventId}
        target={deleting}
        returnFocusId={`${ids}-add`}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

/** Mục "Form mua" ở bước 4 của wizard: cùng phần xem trước với trình sửa (chỉ đọc). */
export function PurchaseFormReview({ orgId, eventId }: { orgId: string; eventId: string }) {
  const titleId = useId();
  const form = useQuery({
    queryKey: eventFormQueryKey(orgId, eventId),
    queryFn: ({ signal }) => fetchEventForm(orgId, eventId, signal),
  });

  let body;
  if (form.data) body = <PurchaseFormPreview questions={form.data.questions} />;
  else if (form.isError && !handledElsewhere(form.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được form mua"
        description={messageOf(form.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void form.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else body = <Skeleton />;

  return (
    <section
      aria-labelledby={titleId}
      data-slot="purchase-form-review"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={titleId} className="text-title">
        Form mua
      </h2>
      <p className="text-meta text-muted-foreground">Người mua thấy form này khi đặt vé.</p>
      {body}
    </section>
  );
}
