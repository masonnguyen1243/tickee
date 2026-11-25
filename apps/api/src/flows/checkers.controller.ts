import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { Permission, type CheckerList } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { listCheckers } from './checkers.flow.js';

/**
 * Danh sách CTV của Sự kiện (Story 5.6): Owner và Admin (`checkers.manage`). Sự kiện lạ, sai dạng hoặc của BTC khác →
 * `404 EVENT_NOT_FOUND`. `no-store`: trạng thái CTV đổi bởi "Thu hồi"/"Khôi phục" (route của `checkin`).
 */
@Controller('orgs/:orgId/events/:eventId/checkers')
export class CheckersListController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermission(Permission.CHECKERS_MANAGE)
  @Header('cache-control', 'no-store')
  list(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<CheckerList> {
    return listCheckers(this.db, ctx, eventId);
  }
}
