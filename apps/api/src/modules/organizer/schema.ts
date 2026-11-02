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

/**
 * Lời mời Admin (Story 2.4). `email` là PII (`PII_COLUMNS.organizer`): log tự che, không bao giờ vào audit.
 * `token_hash` (SHA-256 của token 128 bit) do worker ghi lúc gửi email, nên còn `null` tới khi job chạy; token thô chỉ
 * nằm trong email. Mỗi BTC có tối đa một lời mời còn treo (chưa nhận, chưa thu hồi) cho mỗi email; lời mời quá hạn vẫn
 * tính là còn treo tới khi bị thu hồi hoặc mời lại.
 */
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Đã chuẩn hóa (trim, chữ thường). */
    email: text('email').notNull(),
    tokenHash: text('token_hash'),
    expiresAt: timestamptz('expires_at').notNull(),
    emailSentAt: timestamptz('email_sent_at'),
    acceptedAt: timestamptz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    revokedAt: timestamptz('revoked_at'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('organization_invitations_pending_email_key')
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    uniqueIndex('organization_invitations_token_hash_key').on(t.tokenHash),
    index('organization_invitations_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
    check(
      'organization_invitations_accepted_check',
      sql`(${t.acceptedAt} IS NULL) = (${t.acceptedBy} IS NULL)`,
    ),
  ],
);
