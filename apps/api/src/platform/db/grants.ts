import type pg from 'pg';

/** Role DML dùng ở vai `api`/`worker`. Tên cố định theo AD-36. */
export const APP_DB_ROLE = 'tickee_app';

/**
 * Bảng chỉ cho INSERT/SELECT với `tickee_app` (`schema.table`). Thu UPDATE/DELETE/TRUNCATE sau khi cấp quyền,
 * nên quyền này vẫn bị chặn sau mỗi lần migrate.
 */
export const APPEND_ONLY_TABLES = ['public.audit_events'] as const;

/**
 * Cấp quyền DML cho `tickee_app` trên mọi bảng hiện có (schema `public` và `pgboss`).
 * Bảng mới ở story sau tự có quyền nhờ `ALTER DEFAULT PRIVILEGES` trong migration 0000.
 * Idempotent; chạy bằng `tickee_migrator` sau migration. Chạy trong một transaction: GRANT bên dưới cấp lại
 * UPDATE/DELETE cho bảng append-only, nên lỗi giữa chừng không được để lại trạng thái chưa REVOKE.
 */
export async function grantAppRole(pool: pg.Pool, schemas: readonly string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await grantInTransaction(client, schemas);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function grantInTransaction(client: pg.PoolClient, schemas: readonly string[]): Promise<void> {
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
  // Phải chạy sau GRANT ở trên (GRANT ... ON ALL TABLES cấp lại UPDATE/DELETE cho mọi bảng).
  for (const table of APPEND_ONLY_TABLES) {
    const [schema, name] = table.split('.') as [string, string];
    if (!schemas.includes(schema)) continue;
    const { rows } = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [
      `"${schema}"."${name}"`,
    ]);
    if (!rows[0]?.exists) continue;
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "${schema}"."${name}" FROM ${APP_DB_ROLE}`);
  }
}
