import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { PgBoss, type OpenTelemetryOptions } from 'pg-boss';

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
 * OpenTelemetry có sẵn của pg-boss (Story 4.6-a): span `send <queue>` / `process <queue>`, metrics
 * `messaging.process.duration` và `pgboss.queue.jobs` (theo trạng thái, gồm `failed`). Job lưu context của trace lúc
 * enqueue, nên job chạy một mình nối tiếp trace của request đã enqueue nó; chỉ trace id (W3C `traceparent`), không baggage.
 * Telemetry tắt (không có SDK) thì mọi thứ là no-op và job không lưu context nào.
 */
export const BOSS_OPEN_TELEMETRY: OpenTelemetryOptions = {
  propagateContext: true,
  propagator: new W3CTraceContextPropagator(),
};

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
    openTelemetry: BOSS_OPEN_TELEMETRY,
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
