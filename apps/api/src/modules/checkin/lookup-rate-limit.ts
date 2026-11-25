import { createHmac, hkdfSync } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CHECKIN_LOOKUP_RATE_LIMITS, ErrorCode, type CheckinLookupRateLimitedDetails } from '@tickee/contracts';
import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { DATABASE, dbNow, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { checkinLookupAttempts } from './schema.js';

/** Token DI của cấu hình `checkin` (env vai api). */
export const CHECKIN_CONFIG = Symbol('CHECKIN_CONFIG');

export interface CheckinConfig {
  /** Khóa gốc HMAC IP của bộ đếm tra tay (tách miền bằng HKDF, như bộ đếm tạo Đơn của `ordering`). */
  BETTER_AUTH_SECRET: string;
}

/**
 * Giới hạn tốc độ tra tay (Story 5.5, AD-31) đếm trong Postgres, theo mẫu `ordering/order-rate-limit.ts`: tối đa
 * `perUser` lần mỗi tài khoản và `perIp` lần mỗi IP trong cửa sổ trượt `windowSeconds` (`CHECKIN_LOOKUP_RATE_LIMITS`).
 * Đếm mỗi lần tra đủ dạng tới server (kể cả không khớp Vé nào); lần sai dạng bị chặn trước (`400`) nên không đếm. Bảng
 * chỉ có HMAC của IP, không có giá trị đã tra.
 *
 * Chỉ khóa theo tài khoản (giới hạn chính, không lọt khi gửi song song). Không khóa theo IP: WiFi sự kiện hay CGNAT dồn
 * nhiều CTV vào một IP, một khóa theo IP bắt mọi lần tra xếp hàng. Giới hạn theo IP chỉ là lưới chặn cuối nên các request
 * song song có thể vượt vài lần do đua: chấp nhận được.
 */
@Injectable()
export class CheckinLookupRateLimiter {
  private readonly key: Buffer;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CHECKIN_CONFIG) config: CheckinConfig,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', config.BETTER_AUTH_SECRET, 'tickee', 'checkin.lookup-attempts', 32));
  }

  ipHmac(ip: string): string {
    return createHmac('sha256', this.key).update(`ip:${ip}`).digest('hex');
  }

  /**
   * Kiểm giới hạn rồi ghi một lượt tra, trong một transaction riêng (commit trước khi tra: lần tra lỗi vẫn tính). Khóa
   * theo tài khoản (`pg_advisory_xact_lock`) để request song song của cùng tài khoản không cùng lọt. Mỗi giới hạn chỉ đọc
   * đúng một dòng: lượt thứ `limit` tính từ mới nhất trong cửa sổ (có → đã chạm giới hạn, và đó là mốc được tra lại).
   * Vượt → `429 CHECKIN_LOOKUP_RATE_LIMITED` kèm `retryAfterSeconds` theo giới hạn chặn lâu nhất, không ghi.
   */
  async consume(userId: string, ip: string): Promise<void> {
    const ipHmac = this.ipHmac(ip);
    const { windowSeconds, perUser, perIp } = CHECKIN_LOOKUP_RATE_LIMITS;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checkin-lookup-user:${userId}`}, 0))`);
      const since = sql`now() - make_interval(secs => ${windowSeconds})`;
      const t = checkinLookupAttempts;
      /** `created_at` của lượt thứ `limit` (tính từ mới nhất) trong cửa sổ; chưa đủ `limit` lượt → `undefined`. */
      const nth = async (match: SQL, limit: number): Promise<number | undefined> => {
        const [row] = await tx
          .select({ createdAt: t.createdAt })
          .from(t)
          .where(and(match, gt(t.createdAt, since)))
          .orderBy(desc(t.createdAt))
          .offset(limit - 1)
          .limit(1);
        return row?.createdAt.getTime();
      };

      // Thời điểm (ms) sớm nhất được tra lại theo từng giới hạn đang chạm.
      const allowedAt: number[] = [];
      const oldestUser = await nth(eq(t.userId, userId), perUser);
      if (oldestUser !== undefined) allowedAt.push(oldestUser + windowSeconds * 1000);
      const oldestIp = await nth(eq(t.ipHmac, ipHmac), perIp);
      if (oldestIp !== undefined) allowedAt.push(oldestIp + windowSeconds * 1000);
      if (allowedAt.length > 0) {
        const now = (await dbNow(tx)).getTime();
        const details: CheckinLookupRateLimitedDetails = {
          retryAfterSeconds: Math.max(1, Math.ceil((Math.max(...allowedAt) - now) / 1000)),
        };
        throw new AppError(ErrorCode.CHECKIN_LOOKUP_RATE_LIMITED, 'Tra quá nhiều lần. Vui lòng thử lại sau.', {
          details,
        });
      }
      await tx.insert(t).values({ userId, ipHmac });
    });
  }
}
