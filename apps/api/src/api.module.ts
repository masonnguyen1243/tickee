import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FlowsModule } from './flows/index.js';
import { AdminModule } from './modules/admin/index.js';
import { EventModule } from './modules/event/index.js';
import { IdentityModule } from './modules/identity/index.js';
import { OrderingModule } from './modules/ordering/index.js';
import { OrganizerModule } from './modules/organizer/index.js';
import { ReportingModule } from './modules/reporting/index.js';
import { TingeeModule } from './modules/tingee/index.js';
import { APP_CONFIG, type ApiConfig } from './platform/config/index.js';
import { DbModule } from './platform/db/index.js';
import { EmailModule } from './platform/email/index.js';
import { ErrorFilter, HealthController } from './platform/http/index.js';
import { JobsModule } from './platform/jobs/index.js';
import { createLoggerModule, type LoggingOptions } from './platform/logging/index.js';

/**
 * Gốc DI của vai `api`. Story sau thêm mô-đun miền vào `imports`.
 * Guard toàn cục (session, 2FA, đồng ý NĐ 13, Quản trị Tingee) do `IdentityModule` đăng ký: route nào không
 * `@Public()` / `@AllowAnonymous()` đều cần đăng nhập, đã qua lớp hai (nếu đã bật 2FA) và đã đồng ý; route
 * `@RequirePlatformAdmin()` còn cần cờ `platform_admin`. Guard quyền (`@RequirePermission`) do `OrganizerModule` đăng ký.
 */
@Module({})
export class ApiModule {
  static forRoot(config: ApiConfig, options: Pick<LoggingOptions, 'destination'> = {}): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        createLoggerModule({ level: config.LOG_LEVEL, ...options }),
        DbModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-api' }),
        EmailModule.forRoot({ url: config.SMTP_URL, from: config.EMAIL_FROM }),
        // Chỉ enqueue job (cùng `tx` của thay đổi); không bảo trì, không lịch, không handler — việc của vai `worker`.
        JobsModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-api', mode: 'producer' }),
        // Adapter Tingee (`TINGEE_CLIENT`, toàn cục): mọi lời gọi ký bằng credential của từng BTC (`organizer` giải mã).
        TingeeModule.forRoot({ baseUrl: config.TINGEE_BASE_URL }),
        IdentityModule.forRoot(config),
        // Sau IdentityModule: PermissionGuard chạy sau SessionGuard, TotpGuard, ConsentGuard và PlatformAdminGuard.
        OrganizerModule.forRoot(config),
        ReportingModule,
        // Sự kiện (Story 2.7): route BTC dùng `PermissionGuard` toàn cục của OrganizerModule.
        EventModule,
        // Trạng thái bán công khai (Story 2.11-a): `GET /v1/events/:slug/availability`; phễu mua (Story 3.1); Checkout
        // và tạo Đơn, giữ chỗ (Story 3.2).
        OrderingModule.forRoot(config),
        // Hạng vé và tồn kho (Story 2.8): ghi cả `event` lẫn `ordering` nên controller ở flows.
        FlowsModule,
        // Khu `/v1/admin/*`: guard Quản trị Tingee (cờ `platform_admin`, 2FA, step-up) do IdentityModule đăng ký.
        AdminModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
