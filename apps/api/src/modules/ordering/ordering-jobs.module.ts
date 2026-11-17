import { Module, type DynamicModule } from '@nestjs/common';
import { BuyerEmailWorker, ORDERING_JOBS_CONFIG, type OrderingJobsConfig } from './buyer-email-jobs.js';
import { EventChangeEmailWorker } from './event-change-email-jobs.js';
import { OrderExpiryWorker } from './order-jobs.js';
import { OrderSafetyNetWorker } from './safety-net-jobs.js';

/**
 * Job nền của `ordering` cho vai `worker`: hết hạn Giữ chỗ ((a) và (c)), email Người mua (Story 3.8: email Vé, email
 * tiền về muộn hết chỗ), email báo Sự kiện đổi giờ hoặc địa điểm (Story 3.10) và lưới an toàn định kỳ (Story 4.6-c: quét
 * Đơn quá hạn mỗi phút, đối chiếu tồn kho mỗi 10 phút). Cần `DbModule`, `JobsModule`, `EmailModule`, `TicketingModule`
 * và `AlertsModule` (toàn cục) ở gốc DI; `config` cho origin web của link trong email. Không cần cấu hình Tingee.
 * Tách khỏi `order-jobs.ts` vì lưới an toàn import hàm hết hạn của file đó.
 */
@Module({})
export class OrderingJobsModule {
  static forRoot(config: OrderingJobsConfig): DynamicModule {
    return {
      module: OrderingJobsModule,
      providers: [
        { provide: ORDERING_JOBS_CONFIG, useValue: { WEB_ORIGIN: config.WEB_ORIGIN } satisfies OrderingJobsConfig },
        OrderExpiryWorker,
        BuyerEmailWorker,
        EventChangeEmailWorker,
        OrderSafetyNetWorker,
      ],
    };
  }
}
