import { createHmac, hkdfSync } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, OTP_RESEND_AFTER_SECONDS, type OtpRateLimitedDetails } from '@tickee/contracts';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { otpSendEvents, verifications } from './schema.js';

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
      const nowRows = await tx.execute<{ now: Date }>(sql`SELECT now() AS now`);
      const now = new Date(nowRows.rows[0]!.now).getTime();
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

  /**
   * Dọn rác do `identity` sở hữu: lần gửi đã ra khỏi cửa sổ một giờ, và verification hết hạn hơn 24 giờ
   * (`identifier` chứa email dạng rõ). Verification vừa hết hạn được giữ để người dùng vẫn nhận `OTP_EXPIRED`.
   */
  private async purgeExpired(tx: Tx): Promise<void> {
    await tx.delete(otpSendEvents).where(lt(otpSendEvents.createdAt, sql`now() - interval '1 hour'`));
    await tx.delete(verifications).where(lt(verifications.expiresAt, sql`now() - interval '24 hours'`));
  }

  /** Bỏ một lần gửi khỏi bộ đếm (email không gửi được thì không tính). */
  async release(eventId: string): Promise<void> {
    await this.db.orm.delete(otpSendEvents).where(eq(otpSendEvents.id, eventId));
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }
}
