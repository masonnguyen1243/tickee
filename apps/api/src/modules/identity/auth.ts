import { GoogleSignInError, LOGIN_PATH, OTP_LENGTH, OTP_MAX_ATTEMPTS } from '@tickee/contracts';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import type { Database } from '../../platform/db/index.js';
import type { EmailTransport } from '../../platform/email/index.js';
import { logBetterAuth } from './better-auth-logger.js';
import { googleCallbackHook } from './google-callback.js';
import type { IdentityConfig } from './identity.config.js';
import { buildOtpEmail } from './otp-email.js';
import { EmailDeliveryError, otpDelivery } from './otp-delivery.js';
import { authSchema } from './schema.js';

/** Better Auth mount dưới REST `/v1` (chỉ callback Google mở ra ngoài, qua allowlist ở `auth-http-gate.ts`). */
export const AUTH_BASE_PATH = '/v1/auth';

/** OTP hết hạn sau 300 giây (AD-19). */
export const OTP_EXPIRES_IN_SECONDS = 300;

/** Mã provider Google của Better Auth (cột `accounts.provider_id`). */
export const GOOGLE_PROVIDER_ID = 'google';

/** Không lưu token của Google: Tickee chỉ cần danh tính, không gọi API Google thay người dùng. */
const WITHOUT_PROVIDER_TOKENS = { accessToken: null, refreshToken: null, idToken: null } as const;

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
    hooks: { after: googleCallbackHook },
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
