import { Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG, type WorkerConfig } from './platform/config/index.js';
import { DbModule } from './platform/db/index.js';
import { JobsModule } from './platform/jobs/index.js';
import { createLoggerModule } from './platform/logging/index.js';

/** Gốc DI của vai `worker`: không mở HTTP, chạy pg-boss. */
@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        createLoggerModule({ level: config.LOG_LEVEL }),
        DbModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-worker' }),
        JobsModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-worker' }),
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }],
    };
  }
}
