import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { TICKET_QR_KEYS, TicketQrKeys } from './qr.js';
import { TicketsService } from './tickets.service.js';

/** Cấu hình của `ticketing` (env vai api): khóa ký Mã QR vé. */
export type TicketingConfig = Pick<ApiConfig, 'TICKET_QR_KEYS'>;

/**
 * Vé và Mã QR vé (Story 3.3). Toàn cục: `ordering` (phát Vé trong `markPaid`, trả Vé ở trang Đơn) và sau này `checkin`
 * dùng `TicketsService` và `TICKET_QR_KEYS` mà không phải import module này. Cần `DbModule` ở gốc DI. Chưa có route.
 */
@Global()
@Module({})
export class TicketingModule {
  static forRoot(config: TicketingConfig): DynamicModule {
    return {
      module: TicketingModule,
      providers: [{ provide: TICKET_QR_KEYS, useFactory: () => TicketQrKeys.parse(config.TICKET_QR_KEYS) }, TicketsService],
      exports: [TICKET_QR_KEYS, TicketsService],
    };
  }
}
