import pg from 'pg';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIGRATION_LOCK_APPLICATION_NAME, MIGRATION_LOCK_NAME, withMigrationLock } from '../src/platform/db/index.js';
import { runMigrations } from '../src/roles/migrate.js';
import { migrationDatabaseUrl } from './helpers.js';

// File này giữ khóa migrate của cả database và ngắt backend theo `application_name`: chỉ đúng khi các file test chạy
// tuần tự (`fileParallelism: false` trong vitest.config.ts).

const LOCK_SQL = 'SELECT pg_advisory_lock(hashtextextended($1, 0))';
const UNLOCK_SQL = 'SELECT pg_advisory_unlock(hashtextextended($1, 0))';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: migrationDatabaseUrl(), application_name: 'tickee-test-migrate-lock' });
  await client.connect();
  return client;
}

/** Logger giả: ghi lại các lần gọi `info` và `error`. */
function captureLog() {
  const info = vi.fn();
  const error = vi.fn();
  return { log: { info, error } as unknown as Logger, info };
}

const waitMarkers = (info: ReturnType<typeof vi.fn>) =>
  info.mock.calls.filter(([fields]) => (fields as { marker?: string } | undefined)?.marker === 'migrate_lock_wait');

describe('vai migrate giữ khóa advisory (Story 4.7-e)', () => {
  const clients: pg.Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.end().catch(() => undefined)));
  });

  it('tiến trình khác đang giữ khóa → chờ, log marker migrate_lock_wait một lần; nhả khóa → chạy xong', async () => {
    const holder = await connect();
    clients.push(holder);
    await holder.query(LOCK_SQL, [MIGRATION_LOCK_NAME]);

    const { log, info } = captureLog();
    let settled = false;
    const run = runMigrations({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() }, log).finally(() => {
      settled = true;
    });
    try {
      for (let i = 0; i < 50 && waitMarkers(info).length === 0; i++) await sleep(100);
      expect(waitMarkers(info)).toHaveLength(1);
      await sleep(300);
      expect(settled).toBe(false);
      // Chưa lấy được khóa thì chưa chạy bước nào.
      expect(info.mock.calls.map(([, msg]) => msg)).not.toContain('Đã chạy migration Drizzle');

      await holder.query(UNLOCK_SQL, [MIGRATION_LOCK_NAME]);
      await expect(run).resolves.toBeUndefined();
      expect(waitMarkers(info)).toHaveLength(1);
    } finally {
      // Assert hỏng giữa chừng: nhả khóa và chờ lượt migrate nền xong, để nó không chạy lấn sang test sau.
      await holder.query(UNLOCK_SQL, [MIGRATION_LOCK_NAME]).catch(() => undefined);
      await Promise.allSettled([run]);
    }
  });

  it('không ai giữ khóa → chạy ngay, không log chờ', async () => {
    const { log, info } = captureLog();
    await runMigrations({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() }, log);
    expect(waitMarkers(info)).toHaveLength(0);
  });

  it('nhiều lượt migrate chạy song song đều xong, không lỗi', async () => {
    const config = { MIGRATION_DATABASE_URL: migrationDatabaseUrl() };
    const results = await Promise.allSettled([runMigrations(config), runMigrations(config), runMigrations(config)]);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  });

  it('timeout đặt theo role/database không cắt lượt chờ khóa hay kết nối giữ khóa', async () => {
    const holder = await connect();
    clients.push(holder);
    await holder.query(LOCK_SQL, [MIGRATION_LOCK_NAME]);

    // Như role `tickee_migrator` bị đặt sẵn timeout ngắn (ALTER ROLE … SET …): áp lúc mở kết nối.
    const url = new URL(migrationDatabaseUrl());
    url.searchParams.set('options', '-c lock_timeout=100 -c statement_timeout=100 -c idle_session_timeout=100');
    const run = withMigrationLock(url.toString(), async () => {
      await sleep(400); // dài hơn idle_session_timeout: kết nối giữ khóa đứng yên
      return 'xong';
    });
    try {
      await sleep(300); // dài hơn lock_timeout và statement_timeout: vẫn đang chờ khóa
      await holder.query(UNLOCK_SQL, [MIGRATION_LOCK_NAME]);
      await expect(run).resolves.toBe('xong');
    } finally {
      await holder.query(UNLOCK_SQL, [MIGRATION_LOCK_NAME]).catch(() => undefined);
      await Promise.allSettled([run]);
    }
  });

  it('chạy xong (kể cả khi lỗi) thì nhả khóa', async () => {
    await expect(
      withMigrationLock(migrationDatabaseUrl(), async () => {
        throw new Error('migration hỏng');
      }),
    ).rejects.toThrow('migration hỏng');

    const probe = await connect();
    clients.push(probe);
    const { rows } = await probe.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [MIGRATION_LOCK_NAME],
    );
    expect(rows[0]?.locked).toBe(true);
    await probe.query(UNLOCK_SQL, [MIGRATION_LOCK_NAME]);
  });

  it('mất kết nối giữ khóa giữa chừng → gọi onLost ngay, báo lỗi thay vì coi như xong', async () => {
    const admin = await connect();
    clients.push(admin);
    const onLost = vi.fn();
    let lostBeforeDone = false;
    await expect(
      withMigrationLock(
        migrationDatabaseUrl(),
        async () => {
          await admin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
             WHERE application_name = $1 AND datname = current_database()`,
            [MIGRATION_LOCK_APPLICATION_NAME],
          );
          for (let i = 0; i < 30 && onLost.mock.calls.length === 0; i++) await sleep(100);
          lostBeforeDone = onLost.mock.calls.length === 1;
          return 'xong';
        },
        { onLost },
      ),
    ).rejects.toThrow(/khóa migrate/);
    expect(lostBeforeDone).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});
