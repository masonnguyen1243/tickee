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
import { createBoss, type BossMode, type BossOptions } from './boss.js';

export const BOSS = Symbol('BOSS');
const BOSS_MODE = Symbol('BOSS_MODE');

@Injectable()
/**
 * Start pg-boss ở `onModuleInit` (Nest gọi xong mọi `onModuleInit` rồi mới tới `onApplicationBootstrap`), để mô-đun
 * miền đăng ký queue, lịch và worker trong `onApplicationBootstrap` mà không phụ thuộc thứ tự giữa các mô-đun.
 * Chế độ `producer` (vai `api`) không chờ start: lỗi chỉ log, lần enqueue sau gọi `boss.start()` lại.
 */
class BossLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(BOSS_MODE) private readonly mode: BossMode,
  ) {}

  async onModuleInit(): Promise<void> {
    this.boss.on('error', (err) => this.logger.error({ err }, 'pg-boss lỗi'));
    if (this.mode === 'producer') {
      this.boss.start().then(
        () => this.logger.log('pg-boss đã chạy (chỉ gửi job)'),
        (err: unknown) => this.logger.warn({ err }, 'pg-boss chưa start được; sẽ thử lại khi gửi job'),
      );
      return;
    }
    await this.boss.start();
    this.logger.log('pg-boss đã chạy');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, close: true });
    this.logger.log('pg-boss đã dừng');
  }
}

/**
 * Hàng đợi job pg-boss: start khi khởi động, `stop({ graceful: true })` khi tắt. Vai `api` dùng `mode: 'producer'`
 * (chỉ enqueue); vai `worker` chạy bảo trì, lịch và handler.
 */
@Global()
@Module({})
export class JobsModule {
  static forRoot(options: BossOptions): DynamicModule {
    return {
      module: JobsModule,
      providers: [
        { provide: BOSS, useFactory: () => createBoss(options) },
        { provide: BOSS_MODE, useValue: options.mode ?? 'worker' },
        BossLifecycle,
      ],
      exports: [BOSS],
    };
  }
}
