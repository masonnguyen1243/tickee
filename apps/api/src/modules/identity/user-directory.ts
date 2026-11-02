import { eq, inArray } from 'drizzle-orm';
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

/** Email và tên của các tài khoản theo id; id không tồn tại thì không có trong kết quả. */
export async function userContacts(db: DbExecutor, ids: readonly string[]): Promise<Map<string, UserContact>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, { email: r.email, name: r.name }]));
}
