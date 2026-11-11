import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz } from '../../platform/db/index.js';
import { orders } from '../ordering/schema.js';
import { organizations } from '../organizer/schema.js';

/**
 * Loại sự kiện thanh toán: `payment` — Tingee báo tiền về (`status = 'success'`); `status` — mọi trạng thái khác của
 * đơn Gateway (`expired`, `canceled`, trạng thái lạ).
 */
export const PAYMENT_EVENT_KINDS = ['payment', 'status'] as const;
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];

/**
 * Sự kiện thanh toán nhận từ Tingee (Story 3.5, AD-7): mỗi IPN hợp lệ (đã qua chữ ký) đúng một dòng, chỉ các trường
 * trong whitelist. Không bao giờ lưu `description`, `orderInfo` (nội dung tự do) hay `customerEmail` (PII của người trả).
 * Chỉ INSERT/SELECT (`APPEND_ONLY_TABLES`).
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
