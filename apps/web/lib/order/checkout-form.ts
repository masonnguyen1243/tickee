import {
  answerIssues,
  BUYER_NAME_MAX,
  BuyerPhone,
  ErrorCode,
  FormQuestionKind,
  localBuyerPhone,
  NotOnSaleReason,
  ORDER_ANSWER_TEXT_MAX,
  OrderRateLimitedDetails,
  type AnswerIssueReason,
  type CheckoutForm,
  type CreateOrderRequest,
  type FormQuestion,
  type NotOnSaleDetails,
  type TicketSelectionItem,
} from '@tickee/contracts';

import { ApiError } from '@/lib/api/errors';

/*
 * Form mua của Checkout (Story 3.2): hàm thuần, không React. Kiểm bằng chính schema của contracts (`BuyerPhone`,
 * `answerIssues`) như API, chỉ thêm câu báo tiếng Việt tại từng trường. Dữ liệu form chỉ sống trong state của trang,
 * không bao giờ trong localStorage hay cookie.
 */

/** Giá trị các ô: tên, SĐT (như Người mua gõ), câu trả lời theo id câu hỏi (câu chọn: id phương án). */
export type CheckoutValues = { name: string; phone: string; answers: Record<string, string> };

/** Khóa trường: `name`, `phone`, hoặc id câu hỏi. */
export type FieldKey = string;
export type FieldErrors = Partial<Record<FieldKey, string>>;

/** Tự điền: tên và SĐT của Đơn gần nhất (SĐT hiện dạng `0912345678`), chưa trả lời câu nào. */
export function initialValues(form: CheckoutForm): CheckoutValues {
  return { name: form.buyer.name, phone: form.buyer.phone ? localBuyerPhone(form.buyer.phone) : '', answers: {} };
}

/** Thứ tự trường trên màn hình: Tên, SĐT, rồi câu hỏi theo thứ tự (Email chỉ đọc, không có lỗi). */
export const fieldOrder = (questions: readonly Pick<FormQuestion, 'id'>[]): FieldKey[] => [
  'name',
  'phone',
  ...questions.map((q) => q.id),
];

function nameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Nhập tên của bạn.';
  if (trimmed.length > BUYER_NAME_MAX) return `Tên tối đa ${BUYER_NAME_MAX} ký tự.`;
  return undefined;
}

function phoneError(phone: string): string | undefined {
  if (phone.trim() === '') return 'Nhập số điện thoại.';
  return BuyerPhone.safeParse(phone).success ? undefined : 'Số điện thoại chưa đúng (vd. 0912 345 678).';
}

function answerError(kind: FormQuestion['kind'], reason: AnswerIssueReason): string {
  if (reason === 'too_long') return `Tối đa ${ORDER_ANSWER_TEXT_MAX.toLocaleString('vi-VN')} ký tự.`;
  return kind === FormQuestionKind.CHOICE ? 'Chọn một phương án.' : 'Câu này bắt buộc.';
}

/** Lỗi của mọi trường (theo `fieldOrder`); hợp lệ → `{}`. */
export function fieldErrors(values: CheckoutValues, questions: readonly FormQuestion[]): FieldErrors {
  const errors: FieldErrors = {};
  const name = nameError(values.name);
  if (name) errors.name = name;
  const phone = phoneError(values.phone);
  if (phone) errors.phone = phone;
  const kindOf = new Map(questions.map((q) => [q.id, q.kind]));
  for (const issue of answerIssues(questions, values.answers)) {
    errors[issue.questionId] = answerError(kindOf.get(issue.questionId) ?? FormQuestionKind.TEXT, issue.reason);
  }
  return errors;
}

/** Trường lỗi đầu tiên theo thứ tự trên màn hình; không có → `null`. */
export function firstErrorField(errors: FieldErrors, questions: readonly Pick<FormQuestion, 'id'>[]): FieldKey | null {
  return fieldOrder(questions).find((key) => errors[key]) ?? null;
}

export const hasFieldErrors = (errors: FieldErrors): boolean => Object.values(errors).some(Boolean);

/** Body của `POST /v1/events/:slug/orders`. Câu trả lời bỏ trống không gửi. */
export function orderRequest(
  values: CheckoutValues,
  items: readonly TicketSelectionItem[],
  funnelId: string | null,
): CreateOrderRequest {
  const answers = Object.fromEntries(Object.entries(values.answers).filter(([, value]) => value.trim() !== ''));
  return { items: [...items], buyer: { name: values.name, phone: values.phone }, answers, funnelId };
}

/**
 * `400 VALIDATION_FAILED` của API → lỗi tại trường (câu báo theo giá trị hiện tại, dự phòng câu chung). `unmatched`: có
 * lỗi không gắn được vào trường nào trên màn hình (vd. `items`, hay câu hỏi BTC vừa thêm).
 */
export function serverFieldErrors(
  error: ApiError,
  values: CheckoutValues,
  questions: readonly FormQuestion[],
): { errors: FieldErrors; unmatched: string[] } {
  const issues = (error.details as { issues?: { path?: unknown }[] } | null)?.issues;
  const local = fieldErrors(values, questions);
  const known = new Set(questions.map((q) => q.id));
  const errors: FieldErrors = {};
  const unmatched: string[] = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const path = String(issue.path ?? '');
    const [head, rest] = [path.split('.')[0], path.split('.').slice(1).join('.')];
    let key: FieldKey | null = null;
    if (path === 'buyer.name') key = 'name';
    else if (path === 'buyer.phone') key = 'phone';
    else if (head === 'answers' && known.has(rest)) key = rest;
    if (key === null) {
      unmatched.push(path);
      continue;
    }
    errors[key] = local[key] ?? 'Kiểm tra lại câu trả lời này.';
  }
  return { errors, unmatched };
}

type TierNames = readonly { id: string; name: string }[];

const tierName = (ticketTypes: TierNames, id: string | undefined): string =>
  ticketTypes.find((t) => t.id === id)?.name ?? 'này';

/** Câu báo (toast) khi gửi Đơn mà Sự kiện hoặc Hạng vé không bán. */
export function notOnSaleMessage(details: NotOnSaleDetails | null, ticketTypes: TierNames): string {
  switch (details?.reason) {
    case NotOnSaleReason.CANCELLED:
      return 'Sự kiện đã hủy.';
    case NotOnSaleReason.LOCKED:
      return 'Sự kiện tạm thời không nhận Đơn.';
    case NotOnSaleReason.ENDED:
      return 'Sự kiện đã kết thúc.';
    case NotOnSaleReason.HIDDEN:
      return 'Sự kiện tạm dừng nhận Đơn.';
    case NotOnSaleReason.PAUSED:
      return `Hạng vé ${tierName(ticketTypes, details.ticketTypeId)} đang tạm ngừng bán. Bạn chọn lại nhé.`;
    case NotOnSaleReason.NOT_STARTED:
      return `Hạng vé ${tierName(ticketTypes, details.ticketTypeId)} chưa mở bán. Bạn chọn lại nhé.`;
    case NotOnSaleReason.CLOSED:
      return `Hạng vé ${tierName(ticketTypes, details.ticketTypeId)} đã đóng bán. Bạn chọn lại nhé.`;
    default:
      return 'Sự kiện hiện không nhận Đơn.';
  }
}

/** Câu báo khi gửi Đơn quá nhanh: số phút chờ, làm tròn lên, tối thiểu 1. */
export function rateLimitedMessage(error: ApiError): string {
  const parsed = OrderRateLimitedDetails.safeParse(error.details);
  const minutes = Math.max(1, Math.ceil((parsed.success ? parsed.data.retryAfterSeconds : 600) / 60));
  return `Bạn gửi Đơn quá nhanh. Thử lại sau ${minutes} phút.`;
}

/** Lỗi mạng (không có phản hồi) hoặc lỗi máy chủ (5xx): gửi lại cùng khóa được. */
export const isRetryableSubmitError = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.status === null || error.status >= 500 || error.code === ErrorCode.SERVICE_UNAVAILABLE);

export const SUBMIT_NETWORK_ERROR = 'Chưa gửi được Đơn. Kiểm tra kết nối rồi thử lại.';
