import { Controller, Get, Inject } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { DATABASE, type Database } from '../db/index.js';
import { AppError } from './app-error.js';

@Controller()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Liveness: tiến trình còn sống, không phụ thuộc DB. */
  @Get('healthz')
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: DB trả lời `SELECT 1`. */
  @Get('readyz')
  async readyz(): Promise<{ status: 'ok' }> {
    try {
      await this.db.ping();
    } catch (cause) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Cơ sở dữ liệu chưa sẵn sàng.', { cause });
    }
    return { status: 'ok' };
  }
}
