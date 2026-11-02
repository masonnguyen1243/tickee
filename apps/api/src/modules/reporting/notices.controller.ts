import { Controller, Get, Inject } from '@nestjs/common';
import { Permission, type StatusNotice } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { NoticesService } from './notices.service.js';

/** Thông báo trạng thái của một BTC cho dải `status-banner` đầu dashboard (Owner và Admin). */
@Controller('orgs/:orgId')
export class NoticesController {
  constructor(@Inject(NoticesService) private readonly notices: NoticesService) {}

  @Get('notices')
  @RequirePermission(Permission.ORG_READ)
  list(@Access() ctx: AccessContext): Promise<StatusNotice[]> {
    return this.notices.notices(ctx);
  }
}
