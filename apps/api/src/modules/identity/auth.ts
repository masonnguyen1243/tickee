import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import {
  ErrorCode,
  GoogleSignInError,
  LOGIN_PATH,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  SIGN_IN_ERROR_PARAM,
  type ErrorResponse,
} from '@tickee/contracts';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins/email-otp';
import type { Request, Response } from 'express';
import type { Database } from '../../platform/db/index.js';
import type { EmailTransport } from '../../platform/email/index.js';
import type { IdentityConfig } from './identity.config.js';
import { buildOtpEmail } from './otp-email.js';
import { authSchema } from './schema.js';

/** Better Auth mount dưới REST `/v1` (chỉ callback Google mở ra ngoài, qua allowlist bên dưới). */
export const AUTH_BASE_PATH = '/v1/auth';

/** OTP hết hạn sau 300 giây (AD-19). */
export const OTP_EXPIRES_IN_SECONDS = 300;

/** Mã provider Google của Better Auth (cột `accounts.provider_id`). */
export const GOOGLE_PROVIDER_ID = 'google';

/**
 * Đường dẫn HTTP của Better Auth (tương đối với `/v1/auth`, so khớp chính xác pathname sau khi chuẩn hóa, bỏ qua
 * query) được mở cho bên ngoài. Mặc định đóng hết: web chỉ đi qua `/v1/identity/*`, nơi có giới hạn gửi mã và
 * `SessionGuard`/`ConsentGuard`; endpoint Better Auth gọi thẳng qua HTTP thì bỏ qua cả hai. Chỉ mở callback Google
 * (Google điều hướng trình duyệt về đây); bắt đầu đăng nhập Google đi qua `GET /v1/identity/google`.
 * Chỉ chặn HTTP: `auth.api.*` phía server vẫn gọi được.
 */
export const AUTH_HTTP_ALLOWLIST: readonly string[] = [`/callback/${GOOGLE_PROVIDER_ID}`];

/** Phương thức HTTP được qua cổng: Google quay về callback bằng điều hướng GET top-level. */
const AUTH_HTTP_METHODS: ReadonlySet<string> = new Set(['GET']);

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
  if (AUTH_HTTP_METHODS.has(req.method) && isAuthHttpPathAllowed(req.originalUrl ?? req.url)) {
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
export function logBetterAuth(level: string, message: unknown, ...args: unknown[]): void {
  // Better Auth có chỗ gọi `logger.error(e)` với chính object lỗi làm thông điệp.
  const errors = [message, ...args]
    .filter((a): a is Error & { code?: unknown } => a instanceof Error)
    .map((e) => ({ type: e.name, code: e.code, message: String(e.message).replace(EMAIL_PATTERN, '[REDACTED]') }));
  const meta = errors.length > 0 ? { errors } : {};
  const msg = String(message ?? '').replace(EMAIL_PATTERN, '[REDACTED]');
  if (level === 'error') authLogger.error(meta, msg);
  else if (level === 'warn') authLogger.warn(meta, msg);
  else authLogger.log(meta, msg);
}

/** Không lưu token của Google: Tickee chỉ cần danh tính, không gọi API Google thay người dùng. */
const WITHOUT_PROVIDER_TOKENS = { accessToken: null, refreshToken: null, idToken: null } as const;

/** Callback OAuth của Better Auth (`/callback/:id`). */
const OAUTH_CALLBACK_ENDPOINT = '/callback/:id';

/**
 * Better Auth kiểm `email_verified` của provider *trước* `validateUserInfo` khi email đã có user (nối tài khoản), và
 * khi đó trả `account_not_linked`. Với cấu hình của Tickee (`trustedProviders: []`, liên kết bật, user OTP luôn
 * `emailVerified`, user Google chỉ được tạo khi email đã xác minh) mã này chỉ xảy ra khi Google báo email chưa xác
 * minh, nên đổi thành `email_not_verified` để web hiện đúng thông báo dù email mới hay đã có.
 */
export function rewriteUnverifiedLinkError(location: string): string | null {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  if (url.searchParams.get(SIGN_IN_ERROR_PARAM) !== 'account_not_linked') return null;
  url.searchParams.set(SIGN_IN_ERROR_PARAM, GoogleSignInError.EMAIL_NOT_VERIFIED);
  url.searchParams.delete('error_description');
  return url.toString();
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
      // Chạy trước khi tạo user, nối tài khoản hay đăng nhập lại bằng Google: email Google chưa xác minh thì từ chối,
      // không ghi `users`/`accounts`/`sessions` nào. Callback chuyển lỗi về `errorCallbackURL?error=email_not_verified`.
      validateUserInfo: ({ user, source }) => {
        if (source.method === 'oauth' && user.emailVerified !== true) {
          return { error: GoogleSignInError.EMAIL_NOT_VERIFIED, errorDescription: 'Email chưa được xác minh' };
        }
        return undefined;
      },
    },
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        // Chỉ `openid email profile` (mặc định của Better Auth); không gộp scope đã cấp trước đó.
        includeGrantedScopes: false,
        // `users.name` lấy theo Google; không lưu ảnh đại diện.
        mapProfileToUser: () => ({ image: undefined }),
      },
    },
    account: {
      // Cùng email (chữ thường) luôn là một user: Google tự nối vào user OTP sẵn có. Không tin provider nào
      // (`trustedProviders: []`) để Better Auth luôn đòi `email_verified`; `requireLocalEmailVerified` giữ mặc định.
      accountLinking: { enabled: true, trustedProviders: [], updateUserInfoOnLink: true },
    },
    databaseHooks: {
      account: {
        create: { before: async (account) => ({ data: { ...account, ...WITHOUT_PROVIDER_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...WITHOUT_PROVIDER_TOKENS } }) },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== OAUTH_CALLBACK_ENDPOINT) return;
        const returned = ctx.context.returned;
        const location = isAPIError(returned) ? returned.headers?.get('location') : null;
        const rewritten = location ? rewriteUnverifiedLinkError(location) : null;
        if (rewritten) throw ctx.redirect(rewritten);
      }),
    },
    // Lỗi OAuth không gắn được với một state hợp lệ (state sai/hết hạn) về màn đăng nhập của web, không về
    // `/v1/auth/error` (đã bị cổng HTTP chặn).
    onAPIError: { errorURL: `${config.WEB_ORIGIN}${LOGIN_PATH}` },
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
      // Áp cho mọi cookie của Better Auth (session OTP/Google, state OAuth `tickee.state`).
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
