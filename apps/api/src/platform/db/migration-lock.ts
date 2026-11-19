import pg from 'pg';

/**
 * Tên khóa advisory cấp session của vai `migrate` (Story 4.7-e). Băm bằng `hashtextextended(…, 0)` như các khóa
 * `pg_advisory_xact_lock` khác của app. Khóa advisory tính theo từng database, nên DB khác nhau không chặn nhau.
 */
export const MIGRATION_LOCK_NAME = 'tickee:migrate';

/** `application_name` của kết nối giữ (hoặc đang chờ) khóa migrate: tra trong `pg_stat_activity`. */
export const MIGRATION_LOCK_APPLICATION_NAME = 'tickee-migrate-lock';

/**
 * Cấu hình của riêng kết nối giữ khóa. Migration chạy trên kết nối khác nên không bị ảnh hưởng.
 * - `statement_timeout`, `lock_timeout`: timeout đặt theo role hay database không được cắt lượt chờ khóa. Code không
 *   giới hạn thời gian chờ.
 * - `idle_session_timeout`: kết nối này đứng yên ngoài transaction suốt lúc migrate.
 * - keepalive và `client_connection_check_interval`: lượt giữ khóa chết mà không kịp đóng kết nối (máy mất mạng) thì
 *   server phát hiện trong khoảng một phút và nhả khóa, thay vì chờ keepalive mặc định của OS (khoảng 2 giờ). Lượt đang
 *   chờ bị hủy (job deploy hết giờ) thì backend chờ của nó cũng thoát, không lấy khóa thay một tiến trình đã chết.
 */
const SESSION_SETTINGS = [
  'SET statement_timeout = 0',
  'SET lock_timeout = 0',
  'SET idle_session_timeout = 0',
  'SET tcp_keepalives_idle = 30',
  'SET tcp_keepalives_interval = 10',
  'SET tcp_keepalives_count = 3',
  "SET client_connection_check_interval = '10s'",
].join('; ');

const UNLOCK_TIMEOUT_MS = 5_000;

export interface MigrationLockOptions {
  /** Gọi một lần khi tiến trình khác đang giữ khóa, ngay trước khi bắt đầu chờ. */
  onWait?: () => void;
  /** Gọi ngay khi kết nối giữ khóa mất trong lúc `fn` chạy: từ lúc đó lượt migrate khác có thể lấy khóa và chạy chồng. */
  onLost?: () => void;
}

/**
 * Chạy `fn` trong lúc giữ khóa advisory cấp session `MIGRATION_LOCK_NAME`, trên một kết nối riêng tách khỏi pool mà
 * `fn` dùng. Vì vậy hai lượt migrate trên cùng database chạy lần lượt.
 *
 * Tiến trình khác đang giữ khóa thì chờ tới khi nó xong. Code không giới hạn thời gian chờ: timeout của job deploy chặn.
 * Khóa chỉ xếp hàng các lượt chạy, không sắp thứ tự deploy giữa hai phiên bản.
 *
 * Luôn nhả khóa khi `fn` xong, kể cả khi `fn` lỗi. Tiến trình chết thì kết nối đóng và Postgres tự nhả khóa.
 *
 * Kết nối giữ khóa mất giữa chừng: gọi `onLost` ngay, rồi báo lỗi sau khi `fn` xong (`fn` không bị ngắt). Từ lúc mất kết
 * nối, lượt khác có thể đã chạy chồng. Nhả khóa trả `false` cũng báo lỗi như vậy, vì khi đó kết nối này không giữ khóa
 * (vd. `MIGRATION_DATABASE_URL` đi qua pooler chế độ transaction).
 */
export async function withMigrationLock<T>(
  connectionString: string,
  fn: () => Promise<T>,
  options: MigrationLockOptions = {},
): Promise<T> {
  const client = new pg.Client({
    connectionString,
    application_name: MIGRATION_LOCK_APPLICATION_NAME,
    connectionTimeoutMillis: 3_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
  });
  let held = false;
  let lost = false;
  let releasing = false;
  const markLost = () => {
    if (releasing || lost) return;
    lost = true;
    if (held) options.onLost?.();
  };
  // Kết nối đứng yên suốt lúc `fn` chạy. EventEmitter không có listener `error` thì ném lỗi, nên lỗi trên kết nối đứng
  // yên sẽ làm sập tiến trình. Listener này ghi nhận lỗi rồi báo sau khi `fn` xong.
  client.on('error', markLost);
  client.on('end', markLost);

  let unlockTried = false;
  /** Nhả khóa. Trả `true` khi Postgres xác nhận vừa nhả. Lỗi hay hết giờ thì trả `false`, không ném. */
  const unlock = async (): Promise<boolean> => {
    unlockTried = true;
    try {
      const query: pg.QueryConfig & { query_timeout: number } = {
        text: 'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked',
        values: [MIGRATION_LOCK_NAME],
        query_timeout: UNLOCK_TIMEOUT_MS,
      };
      const { rows } = await client.query<{ unlocked: boolean }>(query);
      return rows[0]?.unlocked === true;
    } catch {
      return false;
    }
  };

  await client.connect();
  try {
    await client.query(SESSION_SETTINGS);
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [MIGRATION_LOCK_NAME],
    );
    if (rows[0]?.locked !== true) {
      options.onWait?.();
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_NAME]);
    }
    held = true;

    const result = await fn();
    const unlocked = !lost && (await unlock());
    if (!unlocked) {
      throw new Error('Mất khóa migrate trong lúc chạy, lượt migrate khác có thể đã chạy chồng: chạy lại vai migrate');
    }
    return result;
  } finally {
    releasing = true;
    // `fn` lỗi: vẫn nhả tường minh để tiến trình đang chờ chạy ngay (đóng kết nối cũng nhả khóa cấp session).
    if (held && !lost && !unlockTried) await unlock();
    await client.end().catch(() => undefined);
  }
}
