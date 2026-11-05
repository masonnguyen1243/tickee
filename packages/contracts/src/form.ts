import { z } from 'zod';

// ---------------------------------------------------------------------------------------------------------------
// Form mua vé (FR-9, Story 2.9)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Form mua vé của một Sự kiện = ba trường mặc định cố định (Tên, SĐT, email; không lưu, không sửa được) + tối đa
 * `FORM_QUESTIONS_MAX` câu hỏi riêng do BTC thêm. Câu hỏi và phương án có id ổn định: đổi nhãn hay thứ tự không đổi id,
 * nên câu trả lời Đơn đã chụp (kèm nhãn lúc đặt, Epic 3) vẫn đối chiếu được.
 */

/** Mỗi Sự kiện tối đa chừng này câu hỏi riêng. */
export const FORM_QUESTIONS_MAX = 20;
export const FORM_QUESTION_LABEL_MAX = 200;
/** Câu lựa chọn có từ `FORM_OPTIONS_MIN` đến `FORM_OPTIONS_MAX` phương án. */
export const FORM_OPTIONS_MIN = 2;
export const FORM_OPTIONS_MAX = 20;
export const FORM_OPTION_LABEL_MAX = 100;

/** Loại câu hỏi: `text` (văn bản) hoặc `choice` (lựa chọn, chỉ chọn một phương án). */
export const FormQuestionKind = {
  TEXT: 'text',
  CHOICE: 'choice',
} as const;
export type FormQuestionKind = (typeof FormQuestionKind)[keyof typeof FormQuestionKind];
export const formQuestionKindSchema = z.enum(FormQuestionKind);

/** Khóa so trùng nhãn phương án: bỏ khoảng trắng hai đầu, không phân biệt hoa thường ("Khá" trùng " khá "). */
export const formOptionKey = (label: string): string => label.trim().normalize('NFC').toLocaleLowerCase('vi');

/** Phương án gửi lên: có `id` = phương án đã có (giữ id); không có = phương án mới (server cấp id). */
export const FormOptionInput = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(FORM_OPTION_LABEL_MAX),
});
export type FormOptionInput = z.input<typeof FormOptionInput>;

/**
 * `POST /v1/orgs/:orgId/events/:eventId/form/questions` và `PATCH …/form/questions/:questionId` (thay toàn bộ các
 * trường dưới đây). Câu `choice` có 2–20 phương án, không trùng nhãn (so sau khi trim, không phân biệt hoa thường),
 * không trùng id; câu `text` không có phương án. Mọi lỗi về danh sách phương án báo ở `options` (nhãn phương án sai báo ở
 * `options.<i>.label`).
 */
export const FormQuestionInput = z
  .object({
    label: z.string().trim().min(1).max(FORM_QUESTION_LABEL_MAX),
    kind: formQuestionKindSchema,
    required: z.boolean(),
    options: z.array(FormOptionInput).default([]),
  })
  .superRefine((value, ctx) => {
    const options: unknown = value.options;
    if (!Array.isArray(options)) return;
    const issue = optionsIssue(value.kind, options as { id?: unknown; label?: unknown }[]);
    if (issue) ctx.addIssue({ code: 'custom', path: ['options'], message: issue });
  });
export type FormQuestionInput = z.input<typeof FormQuestionInput>;

/** Lỗi đầu tiên của danh sách phương án (một lỗi mỗi lần, để `options` chỉ báo một issue); hợp lệ → `null`. */
function optionsIssue(kind: unknown, options: readonly { id?: unknown; label?: unknown }[]): string | null {
  if (kind === FormQuestionKind.TEXT) return options.length === 0 ? null : 'câu văn bản không có phương án';
  if (kind !== FormQuestionKind.CHOICE) return null;
  if (options.length < FORM_OPTIONS_MIN || options.length > FORM_OPTIONS_MAX) {
    return `câu lựa chọn có ${FORM_OPTIONS_MIN}–${FORM_OPTIONS_MAX} phương án`;
  }
  const labels = options.flatMap((o) =>
    typeof o.label === 'string' && o.label.trim() !== '' ? [formOptionKey(o.label)] : [],
  );
  if (new Set(labels).size !== labels.length) return 'phương án trùng nhãn';
  const ids = options.flatMap((o) => (typeof o.id === 'string' ? [o.id.toLowerCase()] : []));
  if (new Set(ids).size !== ids.length) return 'phương án trùng id';
  return null;
}

/**
 * Các trường của `FormQuestionInput`, theo thứ tự (cũng là tên trường trong `changedFields` của
 * `event_form.question_updated`).
 */
export const FORM_QUESTION_FIELDS = ['label', 'kind', 'required', 'options'] as const;
export type FormQuestionField = (typeof FORM_QUESTION_FIELDS)[number];

export const FormOption = z.object({
  id: z.uuid(),
  label: z.string(),
});
export type FormOption = z.infer<typeof FormOption>;

/** Một câu hỏi riêng. `position` tăng dần từ 0 theo thứ tự hiện cho Người mua. Câu `text` có `options` rỗng. */
export const FormQuestion = z.object({
  id: z.uuid(),
  position: z.number().int(),
  label: z.string(),
  kind: formQuestionKindSchema,
  required: z.boolean(),
  options: z.array(FormOption),
});
export type FormQuestion = z.infer<typeof FormQuestion>;

/** `GET /v1/orgs/:orgId/events/:eventId/form` và `PUT …/form/order`: câu hỏi riêng theo thứ tự. */
export const EventForm = z.object({
  questions: z.array(FormQuestion),
});
export type EventForm = z.infer<typeof EventForm>;

/**
 * `PUT /v1/orgs/:orgId/events/:eventId/form/order`: đúng tập id câu hỏi hiện có, theo thứ tự mới. Trùng id lỗi ở đây;
 * thiếu hoặc thừa id (so với câu hỏi hiện có) do server kiểm, cùng lỗi `400 VALIDATION_FAILED` tại `questionIds`.
 */
export const FormOrderInput = z
  .object({
    questionIds: z.array(z.uuid()).max(FORM_QUESTIONS_MAX),
  })
  .refine((v) => new Set(v.questionIds.map((id) => String(id).toLowerCase())).size === v.questionIds.length, {
    path: ['questionIds'],
    message: 'questionIds bị trùng',
  });
export type FormOrderInput = z.input<typeof FormOrderInput>;

/** `details` của `409 FORM_QUESTION_LIMIT_REACHED`: số câu hỏi tối đa của một Sự kiện. */
export const FormQuestionLimitReachedDetails = z.object({ limit: z.number().int() });
export type FormQuestionLimitReachedDetails = z.infer<typeof FormQuestionLimitReachedDetails>;
