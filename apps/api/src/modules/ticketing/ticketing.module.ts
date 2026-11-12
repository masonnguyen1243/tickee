import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { TICKET_QR_KEYS, TicketQrKeys } from './qr.js';
import { SharedTicketsController } from './shared-tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/** Cấu hình của `ticketing` (env vai api và worker): khóa ký Mã QR vé. */
export type TicketingConfig = Pick<ApiConfig, 'TICKET_QR_KEYS'>;

/**
 * Vé và Mã QR vé (Story 3.3), link chia sẻ Vé (Story 3.8). Toàn cục: `ordering` (phát Vé trong `markPaid`, trả Vé ở
 * trang Đơn, email Vé ở worker) và sau này `checkin` dùng `TicketsService` và `TICKET_QR_KEYS` mà không phải import
 * module này. Cần `DbModule` ở gốc DI. Không có route: route ở `TicketingRoutesModule` (chỉ vai api).
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

/**
 * Route của `ticketing` ở vai api (Story 3.8): link chia sẻ Vé (`GET /v1/shared-tickets/:token`, `POST
 * /v1/me/tickets/:ticketId/share-link`). Cần `TicketingModule.forRoot` (toàn cục) và `DbModule` ở gốc DI.
 */
@Module({ controllers: [SharedTicketsController] })
export class TicketingRoutesModule {}
