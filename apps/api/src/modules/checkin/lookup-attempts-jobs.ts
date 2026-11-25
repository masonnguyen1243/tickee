import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { CHECKIN_LOOKUP_RATE_LIMITS, JobQueue } from '@tickee/contracts';
import { lt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { BOSS, defineQueue, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import { checkinLookupAttempts } from './schema.js';

/*
 * Dọn bộ đếm tra tay (Story 5.5) ở vai worker, theo mẫu dọn `order_create_attempts` của `ordering/safety-net-jobs.ts`:
 * một cron, không payload, không retry, không dead-letter (lượt kế làm lại). Hàm dọn gọi thẳng được (test).
 */

/** Lịch dọn bộ đếm tra tay: mỗi 10 phút (bằng cửa sổ giới hạn; dòng cũ không còn tác dụng, chỉ chiếm chỗ). */
export const PURGE_LOOKUP_ATTEMPTS_CRON = '*/10 * * * *';

/**
 * Xóa lượt tra tay đã ra khỏi cửa sổ giới hạn tốc độ (cũ hơn `CHECKIN_LOOKUP_RATE_LIMITS.windowSeconds`, đồng hồ DB): giới
 * hạn chỉ đếm lượt trong cửa sổ, nên dòng cũ hơn không còn tác dụng. Idempotent. Trả số dòng đã xóa.
 */
export async function purgeCheckinLookupAttempts(db: Database): Promise<number> {
  const t = checkinLookupAttempts;
  const result = await db.orm
    .delete(t)
    .where(lt(t.createdAt, sql`now() - make_interval(secs => ${CHECKIN_LOOKUP_RATE_LIMITS.windowSeconds})`));
  return result.rowCount ?? 0;
}

/** Queue cron dọn bộ đếm tra tay: không payload (pg-boss gửi `null`), không retry, không dead-letter. */
export const PURGE_LOOKUP_ATTEMPTS_QUEUE = defineQueue({
  name: JobQueue.CHECKIN_PURGE_LOOKUP_ATTEMPTS,
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: z.unknown(),
});

/** Vai `worker`: tạo queue, lên lịch (upsert: nhiều worker vẫn một lịch) và đăng ký handler dọn. */
@Injectable()
export class CheckinLookupAttemptsJanitor implements OnApplicationBootstrap {
  private readonly logger = new Logger('CheckinLookupAttemptsJanitor');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, PURGE_LOOKUP_ATTEMPTS_QUEUE, {
      logger: this.logger,
      label: 'Dọn bộ đếm tra tay',
      logContext: () => ({}),
      handle: async () => {
        await purgeCheckinLookupAttempts(this.db);
        return JOB_COMPLETED;
      },
    });
    await this.boss.schedule(PURGE_LOOKUP_ATTEMPTS_QUEUE.name, PURGE_LOOKUP_ATTEMPTS_CRON);
  }
}

/** Job nền của `checkin` cho vai `worker`: dọn bộ đếm tra tay. Cần `DbModule` và `JobsModule` (toàn cục) ở gốc DI. */
@Module({ providers: [CheckinLookupAttemptsJanitor] })
export class CheckinJobsModule {}
