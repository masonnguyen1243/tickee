import type { IncomingMessage } from 'node:http';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { TINGEE_IPN_PATH } from '@tickee/contracts';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { authHttpGate } from './auth-http-gate.js';
import { createAuth } from './auth.js';
import { ConsentGuard } from './consent.guard.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';
import { OtpRateLimiter } from './otp-rate-limit.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { ReauthController } from './reauth.controller.js';
import { ReauthService } from './reauth.service.js';
import { SessionGuard } from './session.guard.js';
import { SignInOtpStore } from './sign-in-otp-store.js';
import { TotpAttemptLimiter } from './totp-attempts.js';
import { TotpController } from './totp.controller.js';
import { TotpGuard } from './totp.guard.js';
import { TotpService } from './totp.service.js';
import { TotpStore } from './totp-store.js';

/**
 * Đường dẫn của request (Express giữ `originalUrl` khi middleware mount theo path), bỏ query, chữ thường. Lấy `pathname`
 * bằng `new URL` để nhận cả request dạng absolute-form (`POST http://host/v1/…`: `originalUrl` giữ nguyên URL tuyệt đối
 * mà router Express vẫn khớp route).
 */
function requestPath(req: IncomingMessage): string {
  const raw = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
  let path: string;
  try {
    path = new URL(raw, 'http://localhost').pathname;
  } catch {
    path = raw.split('?', 1)[0]!;
  }
  return path.toLowerCase();
}

/**
 * Loại body mà parser JSON toàn cục đọc: `application/json` (như mặc định của `express.json`), trừ mọi đường dẫn có tiền
 * tố `TINGEE_IPN_PATH` — handler IPN (Story 3.5) tự đọc byte thô để kiểm chữ ký, sau khi đã tra `ipnKey`. So chữ thường
 * vì router Express không phân biệt hoa thường.
 */
export function parsesAsJson(req: IncomingMessage): boolean {
  const path = requestPath(req);
  if (path === TINGEE_IPN_PATH || path.startsWith(`${TINGEE_IPN_PATH}/`)) return false;
  const type = req.headers['content-type'];
  return typeof type === 'string' && type.split(';', 1)[0]!.trim().toLowerCase() === 'application/json';
}

/**
 * Tài khoản Tickee (AD-19): Better Auth mount ở `/v1/auth/*`, endpoint của web ở `/v1/identity/*`,
 * và bốn guard toàn cục — `SessionGuard`, `TotpGuard`, `ConsentGuard` rồi `PlatformAdminGuard` (chỉ ở route
 * `@RequirePlatformAdmin()`); Nest chạy theo đúng thứ tự khai báo ở đây.
 * Cần `DbModule` và `EmailModule` (toàn cục) có mặt ở gốc DI.
 */
@Module({})
export class IdentityModule {
  static forRoot(config: IdentityConfig): DynamicModule {
    return {
      module: IdentityModule,
      imports: [
        AuthModule.forRootAsync({
          // Thay bằng SessionGuard của Tickee (dạng lỗi chuẩn, chuyển tiếp cookie gia hạn session).
          disableGlobalAuthGuard: true,
          inject: [DATABASE, EMAIL_TRANSPORT],
          useFactory: (db: Database, emailTransport: EmailTransport) => ({
            auth: createAuth(config, db, emailTransport),
            // CORS do configureApiApp bật cho WEB_ORIGIN, áp cho cả /v1/auth/*.
            disableTrustedOriginsCors: true,
            // Handler HTTP của Better Auth chỉ mở các đường dẫn trong AUTH_HTTP_ALLOWLIST.
            middleware: authHttpGate,
            bodyParser: {
              // AD-19: route IPN không qua parser JSON (handler tự đọc byte thô); không route nào cần `req.rawBody`.
              json: { type: parsesAsJson },
              // API chỉ nhận JSON: form HTML cross-site (urlencoded) không gửi được body hợp lệ (chống CSRF đăng nhập).
              urlencoded: { enabled: false },
            },
          }),
        }),
      ],
      controllers: [IdentityController, TotpController, ReauthController],
      providers: [
        { provide: IDENTITY_CONFIG, useValue: config },
        OtpRateLimiter,
        SignInOtpStore,
        IdentityService,
        TotpStore,
        TotpAttemptLimiter,
        TotpService,
        ReauthService,
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: TotpGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
        { provide: APP_GUARD, useClass: PlatformAdminGuard },
      ],
    };
  }
}
