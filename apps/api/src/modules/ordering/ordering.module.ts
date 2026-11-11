import { Module, type DynamicModule } from '@nestjs/common';
import { ORDER_HOLD_SECONDS } from '@tickee/contracts';
import { FunnelController } from './funnel.controller.js';
import { FunnelService } from './funnel.service.js';
import { OrderPaymentsModule } from './mark-paid.js';
import { ORDER_CODE_GENERATOR, randomOrderCode } from './order-code.js';
import { OrderQueues } from './order-jobs.js';
import {
  ORDERING_CONFIG,
  OrderRateLimiter,
  type OrderingConfig,
  type OrderRateLimitConfig,
} from './order-rate-limit.js';
import { OrdersController } from './orders.controller.js';
import { ORDER_HOLD, OrdersService } from './orders.service.js';
import { PAYMENT_LINK_SETTINGS, paymentLinkSettings, PaymentLinks } from './payment-link.js';
import {
  AVAILABILITY_CLOCK,
  AvailabilityMemo,
  PublicAvailabilityController,
} from './public-availability.controller.js';

/**
 * Trạng thái bán công khai (Story 2.11-a), phễu mua (Story 3.1), Checkout và tạo Đơn (Story 3.2), Đơn 0đ (Story 3.3),
 * link thanh toán Gateway (Story 3.4). Cần `DbModule`, `JobsModule` (enqueue job hết hạn Đơn trong TX1 và TX2),
 * `TicketingModule` (toàn cục: phát Vé, Mã QR vé) và `TingeeModule` (toàn cục: `create-link`) ở gốc DI; `config` cho
 * khóa HMAC IP của bộ đếm tạo Đơn, `WEB_ORIGIN` (`returnUrl`) và khóa giải mã credential Tingee. `markPaid` nằm ở
 * `OrderPaymentsModule` (không cần cấu hình) để `payment` dùng được ở cả vai api lẫn worker (Story 3.5).
 */
@Module({})
export class OrderingModule {
  static forRoot(config: OrderingConfig): DynamicModule {
    return {
      module: OrderingModule,
      imports: [OrderPaymentsModule],
      controllers: [PublicAvailabilityController, FunnelController, OrdersController],
      providers: [
        AvailabilityMemo,
        FunnelService,
        OrdersService,
        PaymentLinks,
        OrderRateLimiter,
        OrderQueues,
        {
          provide: ORDERING_CONFIG,
          useValue: { BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET } satisfies OrderRateLimitConfig,
        },
        { provide: PAYMENT_LINK_SETTINGS, useFactory: () => paymentLinkSettings(config) },
        { provide: ORDER_CODE_GENERATOR, useValue: randomOrderCode },
        { provide: ORDER_HOLD, useValue: ORDER_HOLD_SECONDS },
        { provide: AVAILABILITY_CLOCK, useValue: () => Date.now() },
      ],
    };
  }
}
