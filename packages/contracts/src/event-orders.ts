import { z } from 'zod';

import { CHECKIN_LOOKUP_QUERY_MAX, parseLookupQuery, type LookupQuery } from './checkin.js';
import { EventDateTime } from './event.js';
import { ORDER_CODE_PATTERN, orderCancelReasonSchema, orderStatusSchema } from './order.js';
import { reviewItemTypeSchema } from './payment.js';
import { RecentOrderReview } from './reporting.js';

// ---------------------------------------------------------------------------------------------------------------
// Tab Đơn của Sự kiện (Story 6.1, FR-31, UX-DR37): danh sách lọc ở server, phân trang `cursor` + `limit`, chi tiết Đơn
// ---------------------------------------------------------------------------------------------------------------

/*
 * Chỗ dùng đầu tiên của quy ước phân trang `cursor` + `limit` (spine): `cursor` là chuỗi mờ (base64url), người gọi chỉ
 * gửi lại nguyên văn `nextCursor` của trang trước; không đếm tổng, không cuộn vô hạn. Chỉ Owner và Admin (`orders.view`).
 * Response không bao giờ có id nội bộ, Mã QR vé, token chia sẻ hay id lần quét. CSV (Story 6.3) dùng lại bộ lọc và cursor
 * ở đây.
 */

/** Số Đơn mỗi trang mặc định và tối đa. */
export const EVENT_ORDERS_PAGE_LIMIT = 50;
export const EVENT_ORDERS_PAGE_LIMIT_MAX = 100;

/** Ô tìm của tab Đơn dài tối đa chừng này ký tự (như tra tay: email dài nhất 254 ký tự). */
export const EVENT_ORDERS_SEARCH_MAX = CHECKIN_LOOKUP_QUERY_MAX;

/**
 * Bộ lọc trạng thái của tab Đơn (chip): Đã thanh toán, Chờ thanh toán, Cần xử lý, Đã hủy, Đã hoàn tay. `needs_action`
 * không phải trạng thái Đơn: Đơn của Sự kiện có ít nhất một mục Cần xử lý `open`, ở mọi trạng thái Đơn (vd. Đơn `paid` bị
 * trả trùng), cùng cách `needs-action-card` đếm. Không có bộ lọc "Hết hạn": Đơn hết hạn chỉ hiện khi không lọc.
 */
export const EventOrderFilter = {
  PAID: 'paid',
  PENDING: 'pending',
  NEEDS_ACTION: 'needs_action',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;
export type EventOrderFilter = (typeof EventOrderFilter)[keyof typeof EventOrderFilter];
export const EVENT_ORDER_FILTERS = Object.values(EventOrderFilter) as [EventOrderFilter, ...EventOrderFilter[]];
export const eventOrderFilterSchema = z.enum(EventOrderFilter);

/** Giá trị tìm đã chuẩn hóa: mã Đơn (viết hoa), hoặc SĐT E.164 / email chữ thường như tra tay (`parseLookupQuery`). */
export type OrderSearch = { kind: 'code'; code: string } | LookupQuery;

/**
 * Phân loại và chuẩn hóa chữ trong ô tìm của tab Đơn, dùng chung web (chỉ gửi khi nhận ra) và api (kiểm lại): bỏ khoảng
 * trắng hai đầu; viết hoa mà khớp `ORDER_CODE_PATTERN` → mã Đơn (`tk1234abcd` → `TK1234ABCD`); còn lại theo
 * `parseLookupQuery` (email chữ thường, SĐT E.164). Không nhận ra (rỗng, quá dài, SĐT/email chưa đủ, tên) → `null`:
 * chỉ khớp đầy đủ, không khớp một phần.
 */
export function parseOrderSearch(raw: string): OrderSearch | null {
  if (raw.length > EVENT_ORDERS_SEARCH_MAX) return null;
  const trimmed = raw.trim();
  const code = trimmed.toUpperCase();
  if (ORDER_CODE_PATTERN.test(code)) return { kind: 'code', code };
  return parseLookupQuery(trimmed);
}

// ---------------------------------------------------------------------------------------------------------------
// Cursor của danh sách: (created_at đủ micro giây, mã Đơn) của Đơn cuối trang
// ---------------------------------------------------------------------------------------------------------------

/**
 * Vị trí keyset của một Đơn: `createdAt` là `created_at` dạng ISO UTC đủ 6 chữ số micro giây (`Date` của JS chỉ tới mili
 * giây, nên không đi qua `Date`: Đơn cùng mili giây ở ranh giới trang không mất, không lặp), `code` là mã Đơn. Không chứa
 * id nội bộ.
 */
export interface EventOrderCursorValue {
  createdAt: string;
  code: string;
}

const CURSOR_CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CURSOR_SEPARATOR = '|';
/** Cursor mã hóa dài chừng 60 ký tự; giới hạn rộng hơn để chuỗi lạ bị chặn trước khi giải mã. */
export const EVENT_ORDERS_CURSOR_MAX = 200;

const toBase64Url = (text: string): string => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromBase64Url(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
}

/**
 * `createdAt` là một thời điểm có thật (vd. không phải 30/02): so lại phần giây với chính nó sau khi qua `Date`. Năm
 * `0000` bị loại: `Date` của JS nhận nhưng Postgres từ chối (`timestamptz` không có năm 0).
 */
function isRealInstant(createdAt: string): boolean {
  if (createdAt.startsWith('0000')) return false;
  const ms = Date.parse(`${createdAt.slice(0, 23)}Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === createdAt.slice(0, 19);
}

/** Mã hóa vị trí keyset thành cursor mờ (base64url, không đệm). */
export function encodeEventOrderCursor(value: EventOrderCursorValue): string {
  return toBase64Url(`${value.createdAt}${CURSOR_SEPARATOR}${value.code}`);
}

/** Giải mã cursor; sai dạng (không phải base64url, thời điểm hay mã Đơn lạ) → `null`. */
export function decodeEventOrderCursor(cursor: string): EventOrderCursorValue | null {
  if (cursor.length > EVENT_ORDERS_CURSOR_MAX) return null;
  const decoded = fromBase64Url(cursor);
  if (decoded === null) return null;
  const parts = decoded.split(CURSOR_SEPARATOR);
  if (parts.length !== 2) return null;
  const [createdAt, code] = parts as [string, string];
  if (!CURSOR_CREATED_AT.test(createdAt) || !isRealInstant(createdAt) || !ORDER_CODE_PATTERN.test(code)) return null;
  return { createdAt, code };
}

/** Cursor trên query: chuỗi mờ → vị trí keyset; hỏng → lỗi (`400 VALIDATION_FAILED`). */
export const EventOrderCursor = z
  .string()
  .max(EVENT_ORDERS_CURSOR_MAX)
  .transform((raw, ctx) => {
    const value = decodeEventOrderCursor(raw);
    if (value) return value;
    ctx.addIssue({ code: 'custom', message: 'Cursor không hợp lệ.' });
    return z.NEVER;
  });

/**
 * Query của `GET /v1/orgs/:orgId/events/:eventId/orders`: `status` (chip), `q` (ô tìm, qua `parseOrderSearch`; không
 * nhận ra → `400 VALIDATION_FAILED`), `cursor` (`nextCursor` của trang trước), `limit` 1–100 (mặc định 50). Có cả
 * `status` lẫn `q` thì lấy giao.
 */
export const EventOrderListQuery = z.object({
  status: eventOrderFilterSchema.optional(),
  q: z
    .string()
    .max(EVENT_ORDERS_SEARCH_MAX)
    .transform((raw, ctx) => {
      const search = parseOrderSearch(raw);
      if (search) return search;
      ctx.addIssue({ code: 'custom', message: 'Nhập mã Đơn, email hoặc SĐT đầy đủ.' });
      return z.NEVER;
    })
    .optional(),
  cursor: EventOrderCursor.optional(),
  limit: z.coerce.number().int().min(1).max(EVENT_ORDERS_PAGE_LIMIT_MAX).default(EVENT_ORDERS_PAGE_LIMIT),
});
export type EventOrderListQuery = z.input<typeof EventOrderListQuery>;
export type EventOrderListValues = z.output<typeof EventOrderListQuery>;

// ---------------------------------------------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------------------------------------------

/** Một dòng của Đơn (bản chụp lúc đặt): tên Hạng vé và số Vé. */
export const EventOrderItem = z.object({
  ticketTypeName: z.string(),
  quantity: z.number().int().min(1),
});
export type EventOrderItem = z.infer<typeof EventOrderItem>;

/**
 * Một Đơn của tab Đơn (mọi trạng thái): mã Đơn, Người mua (bản chụp lúc đặt: tên, email, SĐT E.164), các dòng theo Hạng
 * vé, tổng tiền, tiền đã nhận (`paidAmount`, có khi đã thanh toán), trạng thái, lúc tạo, lúc thanh toán, và `review`:
 * mục Cần xử lý `open` cũ nhất của Đơn (loại, số tiền nhận) ở mọi trạng thái Đơn (vd. trả trùng cho Đơn `paid`), không
 * có thì `null`. Không có id nội bộ.
 */
export const EventOrderRow = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  buyerName: z.string(),
  buyerEmail: z.string(),
  buyerPhone: z.string(),
  items: z.array(EventOrderItem),
  totalAmount: z.number().int().nonnegative(),
  paidAmount: z.number().int().nonnegative().nullable(),
  status: orderStatusSchema,
  createdAt: EventDateTime,
  paidAt: EventDateTime.nullable(),
  review: RecentOrderReview.nullable(),
});
export type EventOrderRow = z.infer<typeof EventOrderRow>;

/**
 * `GET /v1/orgs/:orgId/events/:eventId/orders` (Owner, Admin: `orders.view`; `no-store`): Đơn của Sự kiện khớp bộ lọc,
 * mới nhất trước (lúc tạo rồi mã Đơn, giảm dần), tối đa `limit`. `nextCursor`: còn trang sau thì gửi lại ở `cursor`,
 * hết thì `null`.
 */
export const EventOrderPage = z.object({
  orders: z.array(EventOrderRow).max(EVENT_ORDERS_PAGE_LIMIT_MAX),
  nextCursor: z.string().min(1).nullable(),
});
export type EventOrderPage = z.infer<typeof EventOrderPage>;

// ---------------------------------------------------------------------------------------------------------------
// Chi tiết
// ---------------------------------------------------------------------------------------------------------------

/** Nguồn ghi nhận thanh toán (`orders.paid_source`): IPN, Đối soát bù, BTC duyệt tay, Đơn 0đ. */
export const OrderPaidSource = {
  IPN: 'ipn',
  RECONCILIATION: 'reconciliation',
  MANUAL: 'manual',
  FREE: 'free',
} as const;
export type OrderPaidSource = (typeof OrderPaidSource)[keyof typeof OrderPaidSource];
export const orderPaidSourceSchema = z.enum(OrderPaidSource);

/** Câu trả lời form của Đơn: nhãn câu hỏi lúc đặt (kể cả câu đã bị xóa sau đó) và câu trả lời. */
export const EventOrderAnswer = z.object({ label: z.string(), answer: z.string() });
export type EventOrderAnswer = z.infer<typeof EventOrderAnswer>;

/** Trạng thái Vé: `valid` (check-in là `checkedInAt`, không phải trạng thái) hoặc `cancelled` (kèm `cancelReason`). */
export const EventOrderTicketStatus = { VALID: 'valid', CANCELLED: 'cancelled' } as const;
export type EventOrderTicketStatus = (typeof EventOrderTicketStatus)[keyof typeof EventOrderTicketStatus];

/** Lý do hủy Vé: Sự kiện bị hủy (Story 7.1) hoặc Vé bị vô hiệu (Story 7.5). */
export const EventOrderTicketCancelReason = { EVENT_CANCELLED: 'event_cancelled', VOIDED: 'voided' } as const;
export type EventOrderTicketCancelReason =
  (typeof EventOrderTicketCancelReason)[keyof typeof EventOrderTicketCancelReason];

/**
 * Một Vé của Đơn (bản chụp lúc phát): "Vé k/N" (`seq`/`orderTicketCount`), Hạng vé, tên Người mua, trạng thái, lý do hủy
 * và lúc check-in. Không bao giờ có Mã QR vé, token chia sẻ hay id.
 */
export const EventOrderTicket = z.object({
  seq: z.number().int().min(1),
  orderTicketCount: z.number().int().min(1),
  ticketTypeName: z.string(),
  holderName: z.string(),
  status: z.enum(EventOrderTicketStatus),
  cancelReason: z.enum(EventOrderTicketCancelReason).nullable(),
  checkedInAt: EventDateTime.nullable(),
});
export type EventOrderTicket = z.infer<typeof EventOrderTicket>;

/**
 * Loại mục lịch sử Đơn, dựng từ dữ liệu sẵn có (không có bảng lịch sử riêng):
 * - `created`: lúc tạo Đơn;
 * - `review_opened`: mỗi mục Cần xử lý của Đơn (mọi trạng thái của mục), lúc mở mục, kèm loại;
 * - `paid`: lúc thanh toán (`paid_at`), kèm nguồn;
 * - `expired`: chỉ khi Đơn đang `expired`, mốc sớm hơn giữa hạn Giữ chỗ (`expires_at`) và lúc Đơn đổi gần nhất (Đơn hết
 *   hạn sớm theo IPN không đổi `expires_at`);
 * - `cancelled` / `refunded`: lúc BTC từ chối / bấm "Đã hoàn tay" (audit của Đơn); không có audit (vd. hủy Sự kiện) thì
 *   lúc Đơn đổi gần nhất.
 * Không ghi người thao tác.
 */
export const EventOrderHistoryKind = {
  CREATED: 'created',
  REVIEW_OPENED: 'review_opened',
  PAID: 'paid',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;
export type EventOrderHistoryKind = (typeof EventOrderHistoryKind)[keyof typeof EventOrderHistoryKind];

/** Một mục lịch sử Đơn: loại, lúc xảy ra, kèm loại Cần xử lý (`review_opened`) hoặc nguồn thanh toán (`paid`). */
export const EventOrderHistoryEntry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(EventOrderHistoryKind.CREATED), at: EventDateTime }),
  z.object({ kind: z.literal(EventOrderHistoryKind.REVIEW_OPENED), at: EventDateTime, reviewType: reviewItemTypeSchema }),
  z.object({ kind: z.literal(EventOrderHistoryKind.PAID), at: EventDateTime, paidSource: orderPaidSourceSchema }),
  z.object({ kind: z.literal(EventOrderHistoryKind.EXPIRED), at: EventDateTime }),
  z.object({ kind: z.literal(EventOrderHistoryKind.CANCELLED), at: EventDateTime }),
  z.object({ kind: z.literal(EventOrderHistoryKind.REFUNDED), at: EventDateTime }),
]);
export type EventOrderHistoryEntry = z.infer<typeof EventOrderHistoryEntry>;

/**
 * `GET /v1/orgs/:orgId/events/:eventId/orders/:code` (Owner, Admin: `orders.view`; `no-store`): các trường của dòng, thêm
 * nguồn thanh toán, lý do hủy, câu trả lời form (theo vị trí lúc đặt), Vé (theo `seq`) và lịch sử (cũ trước). Mã Đơn được
 * trim rồi viết hoa; mã sai dạng, không có, hoặc của Sự kiện/BTC khác → `404 ORDER_NOT_FOUND`; Sự kiện lạ → `404
 * EVENT_NOT_FOUND` (kiểm trước mã Đơn).
 */
export const EventOrderDetail = EventOrderRow.extend({
  paidSource: orderPaidSourceSchema.nullable(),
  cancelReason: orderCancelReasonSchema.nullable(),
  answers: z.array(EventOrderAnswer),
  tickets: z.array(EventOrderTicket),
  history: z.array(EventOrderHistoryEntry),
});
export type EventOrderDetail = z.infer<typeof EventOrderDetail>;

// ---------------------------------------------------------------------------------------------------------------
// Đường API (sau `/v1`)
// ---------------------------------------------------------------------------------------------------------------

/** Tham số của `eventOrdersApiPath`: `q` là chữ người dùng gõ (api tự chuẩn hóa), `cursor` là `nextCursor` nguyên văn. */
export interface EventOrdersPathQuery {
  status?: EventOrderFilter;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Đường API của danh sách Đơn một Sự kiện, kèm query (bỏ tham số không có). */
export function eventOrdersApiPath(organizationId: string, eventId: string, query: EventOrdersPathQuery = {}): string {
  const base = `/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/orders`;
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.q !== undefined) params.set('q', query.q);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/** Đường API của chi tiết một Đơn. */
export const eventOrderApiPath = (organizationId: string, eventId: string, code: string): string =>
  `${eventOrdersApiPath(organizationId, eventId)}/${encodeURIComponent(code)}`;
