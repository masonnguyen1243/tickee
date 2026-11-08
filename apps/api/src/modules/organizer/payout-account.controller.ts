import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  ConnectTingeeRequest,
  Permission,
  REAUTH_HEADER,
  SelectPayoutAccountRequest,
  type PayoutAccount,
  type PayoutAccountOptions,
  type PayoutAccountOverview,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import type { ReauthProof } from '../identity/index.js';
import { PayoutAccountService } from './payout-account.service.js';

/** Request đã qua `SessionGuard` (route không công khai nên luôn có session). */
type SessionRequest = { session: { session: { id: string } } };

/** Lần xác nhận lại mà request mang theo (header `REAUTH_HEADER`) cho đúng session đang gọi. */
const reauthProof = (req: SessionRequest, token: string | undefined): ReauthProof => ({
  sessionId: req.session.session.id,
  token,
});

/**
 * Tài khoản nhận tiền của một BTC (Story 2.6): kết nối key Tingee, thêm, hủy liên kết và đặt mặc định tài khoản. Chỉ
 * Owner (`payout_account.manage`): Admin nhận `FORBIDDEN_ROLE`. Hủy liên kết và đặt mặc định còn cần lần xác nhận lại
 * trong header `REAUTH_HEADER` (Story 2.13-a; kiểm sau quyền, thiếu → `REAUTH_REQUIRED`).
 * Mọi route mang `@RequirePermission` nên tự rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId/payout-account')
export class PayoutAccountController {
  constructor(@Inject(PayoutAccountService) private readonly payout: PayoutAccountService) {}

  /** Credential, các tài khoản nhận tiền hiện hành, URL IPN; không gọi Tingee. */
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

  /** Thêm một tài khoản trong danh sách làm tài khoản nhận tiền (tài khoản đầu tiên tự thành mặc định). */
  @Post()
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  select(@Access() ctx: AccessContext, @Body() body: unknown): Promise<PayoutAccount> {
    return this.payout.select(ctx, parseRequest(SelectPayoutAccountRequest, body));
  }

  /** Hủy liên kết một tài khoản nhận tiền (gỡ mềm, không gọi Tingee); cần xác nhận lại; trả tổng quan mới. */
  @Delete(':accountId')
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  unlink(
    @Access() ctx: AccessContext,
    @Param('accountId') accountId: string,
    @Headers(REAUTH_HEADER) reauthToken: string | undefined,
    @Req() req: SessionRequest,
  ): Promise<PayoutAccountOverview> {
    return this.payout.unlink(ctx, accountId, reauthProof(req, reauthToken));
  }

  /** Đặt một tài khoản nhận tiền làm mặc định; cần xác nhận lại; trả tổng quan mới. */
  @Post(':accountId/default')
  @HttpCode(200)
  @RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)
  setDefault(
    @Access() ctx: AccessContext,
    @Param('accountId') accountId: string,
    @Headers(REAUTH_HEADER) reauthToken: string | undefined,
    @Req() req: SessionRequest,
  ): Promise<PayoutAccountOverview> {
    return this.payout.setDefault(ctx, accountId, reauthProof(req, reauthToken));
  }
}
