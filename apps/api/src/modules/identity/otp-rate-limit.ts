import { createHmac, hkdfSync } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  OTP_DAILY_FAILURE_LIMIT,
  OTP_FAILURE_WINDOW_SECONDS,
  OTP_RESEND_AFTER_SECONDS,
  type OtpLockedDetails,
  type OtpRateLimitedDetails,
} from '@tickee/contracts';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { otpSendEvents, otpVerifyFailures, sessions, verifications } from './schema.js';

/** `now()` của Postgres (đầu transaction), cùng mốc với `created_at` mặc định. */
async function dbNow(tx: Tx): Promise<number> {
  const rows = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
  return new Date(rows.rows[0]!.now).getTime();
}

/** Giới hạn gửi OTP (NFR-6). */
export const OTP_SEND_LIMITS = {
  /** Mỗi email: 1 lần mỗi 60 giây (cùng số giây web đếm ngược trước khi cho gửi lại). */
  emailCooldownSeconds: OTP_RESEND_AFTER_SECONDS,
  /** Mỗi email: tối đa 5 lần mỗi giờ. */
  emailPerHour: 5,
  /** Mỗi IP: tối đa 20 lần mỗi giờ. */
  ipPerHour: 20,
} as const;

const HOUR_MS = 3_600_000;

function otpLocked(retryAfterMs: number): AppError {
  const details: OtpLockedDetails = { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  return new AppError(ErrorCode.OTP_LOCKED, 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau.', { details });
}

/**
 * Bộ đếm gửi OTP trong Postgres, chạy TRƯỚC khi Better Auth tạo mã (nếu chặn sau thì mã cũ đã bị rotate).
 * Bảng `otp_send_events` chỉ chứa HMAC của email (đã chuẩn hóa chữ thường) và IP.
 */
@Injectable()
export class OtpRateLimiter {
  private readonly key: Buffer;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_CONFIG) config: IdentityConfig,
  ) {
    // Khóa HMAC tách miền khỏi khóa ký session dù cùng gốc BETTER_AUTH_SECRET.
    this.key = Buffer.from(hkdfSync('sha256', config.BETTER_AUTH_SECRET, 'tickee', 'identity.otp-send-events', 32));
  }

  emailHmac(email: string): string {
    return this.hmac(`email:${email.trim().toLowerCase()}`);
  }

  ipHmac(ip: string): string {
    return this.hmac(`ip:${ip}`);
  }

  /**
   * Kiểm giới hạn rồi ghi một lần gửi, trong một transaction khóa theo email rồi theo IP (`pg_advisory_xact_lock`,
   * luôn cùng thứ tự để không deadlock) để request song song cho cùng email hay cùng IP không cùng lọt.
   * Vượt giới hạn → `OTP_RATE_LIMITED` kèm `retryAfterSeconds`. Cùng lúc dọn bản ghi cũ (xem `purgeExpired`).
   * @returns id của lần gửi, để `release` nếu gửi email thất bại.
   */
  async consume(input: { email: string; ip: string }): Promise<string> {
    const emailHmac = this.emailHmac(input.email);
    const ipHmac = this.ipHmac(input.ip);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`otp-send:${emailHmac}`}, 0))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`otp-send-ip:${ipHmac}`}, 0))`);
      await this.purgeExpired(tx);
      const now = await dbNow(tx);
      const lockedMs = await this.lockedForMs(tx, emailHmac, now);
      if (lockedMs !== null) throw otpLocked(lockedMs);
      const since = sql`now() - interval '1 hour'`;

      const recentForEmail = await tx
        .select({ createdAt: otpSendEvents.createdAt })
        .from(otpSendEvents)
        .where(and(eq(otpSendEvents.emailHmac, emailHmac), gt(otpSendEvents.createdAt, since)))
        .orderBy(desc(otpSendEvents.createdAt))
        .limit(OTP_SEND_LIMITS.emailPerHour);
      const recentForIp = await tx
        .select({ createdAt: otpSendEvents.createdAt })
        .from(otpSendEvents)
        .where(and(eq(otpSendEvents.ipHmac, ipHmac), gt(otpSendEvents.createdAt, since)))
        .orderBy(desc(otpSendEvents.createdAt))
        .limit(OTP_SEND_LIMITS.ipPerHour);

      // Thời điểm (ms) sớm nhất được gửi lại theo từng giới hạn đang bị vượt.
      const allowedAt: number[] = [];
      const latest = recentForEmail[0]?.createdAt.getTime();
      if (latest !== undefined && now - latest < OTP_SEND_LIMITS.emailCooldownSeconds * 1000) {
        allowedAt.push(latest + OTP_SEND_LIMITS.emailCooldownSeconds * 1000);
      }
      const oldestEmail = recentForEmail[OTP_SEND_LIMITS.emailPerHour - 1]?.createdAt.getTime();
      if (oldestEmail !== undefined) allowedAt.push(oldestEmail + HOUR_MS);
      const oldestIp = recentForIp[OTP_SEND_LIMITS.ipPerHour - 1]?.createdAt.getTime();
      if (oldestIp !== undefined) allowedAt.push(oldestIp + HOUR_MS);

      if (allowedAt.length > 0) {
        const details: OtpRateLimitedDetails = {
          retryAfterSeconds: Math.max(1, Math.ceil((Math.max(...allowedAt) - now) / 1000)),
        };
        throw new AppError(ErrorCode.OTP_RATE_LIMITED, 'Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau.', {
          details,
        });
      }

      const [event] = await tx.insert(otpSendEvents).values({ emailHmac, ipHmac }).returning({ id: otpSendEvents.id });
      return event!.id;
    });
  }

  /** Email đang bị khóa vì nhập sai quá nhiều lần trong 24 giờ → `OTP_LOCKED`. Gọi trước khi xác minh mã. */
  async assertVerifyAllowed(email: string): Promise<void> {
    const emailHmac = this.emailHmac(email);
    const lockedMs = await this.db.transaction(async (tx) => this.lockedForMs(tx, emailHmac, await dbNow(tx)));
    if (lockedMs !== null) throw otpLocked(lockedMs);
  }

  /**
   * Ghi một lần nhập sai. Lần sai này làm email vượt ngưỡng ngày → trả lỗi `OTP_LOCKED` để thay cho lỗi mã sai.
   * Không khóa advisory: số lần đoán song song đã bị chặn bởi giới hạn 5 lần mỗi mã của Better Auth.
   */
  async recordVerifyFailure(email: string): Promise<AppError | null> {
    const emailHmac = this.emailHmac(email);
    const lockedMs = await this.db.transaction(async (tx) => {
      await tx.insert(otpVerifyFailures).values({ emailHmac });
      return this.lockedForMs(tx, emailHmac, await dbNow(tx));
    });
    return lockedMs === null ? null : otpLocked(lockedMs);
  }

  /**
   * Còn khóa bao lâu (ms), hoặc `null` nếu không khóa. Khóa khi có hơn `OTP_DAILY_FAILURE_LIMIT` lần sai trong
   * 24 giờ; mở lại khi lần sai cũ nhất cần rời cửa sổ để số lần sai về lại ngưỡng.
   */
  private async lockedForMs(tx: Tx, emailHmac: string, now: number): Promise<number | null> {
    const recent = await tx
      .select({ createdAt: otpVerifyFailures.createdAt })
      .from(otpVerifyFailures)
      .where(
        and(
          eq(otpVerifyFailures.emailHmac, emailHmac),
          gt(otpVerifyFailures.createdAt, sql`now() - make_interval(secs => ${OTP_FAILURE_WINDOW_SECONDS})`),
        ),
      )
      .orderBy(desc(otpVerifyFailures.createdAt))
      .limit(OTP_DAILY_FAILURE_LIMIT + 1);
    const pivot = recent[OTP_DAILY_FAILURE_LIMIT]?.createdAt.getTime();
    return pivot === undefined ? null : pivot + OTP_FAILURE_WINDOW_SECONDS * 1000 - now;
  }

  /**
   * Dọn rác do `identity` sở hữu: lần gửi đã ra khỏi cửa sổ một giờ; lần nhập sai ra khỏi cửa sổ 24 giờ;
   * verification hết hạn hơn 24 giờ (`identifier` chứa email dạng rõ) — verification vừa hết hạn được giữ để người
   * dùng vẫn nhận `OTP_EXPIRED`; session hết hạn hơn 24 giờ (chứa IP, user agent).
   */
  private async purgeExpired(tx: Tx): Promise<void> {
    await tx.delete(otpSendEvents).where(lt(otpSendEvents.createdAt, sql`now() - interval '1 hour'`));
    await tx
      .delete(otpVerifyFailures)
      .where(lt(otpVerifyFailures.createdAt, sql`now() - make_interval(secs => ${OTP_FAILURE_WINDOW_SECONDS})`));
    await tx.delete(verifications).where(lt(verifications.expiresAt, sql`now() - interval '24 hours'`));
    await tx.delete(sessions).where(lt(sessions.expiresAt, sql`now() - interval '24 hours'`));
  }

  /** Bỏ một lần gửi khỏi bộ đếm (email không gửi được thì không tính). */
  async release(eventId: string): Promise<void> {
    await this.db.orm.delete(otpSendEvents).where(eq(otpSendEvents.id, eventId));
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }
}
