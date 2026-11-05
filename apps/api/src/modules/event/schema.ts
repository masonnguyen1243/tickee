import { MAX_TICKETS_PER_ORDER_DEFAULT } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { organizations } from '../organizer/schema.js';

/**
 * Sự kiện của một BTC (FR-6, Story 2.7). `slug` sinh một lần lúc tạo (`slugBase(name)` + `-` + 4 ký tự ngẫu nhiên) và
 * không đổi khi đổi tên. `status` chuyển bằng compare-and-set (`draft` → `published` ↔ `hidden`; `published`/`hidden`
 * → `cancelled`); Story 2.7 chỉ ghi `draft`. "Đã kết thúc" không lưu thành status: luôn tính từ `effective_end_at`
 * (`effectiveEndAt(ends_at)` của contracts, tính lại mỗi lần sửa giờ). Khóa Sự kiện (Epic 7) là trục riêng
 * (`locked_at`, `locked_by`, `lock_reason`), không đụng `status`.
 */
export const events = pgTable(
  'events',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['draft', 'published', 'hidden', 'cancelled'] })
      .notNull()
      .default('draft'),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    effectiveEndAt: timestamptz('effective_end_at').notNull(),
    venue: text('venue'),
    description: text('description'),
    /** Bắt buộc để mở bán (Story 2.10); nháp để trống được. */
    refundPolicy: text('refund_policy'),
    lockedAt: timestamptz('locked_at'),
    /** Quản trị Tingee khóa Sự kiện (Epic 7). Không khai FK: `event` không được phụ thuộc `identity` (AD-10). */
    lockedBy: uuid('locked_by'),
    lockReason: text('lock_reason'),
    /** Giới hạn Vé/Đơn (Story 2.8): mặc định 10, khoảng 1–50. */
    maxTicketsPerOrder: smallint('max_tickets_per_order').notNull().default(MAX_TICKETS_PER_ORDER_DEFAULT),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('events_slug_key').on(t.slug),
    index('events_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
    check('events_status_check', sql`${t.status} IN ('draft', 'published', 'hidden', 'cancelled')`),
    check('events_ends_after_starts_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('events_max_tickets_per_order_check', sql`${t.maxTicketsPerOrder} BETWEEN 1 AND 50`),
  ],
);

/**
 * Hạng vé của một Sự kiện (FR-7, Story 2.8): tên, mô tả, giá (đồng, `bigint`), thời gian mở/đóng bán (để trống được:
 * trống giờ mở = bán ngay khi Sự kiện mở bán; trống giờ đóng = bán đến khi Sự kiện kết thúc). Số suất và tồn kho nằm ở
 * `ticket_type_inventory` của `ordering`. `organization_id` để truy vấn qua `orgScope`. Tạo, sửa và xóa đi qua
 * `flows/ticket-types.flow.ts` (khóa dòng `events` trước, rồi tồn kho).
 */
export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    description: text('description'),
    price: bigint('price', { mode: 'number' }).notNull(),
    saleStartsAt: timestamptz('sale_starts_at'),
    saleEndsAt: timestamptz('sale_ends_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('ticket_types_event_id_created_at_idx').on(t.eventId, t.createdAt),
    check('ticket_types_price_check', sql`${t.price} = 0 OR ${t.price} >= 2000`),
    check(
      'ticket_types_sale_window_check',
      sql`${t.saleStartsAt} IS NULL OR ${t.saleEndsAt} IS NULL OR ${t.saleEndsAt} > ${t.saleStartsAt}`,
    ),
  ],
);
