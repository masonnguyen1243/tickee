import { Controller, Get, Post } from '@nestjs/common';
import { Permission } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../src/platform/access/index.js';

/** Route BTC chỉ Owner (`members.manage`) để kiểm guard; trả lại `AccessContext`. */
@Controller('orgs/:orgId/test-owner-only')
export class OwnerOnlyTestController {
  @Get()
  @RequirePermission(Permission.MEMBERS_MANAGE)
  get(@Access() ctx: AccessContext): AccessContext {
    return ctx;
  }

  @Post('items/:itemId')
  @RequirePermission(Permission.TOKEN_PURCHASE)
  post(@Access() ctx: AccessContext): AccessContext {
    return ctx;
  }
}

/** Route BTC Owner và Admin cùng dùng được (`events.manage`). */
@Controller('orgs/:orgId/test-events')
export class EventsTestController {
  @Get()
  @RequirePermission(Permission.EVENTS_MANAGE)
  get(@Access() ctx: AccessContext): AccessContext {
    return ctx;
  }
}
