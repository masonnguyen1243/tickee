import { Body, Controller, Get, Header, Inject, Put } from '@nestjs/common';
import { Permission, TokenAlertThresholdInput, type TokenAlert, type TokenOverview } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { TokenService } from './token.service.js';

/**
 * Token của một BTC (Story 4.5-a, 4.5-b, FR-34): Owner và Admin xem (`token.view`); chỉ Owner đặt ngưỡng cảnh báo
 * (`token_alert.manage`; Admin → 403 `FORBIDDEN_ROLE`); CTV và BTC khác bị guard chặn. Mang `@RequirePermission` nên tự
 * rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId/token')
export class TokenController {
  constructor(@Inject(TokenService) private readonly token: TokenService) {}

  /**
   * `GET /v1/orgs/:orgId/token`: một lần đọc số dư và hạn mức Token từ Tingee (không lưu, không cache) rồi đánh giá
   * ngưỡng cảnh báo, kèm trạng thái cảnh báo và link portal Tingee khi người gọi là Owner (`token.purchase`).
   */
  @Get()
  @Header('cache-control', 'no-store')
  @RequirePermission(Permission.TOKEN_VIEW)
  get(@Access() ctx: AccessContext): Promise<TokenOverview> {
    return this.token.overview(ctx);
  }

  /**
   * `PUT /v1/orgs/:orgId/token/alert-threshold`: body `{ threshold: 1…10^12 | null }` (`null` = tắt cảnh báo); trả trạng
   * thái cảnh báo sau khi lưu. Sai dạng → 400 `VALIDATION_FAILED`. Không gọi Tingee.
   */
  @Put('alert-threshold')
  @Header('cache-control', 'no-store')
  @RequirePermission(Permission.TOKEN_ALERT_MANAGE)
  setAlertThreshold(@Access() ctx: AccessContext, @Body() body: unknown): Promise<TokenAlert> {
    return this.token.setAlertThreshold(ctx, parseRequest(TokenAlertThresholdInput, body));
  }
}
