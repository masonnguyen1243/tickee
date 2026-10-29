import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, OTP_FAILURE_WINDOW_SECONDS } from '@tickee/contracts';
import { lt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { googleStartEvents, otpSendEvents, otpVerifyFailures, sessions, verifications } from './schema.js';

/** Lịch dọn rác: mỗi 10 phút (cron, UTC). */
export const PURGE_EXPIRED_CRON = '*/10 * * * *';

/**
 * Dọn rác do `identity` sở hữu. Idempotent: chạy lại (pg-boss retry, hai worker cùng chạy) chỉ xóa thêm 0 dòng.
 * - lần gửi OTP và lần bắt đầu Google đã ra khỏi cửa sổ một giờ;
 * - lần nhập sai ra khỏi cửa sổ 24 giờ;
 * - verification hết hạn hơn 24 giờ (`identifier` chứa email dạng rõ; state OAuth `auth-state:*`) — verification vừa
 *   hết hạn được giữ để người dùng vẫn nhận `OTP_EXPIRED` (vì vậy không bỏ `verification.disableCleanup`);
 * - session hết hạn hơn 24 giờ (chứa IP, user agent).
 */
export async function purgeExpired(db: Database): Promise<void> {
  await db.orm.delete(otpSendEvents).where(lt(otpSendEvents.createdAt, sql`now() - interval '1 hour'`));
  await db.orm.delete(googleStartEvents).where(lt(googleStartEvents.createdAt, sql`now() - interval '1 hour'`));
  await db.orm
    .delete(otpVerifyFailures)
    .where(lt(otpVerifyFailures.createdAt, sql`now() - make_interval(secs => ${OTP_FAILURE_WINDOW_SECONDS})`));
  await db.orm.delete(verifications).where(lt(verifications.expiresAt, sql`now() - interval '24 hours'`));
  await db.orm.delete(sessions).where(lt(sessions.expiresAt, sql`now() - interval '24 hours'`));
}

/**
 * Đăng ký queue `identity.purge-expired`, lịch mỗi 10 phút và handler. Chỉ chạy ở vai `worker` (vai `api` không có
 * pg-boss). pg-boss đã start ở `onModuleInit` của `JobsModule`, trước mọi `onApplicationBootstrap`.
 * `createQueue`/`schedule` đều là upsert nên khởi động lại hay nhiều worker vẫn chỉ có một lịch.
 */
@Injectable()
export class IdentityJanitor implements OnApplicationBootstrap {
  private readonly logger = new Logger('IdentityJanitor');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const queue = JobQueue.IDENTITY_PURGE_EXPIRED;
    await this.boss.createQueue(queue);
    await this.boss.schedule(queue, PURGE_EXPIRED_CRON);
    // Lỗi ném ra → pg-boss đánh dấu failed và retry theo cấu hình queue.
    await this.boss.work(queue, async () => {
      await purgeExpired(this.db);
    });
    this.logger.log(`Đã đăng ký job ${queue}`);
  }
}

/** Dọn rác định kỳ của `identity` cho vai `worker`. Cần `DbModule` và `JobsModule` (toàn cục) ở gốc DI. */
@Module({ providers: [IdentityJanitor] })
export class IdentityJanitorModule {}
