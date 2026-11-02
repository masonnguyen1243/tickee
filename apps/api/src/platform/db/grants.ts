import type pg from 'pg';

/** Role DML dùng ở vai `api`/`worker`. Tên cố định theo AD-36. */
export const APP_DB_ROLE = 'tickee_app';

/**
 * Bảng chỉ cho INSERT/SELECT với `tickee_app` (`schema.table`). Thu UPDATE/DELETE/TRUNCATE sau khi cấp quyền,
 * nên quyền này vẫn bị chặn sau mỗi lần migrate.
 */
export const APPEND_ONLY_TABLES = ['public.audit_events'] as const;

/**
 * Cột `tickee_app` không được UPDATE (`schema.table` → tên cột). Sau mỗi lần migrate, bảng bị thu UPDATE cấp bảng rồi
 * được cấp lại UPDATE theo từng cột còn lại (đọc từ `information_schema.columns`), nên cột mới thêm sau vẫn ghi được.
 * `users.platform_admin`: cờ Quản trị Tingee chỉ đổi bằng CLI chạy role `tickee_migrator` (AD-26). DB chặn mọi UPDATE
 * cột này từ `tickee_app` (kể cả khi tầng ứng dụng có lỗi). INSERT KHÔNG bị chặn theo cột (Drizzle liệt kê mọi cột,
 * giá trị `default`, khi INSERT): `tickee_app` vẫn INSERT được dòng có cờ `true`; điều ngăn việc đó chỉ là Better Auth
 * không khai báo trường này nên không nhận từ input, và không code nào khác INSERT `users`.
 */
export const UPDATE_PROTECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'public.users': ['platform_admin'],
};

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function tableExists(client: pg.PoolClient, schema: string, name: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [
    `${quoteIdent(schema)}.${quoteIdent(name)}`,
  ]);
  return rows[0]?.exists === true;
}

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
    if (!(await tableExists(client, schema, name))) continue;
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "${schema}"."${name}" FROM ${APP_DB_ROLE}`);
  }
  for (const [table, protectedColumns] of Object.entries(UPDATE_PROTECTED_COLUMNS)) {
    const [schema, name] = table.split('.') as [string, string];
    if (!schemas.includes(schema)) continue;
    if (!(await tableExists(client, schema, name))) continue;
    const { rows } = await client.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
      [schema, name],
    );
    const updatable = rows.map((r) => r.column_name).filter((c) => !protectedColumns.includes(c));
    const target = `${quoteIdent(schema)}.${quoteIdent(name)}`;
    // REVOKE cấp bảng thu luôn UPDATE theo cột đã cấp ở lần migrate trước (cột đã xóa/đổi tên không còn sót).
    await client.query(`REVOKE UPDATE ON TABLE ${target} FROM ${APP_DB_ROLE}`);
    if (updatable.length > 0) {
      await client.query(`GRANT UPDATE (${updatable.map(quoteIdent).join(', ')}) ON TABLE ${target} TO ${APP_DB_ROLE}`);
    }
  }
}
