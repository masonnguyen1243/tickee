import { Module } from '@nestjs/common';
import { PaymentServiceQueues } from '../organizer/index.js';
import { ClosedBetaController } from './closed-beta.controller.js';
import { PaymentServiceAdminController } from './payment-service.controller.js';

/**
 * Khu Quản trị Tingee `/v1/admin/*` (AD-26). Mọi controller ở đây mang `@RequirePlatformAdmin()`; guard nằm ở
 * `identity` (đăng ký toàn cục), nên `admin` không phụ thuộc `identity`. Cần `DbModule` và `JobsModule` (toàn cục; mở lại
 * dịch vụ thanh toán enqueue job "đã mở lại", Story 4.2) ở gốc DI.
 */
@Module({
  controllers: [ClosedBetaController, PaymentServiceAdminController],
  providers: [PaymentServiceQueues],
})
export class AdminModule {}
