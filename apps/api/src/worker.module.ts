import { Module, type DynamicModule } from '@nestjs/common';
import { CheckinJobsModule } from './modules/checkin/index.js';
import { EventJobsModule } from './modules/event/index.js';
import { IdentityJanitorModule } from './modules/identity/index.js';
import { IntegrationJobsModule } from './modules/integration/index.js';
import { OrderingJobsModule } from './modules/ordering/index.js';
import { OrganizerJobsModule } from './modules/organizer/index.js';
import { PaymentJobsModule } from './modules/payment/index.js';
import { TicketingModule } from './modules/ticketing/index.js';
import { TingeeModule } from './modules/tingee/index.js';
import { AlertsModule } from './platform/alerts/index.js';
import { APP_CONFIG, type WorkerConfig } from './platform/config/index.js';
import { DbModule } from './platform/db/index.js';
import { EmailModule } from './platform/email/index.js';
import { JobsModule } from './platform/jobs/index.js';
import { createLoggerModule, UsePinoLoggerBeforeBootstrap } from './platform/logging/index.js';
import { TelemetryModule } from './platform/telemetry/index.js';

/**
 * Gốc DI của vai `worker`: không mở HTTP, chạy pg-boss, các job định kỳ, job gửi email (lời mời Admin, email Vé,
 * email tiền về muộn và email đổi giờ/địa điểm cho Người mua), job revalidate trang Sự kiện công khai (gọi
 * `<WEB_ORIGIN>/api/revalidate`), job hết hạn Giữ chỗ của Đơn và job Đối soát bù (Story 4.1: tra Tingee khi IPN trễ
 * hoặc mất, đi cùng đường xử lý với IPN qua `IpnProcessor` và `OrderPayments`; cờ `TINGEE_ORDER_STATUS_QUERY`), job
 * cron dò dịch vụ thanh toán của BTC bị ngắt và job "đã mở lại" (Story 4.2: Đối soát bù mọi Đơn còn mở của BTC), job
 * cron dò Token mỗi giờ và email cảnh báo Token dưới ngưỡng (Story 4.5-b), kênh cảnh báo vận hành: email cho đội vận hành
 * và job quét mỗi phút (Story 4.6-b), lưới an toàn của `ordering`: quét Đơn quá hạn mỗi phút và đối chiếu tồn kho mỗi 10
 * phút (Story 4.6-c), luật cảnh báo tỉ lệ phát Vé giảm của `ordering` trong job quét (Story 4.6-e), dọn bộ đếm tra tay
 * của `checkin` (Story 5.5), lần đẩy đầu lên Google Sheets của `integration` (Story 6.4). Có sẵn adapter Tingee và Vé
 * (khóa QR).
 */
@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        // Đầu tiên (Story 4.6-a): tắt SDK OpenTelemetry sau cùng khi dừng (sau `boss.stop`).
        TelemetryModule.forRoot({ httpRoutes: false }),
        createLoggerModule({ level: config.LOG_LEVEL }),
        DbModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-worker' }),
        JobsModule.forRoot({ connectionString: config.DATABASE_URL, applicationName: 'tickee-worker' }),
        EmailModule.forRoot({ url: config.SMTP_URL, from: config.EMAIL_FROM }),
        // Kênh cảnh báo vận hành (Story 4.6-b, toàn cục): `raise`, job gửi email tới `OPS_ALERT_EMAILS` và job quét mỗi
        // phút (hàng đợi pg-boss ùn, job vào dead-letter).
        AlertsModule.forWorker(config),
        // Adapter Tingee (`TINGEE_CLIENT`, toàn cục) và Vé + Mã QR vé (`TicketsService`, toàn cục) như vai api.
        TingeeModule.forRoot({ baseUrl: config.TINGEE_BASE_URL }),
        TicketingModule.forRoot(config),
        // Đối soát bù trên lõi xử lý IPN (không controller): `IpnProcessor` → `ordering.markPaid` / `markExpired`.
        PaymentJobsModule.forRoot(config),
        // Job của mô-đun miền (chỉ vai `worker` đăng ký lịch và handler).
        IdentityJanitorModule,
        OrganizerJobsModule.forRoot({
          WEB_ORIGIN: config.WEB_ORIGIN,
          TINGEE_CREDENTIAL_KEYS: config.TINGEE_CREDENTIAL_KEYS,
          TINGEE_BASE_URL: config.TINGEE_BASE_URL,
        }),
        EventJobsModule.forRoot({ WEB_ORIGIN: config.WEB_ORIGIN, REVALIDATE_SECRET: config.REVALIDATE_SECRET }),
        // Lưới an toàn (Story 4.6-c) và luật cảnh báo `ticket_issuance_drop` của job quét (Story 4.6-e).
        OrderingJobsModule.forRoot({
          WEB_ORIGIN: config.WEB_ORIGIN,
          OPS_ALERT_ISSUANCE_MIN_ORDERS: config.OPS_ALERT_ISSUANCE_MIN_ORDERS,
          OPS_ALERT_ISSUANCE_RATIO: config.OPS_ALERT_ISSUANCE_RATIO,
        }),
        // Dọn bộ đếm tra tay mỗi 10 phút (Story 5.5).
        CheckinJobsModule,
        // Lần đẩy đầu lên Google Sheets: tạo Sheet trong Drive của người cấp, ghi Đơn hiện có (Story 6.4).
        IntegrationJobsModule.forRoot(config),
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }, UsePinoLoggerBeforeBootstrap],
    };
  }
}
