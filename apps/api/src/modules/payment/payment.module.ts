import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox } from '../../platform/crypto/index.js';
import { OrderPaymentsModule } from '../ordering/index.js';
import { IPN_SETTINGS, TingeeIpnController, type IpnSettings } from './ipn.controller.js';
import { IpnProcessor } from './ipn-processor.js';
import { PaymentServiceResumedWorker } from './payment-service-resumed-worker.js';
import {
  RECONCILIATION_SETTINGS,
  reconciliationSettings,
  ReconciliationWorker,
  type ReconciliationConfig,
} from './reconciliation-worker.js';

/** Cấu hình của `payment` ở vai api: khóa giải mã Secret Token Tingee của BTC để kiểm chữ ký IPN. */
export type PaymentConfig = Pick<ApiConfig, 'TINGEE_CREDENTIAL_KEYS'>;

/**
 * Lõi xử lý IPN (`IpnProcessor`, Story 3.5) không có controller, không cần cấu hình: vai worker import để Đối soát bù
 * (Story 4.1) đi cùng đường xử lý với IPN. Cần `DbModule` và `TicketingModule` (toàn cục: phát Vé trong `markPaid`) ở gốc
 * DI.
 */
@Module({ imports: [OrderPaymentsModule], providers: [IpnProcessor], exports: [IpnProcessor] })
export class PaymentProcessingModule {}

/** Cấu hình job nền của `payment` ở vai worker: khóa giải mã credential Tingee và cờ Đối soát bù. */
export type PaymentJobsConfig = ReconciliationConfig;

/**
 * Job nền của `payment` cho vai worker: Đối soát bù (Story 4.1, `ReconciliationWorker` trên lõi xử lý IPN) và job "đã mở
 * lại" dịch vụ thanh toán của BTC (Story 4.2, `PaymentServiceResumedWorker`: enqueue job tra cho mọi Đơn còn mở). Cần
 * `DbModule`, `JobsModule`, `TingeeModule` và `TicketingModule` (toàn cục) ở gốc DI.
 */
@Module({})
export class PaymentJobsModule {
  static forRoot(config: PaymentJobsConfig): DynamicModule {
    return {
      module: PaymentJobsModule,
      imports: [PaymentProcessingModule],
      providers: [
        {
          provide: RECONCILIATION_SETTINGS,
          useFactory: () =>
            reconciliationSettings({
              TINGEE_CREDENTIAL_KEYS: config.TINGEE_CREDENTIAL_KEYS,
              TINGEE_ORDER_STATUS_QUERY: config.TINGEE_ORDER_STATUS_QUERY,
            }),
        },
        ReconciliationWorker,
        PaymentServiceResumedWorker,
      ],
    };
  }
}

/**
 * `payment` ở vai api (Story 3.5): endpoint IPN Tingee `POST /v1/payments/tingee/ipn/:ipnKey` (`@Public`) trên lõi xử lý.
 * Cần thêm ở gốc DI những gì `PaymentProcessingModule` cần.
 */
@Module({})
export class PaymentModule {
  static forRoot(config: PaymentConfig): DynamicModule {
    return {
      module: PaymentModule,
      imports: [PaymentProcessingModule],
      controllers: [TingeeIpnController],
      providers: [
        {
          provide: IPN_SETTINGS,
          useFactory: (): IpnSettings => ({ secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)) }),
        },
      ],
    };
  }
}
