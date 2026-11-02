import { PgBoss } from 'pg-boss';

export const PGBOSS_SCHEMA = 'pgboss';

/**
 * - `worker`: chạy bảo trì (`supervise`), lịch cron (`schedule`) và handler; start chặn khởi động.
 * - `producer` (vai `api`): chỉ enqueue job cùng `tx` của thay đổi; không bảo trì, không lịch. Start chạy nền để api vẫn
 *   khởi động khi DB chưa sẵn sàng (`/healthz` 200, `/readyz` 503); nơi enqueue gọi `boss.start()` trước (idempotent,
 *   thử lại nếu lần trước lỗi).
 */
export type BossMode = 'producer' | 'worker';

export interface BossOptions {
  connectionString: string;
  applicationName: string;
  /** Mặc định `worker`. */
  mode?: BossMode;
}

/**
 * pg-boss cho vai `api`/`worker`: chạy bằng `tickee_app`, không bao giờ tự migrate schema
 * (vai `migrate` lo việc đó).
 */
export function createBoss({ connectionString, applicationName, mode = 'worker' }: BossOptions): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: applicationName,
    migrate: false,
    createSchema: false,
    ...(mode === 'producer' ? { supervise: false, schedule: false } : {}),
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
