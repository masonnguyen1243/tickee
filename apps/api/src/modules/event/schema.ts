import { MAX_TICKETS_PER_ORDER_DEFAULT, type FormOption } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { organizations } from '../organizer/schema.js';

/**
 * Sự kiện của một BTC (FR-6, Story 2.7). `slug` sinh một lần lúc tạo (`slugBase(name)` + `-` + 4 ký tự ngẫu nhiên) và
 * không đổi khi đổi tên. `status` chuyển bằng compare-and-set (`draft` → `published` ↔ `hidden`; `published`/`hidden`
 * → `cancelled`); Story 2.7 chỉ ghi `draft`. "Đã kết thúc" không lưu thành status: luôn tính từ `effective_end_at`
 * (`effectiveEndAt(ends_at)` của contracts, tính lại mỗi lần sửa giờ, trừ khi BTC đã bấm "Kết thúc":
 * `ended_manually_at`). Khóa Sự kiện (Epic 7) là trục riêng
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
    /**
     * Lúc BTC bấm "Kết thúc" (Story 2.12, AD-14): đặt cùng `effective_end_at` trong một lệnh; có rồi thì sửa giờ không
     * tính lại `effective_end_at`. Không có thao tác hoàn tác.
     */
    endedManuallyAt: timestamptz('ended_manually_at'),
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
    /**
     * Phiên bản giờ/địa điểm (Story 3.10): tăng 1 trong chính `UPDATE` của lệnh sửa đổi `starts_at`, `ends_at` hoặc
     * `venue` (`timeOrVenueChanged`), ở mọi trạng thái. Nằm trong id job email báo Người mua, nên mỗi lần sửa là một lượt.
     * Không có trong `EventDetail`.
     */
    timeVenueVersion: integer('time_venue_version').notNull().default(0),
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
    check('events_time_venue_version_check', sql`${t.timeVenueVersion} >= 0`),
    check(
      'events_ended_manually_check',
      sql`${t.endedManuallyAt} IS NULL OR ${t.effectiveEndAt} = ${t.endedManuallyAt}`,
    ),
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

/**
 * Câu hỏi riêng của form mua vé (FR-9, Story 2.9). Trường mặc định (Tên, SĐT, email) cố định nên không lưu ở đây.
 * `id` ổn định: sửa nhãn hay đổi thứ tự không đổi id. `position` tăng dần từ 0, liền nhau (xóa thì dồn lại).
 * `options` (jsonb `[{id, label}]`, luôn đọc và ghi cùng câu hỏi): câu `choice` có 2–20 phương án, mỗi phương án có
 * id ổn định do server cấp; câu `text` là `[]`. Mọi lần ghi khóa dòng `events` `FOR UPDATE` trước (như Hạng vé), nên
 * các thao tác trên form của cùng Sự kiện chạy tuần tự. `organization_id` để truy vấn qua `orgScope`.
 */
export const eventFormQuestions = pgTable(
  'event_form_questions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    position: integer('position').notNull(),
    kind: text('kind', { enum: ['text', 'choice'] }).notNull(),
    label: text('label').notNull(),
    required: boolean('required').notNull().default(false),
    options: jsonb('options').$type<FormOption[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('event_form_questions_event_id_position_idx').on(t.eventId, t.position),
    check('event_form_questions_kind_check', sql`${t.kind} IN ('text', 'choice')`),
    check('event_form_questions_position_check', sql`${t.position} >= 0`),
    check('event_form_questions_options_check', sql`jsonb_typeof(${t.options}) = 'array'`),
  ],
);
