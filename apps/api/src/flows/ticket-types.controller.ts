import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { Permission, TicketTypeInput, type TicketTypeDetail, type TicketTypeList } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { PublicPageQueues } from '../modules/event/index.js';
import { Access, RequirePermission, type AccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { parseRequest } from '../platform/http/index.js';
import { BOSS } from '../platform/jobs/index.js';
import { createTicketType, deleteTicketType, listTicketTypes, updateTicketType } from './ticket-types.flow.js';

/**
 * Hạng vé của một Sự kiện (Story 2.8). Owner và Admin (`events.manage`). Đặt ở flows vì ghi cả `event` lẫn `ordering`
 * (mô-đun không được gọi flows, `event` không được gọi `ordering`); `GET` cũng ở đây vì cần ghép `sold`/`held`.
 * Sự kiện lạ hoặc của BTC khác → 404 `EVENT_NOT_FOUND`; Hạng vé lạ → 404 `TICKET_TYPE_NOT_FOUND`. Lệnh ghi chờ queue
 * revalidate trang Sự kiện công khai sẵn sàng (ngoài transaction) rồi mới chạy flow.
 */
@Controller('orgs/:orgId/events/:eventId/ticket-types')
export class TicketTypesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(PublicPageQueues) private readonly publicPageQueues: PublicPageQueues,
  ) {}

  /** Hạng vé kèm tồn kho, tạo trước đứng trước. */
  @Get()
  @RequirePermission(Permission.EVENTS_MANAGE)
  list(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<TicketTypeList> {
    return listTicketTypes(this.db, ctx, eventId);
  }

  /** Tạo Hạng vé (201) kèm tồn kho `(capacity, 0, 0)`. */
  @Post()
  @RequirePermission(Permission.EVENTS_MANAGE)
  async create(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ): Promise<TicketTypeDetail> {
    const input = parseRequest(TicketTypeInput, body);
    await this.publicPageQueues.ready();
    return createTicketType(this.db, this.boss, ctx, eventId, input);
  }

  /** Sửa Hạng vé (thay toàn bộ các trường của `TicketTypeInput`). */
  @Patch(':ticketTypeId')
  @RequirePermission(Permission.EVENTS_MANAGE)
  async update(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('ticketTypeId') ticketTypeId: string,
    @Body() body: unknown,
  ): Promise<TicketTypeDetail> {
    const input = parseRequest(TicketTypeInput, body);
    await this.publicPageQueues.ready();
    return updateTicketType(this.db, this.boss, ctx, eventId, ticketTypeId, input);
  }

  /** Xóa Hạng vé chưa bán, chưa giữ chỗ (204). */
  @Delete(':ticketTypeId')
  @HttpCode(204)
  @RequirePermission(Permission.EVENTS_MANAGE)
  async remove(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('ticketTypeId') ticketTypeId: string,
  ): Promise<void> {
    await this.publicPageQueues.ready();
    await deleteTicketType(this.db, this.boss, ctx, eventId, ticketTypeId);
  }
}
