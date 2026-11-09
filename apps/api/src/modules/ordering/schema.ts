import { FUNNEL_EVENT_TYPES } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { events, ticketTypes } from '../event/schema.js';

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
 * Phễu mua (Story 3.1, đo SM-C2): `buy_clicked` khi bấm "Mua", `login_completed` khi tới Checkout sau khi đăng nhập.
 * Không PII, không `user_id`: hai sự kiện chỉ nối với nhau bằng `funnel_id` (uuid do trình duyệt sinh lúc bấm "Mua").
 * `login_required` chỉ có ở `buy_clicked` (lúc bấm đã đăng nhập sẵn thì không tính vào mẫu số). Chỉ INSERT: role
 * `tickee_app` bị thu UPDATE/DELETE (`APPEND_ONLY_TABLES`). Unique `(funnel_id, type)`: gửi trùng không thêm dòng.
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
    check('checkout_funnel_events_type_check', sql`${t.type} IN ('buy_clicked', 'login_completed')`),
    check(
      'checkout_funnel_events_login_required_check',
      sql`(${t.type} = 'buy_clicked') = (${t.loginRequired} IS NOT NULL)`,
    ),
  ],
);
