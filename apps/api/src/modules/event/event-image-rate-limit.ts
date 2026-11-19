import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode, EVENT_IMAGE_PRESIGN_LIMITS, type EventImageRateLimitedDetails } from '@tickee/contracts';
import { and, desc, eq, gt, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { DATABASE, dbNow, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { eventImagePresigns } from './schema.js';

/** Marker của dòng log `info` khi cấp một URL upload ảnh Sự kiện. */
export const EVENT_IMAGE_PRESIGN_ISSUED = 'event_image_presign_issued';

/** Marker của dòng log `warn` khi chặn một lần presign ảnh Sự kiện vì vượt giới hạn. */
export const EVENT_IMAGE_PRESIGN_LIMITED = 'event_image_presign_limited';

/** Mỗi lần presign xóa tối đa chừng này dòng đã ra khỏi cửa sổ (của mọi tài khoản và BTC). */
const CLEANUP_BATCH = 500;

/** Giới hạn đang chặn: theo BTC (`perOrganization`) hay theo tài khoản (`perUser`, gộp mọi BTC). */
export type EventImagePresignLimit = 'organization' | 'user';

type Outcome<T> = { issued: T } | { limited: { limits: EventImagePresignLimit[]; retryAfterSeconds: number } };

/**
 * Giới hạn presign ảnh Sự kiện (Story 4.7-d), đếm trong Postgres theo mẫu `ordering/order-rate-limit.ts`: tối đa
 * `perOrganization` lần mỗi BTC và `perUser` lần mỗi tài khoản (gộp mọi BTC) trong cửa sổ trượt `windowSeconds`
 * (`EVENT_IMAGE_PRESIGN_LIMITS`). Chỉ lần cấp thành công được đếm. Không giới hạn theo IP.
 */
@Injectable()
export class EventImagePresignLimiter {
  private readonly logger = new Logger('EventImagePresignLimiter');

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Kiểm giới hạn, gọi `sign` (ký URL: tính toán cục bộ, không gọi mạng) rồi ghi một dòng đếm, trong một transaction
   * riêng. `sign` lỗi thì rollback, không đếm. Khóa tài khoản trước rồi khóa BTC (`pg_advisory_xact_lock`, thứ tự cố
   * định nên không deadlock): request song song của cùng tài khoản, hay của cùng BTC, không cùng lọt quá trần. Mỗi giới
   * hạn chỉ đọc đúng một dòng: lần cấp thứ `limit` tính từ mới nhất trong cửa sổ (có → đã chạm, và đó là mốc được cấp
   * lại). Mỗi lần gọi, kể cả khi bị chặn, xóa tối đa `CLEANUP_BATCH` dòng đã ra khỏi cửa sổ của mọi tài khoản và BTC
   * (`FOR UPDATE SKIP LOCKED`: không chờ dòng request khác đang xóa, nên không deadlock). Vượt → log `warn` marker
   * `EVENT_IMAGE_PRESIGN_LIMITED` (kèm `retryAfterSeconds`) rồi `429 EVENT_IMAGE_RATE_LIMITED` kèm `retryAfterSeconds`
   * theo giới hạn chặn lâu nhất; không gọi `sign`, không ghi dòng đếm.
   */
  async issue<T>(userId: string, organizationId: string, sign: () => Promise<T>): Promise<T> {
    const { windowSeconds, perOrganization, perUser } = EVENT_IMAGE_PRESIGN_LIMITS;
    const outcome = await this.db.transaction(async (tx): Promise<Outcome<T>> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-image-presign-user:${userId}`}, 0))`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-image-presign-org:${organizationId}`}, 0))`,
      );
      const since = sql`now() - make_interval(secs => ${windowSeconds})`;
      const t = eventImagePresigns;
      // Hai giới hạn dùng chung một cửa sổ: dòng đã ra khỏi cửa sổ không còn tính cho giới hạn nào, của ai cũng xóa.
      const expired = tx
        .select({ id: t.id })
        .from(t)
        .where(lte(t.createdAt, since))
        .limit(CLEANUP_BATCH)
        .for('update', { skipLocked: true });
      await tx.delete(t).where(inArray(t.id, expired));

      /** `created_at` (ms) của lần cấp thứ `limit` (từ mới nhất) trong cửa sổ; chưa đủ `limit` lần → `undefined`. */
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

      // Thời điểm (ms) sớm nhất được cấp lại theo từng giới hạn đang chạm.
      const blocked: { limit: EventImagePresignLimit; allowedAt: number }[] = [];
      const oldestOrg = await nth(eq(t.organizationId, organizationId), perOrganization);
      if (oldestOrg !== undefined) blocked.push({ limit: 'organization', allowedAt: oldestOrg + windowSeconds * 1000 });
      const oldestUser = await nth(eq(t.userId, userId), perUser);
      if (oldestUser !== undefined) blocked.push({ limit: 'user', allowedAt: oldestUser + windowSeconds * 1000 });
      if (blocked.length > 0) {
        const now = (await dbNow(tx)).getTime();
        const latest = Math.max(...blocked.map((b) => b.allowedAt));
        return {
          limited: {
            limits: blocked.map((b) => b.limit),
            retryAfterSeconds: Math.max(1, Math.ceil((latest - now) / 1000)),
          },
        };
      }

      const issued = await sign();
      await tx.insert(t).values({ organizationId, userId });
      return { issued };
    });

    if ('issued' in outcome) return outcome.issued;
    const { limits, retryAfterSeconds } = outcome.limited;
    this.logger.warn(
      { marker: EVENT_IMAGE_PRESIGN_LIMITED, userId, organizationId, limits, retryAfterSeconds },
      'Chặn presign ảnh Sự kiện: vượt giới hạn',
    );
    const details: EventImageRateLimitedDetails = { retryAfterSeconds };
    throw new AppError(ErrorCode.EVENT_IMAGE_RATE_LIMITED, 'Bạn đã tải quá nhiều ảnh. Vui lòng thử lại sau.', {
      details,
    });
  }
}
