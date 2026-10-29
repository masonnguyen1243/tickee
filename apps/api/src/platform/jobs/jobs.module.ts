import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { createBoss } from './boss.js';

export const BOSS = Symbol('BOSS');

@Injectable()
/**
 * Start pg-boss ở `onModuleInit` (Nest gọi xong mọi `onModuleInit` rồi mới tới `onApplicationBootstrap`), để mô-đun
 * miền đăng ký queue, lịch và worker trong `onApplicationBootstrap` mà không phụ thuộc thứ tự giữa các mô-đun.
 */
class BossLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');

  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  async onModuleInit(): Promise<void> {
    this.boss.on('error', (err) => this.logger.error({ err }, 'pg-boss lỗi'));
    await this.boss.start();
    this.logger.log('pg-boss đã chạy');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, close: true });
    this.logger.log('pg-boss đã dừng');
  }
}

/** Hàng đợi job pg-boss: start khi khởi động, `stop({ graceful: true })` khi tắt. */
@Global()
@Module({})
export class JobsModule {
  static forRoot(options: { connectionString: string; applicationName: string }): DynamicModule {
    return {
      module: JobsModule,
      providers: [{ provide: BOSS, useFactory: () => createBoss(options.connectionString, options.applicationName) }, BossLifecycle],
      exports: [BOSS],
    };
  }
}
