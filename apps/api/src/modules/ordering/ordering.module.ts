import { Module, type DynamicModule } from '@nestjs/common';
import { ORDER_HOLD_SECONDS } from '@tickee/contracts';
import { FunnelController } from './funnel.controller.js';
import { FunnelService } from './funnel.service.js';
import { OrderPayments } from './mark-paid.js';
import { ORDER_CODE_GENERATOR, randomOrderCode } from './order-code.js';
import { OrderQueues } from './order-jobs.js';
import { ORDERING_CONFIG, OrderRateLimiter, type OrderingConfig } from './order-rate-limit.js';
import { OrdersController } from './orders.controller.js';
import { ORDER_HOLD, OrdersService } from './orders.service.js';
import {
  AVAILABILITY_CLOCK,
  AvailabilityMemo,
  PublicAvailabilityController,
} from './public-availability.controller.js';

/**
 * Trạng thái bán công khai (Story 2.11-a), phễu mua (Story 3.1), Checkout và tạo Đơn (Story 3.2), Đơn 0đ và `markPaid`
 * (Story 3.3). Cần `DbModule`, `JobsModule` (enqueue job hết hạn Đơn trong TX1) và `TicketingModule` (toàn cục: phát
 * Vé, Mã QR vé) ở gốc DI; `config` cho khóa HMAC IP của bộ đếm tạo Đơn. Xuất `OrderPayments` (`markPaid`) cho nguồn
 * thanh toán khác (IPN, Story 3.5).
 */
@Module({})
export class OrderingModule {
  static forRoot(config: OrderingConfig): DynamicModule {
    return {
      module: OrderingModule,
      controllers: [PublicAvailabilityController, FunnelController, OrdersController],
      providers: [
        AvailabilityMemo,
        FunnelService,
        OrdersService,
        OrderPayments,
        OrderRateLimiter,
        OrderQueues,
        { provide: ORDERING_CONFIG, useValue: { BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET } },
        { provide: ORDER_CODE_GENERATOR, useValue: randomOrderCode },
        { provide: ORDER_HOLD, useValue: ORDER_HOLD_SECONDS },
        { provide: AVAILABILITY_CLOCK, useValue: () => Date.now() },
      ],
      exports: [OrderPayments],
    };
  }
}
