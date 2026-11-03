import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
  ],
);
