import { Module, type DynamicModule } from '@nestjs/common';
import { EventJobsModule } from './modules/event/index.js';
import { IdentityJanitorModule } from './modules/identity/index.js';
import { OrderingJobsModule } from './modules/ordering/index.js';
import { OrganizerJobsModule } from './modules/organizer/index.js';
import { PaymentJobsModule } from './modules/payment/index.js';
import { TicketingModule } from './modules/ticketing/index.js';
import { TingeeModule } from './modules/tingee/index.js';
import { APP_CONFIG, type WorkerConfig } from './platform/config/index.js';
import { DbModule } from './platform/db/index.js';
import { EmailModule } from './platform/email/index.js';
import { JobsModule } from './platform/jobs/index.js';
import { createLoggerModule } from './platform/logging/index.js';

/**
 * Gốc DI của vai `worker`: không mở HTTP, chạy pg-boss, các job định kỳ, job gửi email (lời mời Admin, email Vé,
 * email tiền về muộn và email đổi giờ/địa điểm cho Người mua), job revalidate trang Sự kiện công khai (gọi
 * `<WEB_ORIGIN>/api/revalidate`), job hết hạn Giữ chỗ của Đơn và job Đối soát bù (Story 4.1: tra Tingee khi IPN trễ
 * hoặc mất, đi cùng đường xử lý với IPN qua `IpnProcessor` và `OrderPayments`; cờ `TINGEE_ORDER_STATUS_QUERY`). Có sẵn
 * adapter Tingee và Vé (khóa QR).
 */
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
        // Adapter Tingee (`TINGEE_CLIENT`, toàn cục) và Vé + Mã QR vé (`TicketsService`, toàn cục) như vai api.
        TingeeModule.forRoot({ baseUrl: config.TINGEE_BASE_URL }),
        TicketingModule.forRoot(config),
        // Đối soát bù trên lõi xử lý IPN (không controller): `IpnProcessor` → `ordering.markPaid` / `markExpired`.
        PaymentJobsModule.forRoot(config),
        // Job của mô-đun miền (chỉ vai `worker` đăng ký lịch và handler).
        IdentityJanitorModule,
        OrganizerJobsModule.forRoot({ WEB_ORIGIN: config.WEB_ORIGIN }),
        EventJobsModule.forRoot({ WEB_ORIGIN: config.WEB_ORIGIN, REVALIDATE_SECRET: config.REVALIDATE_SECRET }),
        OrderingJobsModule.forRoot({ WEB_ORIGIN: config.WEB_ORIGIN }),
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }],
    };
  }
}
