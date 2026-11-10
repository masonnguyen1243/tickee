import { FUNNEL_EVENT_TYPES, ORDER_STATUSES } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { events, ticketTypes } from '../event/schema.js';
import { organizations } from '../organizer/schema.js';

/**
 * Tồn kho của một Hạng vé (Story 2.8, AD-2): `capacity` (số suất), `sold` (đã bán), `held` (đang Giữ chỗ). Chỉ
 * `ordering` ghi. CHECK `sold + held <= capacity` để DB chặn bán vượt kể cả khi tầng ứng dụng có lỗi. `event_id` lặp lại
 * từ `ticket_types` để khóa mọi dòng tồn kho của một Sự kiện (`ORDER BY ticket_type_id FOR UPDATE`) mà không cần join
 * sang bảng của `event`.
 */
export const ticketTypeInventory = pgTable(
  'ticket_type_inventory',
  {
    ticketTypeId: uuid('ticket_type_id')
      .primaryKey()
      .references(() => ticketTypes.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    capacity: integer('capacity').notNull(),
    sold: integer('sold').notNull().default(0),
    held: integer('held').notNull().default(0),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('ticket_type_inventory_event_id_idx').on(t.eventId),
    check(
      'ticket_type_inventory_counts_check',
      sql`${t.held} >= 0 AND ${t.sold} >= 0 AND ${t.sold} + ${t.held} <= ${t.capacity}`,
    ),
  ],
);

/**
 * Phễu mua (Story 3.1, đo SM-C2): `buy_clicked` khi bấm "Mua", `login_completed` khi tới Checkout sau khi đăng nhập,
 * `order_created` khi Đơn được tạo (Story 3.2, ghi trong TX1). Không PII, không `user_id`: các sự kiện chỉ nối với nhau
 * bằng `funnel_id` (uuid do trình duyệt sinh lúc bấm "Mua"). `login_required` chỉ có ở `buy_clicked` (lúc bấm đã đăng
 * nhập sẵn thì không tính vào mẫu số). Chỉ INSERT: role `tickee_app` bị thu UPDATE/DELETE (`APPEND_ONLY_TABLES`). Unique
 * `(funnel_id, type)`: gửi trùng không thêm dòng.
 */
export const checkoutFunnelEvents = pgTable(
  'checkout_funnel_events',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    type: text('type', { enum: FUNNEL_EVENT_TYPES }).notNull(),
    funnelId: uuid('funnel_id').notNull(),
    loginRequired: boolean('login_required'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('checkout_funnel_events_funnel_id_type_key').on(t.funnelId, t.type),
    index('checkout_funnel_events_event_id_created_at_idx').on(t.eventId, t.createdAt),
    check('checkout_funnel_events_type_check', sql`${t.type} IN ('buy_clicked', 'login_completed', 'order_created')`),
    check(
      'checkout_funnel_events_login_required_check',
      sql`(${t.type} = 'buy_clicked') = (${t.loginRequired} IS NOT NULL)`,
    ),
  ],
);

/**
 * Đơn (Story 3.2, AD-3, AD-31): mã `TK` + 8 Crockford base32, Người mua (`user_id`, không FK: `ordering` không phụ
 * thuộc `identity`), Sự kiện, trạng thái (máy trạng thái CAS `WHERE status = :from`) và hạn Giữ chỗ (`expires_at`).
 * Bản chụp bất biến lúc đặt (TX1): tổng tiền tính ở server, tên, SĐT (E.164), email, chính sách hoàn vé; `tickee_app`
 * không UPDATE được các cột này (`UPDATE_PROTECTED_COLUMNS`). Cột ghi được sau khi tạo: `status`, `payment_link`
 * (Story 3.4), `expires_at`, `updated_at`.
 *
 * Unique: `code`; `(user_id, idempotency_key)` (gửi lại cùng khóa trả Đơn đã có); một phần `(user_id, event_id) WHERE
 * status = 'pending'` (tối đa một Đơn chờ mỗi Người mua mỗi Sự kiện). `funnel_id`: `f` của lần bấm "Mua" dẫn tới Đơn.
 */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    code: text('code').notNull(),
    userId: uuid('user_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending'),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerPhone: text('buyer_phone').notNull(),
    buyerEmail: text('buyer_email').notNull(),
    refundPolicy: text('refund_policy'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    funnelId: uuid('funnel_id'),
    /** Link thanh toán Gateway (Story 3.4, TX2). `NULL` = chưa có link: job hết hạn (a) chỉ chạm Đơn chưa có link. */
    paymentLink: text('payment_link'),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('orders_code_key').on(t.code),
    uniqueIndex('orders_user_id_idempotency_key_key').on(t.userId, t.idempotencyKey),
    uniqueIndex('orders_one_pending_per_buyer_event_key').on(t.userId, t.eventId).where(sql`${t.status} = 'pending'`),
    index('orders_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('orders_event_id_created_at_idx').on(t.eventId, t.createdAt),
    check(
      'orders_status_check',
      sql`${t.status} IN ('pending', 'paid', 'expired', 'review', 'cancelled', 'refunded')`,
    ),
    check('orders_code_check', sql`${t.code} ~ '^TK[0-9A-HJKMNP-TV-Z]{8}$'`),
    check('orders_total_amount_check', sql`${t.totalAmount} >= 0`),
  ],
);

/**
 * Dòng của Đơn, bản chụp lúc đặt: tên Hạng vé, giá một Vé (`unit_price`), số Vé. FK tới `ticket_types`: Hạng vé đã có
 * dòng Đơn (kể cả Đơn đã hết hạn) không xóa được (`409 TICKET_TYPE_IN_USE`, không xóa mềm). Chỉ INSERT
 * (`APPEND_ONLY_TABLES`).
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id),
    ticketTypeName: text('ticket_type_name').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('order_items_order_id_ticket_type_id_key').on(t.orderId, t.ticketTypeId),
    index('order_items_ticket_type_id_idx').on(t.ticketTypeId),
    check('order_items_quantity_check', sql`${t.quantity} > 0`),
    check('order_items_unit_price_check', sql`${t.unitPrice} >= 0`),
  ],
);

/**
 * Câu trả lời form mua của Đơn, bản chụp lúc đặt (FR-9): nhãn và thứ tự (`position`) câu hỏi lúc đặt; câu chọn lưu nhãn
 * phương án (`answer`) kèm `option_id`. `question_id` không có FK: BTC xóa câu hỏi sau đó thì câu trả lời vẫn còn.
 * `answer` là PII (`PII_COLUMNS.ordering`). Chỉ INSERT (`APPEND_ONLY_TABLES`).
 */
export const orderAnswers = pgTable(
  'order_answers',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    questionId: uuid('question_id').notNull(),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['text', 'choice'] }).notNull(),
    answer: text('answer').notNull(),
    optionId: uuid('option_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('order_answers_order_id_question_id_key').on(t.orderId, t.questionId),
    check('order_answers_kind_check', sql`${t.kind} IN ('text', 'choice')`),
    check('order_answers_option_check', sql`(${t.kind} = 'choice') = (${t.optionId} IS NOT NULL)`),
  ],
);

/**
 * Bộ đếm giới hạn tốc độ tạo Đơn (Story 3.2): một dòng cho mỗi lần thử tới được TX1, theo `user_id` và HMAC của IP
 * (không lưu IP thô). Dọn dòng cũ là việc của quét định kỳ (deferred, Story 4.6).
 */
export const orderCreateAttempts = pgTable(
  'order_create_attempts',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    ipHmac: text('ip_hmac').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_create_attempts_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('order_create_attempts_ip_hmac_created_at_idx').on(t.ipHmac, t.createdAt),
  ],
);
