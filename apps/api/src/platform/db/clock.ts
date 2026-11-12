import { sql } from 'drizzle-orm';
import type { DbExecutor } from './database.js';

/*
 * Đồng hồ DB: mốc để so với cột thời gian trong DB đọc từ Postgres, không lấy giờ của process. Hai hàm, khác nhau ở
 * mốc trả về:
 * - `dbNow` (`now()`): giờ bắt đầu transaction. Gọi bao nhiêu lần trong cùng transaction cũng ra một giá trị, trùng
 *   mốc với `created_at` mặc định và với `now()` viết nội tuyến trong câu SQL của cùng transaction. Dùng khi phải so
 *   cùng mốc với các câu khác của transaction (giới hạn tốc độ, cửa sổ OTP, `retired_at`, `effective_end_at` mới khi
 *   sửa Sự kiện).
 * - `dbClock` (`clock_timestamp()`): giờ thật lúc gọi, tăng dần trong cùng transaction. Dùng khi transaction có thể
 *   đã chờ khóa lâu và mốc phải là lúc ghi một việc không đảo được, như phát Vé (`issued_at`, `paid_at` khi Tingee
 *   không báo), chứ không phải lúc transaction bắt đầu.
 * Read model chỉ cần biết "Sự kiện đã kết thúc chưa" thì dùng biểu thức `now()` nội tuyến chung của mô-đun `event`
 * (`endedNow`), không gọi hai hàm này. Ngoài transaction (`db.orm`), mỗi câu là một transaction riêng nên `dbNow` cũng
 * xấp xỉ giờ lúc gọi.
 */

/** `now()` của Postgres: giờ bắt đầu transaction, cùng mốc với `created_at` mặc định. */
export async function dbNow(db: DbExecutor): Promise<Date> {
  const { rows } = await db.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
  return new Date(rows[0]!.now);
}

/** `clock_timestamp()` của Postgres: giờ thật lúc gọi, tăng dần trong cùng transaction. */
export async function dbClock(db: DbExecutor): Promise<Date> {
  const { rows } = await db.execute<{ now: string | Date }>(sql`SELECT clock_timestamp() AS now`);
  return new Date(rows[0]!.now);
}
