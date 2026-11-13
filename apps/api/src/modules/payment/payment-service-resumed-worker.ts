import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { DATABASE, dbClock, type Database } from '../../platform/db/index.js';
import { BOSS, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import { enqueueReconciliation, RECONCILE_ORDER_QUEUE, reconcilableOrderIdsOf } from '../ordering/index.js';
import { PAYMENT_SERVICE_RESUMED_QUEUE } from '../organizer/index.js';

/*
 * Đối soát bù khi dịch vụ thanh toán của BTC mở lại (Story 4.2, AD-32, AD-8), vai worker. Mọi đường tắt cờ nằm ở
 * `organizer`/`admin` (không được import `ordering`/`payment`), nên `organizer` enqueue job `payment.service-resumed`
 * bằng chính `tx` tắt cờ; worker này nhận job và, trong một transaction, enqueue job tra của 4.1
 * (`payment.reconcile-order`) tại đồng hồ DB cho mọi Đơn còn mở của BTC (`ordering.reconcilableOrderIdsOf`: có link,
 * `pending`, hoặc `expired` với `expires_at` trong 24 giờ trước). Job tra idempotent và tự hẹn mốc kế (Đơn `expired` chưa
 * tới mốc sau hết hạn thì chỉ hẹn mốc, không gọi Tingee), nên tra "ngay" an toàn và nối lại chuỗi đã dừng. Cờ
 * `TINGEE_ORDER_STATUS_QUERY` tắt thì job tra xong ngay như 4.1.
 */

/** Kết quả một job "đã mở lại" (log, test): mốc tra (đồng hồ DB) và các Đơn đã enqueue job tra. */
export interface ResumedReconciliation {
  checkAt: Date;
  orderIds: string[];
}

@Injectable()
export class PaymentServiceResumedWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('PaymentServiceResumedWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Job tra enqueue vào queue của 4.1: phải có trước lần enqueue đầu (gọi lại không sao).
    await RECONCILE_ORDER_QUEUE.ensure(this.boss);
    await registerQueueWorker(this.boss, PAYMENT_SERVICE_RESUMED_QUEUE, {
      logger: this.logger,
      label: 'Đối soát bù khi mở lại dịch vụ thanh toán',
      logContext: ({ organizationId }) => ({ organizationId }),
      handle: async ({ organizationId }) => {
        const { checkAt, orderIds } = await this.reconcileOpenOrders(organizationId);
        this.logger.log(
          { organizationId, orders: orderIds.length, checkAt: checkAt.toISOString() },
          'Dịch vụ thanh toán mở lại: đã hẹn Đối soát bù các Đơn còn mở',
        );
        return JOB_COMPLETED;
      },
    });
  }

  /**
   * Một transaction: đồng hồ DB, các Đơn còn mở của BTC, rồi job tra của từng Đơn tại mốc đó (id cố định theo Đơn và mốc).
   * Lỗi DB → ném: pg-boss retry cả job (transaction đã rollback, không có job tra nào).
   */
  async reconcileOpenOrders(organizationId: string): Promise<ResumedReconciliation> {
    return this.db.transaction(async (tx) => {
      const checkAt = await dbClock(tx);
      const orderIds = await reconcilableOrderIdsOf(tx, organizationId, checkAt);
      for (const orderId of orderIds) await enqueueReconciliation(this.boss, tx, orderId, checkAt);
      return { checkAt, orderIds };
    });
  }
}
