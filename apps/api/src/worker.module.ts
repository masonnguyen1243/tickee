import { Module, type DynamicModule } from '@nestjs/common';
import { IdentityJanitorModule } from './modules/identity/index.js';
import { OrganizerJobsModule } from './modules/organizer/index.js';
import { APP_CONFIG, type WorkerConfig } from './platform/config/index.js';
import { DbModule } from './platform/db/index.js';
import { EmailModule } from './platform/email/index.js';
import { JobsModule } from './platform/jobs/index.js';
import { createLoggerModule } from './platform/logging/index.js';

/** Gốc DI của vai `worker`: không mở HTTP, chạy pg-boss, các job định kỳ và job gửi email (lời mời Admin). */
@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        createLoggerModule({ level: config.LOG_LEVEL }),
        DbModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-worker' }),
        JobsModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-worker' }),
        EmailModule.forRoot({ url: config.SMTP_URL, from: config.EMAIL_FROM }),
        // Job của mô-đun miền (chỉ vai `worker` đăng ký lịch và handler).
        IdentityJanitorModule,
        OrganizerJobsModule.forRoot({ WEB_ORIGIN: config.WEB_ORIGIN }),
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }],
    };
  }
}
