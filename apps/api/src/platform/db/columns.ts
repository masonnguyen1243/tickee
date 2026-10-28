import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Khóa chính UUIDv7 do Postgres 18 sinh (`uuidv7()`). */
export const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);

/** Mốc thời gian luôn là `timestamptz`. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Cột `created_at` mặc định `now()`. */
export const createdAt = () => timestamptz('created_at').notNull().defaultNow();
