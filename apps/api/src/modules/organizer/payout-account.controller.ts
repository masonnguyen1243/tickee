import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ConnectTingeeRequest,
  Permission,
  SelectPayoutAccountRequest,
  type PayoutAccount,
  type PayoutAccountOptions,
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

  /** Credential, tài khoản nhận tiền hiện hành, URL IPN; không gọi Tingee. */
  @Get()
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  get(@Access() ctx: AccessContext): Promise<PayoutAccountOverview> {
    return this.payout.overview(ctx);
  }

  /** Kết nối API key Tingee của BTC; key đúng thì lưu (Secret Token mã hóa) và trả danh sách tài khoản. */
  @Post('credential')
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  connect(@Access() ctx: AccessContext, @Body() body: unknown): Promise<PayoutAccountOptions> {
    return this.payout.connect(ctx, parseRequest(ConnectTingeeRequest, body));
  }

  /** Đọc lại danh sách tài khoản bằng credential hiện hành; chưa kết nối → 404. */
  @Get('options')
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  options(@Access() ctx: AccessContext): Promise<PayoutAccountOptions> {
    return this.payout.options(ctx);
  }

  /** Chọn một tài khoản trong danh sách làm tài khoản nhận tiền. */
  @Post()
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  select(@Access() ctx: AccessContext, @Body() body: unknown): Promise<PayoutAccount> {
    return this.payout.select(ctx, parseRequest(SelectPayoutAccountRequest, body));
  }
}
