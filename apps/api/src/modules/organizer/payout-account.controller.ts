import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ConfirmPayoutOtpRequest,
  LinkPayoutAccountRequest,
  Permission,
  type PayoutAccount,
  type PayoutAccountOverview,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { PayoutAccountService } from './payout-account.service.js';

/**
 * Tài khoản nhận tiền của một BTC (Story 2.6). Chỉ Owner (`payout_account.manage`): Admin nhận `FORBIDDEN_ROLE`.
 * Mọi route mang `@RequirePermission` nên tự rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId/payout-account')
export class PayoutAccountController {
  constructor(@Inject(PayoutAccountService) private readonly payout: PayoutAccountService) {}

  @Get()
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  get(@Access() ctx: AccessContext): Promise<PayoutAccountOverview> {
    return this.payout.overview(ctx);
  }

  /** Liên kết tài khoản cá nhân: 200 `linked` hoặc `awaiting_otp` (nhập OTP ngân hàng ở `…/otp`). */
  @Post()
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  link(@Access() ctx: AccessContext, @Body() body: unknown): Promise<PayoutAccount> {
    return this.payout.link(ctx, parseRequest(LinkPayoutAccountRequest, body));
  }

  @Post('otp')
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  confirmOtp(@Access() ctx: AccessContext, @Body() body: unknown): Promise<PayoutAccount> {
    const { attemptId, otp } = parseRequest(ConfirmPayoutOtpRequest, body);
    return this.payout.confirmOtp(ctx, attemptId, otp);
  }
}
