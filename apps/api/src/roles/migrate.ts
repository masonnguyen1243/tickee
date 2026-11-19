import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Logger } from 'pino';
import type { MigrateConfig } from '../platform/config/index.js';
import { Database, grantAppRole, withMigrationLock } from '../platform/db/index.js';
import { installBossSchema, PGBOSS_SCHEMA } from '../platform/jobs/index.js';

/** `apps/api/drizzle`, đúng cả khi chạy từ `src/` lẫn `dist/`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Migration Drizzle → schema `pgboss` → cấp quyền cho `tickee_app`. Chạy bằng `tickee_migrator`.
 *
 * Cả ba bước chạy trong lúc giữ khóa advisory `MIGRATION_LOCK_NAME` (Story 4.7-e). Lý do: migrator của Drizzle đọc
 * migration cuối ngoài transaction, và `GRANT`/`REVOKE` chạy song song lỗi `tuple concurrently updated`. Lượt migrate thứ
 * hai chờ lượt đầu xong rồi mới chạy. Nếu hai lượt cùng phiên bản thì lượt sau không đổi gì.
 */
export async function runMigrations(config: Pick<MigrateConfig, 'MIGRATION_DATABASE_URL'>, log?: Logger): Promise<void> {
  await withMigrationLock(config.MIGRATION_DATABASE_URL, () => runLocked(config, log), {
    onWait: () => log?.info({ marker: 'migrate_lock_wait' }, 'Tiến trình migrate khác đang chạy: chờ nó xong rồi chạy tiếp'),
    onLost: () =>
      log?.error(
        { marker: 'migrate_lock_lost' },
        'Mất kết nối giữ khóa migrate: lượt migrate khác có thể chạy chồng; lượt này sẽ thoát lỗi khi xong',
      ),
  });
}

async function runLocked(config: Pick<MigrateConfig, 'MIGRATION_DATABASE_URL'>, log?: Logger): Promise<void> {
  const db = new Database({ connectionString: config.MIGRATION_DATABASE_URL, max: 1, applicationName: 'tickee-migrate' });
  try {
    await migrate(db.orm, { migrationsFolder: MIGRATIONS_DIR });
    log?.info('Đã chạy migration Drizzle');
    await installBossSchema(config.MIGRATION_DATABASE_URL);
    log?.info('Đã khởi tạo schema pgboss');
    await grantAppRole(db.pool, ['public', PGBOSS_SCHEMA]);
    log?.info('Đã cấp quyền cho tickee_app');
  } finally {
    await db.close();
  }
}
