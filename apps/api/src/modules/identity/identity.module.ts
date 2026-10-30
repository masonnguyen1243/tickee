import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { authHttpGate } from './auth-http-gate.js';
import { createAuth } from './auth.js';
import { ConsentGuard } from './consent.guard.js';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config.js';
import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';
import { OtpRateLimiter } from './otp-rate-limit.js';
import { SessionGuard } from './session.guard.js';
import { SignInOtpStore } from './sign-in-otp-store.js';
import { TotpAttemptLimiter } from './totp-attempts.js';
import { TotpController } from './totp.controller.js';
import { TotpService } from './totp.service.js';
import { TotpStore } from './totp-store.js';

/**
 * Tài khoản Tickee (AD-19): Better Auth mount ở `/v1/auth/*`, endpoint của web ở `/v1/identity/*`,
 * và hai guard toàn cục — `SessionGuard` rồi `ConsentGuard` (Nest chạy theo đúng thứ tự khai báo ở đây).
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
              // AD-19: giữ `req.rawBody` cho IPN (Epic 3).
              rawBody: true,
              // API chỉ nhận JSON: form HTML cross-site (urlencoded) không gửi được body hợp lệ (chống CSRF đăng nhập).
              urlencoded: { enabled: false },
            },
          }),
        }),
      ],
      controllers: [IdentityController, TotpController],
      providers: [
        { provide: IDENTITY_CONFIG, useValue: config },
        OtpRateLimiter,
        SignInOtpStore,
        IdentityService,
        TotpStore,
        TotpAttemptLimiter,
        TotpService,
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
      ],
    };
  }
}
