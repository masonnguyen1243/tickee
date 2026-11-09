import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DbExecutor } from '../../platform/db/index.js';
import { users } from './schema.js';

/** Email và tên hiển thị của một tài khoản (đọc cho mô-đun khác, vd. danh sách thành viên BTC). */
export interface UserContact {
  email: string;
  /** Rỗng với tài khoản đăng nhập OTP. */
  name: string;
}

/**
 * Read model của `identity` cho mô-đun khác (AD-10): mô-đun ngoài không đọc bảng `users` trực tiếp. Truyền `tx` để đọc
 * trong transaction của người gọi.
 */
export async function findUserIdByEmail(db: DbExecutor, email: string): Promise<string | null> {
  // `users.email` luôn ở dạng chữ thường (Better Auth chuẩn hóa), người gọi truyền email đã chuẩn hóa.
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row?.id ?? null;
}

/** Tài khoản `userId` đã bật xác thực hai lớp chưa (không có tài khoản → `false`). */
export async function hasTwoFactorEnabled(db: DbExecutor, userId: string): Promise<boolean> {
  const [row] = await db.select({ enabled: users.twoFactorEnabled }).from(users).where(eq(users.id, userId));
  return row?.enabled ?? false;
}

/** Email và tên của các tài khoản theo id; id không tồn tại thì không có trong kết quả. */
export async function userContacts(db: DbExecutor, ids: readonly string[]): Promise<Map<string, UserContact>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, { email: r.email, name: r.name }]));
}

/**
 * Bật/tắt cờ Quản trị Tingee của một tài khoản. Chỉ CLI `admin:grant`/`admin:revoke` gọi, bằng kết nối role
 * `tickee_migrator`: `tickee_app` không có UPDATE trên cột `platform_admin` nên gọi từ api/worker sẽ lỗi quyền.
 * @returns `true` khi cờ đổi, `false` khi đã ở trạng thái đích hoặc không có tài khoản `userId`.
 */
export async function setPlatformAdmin(db: DbExecutor, userId: string, value: boolean): Promise<boolean> {
  const changed = await db
    .update(users)
    .set({ platformAdmin: value })
    .where(and(eq(users.id, userId), ne(users.platformAdmin, value)))
    .returning({ id: users.id });
  return changed.length > 0;
}
