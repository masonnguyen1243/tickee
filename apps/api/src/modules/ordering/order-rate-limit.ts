import { createHmac, hkdfSync } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, ORDER_RATE_LIMITS, type OrderRateLimitedDetails } from '@tickee/contracts';
import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { DATABASE, dbNow, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { orderCreateAttempts } from './schema.js';

/** Token DI của cấu hình `ordering` (env vai api). */
export const ORDERING_CONFIG = Symbol('ORDERING_CONFIG');

export interface OrderingConfig {
  /** Khóa gốc HMAC IP của bộ đếm tạo Đơn (tách miền bằng HKDF, như bộ đếm OTP của `identity`). */
  BETTER_AUTH_SECRET: string;
  /** Origin của web: `returnUrl` của link thanh toán là Trang Đơn trên web (Story 3.4). */
  WEB_ORIGIN: string;
  /** Khóa giải mã Secret Token Tingee của BTC để ký `create-link` (Story 3.4). Không bao giờ log. */
  TINGEE_CREDENTIAL_KEYS: string;
}

/** Giá trị của `ORDERING_CONFIG`: chỉ khóa HMAC IP (khóa credential Tingee đi riêng vào `PAYMENT_LINK_SETTINGS`). */
export type OrderRateLimitConfig = Pick<OrderingConfig, 'BETTER_AUTH_SECRET'>;

/**
 * Giới hạn tốc độ tạo Đơn (Story 3.2, AD-31) đếm trong Postgres: tối đa `perUser` lần mỗi tài khoản và `perIp` lần mỗi
 * IP trong cửa sổ trượt `windowSeconds`. Đếm mọi lần thử tới được TX1 (kể cả lần hết chỗ) và mọi lần thử lại tạo link
 * thanh toán cho Đơn đã có (Story 3.4: `POST /v1/me/orders/:code/payment-link`, hay gửi lại cùng `Idempotency-Key` khi
 * Đơn chưa có link mà còn lượt); không đếm lần bị chặn sớm (payload sai, Đơn chờ đã có) hay lần trả lại Đơn cũ không
 * cần tạo link. Bảng chỉ có HMAC của IP.
 *
 * Chỉ khóa theo tài khoản (giới hạn chính, không lọt khi gửi song song). Không khóa theo IP: CGNAT dồn nhiều Người mua
 * vào một IP (kịch bản NFR-3), một khóa theo IP sẽ bắt mọi lần thử xếp hàng, mỗi lần giữ một kết nối pool. Giới hạn theo
 * IP chỉ là lưới chặn cuối nên các request song song có thể vượt vài lần do đua: chấp nhận được.
 */
@Injectable()
export class OrderRateLimiter {
  private readonly key: Buffer;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ORDERING_CONFIG) config: OrderRateLimitConfig,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', config.BETTER_AUTH_SECRET, 'tickee', 'ordering.order-create-attempts', 32));
  }

  ipHmac(ip: string): string {
    return createHmac('sha256', this.key).update(`ip:${ip}`).digest('hex');
  }

  /**
   * Kiểm giới hạn rồi ghi một lần thử, trong một transaction riêng (commit trước TX1: TX1 rollback vẫn tính lần thử).
   * Khóa theo tài khoản (`pg_advisory_xact_lock`) để request song song của cùng tài khoản không cùng lọt. Mỗi giới hạn
   * chỉ đọc đúng một dòng: lần thử thứ `limit` tính từ mới nhất trong cửa sổ (có → đã chạm giới hạn, và đó là mốc được
   * thử lại). Vượt → `429 ORDER_RATE_LIMITED` kèm `retryAfterSeconds`, không ghi.
   */
  async consume(userId: string, ip: string): Promise<void> {
    const ipHmac = this.ipHmac(ip);
    const { windowSeconds, perUser, perIp } = ORDER_RATE_LIMITS;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`order-create-user:${userId}`}, 0))`);
      const since = sql`now() - make_interval(secs => ${windowSeconds})`;
      const t = orderCreateAttempts;
      /** `created_at` của lần thử thứ `limit` (tính từ mới nhất) trong cửa sổ; chưa đủ `limit` lần → `undefined`. */
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

      // Thời điểm (ms) sớm nhất được thử lại theo từng giới hạn đang chạm.
      const allowedAt: number[] = [];
      const oldestUser = await nth(eq(t.userId, userId), perUser);
      if (oldestUser !== undefined) allowedAt.push(oldestUser + windowSeconds * 1000);
      const oldestIp = await nth(eq(t.ipHmac, ipHmac), perIp);
      if (oldestIp !== undefined) allowedAt.push(oldestIp + windowSeconds * 1000);
      if (allowedAt.length > 0) {
        const now = (await dbNow(tx)).getTime();
        const details: OrderRateLimitedDetails = {
          retryAfterSeconds: Math.max(1, Math.ceil((Math.max(...allowedAt) - now) / 1000)),
        };
        throw new AppError(ErrorCode.ORDER_RATE_LIMITED, 'Bạn gửi Đơn quá nhanh. Vui lòng thử lại sau.', { details });
      }
      await tx.insert(t).values({ userId, ipHmac });
    });
  }
}
