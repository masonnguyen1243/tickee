import { Controller, Header, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { CheckerAction, Permission } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { setCheckerStatus } from './checkers.js';

/**
 * "Thu hồi" và "Khôi phục" CTV của Sự kiện (Story 5.6, FR-26): Owner và Admin (`checkers.manage`). Không body, `204`.
 * Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`, kiểm trước mọi thứ khác; `checkerId` sai dạng, lạ hoặc
 * của Sự kiện khác → `404 NOT_FOUND`. Đã ở trạng thái đích → `204`, không ghi gì. Không nhận `Idempotency-Key`: gửi lại
 * luôn ra cùng trạng thái đích. Danh sách CTV (`GET …/checkers`) ở `flows` (cần tên, email của `identity`).
 */
@Controller('orgs/:orgId/events/:eventId/checkers/:checkerId')
export class CheckersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** CTV không quét hay tra tay được nữa từ request kế tiếp; nhận lại lời mời vẫn `CHECKER_REVOKED`. Luôn được. */
  @Post('revoke')
  @HttpCode(204)
  @RequirePermission(Permission.CHECKERS_MANAGE)
  @Header('cache-control', 'no-store')
  async revoke(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('checkerId') checkerId: string,
  ): Promise<void> {
    await setCheckerStatus(this.db, ctx, eventId, checkerId, CheckerAction.REVOKE);
  }

  /** CTV quét và tra tay lại được. Sự kiện đã kết thúc → `409 EVENT_ALREADY_ENDED`. */
  @Post('restore')
  @HttpCode(204)
  @RequirePermission(Permission.CHECKERS_MANAGE)
  @Header('cache-control', 'no-store')
  async restore(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('checkerId') checkerId: string,
  ): Promise<void> {
    await setCheckerStatus(this.db, ctx, eventId, checkerId, CheckerAction.RESTORE);
  }
}
