import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ErrorCode, Permission, type CheckinEvent } from '@tickee/contracts';
import { EventAccess, RequirePermission, type EventAccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { checkinEventById } from '../event/index.js';

/**
 * Route CTV (`/v1/checkin/events/:eventId/…`, Story 5.2, AD-26): Owner/Admin của BTC sở hữu Sự kiện, hoặc CTV `active`
 * của đúng Sự kiện đó (`PermissionGuard`, nhánh Sự kiện). Người khác, Sự kiện lạ hoặc id sai dạng → `403 NOT_A_MEMBER`;
 * CTV bị thu hồi → `403 CHECKER_REVOKED`. `no-store`: response phụ thuộc quyền đọc lại ở mỗi request.
 */
@Controller('checkin/events/:eventId')
export class CheckinEventController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Sự kiện của Màn quét: id và tên. */
  @Get()
  @RequirePermission(Permission.CHECKIN_SCAN)
  @Header('cache-control', 'no-store')
  async get(@EventAccess() ctx: EventAccessContext): Promise<CheckinEvent> {
    const event = await checkinEventById(this.db.orm, ctx.eventId);
    // Guard vừa xác nhận Sự kiện thuộc BTC này; biến mất hay đổi BTC giữa chừng thì coi như không có quyền.
    if (!event || event.organizationId !== ctx.organizationId) {
      throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không có quyền soát vé cho Sự kiện này.');
    }
    return { eventId: event.id, eventName: event.name };
  }
}
