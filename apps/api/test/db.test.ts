import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, seedChecks } from '../src/platform/db/index.js';
import { runMigrations } from '../src/roles/migrate.js';
import { databaseUrl, migrationDatabaseUrl } from './helpers.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('platform/db trên Postgres thật (role tickee_app)', () => {
  let db: Database;

  beforeAll(() => {
    db = new Database({ connectionString: databaseUrl() });
  });
  afterAll(async () => {
    await db.close();
  });

  it('chạy trên PostgreSQL 18', async () => {
    const { rows } = await db.pool.query<{ v: string }>(`SELECT current_setting('server_version_num') AS v`);
    expect(Number(rows[0]?.v)).toBeGreaterThanOrEqual(180000);
  });

  it('transaction mức READ COMMITTED, PK sinh bằng uuidv7()', async () => {
    const result = await db.transaction(async (tx) => {
      const iso = await tx.execute<{ transaction_isolation: string }>(sql`SHOW transaction_isolation`);
      const [row] = await tx.insert(seedChecks).values({ note: 'tx-ok' }).returning();
      return { isolation: iso.rows[0]?.transaction_isolation, row };
    });
    expect(result.isolation).toBe('read committed');
    expect(result.row?.id).toMatch(UUID_V7);
    expect(result.row?.createdAt).toBeInstanceOf(Date);
  });

  it('lỗi trong transaction → rollback', async () => {
    const note = `rollback-${Date.now()}`;
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(seedChecks).values({ note });
        throw new Error('hủy');
      }),
    ).rejects.toThrow('hủy');
    const rows = await db.orm.select().from(seedChecks).where(eq(seedChecks.note, note));
    expect(rows).toHaveLength(0);
  });

  it('tickee_app không có quyền DDL', async () => {
    await expect(db.pool.query('CREATE TABLE khong_duoc (id int)')).rejects.toMatchObject({ code: '42501' });
  });

  it('tickee_app đọc/ghi được schema pgboss do vai migrate tạo', async () => {
    const { rows } = await db.pool.query<{ version: number }>('SELECT version FROM pgboss.version');
    expect(rows[0]?.version).toBeGreaterThan(0);
  });

  it('chạy migrate lần nữa vẫn thành công (idempotent)', async () => {
    await expect(runMigrations({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() })).resolves.toBeUndefined();
  });
});
