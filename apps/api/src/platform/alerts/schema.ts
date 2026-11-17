import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestamptz } from '../db/columns.js';

/**
 * Dấu chống lặp của kênh cảnh báo vận hành (Story 4.6-b): một dòng cho mỗi `(kind, subject)` đã báo. `raise` ghi dấu và
 * enqueue email trong cùng transaction; câu `INSERT … ON CONFLICT` quyết định subject nào là mới, đúng cả khi nhiều
 * instance cùng báo. Loại `once` không bao giờ ghi đè dấu; loại `cooldown` ghi đè `raised_at` khi dấu đã cũ hơn cooldown.
 * Job quét xóa dấu cũ hơn 30 ngày. Không khóa ngoại: `subject` là id, mã Đơn, tên queue… của nhiều nguồn khác nhau.
 */
export const opsAlertMarks = pgTable(
  'ops_alert_marks',
  {
    /** Loại cảnh báo (`OpsAlertKind`). */
    kind: text('kind').notNull(),
    /** Đối tượng chống lặp của loại (id `payment_events`, mã Đơn, tên queue, id job…); không PII. */
    subject: text('subject').notNull(),
    /** Lần báo gần nhất (đồng hồ DB). */
    raisedAt: timestamptz('raised_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.subject] }), index('ops_alert_marks_raised_at_idx').on(t.raisedAt)],
);
