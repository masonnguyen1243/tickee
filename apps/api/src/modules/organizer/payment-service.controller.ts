import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Permission, type PaymentServiceCheckResult } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { PaymentServiceService } from './payment-service.js';

/**
 * Dịch vụ thanh toán của một BTC (Story 4.2-a, AD-32). Chỉ Owner (`payout_account.manage`, như Tài khoản nhận tiền):
 * Admin nhận `FORBIDDEN_ROLE`. Mang `@RequirePermission` nên tự rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId/payment-service')
export class PaymentServiceController {
  constructor(@Inject(PaymentServiceService) private readonly paymentService: PaymentServiceService) {}

  /**
   * `POST /v1/orgs/:orgId/payment-service/check` ("Kiểm tra lại"): dò dịch vụ bằng key hiện hành rồi trả
   * `PaymentServiceCheckResult` (trạng thái mới, kết quả, số giây còn chờ). BTC đang `active` (`not_suspended`), hoặc lần
   * dò trước chưa quá 30 giây (`cooldown`) → không gọi Tingee.
   */
  @Post('check')
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  check(@Access() ctx: AccessContext): Promise<PaymentServiceCheckResult> {
    return this.paymentService.check(ctx);
  }
}
