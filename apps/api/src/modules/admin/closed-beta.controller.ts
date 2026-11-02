import { Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ClosedBetaAction, ClosedBetaQueueQuery, type ClosedBetaOrganization } from '@tickee/contracts';
import type { Response } from 'express';
import {
  PlatformAdminAccess,
  platformAdminScope,
  RequirePlatformAdmin,
  type PlatformAdminContext,
} from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { changeClosedBetaStatus, listOrganizationsByClosedBeta } from '../organizer/index.js';

/**
 * Màn "Duyệt Closed Beta" của Quản trị Tingee (FR-37, Story 2.5). Cả controller mang `@RequirePlatformAdmin()`: guard
 * của `identity` đòi cờ `platform_admin` (đọc mới từ DB), 2FA đã bật và session đã qua lớp hai. Mỗi request đọc ghi đúng
 * một dòng audit `platform_admin.read` qua `platformAdminScope`, cùng `tx` với truy vấn.
 */
@Controller('admin/organizations')
@RequirePlatformAdmin()
export class ClosedBetaController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /v1/admin/organizations?closedBeta=pending|approved|revoked` */
  @Get()
  list(
    @PlatformAdminAccess() ctx: PlatformAdminContext,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ClosedBetaOrganization[]> {
    const { closedBeta } = parseRequest(ClosedBetaQueueQuery, query);
    // Response chứa PII của nhiều BTC (email Owner, kênh liên hệ): không cho cache.
    res.setHeader('cache-control', 'no-store');
    return this.db.transaction(async (tx) => {
      const reader = await platformAdminScope(tx, ctx, { type: 'closed_beta_queue', id: closedBeta });
      return listOrganizationsByClosedBeta(reader, closedBeta);
    });
  }

  /** Duyệt (kể cả duyệt lại BTC đã bị thu hồi). Đã duyệt → 204 không audit. */
  @Post(':id/closed-beta/approve')
  @HttpCode(204)
  async approve(@PlatformAdminAccess() ctx: PlatformAdminContext, @Param('id') id: string): Promise<void> {
    await changeClosedBetaStatus(this.db, ctx, id, ClosedBetaAction.APPROVE);
  }

  /** Thu hồi BTC đã duyệt (Hạng vé có phí Tạm ngừng bán — Story 2.10). Đã thu hồi → 204; đang chờ duyệt → 409. */
  @Post(':id/closed-beta/revoke')
  @HttpCode(204)
  async revoke(@PlatformAdminAccess() ctx: PlatformAdminContext, @Param('id') id: string): Promise<void> {
    await changeClosedBetaStatus(this.db, ctx, id, ClosedBetaAction.REVOKE);
  }
}
