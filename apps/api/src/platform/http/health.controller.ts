import { Controller, Get, Inject } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { DATABASE, type Database } from '../db/index.js';
import { RealtimeHub } from '../realtime/index.js';
import { AppError } from './app-error.js';
import { Public } from './public.decorator.js';

@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RealtimeHub) private readonly realtime: RealtimeHub,
  ) {}

  /** Liveness: tiến trình còn sống, không phụ thuộc DB. */
  @Get('healthz')
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: DB trả lời `SELECT 1` và kết nối `LISTEN` realtime đang chạy (AD-17: instance mất `LISTEN` không nhận
   * SSE mới cho tới khi nối lại); đang tắt máy → 503.
   */
  @Get('readyz')
  async readyz(): Promise<{ status: 'ok' }> {
    try {
      await this.db.ping();
    } catch (cause) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Cơ sở dữ liệu chưa sẵn sàng.', { cause });
    }
    if (!this.realtime.isReady()) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Kết nối realtime chưa sẵn sàng.');
    }
    return { status: 'ok' };
  }
}
