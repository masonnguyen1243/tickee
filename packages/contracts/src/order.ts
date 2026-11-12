import { z } from 'zod';

import { TicketSelection } from './checkout.js';
import { EventDateTime } from './event.js';
import { FormQuestion, FormQuestionKind } from './form.js';

// ---------------------------------------------------------------------------------------------------------------
// Đơn và Giữ chỗ (FR-12, FR-13, Story 3.2, AD-2, AD-4, AD-31)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Một nguồn luật cho web và API: Checkout kiểm form bằng chính các schema ở đây (lỗi tại trường), `POST
 * /v1/events/:slug/orders` kiểm lại bằng `orderRequestFor` với giới hạn Vé/Đơn và câu hỏi của Sự kiện lúc đặt.
 */

/** Mã Đơn: `TK` + 8 ký tự Crockford base32 (không I, L, O, U). Ví dụ `TK8F3Q2AXM`. */
export const ORDER_CODE_PREFIX = 'TK';
export const ORDER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ORDER_CODE_RANDOM_LENGTH = 8;
export const ORDER_CODE_PATTERN = /^TK[0-9A-HJKMNP-TV-Z]{8}$/;

/** Trang Đơn của web (bề mặt Người mua, cần đăng nhập). */
export const orderPath = (code: string): string => `/orders/${encodeURIComponent(code)}`;

/**
 * Giữ chỗ của Đơn vừa tạo (TX1) sống chừng này giây (AD-4): chưa có link thanh toán khi hết hạn thì job
 * `ordering.expire-order` chuyển Đơn sang `expired` và nhả chỗ. Story 3.4 gắn link thì hạn đổi thành hạn của link.
 */
export const ORDER_HOLD_SECONDS = 60;

/**
 * Link thanh toán Gateway (Story 3.4, AD-4, AD-6): `create-link` gửi `expireInMinute` bằng số này. Tingee không trả hạn
 * link nên hạn Đơn (`expires_at`) = lúc giành lượt tạo link (đồng hồ DB, trước khi gửi request) + chừng này phút: không
 * bao giờ muộn hơn hạn thật của link.
 */
export const PAYMENT_LINK_MINUTES = 15;

/**
 * Đơn đã có link chỉ hết hạn (AD-4 (c)) khi quá `expires_at` thêm chừng này giây: chừa thời gian cho IPN của lần trả
 * tiền sát giờ.
 */
export const PAYMENT_LINK_GRACE_SECONDS = 300;

/**
 * Lý do chưa có link thanh toán của Đơn có phí (`BuyerOrderView.payment.linkError`):
 * - `provider_error`: Tingee từ chối bằng mã thường; Đơn vẫn `pending`, thử lại được cho cùng Đơn trong hạn Giữ chỗ.
 * - `sales_paused`: dịch vụ thanh toán của BTC đang tạm ngừng (merchant bị khóa, key không còn dùng được, tài khoản
 *   nhận tiền chưa được cho phép trên Cổng thanh toán) hoặc BTC không còn tài khoản nhận tiền mặc định; Đơn `expired`.
 * - `timeout`: kết quả mơ hồ (timeout, lỗi mạng, phản hồi lạ); Đơn `expired`, không thử lại cùng Đơn.
 */
export const PaymentLinkError = {
  PROVIDER_ERROR: 'provider_error',
  SALES_PAUSED: 'sales_paused',
  TIMEOUT: 'timeout',
} as const;
export type PaymentLinkError = (typeof PaymentLinkError)[keyof typeof PaymentLinkError];
export const PAYMENT_LINK_ERRORS = Object.values(PaymentLinkError) as [PaymentLinkError, ...PaymentLinkError[]];
export const paymentLinkErrorSchema = z.enum(PaymentLinkError);

/**
 * API thử lại tạo link thanh toán cho cùng Đơn (`POST /v1/me/orders/:code/payment-link`, Story 3.4), tương đối với gốc
 * `/v1` như mọi đường dẫn web gọi qua `apiRequest`.
 */
export const buyerOrderApiPath = (code: string): string => `/me/orders/${encodeURIComponent(code)}`;
export const paymentLinkApiPath = (code: string): string => `${buyerOrderApiPath(code)}/payment-link`;
/**
 * Luồng SSE của một Đơn (`GET /v1/me/orders/:code/live`, Story 3.7): cùng phiên và phép sở hữu với
 * `buyerOrderApiPath`; chỉ đẩy tín hiệu `{ type }` (`RealtimeStreamMessage`) khi Đơn đổi, web tự tải lại REST.
 */
export const buyerOrderLiveApiPath = (code: string): string => `${buyerOrderApiPath(code)}/live`;

/**
 * Header chống trùng của `POST /v1/events/:slug/orders` (AD-31): một uuid cho mỗi lần mở Checkout. Gửi lại cùng khóa
 * (kể cả hai request song song) trả về Đơn đã tạo, không giữ thêm chỗ.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKey = z.uuid();

/** Tên Người mua: bỏ khoảng trắng hai đầu, 1–100 ký tự. */
export const BUYER_NAME_MAX = 100;
export const BuyerName = z.string().trim().min(1).max(BUYER_NAME_MAX);

/** SĐT Người mua dạng lưu duy nhất E.164 của Việt Nam: `+84` + 9 số, số đầu khác 0. */
export const BUYER_PHONE_PATTERN = /^\+84[1-9]\d{8}$/;

/** Bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc; `0` đầu số đổi thành `+84`. `0912.345.678` → `+84912345678`. */
export function normalizeBuyerPhone(raw: string): string {
  const compact = raw.replace(/[\s.()-]+/g, '');
  return compact.startsWith('0') ? `+84${compact.slice(1)}` : compact;
}

/** `+84912345678` → `0912345678` (cách Người mua quen nhập, để tự điền vào ô SĐT). Không phải E.164 → giữ nguyên. */
export function localBuyerPhone(phone: string): string {
  return BUYER_PHONE_PATTERN.test(phone) ? `0${phone.slice(3)}` : phone;
}

/** SĐT Người mua: nhận `0912 345 678`, `0912.345.678`, `+84 912 345 678`… và trả về E.164 `+84912345678`. */
export const BuyerPhone = z.string().transform(normalizeBuyerPhone).pipe(z.string().regex(BUYER_PHONE_PATTERN));

/** Câu trả lời văn bản tối đa chừng này ký tự (sau khi bỏ khoảng trắng hai đầu). */
export const ORDER_ANSWER_TEXT_MAX = 1_000;

/**
 * Câu trả lời form: `questionId` → chữ (câu `text`) hoặc id phương án (câu `choice`). Khóa chuyển về chữ thường (id câu
 * hỏi lưu chữ thường). Chuỗi rỗng (sau trim) là chưa trả lời. Id câu hỏi không có trong form của Sự kiện thì bị bỏ qua
 * (BTC vừa xóa câu đó).
 */
export const OrderAnswers = z
  .record(z.uuid(), z.string().max(ORDER_ANSWER_TEXT_MAX * 2))
  .transform((answers) => Object.fromEntries(Object.entries(answers).map(([id, value]) => [id.toLowerCase(), value])));
export type OrderAnswers = z.infer<typeof OrderAnswers>;

/**
 * `POST /v1/events/:slug/orders` (cần đăng nhập, header `Idempotency-Key`). Email lấy từ tài khoản, không gửi lên.
 * `funnelId`: `f` của lần bấm "Mua" dẫn tới Checkout này (ghi `order_created` của phễu SM-C2).
 */
export const CreateOrderRequest = z.strictObject({
  items: TicketSelection,
  buyer: z.strictObject({ name: BuyerName, phone: BuyerPhone }),
  answers: OrderAnswers.default({}),
  funnelId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});
export type CreateOrderRequest = z.input<typeof CreateOrderRequest>;
export type CreateOrderValues = z.output<typeof CreateOrderRequest>;

/** Lỗi của một câu trả lời: thiếu câu bắt buộc, phương án lạ, hoặc chữ quá dài. */
export type AnswerIssueReason = 'required' | 'invalid_option' | 'too_long';
export interface AnswerIssue {
  questionId: string;
  reason: AnswerIssueReason;
}

type QuestionRef = Pick<FormQuestion, 'id' | 'kind' | 'required' | 'options'>;

const answerOf = (answers: Readonly<Record<string, string>>, questionId: string): string =>
  (answers[questionId] ?? '').trim();

/** Lỗi của câu trả lời theo thứ tự câu hỏi (mỗi câu tối đa một lỗi). Hợp lệ → `[]`. */
export function answerIssues(
  questions: readonly QuestionRef[],
  answers: Readonly<Record<string, string>>,
): AnswerIssue[] {
  const issues: AnswerIssue[] = [];
  for (const q of questions) {
    const value = answerOf(answers, q.id);
    if (value === '') {
      if (q.required) issues.push({ questionId: q.id, reason: 'required' });
      continue;
    }
    if (q.kind === FormQuestionKind.CHOICE) {
      const known = q.options.some((o) => o.id === value.toLowerCase());
      if (!known) issues.push({ questionId: q.id, reason: 'invalid_option' });
    } else if (value.length > ORDER_ANSWER_TEXT_MAX) {
      issues.push({ questionId: q.id, reason: 'too_long' });
    }
  }
  return issues;
}

/** Tổng số Vé của các dòng. */
export const ticketCount = (items: readonly { quantity: number }[]): number =>
  items.reduce((sum, item) => sum + item.quantity, 0);

/**
 * Schema của `POST /v1/events/:slug/orders` cho một Sự kiện: `CreateOrderRequest` thêm tổng Vé ≤ giới hạn Vé/Đơn
 * (lỗi tại `items`), câu bắt buộc có trả lời và câu chọn chọn phương án có thật (lỗi tại `answers.<questionId>`).
 */
export function orderRequestFor(event: { maxTicketsPerOrder: number }, questions: readonly QuestionRef[]) {
  return CreateOrderRequest.superRefine((value, ctx) => {
    if (ticketCount(value.items) > event.maxTicketsPerOrder) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: event.maxTicketsPerOrder,
        inclusive: true,
        path: ['items'],
        message: `Tối đa ${event.maxTicketsPerOrder} vé mỗi Đơn`,
      });
    }
    for (const issue of answerIssues(questions, value.answers)) {
      ctx.addIssue({ code: 'custom', path: ['answers', issue.questionId], message: issue.reason });
    }
  });
}

/** Một câu trả lời đã chụp: nhãn và thứ tự câu hỏi lúc đặt; câu chọn lưu nhãn phương án (và id phương án). */
export interface AnswerSnapshot {
  questionId: string;
  position: number;
  label: string;
  kind: FormQuestionKind;
  answer: string;
  optionId: string | null;
}

/**
 * Bản chụp câu trả lời theo thứ tự câu hỏi (`position` 0, 1, … theo thứ tự đã nhận), bỏ câu không trả lời. Người gọi đã
 * kiểm bằng `answerIssues`: câu chọn có phương án lạ bị bỏ qua.
 */
export function answerSnapshot(
  questions: readonly Pick<FormQuestion, 'id' | 'kind' | 'label' | 'options'>[],
  answers: Readonly<Record<string, string>>,
): AnswerSnapshot[] {
  const snapshot: AnswerSnapshot[] = [];
  questions.forEach((q, position) => {
    const value = answerOf(answers, q.id);
    if (value === '') return;
    if (q.kind === FormQuestionKind.CHOICE) {
      const option = q.options.find((o) => o.id === value.toLowerCase());
      if (!option) return;
      const { label, kind } = q;
      snapshot.push({ questionId: q.id, position, label, kind, answer: option.label, optionId: option.id });
      return;
    }
    snapshot.push({ questionId: q.id, position, label: q.label, kind: q.kind, answer: value, optionId: null });
  });
  return snapshot;
}

/**
 * `GET /v1/events/:slug/checkout` (cần đăng nhập): câu hỏi riêng của form mua theo thứ tự, và phần tự điền. `buyer.name`
 * và `buyer.phone` lấy từ Đơn gần nhất của chính Người mua (không có Đơn: tên của tài khoản nếu có, SĐT `null`);
 * `buyer.email` là email tài khoản, chỉ hiện, không sửa được.
 */
export const CheckoutForm = z.object({
  questions: z.array(FormQuestion),
  buyer: z.object({
    name: z.string(),
    phone: z.string().regex(BUYER_PHONE_PATTERN).nullable(),
    email: z.string(),
  }),
});
export type CheckoutForm = z.infer<typeof CheckoutForm>;

/**
 * Trạng thái Đơn (máy trạng thái AD-3). Story 3.2: tạo `pending`, `pending` → `expired`. Story 3.3: Đơn tổng 0đ đi
 * `pending` → `paid` ngay trong transaction tạo Đơn (`ordering.markPaid`, nguồn `free`).
 */
export const OrderStatus = {
  PENDING: 'pending',
  PAID: 'paid',
  EXPIRED: 'expired',
  REVIEW: 'review',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUSES = Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]];
export const orderStatusSchema = z.enum(OrderStatus);

/** Một dòng của Đơn (bản chụp lúc đặt): tên Hạng vé, giá một Vé, số Vé, thành tiền. */
export const BuyerOrderItem = z.object({
  ticketTypeId: z.uuid(),
  name: z.string(),
  unitPrice: z.number().int().min(0),
  quantity: z.number().int().min(1),
  amount: z.number().int().min(0),
});
export type BuyerOrderItem = z.infer<typeof BuyerOrderItem>;

/**
 * Mã QR vé (AD-16): `t<k>.<ticketId>.<sig>`, `k` là phiên bản khóa ký (số nguyên dương), `ticketId` là uuid chữ thường
 * của Vé, `sig` = base64url (không đệm, 43 ký tự) của HMAC-SHA256(khóa `k`, `t<k>.<ticketId>`). Không chứa PII. Máy
 * chủ tính lại khi đọc (không lưu chuỗi QR hay chữ ký trong DB); kiểm chữ ký là việc của máy chủ (check-in, Epic 5).
 */
export const TICKET_QR_PATTERN =
  /^t[1-9]\d{0,8}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

/**
 * Token link chia sẻ Vé (AD-29, Story 3.8): 16 byte, base64url không đệm (22 ký tự). Link là `sharedTicketUrl` (token sau
 * `#`); máy chủ suy token bằng khóa bí mật, DB chỉ lưu hash.
 */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Một Vé của Đơn đã thanh toán (bản chụp lúc phát Vé, AD-35): `seq`/`count` là "Vé k/N" (đánh theo Hạng vé tăng dần
 * theo id), tên Hạng vé và tên Người mua lúc phát, `qr` là Mã QR vé. `shareToken`: token link chia sẻ hiện hành của Vé
 * (Story 3.8; chỉ có trong response cho chủ Đơn), cùng một giá trị mỗi lần đọc tới khi chủ Vé "Tạo lại link".
 */
export const BuyerTicket = z.object({
  id: z.uuid(),
  seq: z.number().int().min(1),
  count: z.number().int().min(1),
  ticketTypeName: z.string(),
  holderName: z.string(),
  qr: z.string().regex(TICKET_QR_PATTERN),
  shareToken: z.string().regex(SHARE_TOKEN_PATTERN),
});
export type BuyerTicket = z.infer<typeof BuyerTicket>;

/**
 * Người nhận tiền của Đơn (`recipient-trust-block`): tên BTC, tên chủ tài khoản (in hoa như app ngân hàng) và ngân hàng
 * của tài khoản nhận tiền đã chụp lúc gắn link; chưa có link thì của tài khoản mặc định hiện tại; BTC không còn tài
 * khoản nào thì hai trường sau `null`.
 */
export const PaymentRecipient = z.object({
  organizationName: z.string(),
  accountName: z.string().nullable(),
  bankName: z.string().nullable(),
});
export type PaymentRecipient = z.infer<typeof PaymentRecipient>;

/**
 * Phần thanh toán của Đơn có phí (Story 3.4). `checkoutUrl`: trang thanh toán của Tingee (chỉ http/https), chỉ có khi
 * Đơn `pending` và đã có link; web mở bằng redirect toàn trang. `linkError`: lý do lần tạo link gần nhất thất bại
 * (`PaymentLinkError`), `null` khi chưa thất bại hoặc đã có link.
 */
export const BuyerOrderPayment = z.object({
  checkoutUrl: z.url({ protocol: /^https?$/ }).nullable(),
  linkError: paymentLinkErrorSchema.nullable(),
  recipient: PaymentRecipient,
});
export type BuyerOrderPayment = z.infer<typeof BuyerOrderPayment>;

/**
 * Trạng thái Đơn phía Người mua (`BuyerOrderView.buyerStatus`, AD-17, Story 3.7), máy chủ tính từ trạng thái Đơn
 * (`OrderStatus`), giờ máy chủ và Sự kiện; không lộ loại Cần xử lý hay số tiền lệch:
 *
 * | Đơn | Sự kiện | `buyerStatus` |
 * |---|---|---|
 * | `pending`, giờ máy chủ < `expires_at` | bất kỳ | `awaiting_payment` |
 * | `pending`, giờ máy chủ ≥ `expires_at` | bất kỳ | `confirming` |
 * | `expired` | bất kỳ | `expired` |
 * | `paid`/`review`/`cancelled`/`refunded` | đã hủy | `event_cancelled` |
 * | `paid` | chưa hủy | `paid` |
 * | `review` | chưa hủy | `under_review` |
 * | `cancelled`/`refunded` | chưa hủy | `cancelled_by_organizer` |
 */
export const BuyerOrderStatus = {
  AWAITING_PAYMENT: 'awaiting_payment',
  CONFIRMING: 'confirming',
  UNDER_REVIEW: 'under_review',
  PAID: 'paid',
  EXPIRED: 'expired',
  CANCELLED_BY_ORGANIZER: 'cancelled_by_organizer',
  EVENT_CANCELLED: 'event_cancelled',
} as const;
export type BuyerOrderStatus = (typeof BuyerOrderStatus)[keyof typeof BuyerOrderStatus];
export const BUYER_ORDER_STATUSES = Object.values(BuyerOrderStatus) as [BuyerOrderStatus, ...BuyerOrderStatus[]];
export const buyerOrderStatusSchema = z.enum(BuyerOrderStatus);

/** `buyerStatus` có phải một giá trị web biết không (máy chủ mới hơn bản web có thể trả giá trị mới). */
export const isBuyerOrderStatus = (value: string): value is BuyerOrderStatus =>
  (BUYER_ORDER_STATUSES as readonly string[]).includes(value);

/**
 * Kênh liên hệ BTC của Đơn (Story 3.7): tên BTC, SĐT và email liên hệ BTC đã nhập khi tạo BTC (`null` khi BTC không
 * nhập). Trang Đơn hiện khi Người mua cần liên hệ BTC (BTC đang kiểm tra thanh toán, Đơn bị hủy, Sự kiện hủy).
 */
export const BuyerOrderOrganizer = z.object({
  name: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
});
export type BuyerOrderOrganizer = z.infer<typeof BuyerOrderOrganizer>;

/**
 * Đơn của chính Người mua (AD-17): `201`/`200` của `POST /v1/events/:slug/orders`, `GET /v1/me/orders/:code` và `200`
 * của `POST /v1/me/orders/:code/payment-link`. Mọi trường trừ `buyerStatus`, `expiresAt`, `serverNow`, `event`,
 * `payment`, `tickets` và `organizer` là bản chụp lúc đặt (BTC sửa giá, tên Hạng vé, chính sách hoàn vé hay form sau đó
 * không đổi gì ở đây).
 * - `buyerStatus`: `BuyerOrderStatus` theo giờ máy chủ lúc trả lời. Web nhận cả chuỗi lạ (máy chủ mới hơn bản web) để
 *   hiện trạng thái an toàn thay vì lỗi parse; thu hẹp bằng `isBuyerOrderStatus`.
 * - `serverNow`: giờ của máy chủ lúc trả lời, để web đếm ngược tới `expiresAt` không theo đồng hồ máy. Đơn 0đ có
 *   `expiresAt` = `createdAt` (không Giữ chỗ).
 * - `event.startsAt`: giờ bắt đầu hiện tại của Sự kiện (thẻ Vé).
 * - `event.ended`: đồng hồ DB đã quá `effective_end_at` của Sự kiện lúc trả lời (AD-14, kể cả BTC bấm "Kết thúc"
 *   sớm). Không có tín hiệu realtime tại mốc kết thúc: trang đang mở chỉ đổi ở lần tải sau.
 * - `payment`: `null` với Đơn tổng 0đ.
 * - `tickets`: các Vé theo `seq` (kèm Mã QR vé và token link chia sẻ), chỉ khi `buyerStatus = paid` và
 *   `event.ended = false`; còn lại rỗng (máy chủ không ký Mã QR vé cho Sự kiện đã kết thúc, FR-24).
 * - `organizer`: tên và kênh liên hệ BTC hiện tại.
 */
export const BuyerOrderView = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  buyerStatus: z.union([buyerOrderStatusSchema, z.string()]),
  event: z.object({ slug: z.string(), name: z.string(), startsAt: EventDateTime, ended: z.boolean() }),
  items: z.array(BuyerOrderItem).min(1),
  totalAmount: z.number().int().min(0),
  buyer: z.object({ name: z.string(), phone: z.string(), email: z.string() }),
  answers: z.array(z.object({ questionId: z.uuid(), label: z.string(), answer: z.string() })),
  refundPolicy: z.string().nullable(),
  createdAt: EventDateTime,
  expiresAt: EventDateTime,
  serverNow: EventDateTime,
  payment: BuyerOrderPayment.nullable(),
  tickets: z.array(BuyerTicket),
  organizer: BuyerOrderOrganizer,
});
export type BuyerOrderView = z.infer<typeof BuyerOrderView>;

/** `details` của `409 TICKET_TYPE_SOLD_OUT`: Hạng vé không còn đủ chỗ (dòng đầu tiên thiếu, theo id tăng dần). */
export const TicketTypeSoldOutDetails = z.object({ ticketTypeId: z.uuid(), ticketTypeName: z.string() });
export type TicketTypeSoldOutDetails = z.infer<typeof TicketTypeSoldOutDetails>;

/**
 * Lý do của `409 NOT_ON_SALE`. Cấp Sự kiện (không có `ticketTypeId`): `cancelled`, `locked`, `ended`, `hidden`. Cấp
 * Hạng vé: `paused` (Tạm ngừng bán), `not_started` (chưa mở bán), `closed` (đã đóng bán, hoặc không còn trong Sự kiện).
 */
export const NotOnSaleReason = {
  CANCELLED: 'cancelled',
  LOCKED: 'locked',
  ENDED: 'ended',
  HIDDEN: 'hidden',
  PAUSED: 'paused',
  NOT_STARTED: 'not_started',
  CLOSED: 'closed',
} as const;
export type NotOnSaleReason = (typeof NotOnSaleReason)[keyof typeof NotOnSaleReason];
export const notOnSaleReasonSchema = z.enum(NotOnSaleReason);

/** `details` của `409 NOT_ON_SALE`. */
export const NotOnSaleDetails = z.object({
  ticketTypeId: z.uuid().optional(),
  reason: notOnSaleReasonSchema,
});
export type NotOnSaleDetails = z.infer<typeof NotOnSaleDetails>;

/** `details` của `409 PENDING_ORDER_EXISTS`: mã Đơn đang chờ của chính Người mua cho Sự kiện này. */
export const PendingOrderExistsDetails = z.object({ code: z.string().regex(ORDER_CODE_PATTERN) });
export type PendingOrderExistsDetails = z.infer<typeof PendingOrderExistsDetails>;

/**
 * Câu báo của `409 FREE_TICKET_LIMIT_REACHED`: Đơn tổng 0đ làm tổng Vé của Người mua trong các Đơn `paid` tổng 0đ của
 * Sự kiện vượt giới hạn Vé/Đơn (Vé có phí không tính).
 */
export const FREE_TICKET_LIMIT_MESSAGE = 'Bạn đã nhận đủ số Vé tối đa cho Sự kiện này.';

/** `details` của `429 ORDER_RATE_LIMITED`. */
export const OrderRateLimitedDetails = z.object({ retryAfterSeconds: z.number().int().positive() });
export type OrderRateLimitedDetails = z.infer<typeof OrderRateLimitedDetails>;

/**
 * Giới hạn tốc độ tạo Đơn, đếm trong Postgres (mọi lần thử tới được TX1, trừ lần trả lại Đơn cũ theo khóa; Story 3.4:
 * cộng mọi lần thử lại tạo link thanh toán cho Đơn đã có — `POST /v1/me/orders/:code/payment-link` hay gửi lại cùng khóa
 * khi Đơn chưa có link mà còn lượt). Theo tài
 * khoản là giới hạn chính; theo IP chỉ là lưới chặn cuối, nới rộng vì CGNAT của nhà mạng di động dồn nhiều Người mua vào
 * một IP (kịch bản NFR-3: 5.000 người tranh 300 vé, mỗi lần báo hết vé vẫn bị đếm).
 */
export const ORDER_RATE_LIMITS = {
  windowSeconds: 600,
  perUser: 10,
  perIp: 600,
} as const;
