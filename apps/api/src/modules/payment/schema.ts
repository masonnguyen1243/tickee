import { REVIEW_ITEM_REASONS, REVIEW_ITEM_RESOLUTIONS, REVIEW_ITEM_STATUSES, REVIEW_ITEM_TYPES } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { orders } from '../ordering/schema.js';
import { organizations } from '../organizer/schema.js';

/**
 * Loại sự kiện thanh toán: `payment` — Tingee báo tiền về (`status = 'success'`); `status` — mọi trạng thái khác của
 * đơn Gateway (`expired`, `canceled`, trạng thái lạ).
 */
export const PAYMENT_EVENT_KINDS = ['payment', 'status'] as const;
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];

/**
 * Sự kiện thanh toán nhận từ Tingee (Story 3.5, AD-7): mỗi IPN hợp lệ (đã qua chữ ký), hoặc mỗi kết quả tra trạng thái
 * của Đối soát bù (Story 4.1, `success`/`expired`/`canceled`; kết quả "chưa trả" không lưu), đúng một dòng, chỉ các
 * trường trong whitelist. IPN và kết quả tra cùng khóa chống lặp là một dòng. Không bao giờ lưu `description`,
 * `orderInfo` (nội dung tự do) hay `customerEmail` (PII của người trả). Chỉ INSERT/SELECT (`APPEND_ONLY_TABLES`).
 *
 * - `organization_id`: BTC sở hữu `ipnKey` của URL nhận IPN (luôn có).
 * - `order_id`: Đơn có mã `provider_order_id` thuộc chính BTC đó; `null` khi mã sai dạng, không có Đơn, hoặc Đơn thuộc BTC
 *   khác (IPN lạc: chỉ lưu, không phát Vé).
 * - Chống lặp theo BTC: `(organization_id, provider_transaction_code)` cho `payment`, `(organization_id,
 *   provider_order_id, status)` cho `status`. Khóa có `organization_id` để một BTC (tự ký được IPN bằng secret của mình)
 *   không chiếm trước mã giao dịch thật của BTC khác. Trùng khóa → IPN lặp: trả `00`, không làm gì thêm.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    orderId: uuid('order_id').references(() => orders.id),
    kind: text('kind', { enum: PAYMENT_EVENT_KINDS }).notNull(),
    /** `status` của IPN (`success`, `expired`, `canceled`, …), nguyên văn. */
    status: text('status').notNull(),
    /** `orderId` của IPN: mã Đơn Tickee gửi lúc tạo link (hoặc mã bất kỳ khi BTC dùng Tingee cho việc khác). */
    providerOrderId: text('provider_order_id').notNull(),
    /** `providerTransactionCode`: mã giao dịch của Tingee; bắt buộc với `payment`. */
    providerTransactionCode: text('provider_transaction_code'),
    amount: bigint('amount', { mode: 'number' }),
    paidAmount: bigint('paid_amount', { mode: 'number' }),
    /** Lúc Tingee báo tiền về (`paidAt`). */
    paidAt: timestamptz('paid_at'),
    statusCode: text('status_code'),
    paymentMethod: text('payment_method'),
    billId: text('bill_id'),
    merchantId: text('merchant_id'),
    requestId: text('request_id'),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_events_payment_transaction_key')
      .on(t.organizationId, t.providerTransactionCode)
      .where(sql`${t.kind} = 'payment'`),
    uniqueIndex('payment_events_status_order_key')
      .on(t.organizationId, t.providerOrderId, t.status)
      .where(sql`${t.kind} = 'status'`),
    index('payment_events_order_id_idx').on(t.orderId),
    check('payment_events_kind_check', sql`${t.kind} IN ('payment', 'status')`),
    check('payment_events_kind_status_check', sql`(${t.kind} = 'payment') = (${t.status} = 'success')`),
    check(
      'payment_events_transaction_code_check',
      sql`${t.kind} <> 'payment' OR ${t.providerTransactionCode} IS NOT NULL`,
    ),
  ],
);

/**
 * Mục Cần xử lý (Story 3.6, AD-7): mỗi khoản tiền về (`payment_events` loại `payment`) không thành Vé là đúng một mục,
 * tạo trong cùng transaction với event. Ngoại lệ: mã Đơn sai định dạng (chỉ lưu), và kết quả tra của Đối soát bù cho
 * Đơn đã chốt (`already_settled`, Story 4.1: dòng gắn Đơn, không Vé, không mục; là lần hỏi lại khoản tiền đã ghi nhận). `payment` sở hữu; hàng Cần xử lý (Story 4.3) và duyệt/từ chối/đánh dấu đã hoàn
 * (Story 4.4) đọc và ghi bảng này.
 *
 * - `organization_id`: BTC sở hữu `ipnKey` của IPN (luôn có); bằng BTC của Đơn khi có Đơn (IPN chỉ gắn Đơn của chính
 *   BTC đó).
 * - `order_id`: `null` đúng khi loại `unmatched` (không có Đơn, hoặc Đơn thuộc BTC khác: không gắn Đơn của BTC kia).
 * - `payment_event_id`: khoản tiền của mục; unique (một khoản tiền một mục).
 * - `reason`: chỉ loại `orphan`, và bắt buộc với loại đó (`REVIEW_ITEM_REASONS`).
 * - `resolution`: có đúng khi `status = 'resolved'`; `event_cancelled`/`duplicate_payment`/`unmatched` chỉ
 *   `refunded`/`dismissed` (không phát Vé).
 * - Unique một phần `(order_id, type) WHERE status = 'open' AND type IN ('amount_mismatch', 'orphan')`: hai loại này đưa
 *   Đơn vào `review`, nên khoản tiền sau cho cùng Đơn đã là `duplicate_payment`. `event_cancelled` và
 *   `duplicate_payment` không unique theo Đơn: mỗi khoản tiền một mục, BTC hoàn đủ từng khoản.
 *
 * `tickee_app` chỉ UPDATE được `status`, `resolution` (`UPDATE_PROTECTED_COLUMNS`).
 */
export const reviewItems = pgTable(
  'review_items',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    orderId: uuid('order_id').references(() => orders.id),
    paymentEventId: uuid('payment_event_id')
      .notNull()
      .references(() => paymentEvents.id),
    type: text('type', { enum: REVIEW_ITEM_TYPES }).notNull(),
    reason: text('reason', { enum: REVIEW_ITEM_REASONS }),
    status: text('status', { enum: REVIEW_ITEM_STATUSES }).notNull().default('open'),
    resolution: text('resolution', { enum: REVIEW_ITEM_RESOLUTIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_items_payment_event_id_key').on(t.paymentEventId),
    uniqueIndex('review_items_open_order_type_key')
      .on(t.orderId, t.type)
      .where(sql`${t.status} = 'open' AND ${t.type} IN ('amount_mismatch', 'orphan')`),
    index('review_items_organization_id_status_created_at_idx').on(t.organizationId, t.status, t.createdAt),
    index('review_items_order_id_idx').on(t.orderId),
    check(
      'review_items_type_check',
      sql`${t.type} IN ('amount_mismatch', 'orphan', 'event_cancelled', 'duplicate_payment', 'unmatched')`,
    ),
    check('review_items_order_check', sql`(${t.type} = 'unmatched') = (${t.orderId} IS NULL)`),
    check(
      'review_items_reason_check',
      sql`(${t.type} = 'orphan') = (${t.reason} IS NOT NULL) AND (${t.reason} IS NULL OR ${t.reason} IN ('event_ended', 'event_locked', 'sold_out'))`,
    ),
    check('review_items_status_check', sql`${t.status} IN ('open', 'resolved')`),
    check(
      'review_items_resolution_check',
      sql`(${t.status} = 'resolved') = (${t.resolution} IS NOT NULL) AND (${t.resolution} IS NULL OR ${t.resolution} IN ('approved', 'rejected', 'refunded', 'dismissed'))`,
    ),
    check(
      'review_items_refund_only_check',
      sql`${t.type} NOT IN ('event_cancelled', 'duplicate_payment', 'unmatched') OR ${t.resolution} IS NULL OR ${t.resolution} IN ('refunded', 'dismissed')`,
    ),
  ],
);
