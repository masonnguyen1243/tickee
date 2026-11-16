import { Controller, Get, Header, Inject } from '@nestjs/common';
import { Permission, type TokenOverview } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { TokenService } from './token.service.js';

/**
 * Token của một BTC (Story 4.5-a, FR-34): Owner và Admin xem (`token.view`); CTV và BTC khác bị guard chặn. Mang
 * `@RequirePermission` nên tự rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId/token')
export class TokenController {
  constructor(@Inject(TokenService) private readonly token: TokenService) {}

  /**
   * `GET /v1/orgs/:orgId/token`: một lần đọc số dư và hạn mức Token từ Tingee (không lưu, không cache), kèm link portal
   * Tingee khi người gọi là Owner (`token.purchase`).
   */
  @Get()
  @Header('cache-control', 'no-store')
  @RequirePermission(Permission.TOKEN_VIEW)
  get(@Access() ctx: AccessContext): Promise<TokenOverview> {
    return this.token.overview(ctx);
  }
}
