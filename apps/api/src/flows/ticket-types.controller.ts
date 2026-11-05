import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { Permission, TicketTypeInput, type TicketTypeDetail, type TicketTypeList } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { parseRequest } from '../platform/http/index.js';
import { createTicketType, deleteTicketType, listTicketTypes, updateTicketType } from './ticket-types.flow.js';

/**
 * Hạng vé của một Sự kiện (Story 2.8). Owner và Admin (`events.manage`). Đặt ở flows vì ghi cả `event` lẫn `ordering`
 * (mô-đun không được gọi flows, `event` không được gọi `ordering`); `GET` cũng ở đây vì cần ghép `sold`/`held`.
 * Sự kiện lạ hoặc của BTC khác → 404 `EVENT_NOT_FOUND`; Hạng vé lạ → 404 `TICKET_TYPE_NOT_FOUND`.
 */
@Controller('orgs/:orgId/events/:eventId/ticket-types')
export class TicketTypesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Hạng vé kèm tồn kho, tạo trước đứng trước. */
  @Get()
  @RequirePermission(Permission.EVENTS_MANAGE)
  list(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<TicketTypeList> {
    return listTicketTypes(this.db, ctx, eventId);
  }

  /** Tạo Hạng vé (201) kèm tồn kho `(capacity, 0, 0)`. */
  @Post()
  @RequirePermission(Permission.EVENTS_MANAGE)
  create(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ): Promise<TicketTypeDetail> {
    return createTicketType(this.db, ctx, eventId, parseRequest(TicketTypeInput, body));
  }

  /** Sửa Hạng vé (thay toàn bộ các trường của `TicketTypeInput`). */
  @Patch(':ticketTypeId')
  @RequirePermission(Permission.EVENTS_MANAGE)
  update(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('ticketTypeId') ticketTypeId: string,
    @Body() body: unknown,
  ): Promise<TicketTypeDetail> {
    return updateTicketType(this.db, ctx, eventId, ticketTypeId, parseRequest(TicketTypeInput, body));
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
    await deleteTicketType(this.db, ctx, eventId, ticketTypeId);
  }
}
