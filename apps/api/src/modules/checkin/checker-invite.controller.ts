import { Controller, Get, Header, Inject, Param, Post } from '@nestjs/common';
import { Permission, type CheckerInviteResponse, type CreatedCheckerInvite } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { CheckerInviteService } from './checker-invite.service.js';

/**
 * Link mời CTV chung của một Sự kiện (Story 5.1): Owner và Admin (`checkers.manage`). Sự kiện lạ, sai dạng hoặc của BTC
 * khác → `404 EVENT_NOT_FOUND`, kiểm trước mọi thứ khác. Mọi response `cache-control: no-store` (`POST` trả token).
 * Không có route thu hồi: "Tạo link mới" thu hồi link cũ. Không nhận `Idempotency-Key`: thử lại chỉ tạo thêm một link,
 * link trước bị thu hồi.
 */
@Controller('orgs/:orgId/events/:eventId/checker-invite')
export class CheckerInviteController {
  constructor(@Inject(CheckerInviteService) private readonly invites: CheckerInviteService) {}

  /** Link mới nhất (không token), chưa có thì `{ invite: null }`. */
  @Get()
  @RequirePermission(Permission.CHECKERS_MANAGE)
  @Header('cache-control', 'no-store')
  get(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<CheckerInviteResponse> {
    return this.invites.latest(ctx, eventId);
  }

  /** "Tạo link mới" (không body, `201`): link mới kèm token; link cũ hết hiệu lực ngay. */
  @Post()
  @RequirePermission(Permission.CHECKERS_MANAGE)
  @Header('cache-control', 'no-store')
  create(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<CreatedCheckerInvite> {
    return this.invites.create(ctx, eventId);
  }
}
