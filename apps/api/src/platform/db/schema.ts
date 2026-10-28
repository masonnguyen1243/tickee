import { pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';

/**
 * Bảng kỹ thuật của `platform`, không phải bảng miền: chứng minh role, quyền và `uuidv7()` hoạt động.
 */
export const seedChecks = pgTable('_seed_checks', {
  id: id(),
  note: text('note').notNull(),
  createdAt: createdAt(),
});
