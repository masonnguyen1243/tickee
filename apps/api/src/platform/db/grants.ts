import type pg from 'pg';

/** Role DML dùng ở vai `api`/`worker`. Tên cố định theo AD-36. */
export const APP_DB_ROLE = 'tickee_app';

/**
 * Cấp quyền DML cho `tickee_app` trên mọi bảng hiện có (schema `public` và `pgboss`).
 * Bảng mới ở story sau tự có quyền nhờ `ALTER DEFAULT PRIVILEGES` trong migration 0000.
 * Idempotent; chạy bằng `tickee_migrator` sau migration.
 */
export async function grantAppRole(client: pg.Pool | pg.PoolClient, schemas: readonly string[]): Promise<void> {
  for (const schema of schemas) {
    const s = `"${schema.replaceAll('"', '""')}"`;
    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${APP_DB_ROLE}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${APP_DB_ROLE}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${APP_DB_ROLE}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO ${APP_DB_ROLE}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_ROLE}`,
    );
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_ROLE}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT EXECUTE ON FUNCTIONS TO ${APP_DB_ROLE}`);
  }
}
