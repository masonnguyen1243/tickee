import { sql } from 'drizzle-orm';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../db/columns.js';

/**
 * Nhật ký audit (AD-24), chỉ INSERT: role `tickee_app` bị thu UPDATE/DELETE trong `grantAppRole` sau mỗi lần migrate.
 * Chỉ ghi tên trường đổi, không bao giờ ghi giá trị. Không khóa ngoại: `platform` không phụ thuộc bảng của mô-đun.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    /** Tài khoản thực hiện; `null` = hệ thống. */
    actorUserId: uuid('actor_user_id'),
    /** BTC liên quan; `null` cho thao tác nền tảng. Ngoại lệ duy nhất của quy tắc `organization_id NOT NULL`. */
    organizationId: uuid('organization_id'),
    /** `<đối tượng>.<động từ>`, vd. `organization.created`. */
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    /** Tên trường đổi (snake_case), không giá trị. */
    changedFields: text('changed_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_events_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
    index('audit_events_target_idx').on(t.targetType, t.targetId),
  ],
);
