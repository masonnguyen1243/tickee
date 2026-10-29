import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { IdentityModule } from './modules/identity/index.js';
import { APP_CONFIG, type ApiConfig } from './platform/config/index.js';
import { DbModule } from './platform/db/index.js';
import { EmailModule } from './platform/email/index.js';
import { ErrorFilter, HealthController } from './platform/http/index.js';
import { createLoggerModule, type LoggingOptions } from './platform/logging/index.js';

/**
 * Gốc DI của vai `api`. Story sau thêm mô-đun miền vào `imports`.
 * Guard toàn cục (session rồi đồng ý NĐ 13) do `IdentityModule` đăng ký: route nào không `@Public()` /
 * `@AllowAnonymous()` đều cần đăng nhập và đã đồng ý.
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
        IdentityModule.forRoot(config),
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
