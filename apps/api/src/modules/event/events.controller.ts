import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { EventDraftInput, EventOrderLimitInput, Permission, type EventDetail, type EventList } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { EventService } from './event.service.js';

/**
 * Sự kiện của một BTC (Story 2.7): tạo, sửa, đọc Sự kiện nháp. Owner và Admin (`events.manage`).
 * Mọi route mang `@RequirePermission` nên tự rơi vào bộ test cách ly. `:eventId` sai dạng → 404 `EVENT_NOT_FOUND`.
 */
@Controller('orgs/:orgId/events')
export class EventsController {
  constructor(@Inject(EventService) private readonly events: EventService) {}

  /** Tạo Sự kiện nháp (201). */
  @Post()
  @RequirePermission(Permission.EVENTS_MANAGE)
  create(@Access() ctx: AccessContext, @Body() body: unknown): Promise<EventDetail> {
    return this.events.create(ctx, parseRequest(EventDraftInput, body));
  }

  /** Sự kiện của BTC, mới tạo trước. */
  @Get()
  @RequirePermission(Permission.EVENTS_MANAGE)
  list(@Access() ctx: AccessContext): Promise<EventList> {
    return this.events.list(ctx);
  }

  @Get(':eventId')
  @RequirePermission(Permission.EVENTS_MANAGE)
  get(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventDetail> {
    return this.events.get(ctx, eventId);
  }

  /** Sửa Sự kiện (thay toàn bộ các trường của `EventDraftInput`); slug không đổi. */
  @Patch(':eventId')
  @RequirePermission(Permission.EVENTS_MANAGE)
  update(@Access() ctx: AccessContext, @Param('eventId') eventId: string, @Body() body: unknown): Promise<EventDetail> {
    return this.events.update(ctx, eventId, parseRequest(EventDraftInput, body));
  }

  /** Đổi giới hạn Vé/Đơn của Sự kiện (Story 2.8): 1–50, mặc định 10. */
  @Patch(':eventId/order-limit')
  @RequirePermission(Permission.EVENTS_MANAGE)
  updateOrderLimit(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ): Promise<EventDetail> {
    return this.events.updateOrderLimit(ctx, eventId, parseRequest(EventOrderLimitInput, body));
  }
}
