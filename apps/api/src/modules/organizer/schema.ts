import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { users } from '../identity/schema.js';

/** BTC (Ban tổ chức). Kênh liên hệ là PII (`PII_COLUMNS.organizer`): log tự che, không bao giờ vào audit. */
export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  createdAt: createdAt(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Thành viên BTC (`owner`/`admin`). Unique index một phần chỉ bảo đảm tối đa một Owner mỗi BTC; "đúng một" do luồng
 * tạo BTC (cùng transaction) giữ, DB không chặn BTC không có Owner.
 */
export const members = pgTable(
  'members',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['owner', 'admin'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('members_organization_id_user_id_key').on(t.organizationId, t.userId),
    uniqueIndex('members_one_owner_per_organization_key').on(t.organizationId).where(sql`${t.role} = 'owner'`),
    index('members_user_id_idx').on(t.userId),
    check('members_role_check', sql`${t.role} IN ('owner', 'admin')`),
  ],
);
