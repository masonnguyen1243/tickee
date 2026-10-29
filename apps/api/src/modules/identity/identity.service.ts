import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import {
  DEFAULT_RETURN_TO,
  ErrorCode,
  GOOGLE_RETURN_PATH,
  LOGIN_PATH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_AFTER_SECONDS,
  type Me,
  type OtpInvalidDetails,
  type SendOtpResponse,
} from '@tickee/contracts';
import { isAPIError } from 'better-auth/api';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { GOOGLE_PROVIDER_ID, otpDelivery, type Auth, type AuthSession, type OtpDeliveryState } from './auth.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { OtpRateLimiter } from './otp-rate-limit.js';
import { users } from './schema.js';

/** Định danh verification mà plugin emailOTP dùng cho mã đăng nhập (`toOTPIdentifier`). */
const signInIdentifier = (email: string): string => `sign-in-otp-${email}`;

/** Số lần nhập sai đã ghi trong verification (`"<hash>:<attempts>"`). */
function usedAttempts(value: string): number {
  const n = Number.parseInt(value.slice(value.lastIndexOf(':') + 1), 10);
  return Number.isFinite(n) ? n : 0;
}

export interface GoogleSignInStart {
  /** URL ủy quyền của Google (đã gắn `state`), controller trả 302 tới đây. */
  url: string;
  /** Header `set-cookie` của cookie state OAuth. */
  headers: Headers;
}

export interface SignInResult {
  consentRequired: boolean;
  /** Header `set-cookie` của session mới, controller chuyển tiếp cho trình duyệt. */
  headers: Headers;
}

/** Luồng đăng nhập OTP email bọc quanh `auth.api.*` (web không gọi thẳng endpoint OTP của Better Auth). */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService<Auth>,
    @Inject(OtpRateLimiter) private readonly rateLimiter: OtpRateLimiter,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  /**
   * Bắt đầu đăng nhập Google. `returnTo` đã qua `safeReturnTo`. Mọi URL quay về là URL tuyệt đối trên `WEB_ORIGIN`
   * do server tự dựng: lời gọi `auth.api.*` phía server không chạy `originCheck`, nên không nhận URL từ client.
   * Thành công (user mới hay cũ) → trang trung gian `/dang-nhap/google`; lỗi → `/dang-nhap?error=…`, cả hai giữ `returnTo`.
   */
  async startGoogleSignIn(returnTo: string, requestHeaders: Headers): Promise<GoogleSignInStart> {
    const query = returnTo === DEFAULT_RETURN_TO ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
    const callbackURL = `${this.config.WEB_ORIGIN}${GOOGLE_RETURN_PATH}${query}`;
    const { headers, response } = await this.auth.api.signInSocial({
      body: {
        provider: GOOGLE_PROVIDER_ID,
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL: `${this.config.WEB_ORIGIN}${LOGIN_PATH}${query}`,
        disableRedirect: true,
      },
      headers: requestHeaders,
      returnHeaders: true,
    });
    if (!response.url) throw new Error('Better Auth không trả URL ủy quyền Google');
    return { url: response.url, headers };
  }

  /** Đếm giới hạn trong Postgres trước, rồi mới để Better Auth tạo (rotate) mã và gửi email. */
  async sendSignInCode(email: string, ip: string): Promise<SendOtpResponse> {
    const eventId = await this.rateLimiter.consume({ email, ip });
    const delivery: OtpDeliveryState = {};
    try {
      await otpDelivery.run(delivery, () => this.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } }));
    } catch (err) {
      await this.rateLimiter.release(eventId);
      throw err;
    }
    if (delivery.failure) {
      await this.rateLimiter.release(eventId);
      // Better Auth đã lưu mã mới (0 lần sai) dù email không đi: xóa đi, nếu không mỗi vòng "gửi → 503" lại cho
      // thêm 5 lần đoán mà không tốn lượt gửi.
      const context = await this.auth.instance.$context;
      await context.internalAdapter.deleteVerificationByIdentifier(signInIdentifier(email));
      // Không gắn `cause`: lỗi SMTP có thể chứa địa chỉ email, mà ErrorFilter log `cause` của lỗi 5xx.
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Chưa gửi được email. Vui lòng thử lại sau ít phút.');
    }
    return { resendAfterSeconds: OTP_RESEND_AFTER_SECONDS };
  }

  /**
   * Xác minh mã; user chỉ được tạo ở lần xác minh đúng đầu tiên (`signInEmailOTP`). Email đang bị khóa theo ngày
   * thì từ chối trước khi tới Better Auth; mỗi lần đoán sai một mã đang tồn tại được ghi lại để tính ngưỡng khóa.
   */
  async signInWithCode(email: string, otp: string, requestHeaders: Headers): Promise<SignInResult> {
    await this.rateLimiter.assertVerifyAllowed(email);
    // Chỉ đếm lần sai khi có mã để đoán: nếu không, ai biết email cũng khóa được người đó 24 giờ chỉ bằng
    // 16 request verify mà không cần gửi mã nào.
    const context = await this.auth.instance.$context;
    const hadCode = (await context.internalAdapter.findVerificationValue(signInIdentifier(email))) !== null;
    try {
      const { headers, response } = await this.auth.api.signInEmailOTP({
        body: { email, otp },
        headers: requestHeaders,
        returnHeaders: true,
      });
      // Kiểu trả về của endpoint plugin không gồm additionalFields, nhưng giá trị runtime có `consentedAt`.
      const user = response.user as typeof response.user & Pick<AuthSession['user'], 'consentedAt'>;
      return { consentRequired: !user.consentedAt, headers };
    } catch (err) {
      const mapped = await this.mapOtpError(err, email);
      if (
        hadCode &&
        mapped instanceof AppError &&
        (mapped.code === ErrorCode.OTP_INVALID || mapped.code === ErrorCode.OTP_ATTEMPTS_EXCEEDED)
      ) {
        throw (await this.rateLimiter.recordVerifyFailure(email)) ?? mapped;
      }
      throw mapped;
    }
  }

  async signOut(requestHeaders: Headers): Promise<Headers> {
    const { headers } = await this.auth.api.signOut({ headers: requestHeaders, returnHeaders: true });
    return headers;
  }

  /** Ghi thời điểm đồng ý NĐ 13; gọi lại khi đã đồng ý thì giữ thời điểm cũ. */
  async recordConsent(session: AuthSession): Promise<Me> {
    await this.db.orm
      .update(users)
      .set({ consentedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(users.id, session.user.id), isNull(users.consentedAt)));
    const [user] = await this.db.orm
      .select({ id: users.id, email: users.email, consentedAt: users.consentedAt })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Bạn cần đăng nhập để tiếp tục.');
    return { id: user.id, email: user.email, consentedAt: user.consentedAt?.toISOString() ?? null };
  }

  toMe(session: AuthSession): Me {
    const consentedAt = session.user.consentedAt;
    return {
      id: session.user.id,
      email: session.user.email,
      consentedAt: consentedAt ? new Date(consentedAt).toISOString() : null,
    };
  }

  private async mapOtpError(err: unknown, email: string): Promise<unknown> {
    if (!isAPIError(err)) return err;
    const code = (err.body as { code?: string } | undefined)?.code;
    switch (code) {
      case 'OTP_EXPIRED':
        return new AppError(ErrorCode.OTP_EXPIRED, 'Mã đã hết hạn.');
      case 'TOO_MANY_ATTEMPTS':
        return attemptsExceeded();
      case 'INVALID_OTP': {
        // Better Auth đã ghi lại lần sai vào phần `:attempts`; còn 0 lượt (lần sai thứ 5) hoặc không còn mã → hết hiệu lực.
        const context = await this.auth.instance.$context;
        const verification = await context.internalAdapter.findVerificationValue(signInIdentifier(email));
        const remaining = verification ? OTP_MAX_ATTEMPTS - usedAttempts(verification.value) : 0;
        if (remaining <= 0) return attemptsExceeded();
        const details: OtpInvalidDetails = { remainingAttempts: remaining };
        return new AppError(ErrorCode.OTP_INVALID, `Mã chưa đúng, còn ${remaining} lần.`, { details });
      }
      default:
        return err;
    }
  }
}

const attemptsExceeded = (): AppError =>
  new AppError(ErrorCode.OTP_ATTEMPTS_EXCEEDED, 'Mã đã hết hiệu lực. Hãy gửi mã mới.');
