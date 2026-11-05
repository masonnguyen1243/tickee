import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../../platform/db/index.js';
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
