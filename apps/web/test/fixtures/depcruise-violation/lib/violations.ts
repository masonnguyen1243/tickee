// Fixture cố ý vi phạm ranh giới apps/web — chỉ dùng trong test/dependency-rules.test.ts.
import pg from 'pg';
import PgBoss from 'pg-boss';
import { drizzle } from 'drizzle-orm/node-postgres';
import { api } from '@tickee/api';

export const all = [pg, PgBoss, drizzle, api];
