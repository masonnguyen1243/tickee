import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox } from '../../platform/crypto/index.js';
import { OrderPaymentsModule } from '../ordering/index.js';
import { IPN_SETTINGS, TingeeIpnController, type IpnSettings } from './ipn.controller.js';
import { IpnProcessor } from './ipn-processor.js';

/** Cấu hình của `payment` ở vai api: khóa giải mã Secret Token Tingee của BTC để kiểm chữ ký IPN. */
export type PaymentConfig = Pick<ApiConfig, 'TINGEE_CREDENTIAL_KEYS'>;

/**
 * Lõi xử lý IPN (`IpnProcessor`, Story 3.5) không có controller, không cần cấu hình: vai worker import để Đối soát bù
 * (Story 4.1) đi cùng đường xử lý với IPN. Cần `DbModule` và `TicketingModule` (toàn cục: phát Vé trong `markPaid`) ở gốc
 * DI.
 */
@Module({ imports: [OrderPaymentsModule], providers: [IpnProcessor], exports: [IpnProcessor] })
export class PaymentProcessingModule {}

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
