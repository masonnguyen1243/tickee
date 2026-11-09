import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_AFTER_SECONDS,
  REAUTH_TTL_SECONDS,
  ReauthMethod,
  type OtpInvalidDetails,
  type ReauthEmailCodeResponse,
  type ReauthGrant,
  type ReauthRequiredDetails,
} from '@tickee/contracts';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { AppError } from '../../platform/http/index.js';
import type { AuthSession } from './auth.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { OtpRateLimiter } from './otp-rate-limit.js';
import { buildReauthCodeEmail } from './reauth-email.js';
import { reauthCodes, reauthGrants, sessions, users } from './schema.js';
import { TotpAttemptLimiter } from './totp-attempts.js';
import { TotpStore } from './totp-store.js';

/*
 * Xác nhận lại trước thao tác nhạy cảm (Story 2.13): đổi tài khoản nhận tiền mặc định, hủy liên kết tài khoản nhận
 * tiền, đổi key Tingee (2.13-b), chuyển quyền Owner (2.14). Tài khoản đã bật 2FA nhập mã TOTP (không nhận mã khôi
 * phục, cùng bộ đếm sai `TotpAttemptLimiter`); chưa bật thì nhập mã 6 số gửi qua email (cùng giới hạn gửi và khóa
 * sai theo ngày `OtpRateLimiter` của đăng nhập). Đúng → một lần xác nhận gắn user + session, hết hạn sau
 * `REAUTH_TTL_SECONDS`, dùng một lần. Thao tác nhạy cảm tiêu lần xác nhận bằng `consumeReauth` trong chính transaction
 * của nó (thao tác lỗi thì rollback, lần xác nhận còn dùng được); bước đầu của thao tác nhiều bước chỉ kiểm bằng
 * `assertReauth` (không tiêu). Không dùng `sessions.step_up_at`.
 */

/** Token: 256 bit ngẫu nhiên; DB chỉ giữ SHA-256 (đủ entropy nên không cần khóa bí mật). */
const TOKEN_BYTES = 32;

const hashReauthToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** Cách xác nhận lại của user: đọc `users.two_factor_enabled` (không qua session). */
async function reauthMethodOf(db: DbExecutor, userId: string): Promise<ReauthMethod> {
  const [row] = await db.select({ enabled: users.twoFactorEnabled }).from(users).where(eq(users.id, userId));
  return row?.enabled ? ReauthMethod.TOTP : ReauthMethod.EMAIL_OTP;
}

function reauthRequired(method: ReauthMethod): AppError {
  const details: ReauthRequiredDetails = { method };
  return new AppError(ErrorCode.REAUTH_REQUIRED, 'Bạn cần xác nhận lại để tiếp tục.', { details });
}

/** Cách xác nhận đã gửi không còn đúng với tài khoản; `details.method` là cách đúng. */
function methodMismatch(method: ReauthMethod): AppError {
  const details: ReauthRequiredDetails = { method };
  const message =
    method === ReauthMethod.TOTP
      ? 'Tài khoản đã bật xác thực hai lớp: xác nhận bằng mã trong ứng dụng xác thực.'
      : 'Tài khoản không còn bật xác thực hai lớp: xác nhận bằng mã gửi qua email.';
  return new AppError(ErrorCode.REAUTH_METHOD_MISMATCH, message, { details });
}

const sessionGone = () => new AppError(ErrorCode.UNAUTHENTICATED, 'Bạn cần đăng nhập để tiếp tục.');
const codeExpired = () => new AppError(ErrorCode.OTP_EXPIRED, 'Mã đã hết hạn.');
const attemptsExceeded = () => new AppError(ErrorCode.OTP_ATTEMPTS_EXCEEDED, 'Mã đã hết hiệu lực. Hãy gửi mã mới.');
function codeInvalid(remainingAttempts: number): AppError {
  const details: OtpInvalidDetails = { remainingAttempts };
  return new AppError(ErrorCode.OTP_INVALID, `Mã chưa đúng, còn ${remainingAttempts} lần.`, { details });
}

/** Bằng chứng xác nhận lại mà controller của thao tác nhạy cảm đọc từ request. */
export interface ReauthProof {
  /** `sessions.id` của session đang gọi. */
  sessionId: string;
  /** Giá trị header `REAUTH_HEADER` (thiếu → `undefined`). */
  token: string | null | undefined;
}

/** Request đã qua `SessionGuard` (route không công khai nên luôn có session). */
export type SessionRequest = { session: { session: { id: string } } };

/** Lần xác nhận lại mà request mang theo (header `REAUTH_HEADER`) cho đúng session đang gọi; dùng ở controller. */
export const reauthProof = (req: SessionRequest, token: string | undefined): ReauthProof => ({
  sessionId: req.session.session.id,
  token,
});

/** Điều kiện của một lần xác nhận còn dùng được: `token` của đúng user và session, chưa dùng, chưa hết hạn. */
const usableGrant = (token: string, input: { userId: string } & ReauthProof) =>
  and(
    eq(reauthGrants.tokenHash, hashReauthToken(token)),
    eq(reauthGrants.userId, input.userId),
    eq(reauthGrants.sessionId, input.sessionId),
    isNull(reauthGrants.usedAt),
    gt(reauthGrants.expiresAt, sql`now()`),
  );

/**
 * Tiêu một lần xác nhận lại trong `tx` của thao tác nhạy cảm (gọi sau khi đã kiểm quyền và khóa dòng cần khóa): token
 * phải của đúng user và session, chưa dùng, chưa hết hạn. Đúng → đánh dấu đã dùng (rollback `tx` thì lần xác nhận còn
 * dùng được); không có lần xác nhận nào như vậy → 403 `REAUTH_REQUIRED` kèm `method` theo `users.two_factor_enabled`.
 * Hai request cùng token: request sau chờ khóa dòng của request trước rồi thấy `used_at` đã có → `REAUTH_REQUIRED`.
 */
export async function consumeReauth(tx: Tx, input: { userId: string } & ReauthProof): Promise<void> {
  const token = input.token?.trim();
  if (token) {
    const [used] = await tx
      .update(reauthGrants)
      .set({ usedAt: sql`now()` })
      .where(usableGrant(token, input))
      .returning({ id: reauthGrants.id });
    if (used) return;
  }
  throw reauthRequired(await reauthMethodOf(tx, input.userId));
}

/**
 * Kiểm (không tiêu) lần xác nhận lại cho bước đầu của một thao tác nhạy cảm nhiều bước (đổi key Tingee: mở form, xem
 * trước key mới), cùng điều kiện với `consumeReauth`: còn dùng được → không làm gì; không → 403 `REAUTH_REQUIRED` kèm
 * `method`. Bước ghi cuối cùng vẫn phải `consumeReauth` trong transaction của nó.
 */
export async function assertReauth(db: DbExecutor, input: { userId: string } & ReauthProof): Promise<void> {
  const token = input.token?.trim();
  if (token) {
    const [grant] = await db.select({ id: reauthGrants.id }).from(reauthGrants).where(usableGrant(token, input));
    if (grant) return;
  }
  throw reauthRequired(await reauthMethodOf(db, input.userId));
}

/** Kết quả kiểm mã email trong transaction: lần xác nhận vừa cấp, hoặc lỗi (`countFailure`: tính vào khóa theo ngày). */
type EmailCodeOutcome = { grant: ReauthGrant } | { error: AppError; countFailure: boolean };

/**
 * `POST /v1/identity/reauth/email-code` và `POST /v1/identity/reauth`. Mã email: 6 số, chỉ lưu HMAC (khóa tách miền từ
 * `BETTER_AUTH_SECRET`, gắn với user), gửi mã mới thì thay mã cũ.
 */
@Injectable()
export class ReauthService {
  private readonly codeKey: Buffer;

  constructor(
    @Inject(TotpStore) private readonly totp: TotpStore,
    @Inject(TotpAttemptLimiter) private readonly totpLimiter: TotpAttemptLimiter,
    @Inject(OtpRateLimiter) private readonly otpLimiter: OtpRateLimiter,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(IDENTITY_CONFIG) config: IdentityConfig,
  ) {
    this.codeKey = Buffer.from(hkdfSync('sha256', config.BETTER_AUTH_SECRET, 'tickee', 'identity.reauth-codes', 32));
  }

  /**
   * Gửi mã xác nhận qua email (tài khoản chưa bật 2FA; đã bật → 409 `REAUTH_METHOD_MISMATCH` `{method: totp}`, không
   * gửi). Đếm giới hạn
   * gửi của đăng nhập trước (`OTP_RATE_LIMITED`, email đang khóa → `OTP_LOCKED`), rồi lưu mã mới (thay mã cũ, 0 lần sai)
   * và gửi đồng bộ. Gửi lỗi → 503, lần gửi không tính và mã vừa lưu bị xóa.
   */
  async sendEmailCode(session: AuthSession, ip: string): Promise<ReauthEmailCodeResponse> {
    const userId = session.user.id;
    if (await this.totp.isEnabled(userId)) throw methodMismatch(ReauthMethod.TOTP);
    const email = session.user.email;
    const eventId = await this.otpLimiter.consume({ email, ip });
    const code = String(randomInt(10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    const codeHash = this.codeHash(userId, code);
    const expiresAt = sql`now() + make_interval(secs => ${REAUTH_TTL_SECONDS})`;
    try {
      await this.db.orm
        .insert(reauthCodes)
        .values({ userId, codeHash, attempts: 0, expiresAt })
        .onConflictDoUpdate({ target: reauthCodes.userId, set: { codeHash, attempts: 0, expiresAt } });
    } catch (err) {
      // Dọn best-effort: lỗi dọn không được thay lỗi gốc.
      await this.otpLimiter.release(eventId).catch(() => undefined);
      throw err;
    }
    try {
      await this.email.send({ to: email, ...buildReauthCodeEmail(code, REAUTH_TTL_SECONDS) });
    } catch {
      // Dọn best-effort: lỗi dọn không được biến 503 thành 500.
      await this.otpLimiter.release(eventId).catch(() => undefined);
      await this.db.orm
        .delete(reauthCodes)
        .where(and(eq(reauthCodes.userId, userId), eq(reauthCodes.codeHash, codeHash)))
        .catch(() => undefined);
      // Không gắn `cause`: lỗi SMTP có thể chứa địa chỉ email, mà ErrorFilter log `cause` của lỗi 5xx.
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Chưa gửi được email. Vui lòng thử lại sau ít phút.');
    }
    return { resendAfterSeconds: OTP_RESEND_AFTER_SECONDS };
  }

  /**
   * Xác nhận lại bằng `code`: tài khoản đã bật 2FA → mã TOTP; chưa bật → mã vừa gửi qua email. Đúng → lần xác nhận mới
   * cho session hiện tại (`headers`: `set-cookie` nếu plugin xoay session, controller chuyển tiếp).
   */
  async confirm(
    session: AuthSession,
    code: string,
    requestHeaders: Headers,
  ): Promise<ReauthGrant & { headers: Headers }> {
    if (await this.totp.isEnabled(session.user.id)) return this.confirmTotp(session, code, requestHeaders);
    return { ...(await this.confirmEmailCode(session, code)), headers: new Headers() };
  }

  /**
   * Mã TOTP, cùng bộ đếm sai liên tiếp với step-up (`TOTP_INVALID` / `TOTP_LOCKED`). 2FA vừa bị tắt (plugin báo chưa
   * đăng ký) → 409 `REAUTH_METHOD_MISMATCH` `{method: email_otp}`.
   */
  private async confirmTotp(
    session: AuthSession,
    code: string,
    requestHeaders: Headers,
  ): Promise<ReauthGrant & { headers: Headers }> {
    const userId = session.user.id;
    await this.totpLimiter.begin(userId);
    let verified: Awaited<ReturnType<TotpStore['verify']>>;
    try {
      verified = await this.totp.verify(requestHeaders, code);
    } catch (err) {
      await this.totpLimiter.restore(userId);
      throw err;
    }
    if (verified.status === 'not_started') {
      // 2FA vừa tắt giữa lúc kiểm và lúc xác minh: phải xác nhận bằng mã email.
      await this.totpLimiter.restore(userId);
      throw methodMismatch(ReauthMethod.EMAIL_OTP);
    }
    if (verified.status === 'invalid') throw await this.totpLimiter.fail(userId);
    const sessionToken = verified.rotatedSessionToken ?? session.session.token;
    try {
      const grant = await this.db.transaction(async (tx) => {
        await this.totpLimiter.succeed(tx, userId);
        return this.issueGrant(tx, userId, sessionToken);
      });
      return { ...grant, headers: verified.headers };
    } catch (err) {
      await this.totpLimiter.restore(userId).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Mã email: email đang khóa theo ngày → `OTP_LOCKED`. Không có mã → `OTP_ATTEMPTS_EXCEEDED`; mã hết hạn →
   * `OTP_EXPIRED`; sai → `OTP_INVALID` (còn N lần), lần sai thứ `OTP_MAX_ATTEMPTS` xóa mã → `OTP_ATTEMPTS_EXCEEDED`. Mỗi
   * lần sai một mã còn hạn được tính vào khóa theo ngày của đăng nhập (vượt ngưỡng → `OTP_LOCKED`). Đúng → xóa mã.
   */
  private async confirmEmailCode(session: AuthSession, code: string): Promise<ReauthGrant> {
    const userId = session.user.id;
    const email = session.user.email;
    await this.otpLimiter.assertVerifyAllowed(email);
    const outcome = await this.db.transaction(async (tx): Promise<EmailCodeOutcome> => {
      const [row] = await tx
        .select({
          codeHash: reauthCodes.codeHash,
          attempts: reauthCodes.attempts,
          expired: sql<boolean>`${reauthCodes.expiresAt} <= now()`,
        })
        .from(reauthCodes)
        .where(eq(reauthCodes.userId, userId))
        .for('update');
      if (!row) return { error: attemptsExceeded(), countFailure: false };
      if (row.expired) return { error: codeExpired(), countFailure: false };
      if (!this.matches(row.codeHash, this.codeHash(userId, code))) {
        const attempts = row.attempts + 1;
        if (attempts >= OTP_MAX_ATTEMPTS) {
          await tx.delete(reauthCodes).where(eq(reauthCodes.userId, userId));
          return { error: attemptsExceeded(), countFailure: true };
        }
        await tx.update(reauthCodes).set({ attempts }).where(eq(reauthCodes.userId, userId));
        return { error: codeInvalid(OTP_MAX_ATTEMPTS - attempts), countFailure: true };
      }
      await tx.delete(reauthCodes).where(eq(reauthCodes.userId, userId));
      return { grant: await this.issueGrant(tx, userId, session.session.token) };
    });
    if ('grant' in outcome) return outcome.grant;
    if (outcome.countFailure) throw (await this.otpLimiter.recordVerifyFailure(email)) ?? outcome.error;
    throw outcome.error;
  }

  /** Cấp lần xác nhận cho session `sessionToken` của user (session không còn → `UNAUTHENTICATED`). */
  private async issueGrant(tx: Tx, userId: string, sessionToken: string): Promise<ReauthGrant> {
    const [current] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.token, sessionToken), eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)));
    if (!current) throw sessionGone();
    const reauthToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const [grant] = await tx
      .insert(reauthGrants)
      .values({
        userId,
        sessionId: current.id,
        tokenHash: hashReauthToken(reauthToken),
        expiresAt: sql`now() + make_interval(secs => ${REAUTH_TTL_SECONDS})`,
      })
      .returning({ expiresAt: reauthGrants.expiresAt });
    if (!grant) throw new Error('INSERT reauth_grants không trả về dòng nào');
    return { reauthToken, expiresAt: grant.expiresAt.toISOString() };
  }

  private codeHash(userId: string, code: string): string {
    return createHmac('sha256', this.codeKey).update(`${userId}:${code}`).digest('hex');
  }

  private matches(storedHex: string, candidateHex: string): boolean {
    const stored = Buffer.from(storedHex, 'hex');
    const candidate = Buffer.from(candidateHex, 'hex');
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  }
}
