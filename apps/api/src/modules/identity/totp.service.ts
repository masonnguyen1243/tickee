import { createHmac, hkdfSync, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  formatRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  TotpRequiredReason,
  type RecoveryCodeResponse,
  type StepUpResponse,
  type TotpEnrollResponse,
  type TotpRequiredDetails,
} from '@tickee/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { AppError } from '../../platform/http/index.js';
import type { AuthSession } from './auth.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { totpRecoveryCodes } from './schema.js';
import { TotpAttemptLimiter } from './totp-attempts.js';
import { buildRecoveryCodeUsedEmail } from './totp-email.js';
import { TotpStore, type TotpVerification } from './totp-store.js';

export function totpRequired(reason: TotpRequiredReason): AppError {
  const details: TotpRequiredDetails = { reason };
  return new AppError(ErrorCode.TOTP_REQUIRED, 'Bạn cần xác thực hai lớp để tiếp tục.', { details });
}

const alreadyEnabled = () =>
  new AppError(ErrorCode.VALIDATION_FAILED, 'Bạn đã bật xác thực hai lớp.', { status: 409 });

const notStarted = () =>
  new AppError(ErrorCode.VALIDATION_FAILED, 'Phiên đăng ký đã hết. Hãy bắt đầu đăng ký lại.', { status: 409 });

const sessionGone = () => new AppError(ErrorCode.UNAUTHENTICATED, 'Bạn cần đăng nhập để tiếp tục.');

/** Một mã khôi phục ngẫu nhiên (dạng chuẩn hóa, chưa có dấu gạch). */
function randomRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) code += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)];
  return code;
}

export interface EnrollmentConfirmed {
  /** Dạng hiển thị `XXXXX-XXXXX`; chỉ trả đúng lần này, DB chỉ giữ HMAC. */
  recoveryCodes: string[];
  /** `set-cookie` của session mới (plugin xoay session), controller chuyển tiếp. */
  headers: Headers;
}

/**
 * TOTP cho Owner (FR-1, AD-26): đăng ký, step-up và mã khôi phục. Plugin `twoFactor` chỉ được chạm qua `TotpStore`;
 * bộ đếm sai liên tiếp ở `TotpAttemptLimiter`.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger('TotpService');
  private readonly recoveryKey: Buffer;

  constructor(
    @Inject(TotpStore) private readonly store: TotpStore,
    @Inject(TotpAttemptLimiter) private readonly limiter: TotpAttemptLimiter,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(IDENTITY_CONFIG) config: IdentityConfig,
  ) {
    // Khóa HMAC tách miền khỏi khóa ký session và khóa HMAC của OTP dù cùng gốc BETTER_AUTH_SECRET.
    this.recoveryKey = Buffer.from(
      hkdfSync('sha256', config.BETTER_AUTH_SECRET, 'tickee', 'identity.totp-recovery-codes', 32),
    );
  }

  /** Bắt đầu (hoặc bắt đầu lại) đăng ký: secret mới, URI cho QR và khóa nhập tay. Đã đăng ký → 409. */
  async beginEnrollment(session: AuthSession, requestHeaders: Headers): Promise<TotpEnrollResponse> {
    if (await this.store.isEnabled(session.user.id)) throw alreadyEnabled();
    return this.store.beginEnrollment(requestHeaders);
  }

  /**
   * Xác nhận đăng ký bằng mã đầu tiên. Đúng → plugin bật TOTP và xoay session; Tickee sinh bộ 10 mã khôi phục mới
   * (bộ cũ hết hiệu lực), đặt `step_up_at = now()` cho session mới và ghi audit `totp.enrolled`.
   */
  async confirmEnrollment(session: AuthSession, code: string, requestHeaders: Headers): Promise<EnrollmentConfirmed> {
    const userId = session.user.id;
    if (await this.store.isEnabled(userId)) throw alreadyEnabled();
    const verified = await this.checkCode(userId, () => this.store.verify(requestHeaders, code));
    const sessionToken = verified.rotatedSessionToken ?? session.session.token;
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);

    try {
      await this.db.transaction(async (tx) => {
        await this.limiter.succeed(tx, userId);
        await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
        await tx.insert(totpRecoveryCodes).values(codes.map((c) => ({ userId, codeHmac: this.recoveryHmac(c) })));
        if (!(await this.store.markStepUp(tx, userId, sessionToken))) throw sessionGone();
        await audit.record(tx, {
          actorUserId: userId,
          organizationId: null,
          action: 'totp.enrolled',
          target: { type: 'user', id: userId },
        });
      });
    } catch (err) {
      // Plugin đã bật TOTP nhưng Tickee chưa có mã khôi phục: gỡ lại (best-effort) để user đăng ký lại được.
      await this.db.transaction((tx) => this.store.remove(tx, userId)).catch(() => undefined);
      await this.limiter.restore(userId).catch(() => undefined);
      throw err;
    }
    return { recoveryCodes: codes.map(formatRecoveryCode), headers: verified.headers };
  }

  /** Step-up bằng mã TOTP: đúng → `step_up_at = now()` cho session hiện tại. Chưa đăng ký → `TOTP_REQUIRED` enroll. */
  async stepUp(
    session: AuthSession,
    code: string,
    requestHeaders: Headers,
  ): Promise<StepUpResponse & { headers: Headers }> {
    const userId = session.user.id;
    if (!(await this.store.isEnabled(userId))) throw totpRequired(TotpRequiredReason.ENROLL);
    const verified = await this.checkCode(userId, () => this.store.verify(requestHeaders, code));
    const sessionToken = verified.rotatedSessionToken ?? session.session.token;
    let stepUpAt: Date;
    try {
      stepUpAt = await this.db.transaction(async (tx) => {
        await this.limiter.succeed(tx, userId);
        const at = await this.store.markStepUp(tx, userId, sessionToken);
        if (!at) throw sessionGone();
        return at;
      });
    } catch (err) {
      await this.limiter.restore(userId).catch(() => undefined);
      throw err;
    }
    return { stepUpAt: stepUpAt.toISOString(), headers: verified.headers };
  }

  /**
   * Step-up bằng mã khôi phục: mã hết hiệu lực, TOTP hiện tại bị gỡ (lần request Owner kế tiếp ra `TOTP_REQUIRED`
   * enroll), audit `totp.recovery_code_used`; sau khi commit gửi email báo cho user (lỗi gửi chỉ ghi log).
   * Mã sai hoặc đã dùng → `TOTP_INVALID`, tính vào cùng bộ đếm với TOTP.
   */
  async useRecoveryCode(session: AuthSession, recoveryCode: string): Promise<RecoveryCodeResponse> {
    const userId = session.user.id;
    if (!(await this.store.isEnabled(userId))) throw totpRequired(TotpRequiredReason.ENROLL);
    await this.limiter.begin(userId);
    let stepUpAt: Date | null;
    try {
      stepUpAt = await this.db.transaction(async (tx) => {
        const [used] = await tx
          .update(totpRecoveryCodes)
          .set({ usedAt: sql`now()` })
          .where(
            and(
              eq(totpRecoveryCodes.userId, userId),
              eq(totpRecoveryCodes.codeHmac, this.recoveryHmac(recoveryCode)),
              isNull(totpRecoveryCodes.usedAt),
            ),
          )
          .returning({ id: totpRecoveryCodes.id });
        if (!used) return null;
        await this.limiter.succeed(tx, userId);
        await this.store.remove(tx, userId);
        const at = await this.store.markStepUp(tx, userId, session.session.token);
        if (!at) throw sessionGone();
        await audit.record(tx, {
          actorUserId: userId,
          organizationId: null,
          action: 'totp.recovery_code_used',
          target: { type: 'user', id: userId },
        });
        return at;
      });
    } catch (err) {
      await this.limiter.restore(userId);
      throw err;
    }
    if (!stepUpAt) throw await this.limiter.fail(userId);
    await this.notifyRecoveryCodeUsed(session.user.email);
    return { stepUpAt: stepUpAt.toISOString(), reenrollRequired: true };
  }

  /** Gửi đồng bộ như OTP (api chưa có pg-boss); lỗi gửi không làm hỏng step-up đã commit. */
  private async notifyRecoveryCodeUsed(to: string): Promise<void> {
    try {
      await this.email.send({ to, ...buildRecoveryCodeUsedEmail() });
    } catch (err) {
      // Chỉ tên lớp lỗi: message của lỗi SMTP có thể chứa địa chỉ email.
      const errName = (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';
      this.logger.warn({ errName }, 'Không gửi được email báo dùng mã khôi phục');
    }
  }

  /** Giữ lượt, xác minh, rồi đổi kết quả thành lỗi miền (`TOTP_INVALID`/`TOTP_LOCKED`) khi sai. */
  private async checkCode(
    userId: string,
    verify: () => Promise<TotpVerification>,
  ): Promise<Extract<TotpVerification, { status: 'valid' }>> {
    await this.limiter.begin(userId);
    let result: TotpVerification;
    try {
      result = await verify();
    } catch (err) {
      await this.limiter.restore(userId);
      throw err;
    }
    if (result.status === 'not_started') {
      await this.limiter.restore(userId);
      throw notStarted();
    }
    if (result.status === 'invalid') throw await this.limiter.fail(userId);
    return result;
  }

  private recoveryHmac(normalized: string): string {
    return createHmac('sha256', this.recoveryKey).update(normalized).digest('hex');
  }
}
