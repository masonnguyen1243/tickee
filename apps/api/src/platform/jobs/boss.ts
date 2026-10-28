import { PgBoss } from 'pg-boss';

export const PGBOSS_SCHEMA = 'pgboss';

/**
 * pg-boss cho vai `api`/`worker`: chạy bằng `tickee_app`, không bao giờ tự migrate schema
 * (vai `migrate` lo việc đó).
 */
export function createBoss(connectionString: string, applicationName: string): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: applicationName,
    migrate: false,
    createSchema: false,
  });
}

/** pg-boss cho vai `migrate`: tạo/nâng schema `pgboss` bằng `tickee_migrator` rồi dừng. */
export async function installBossSchema(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: 'tickee-migrate',
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await boss.stop({ graceful: false, close: true });
}
