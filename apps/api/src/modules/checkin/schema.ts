import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { events } from '../event/schema.js';

/**
 * Link mời CTV chung của một Sự kiện (Story 5.1, AD-30). Token 128 bit chỉ nằm trong response lúc tạo; DB lưu
 * `token_hash` (SHA-256 hex, unique). `expires_at` = min(lúc tạo + 7 ngày, `effective_end_at` lúc tạo); đọc ra thì lấy
 * min với `effective_end_at` hiện tại (Kết thúc sớm sau khi tạo). Mỗi Sự kiện tối đa một link chưa thu hồi (unique index
 * một phần): "Tạo link mới" đặt `revoked_at` cho link cũ rồi INSERT, cùng transaction và sau khi khóa dòng `events`.
 * Chỉ `revoked_at` được UPDATE (`UPDATE_PROTECTED_COLUMNS`).
 *
 * `organization_id` không có FK: `checkin` không phụ thuộc `organizer` (module-graph, AD-10). FK tới `events`
 * (`checkin → event`).
 */
export const checkerInvites = pgTable(
  'checker_invites',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('checker_invites_token_hash_key').on(t.tokenHash),
    uniqueIndex('checker_invites_one_active_per_event_key').on(t.eventId).where(sql`${t.revokedAt} IS NULL`),
    index('checker_invites_event_id_idx').on(t.eventId),
    check('checker_invites_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * CTV của một Sự kiện (Story 5.2, AD-30): một dòng mỗi `(event_id, user_id)`, ghi khi tài khoản nhận lời mời lần đầu
 * (`created_at` = lúc nhận). `status`: `active` quét và tra tay được ở đúng Sự kiện này; `revoked` bị Owner/Admin thu hồi
 * (`revoked_by`, `revoked_at`, Story 5.6), nhận lại lời mời không kích hoạt lại. Chỉ `status`, `revoked_by`, `revoked_at`
 * được UPDATE (`UPDATE_PROTECTED_COLUMNS`).
 *
 * `organization_id` (BTC sở hữu Sự kiện lúc nhận) và `user_id`, `revoked_by` không có FK: `checkin` không phụ thuộc
 * `organizer` hay `identity` (module-graph, AD-10). FK tới `events` (`checkin → event`).
 */
export const checkers = pgTable(
  'checkers',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    userId: uuid('user_id').notNull(),
    status: text('status', { enum: ['active', 'revoked'] }).notNull(),
    revokedBy: uuid('revoked_by'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('checkers_event_id_user_id_key').on(t.eventId, t.userId),
    check('checkers_status_check', sql`${t.status} IN ('active', 'revoked')`),
    // Story 5.6: dòng `active` không mang dấu thu hồi (khôi phục xóa `revoked_*`, lịch sử ở audit); dòng `revoked` luôn
    // có người và lúc thu hồi.
    check(
      'checkers_revoked_check',
      sql`(${t.status} = 'active' AND ${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL) OR (${t.status} = 'revoked' AND ${t.revokedAt} IS NOT NULL AND ${t.revokedBy} IS NOT NULL)`,
    ),
  ],
);

/**
 * Bộ đếm giới hạn tốc độ tra tay (Story 5.5, AD-31): một dòng cho mỗi lần tra đủ dạng tới server, theo `user_id` và HMAC
 * của IP (không lưu IP thô, không lưu giá trị đã tra). Job `checkin.purge-lookup-attempts` của vai worker xóa dòng đã ra
 * khỏi cửa sổ `CHECKIN_LOOKUP_RATE_LIMITS.windowSeconds`. `user_id` không có FK (`checkin` không phụ thuộc `identity`).
 */
export const checkinLookupAttempts = pgTable(
  'checkin_lookup_attempts',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    ipHmac: text('ip_hmac').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('checkin_lookup_attempts_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('checkin_lookup_attempts_ip_hmac_created_at_idx').on(t.ipHmac, t.createdAt),
  ],
);
