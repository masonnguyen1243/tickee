import { Database } from '../../src/platform/db/index.js';
import { migrationDatabaseUrl } from '../helpers.js';
import { signUpWithTotp, type Harness } from '../identity/harness.js';

/**
 * Bật/tắt cờ `platform_admin` như CLI: bằng role `tickee_migrator` (`tickee_app` không có UPDATE trên cột này).
 * Mỗi lần mở một kết nối riêng rồi đóng ngay.
 */
export async function setPlatformAdminFlag(userId: string, value: boolean): Promise<void> {
  const db = new Database({ connectionString: migrationDatabaseUrl(), max: 1, applicationName: 'tickee-test-admin' });
  try {
    await db.pool.query('UPDATE users SET platform_admin = $2 WHERE id = $1', [userId, value]);
  } finally {
    await db.close();
  }
}

/** Quản trị Tingee sẵn sàng: tài khoản mới, đã bật 2FA (session đã qua lớp hai), có cờ `platform_admin`. */
export async function signUpPlatformAdmin(h: Harness) {
  const user = await signUpWithTotp(h);
  await setPlatformAdminFlag(user.userId, true);
  return user;
}
