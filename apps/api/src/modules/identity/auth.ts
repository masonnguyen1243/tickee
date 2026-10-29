import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { ErrorCode, OTP_LENGTH, OTP_MAX_ATTEMPTS, type ErrorResponse } from '@tickee/contracts';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import type { Request, Response } from 'express';
import type { Database } from '../../platform/db/index.js';
import type { EmailTransport } from '../../platform/email/index.js';
import type { IdentityConfig } from './identity.config.js';
import { buildOtpEmail } from './otp-email.js';
import { authSchema } from './schema.js';

/** Better Auth mount dưới REST `/v1` (Story 1.4 mở callback Google qua allowlist bên dưới). */
export const AUTH_BASE_PATH = '/v1/auth';

/** OTP hết hạn sau 300 giây (AD-19). */
export const OTP_EXPIRES_IN_SECONDS = 300;

/**
 * Đường dẫn HTTP của Better Auth (tương đối với `/v1/auth`, so khớp chính xác sau khi chuẩn hóa) được mở cho bên
 * ngoài. Mặc định đóng hết: web chỉ đi qua `/v1/identity/*`, nơi có giới hạn gửi mã và `SessionGuard`/`ConsentGuard`;
 * endpoint Better Auth gọi thẳng qua HTTP thì bỏ qua cả hai. Story 1.4 thêm đăng nhập Google (sign-in, callback).
 * Chỉ chặn HTTP: `auth.api.*` phía server vẫn gọi được.
 */
export const AUTH_HTTP_ALLOWLIST: readonly string[] = [];

const NOT_FOUND_BODY: ErrorResponse = {
  error: { code: ErrorCode.NOT_FOUND, message: 'Không tìm thấy tài nguyên.', details: null },
};

/** `url` (path + query của request) có thuộc allowlist HTTP của Better Auth không. */
export function isAuthHttpPathAllowed(url: string, allowlist: readonly string[] = AUTH_HTTP_ALLOWLIST): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://auth.invalid').pathname;
  } catch {
    return false;
  }
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;
  return allowlist.includes(pathname.slice(AUTH_BASE_PATH.length));
}

/** Middleware của `AuthModule`, chạy trước handler Better Auth: ngoài allowlist → 404 dạng lỗi chuẩn. */
export function authHttpGate(req: Request, res: Response, next: () => void): void {
  if (isAuthHttpPathAllowed(req.originalUrl ?? req.url)) {
    next();
    return;
  }
  res.status(404).json(NOT_FOUND_BODY);
}

/** Gửi email OTP thất bại (SMTP lỗi): request gửi mã trả 503 và không tính vào giới hạn. */
export class EmailDeliveryError extends Error {
  constructor(cause: unknown) {
    super('Gửi email OTP thất bại', { cause });
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Better Auth nuốt lỗi của `sendVerificationOTP` (`runInBackgroundOrAwait` chỉ log rồi trả 200), nên lỗi gửi
 * email được báo ngược về request đang gửi mã qua AsyncLocalStorage bao quanh lời gọi `auth.api`.
 */
export interface OtpDeliveryState {
  failure?: EmailDeliveryError;
}
export const otpDelivery = new AsyncLocalStorage<OtpDeliveryState>();

const EMAIL_PATTERN = /[^\s"'<>@]+@[^\s"'<>@]+\.[^\s"'<>@]+/g;
const authLogger = new Logger('BetterAuth');

/**
 * Logger của Better Auth đi qua pino nhưng chỉ giữ thông điệp (đã che email) và tên/mã lỗi:
 * tham số kèm theo (lỗi DB có `detail` chứa email, object request…) không bao giờ được ghi nguyên.
 */
function logBetterAuth(level: string, message: string, ...args: unknown[]): void {
  const errors = args
    .filter((a): a is Error & { code?: unknown } => a instanceof Error)
    .map((e) => ({ type: e.name, code: e.code, message: e.message.replace(EMAIL_PATTERN, '[REDACTED]') }));
  const meta = errors.length > 0 ? { errors } : {};
  const msg = message.replace(EMAIL_PATTERN, '[REDACTED]');
  if (level === 'error') authLogger.error(meta, msg);
  else if (level === 'warn') authLogger.warn(meta, msg);
  else authLogger.log(meta, msg);
}

/** Better Auth (AD-19) — nơi duy nhất cấp session. Chỉ được dựng trong mô-đun `identity`. */
export function createAuth(config: IdentityConfig, db: Database, emailTransport: EmailTransport) {
  return betterAuth({
    appName: 'Tickee',
    baseURL: config.API_PUBLIC_URL,
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN],
    database: drizzleAdapter(db.orm, { provider: 'pg', usePlural: true, schema: authSchema }),
    user: {
      additionalFields: {
        // Chỉ `POST /v1/identity/consent` ghi cột này; client không tự đặt được.
        consentedAt: { type: 'date', required: false, input: false },
      },
    },
    // Không tự xóa verification hết hạn của người khác mỗi lần tra: nếu xóa, người nhập mã đã hết hạn
    // nhận `INVALID_OTP` thay vì `OTP_EXPIRED`. Bản ghi bị thay khi gửi mã mới hoặc bị tiêu khi xác minh.
    verification: { disableCleanup: true },
    // Giới hạn gửi mã đếm trong Postgres ở `OtpRateLimiter`, không dùng rate limiter của Better Auth.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { level: 'warn', log: logBetterAuth },
    advanced: {
      database: { generateId: false },
      cookiePrefix: 'tickee',
      // httpOnly + SameSite=Lax là mặc định của Better Auth; Secure (và tiền tố `__Secure-`) khi api chạy HTTPS,
      // theo URL công khai chứ không theo NODE_ENV (staging HTTPS cũng phải có Secure).
      useSecureCookies: new URL(config.API_PUBLIC_URL).protocol === 'https:',
      ...(config.AUTH_COOKIE_DOMAIN
        ? { crossSubDomainCookies: { enabled: true, domain: config.AUTH_COOKIE_DOMAIN } }
        : {}),
    },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: OTP_MAX_ATTEMPTS,
        storeOTP: 'hashed',
        resendStrategy: 'rotate',
        async sendVerificationOTP({ email, otp }) {
          try {
            await emailTransport.send({ to: email, ...buildOtpEmail(otp, OTP_EXPIRES_IN_SECONDS) });
          } catch (cause) {
            const failure = new EmailDeliveryError(cause);
            const state = otpDelivery.getStore();
            if (state) state.failure = failure;
            throw failure;
          }
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
