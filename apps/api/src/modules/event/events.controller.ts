import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  EventDraftInput,
  EventOrderLimitInput,
  Permission,
  type EventDetail,
  type EventList,
  type PublishReadiness,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { EventStatusService } from './event-status.service.js';
import { EventService } from './event.service.js';
import { PublishService } from './publish.service.js';

/**
 * Sự kiện của một BTC: tạo, đọc Sự kiện (Story 2.7), giới hạn Vé/Đơn (Story 2.8), điều kiện mở bán và mở bán
 * (Story 2.10), Ẩn / Hiện lại / Kết thúc sớm (Story 2.12). Owner và Admin (`events.manage`). Sửa thông tin
 * (`PATCH :eventId`) nằm ở `flows/event-edit.controller.ts` (Story 3.10: cùng `tx` enqueue email báo Người mua của `ordering`).
 * Mọi route mang `@RequirePermission` nên tự rơi vào bộ test cách ly. `:eventId` sai dạng → 404 `EVENT_NOT_FOUND`.
 */
@Controller('orgs/:orgId/events')
export class EventsController {
  constructor(
    @Inject(EventService) private readonly events: EventService,
    @Inject(PublishService) private readonly publishing: PublishService,
    @Inject(EventStatusService) private readonly statuses: EventStatusService,
  ) {}

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

  /** Điều kiện mở bán (Story 2.10): chỉ các mã áp dụng cho Sự kiện, kèm đạt hay chưa. */
  @Get(':eventId/publish-readiness')
  @RequirePermission(Permission.EVENTS_MANAGE)
  publishReadiness(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<PublishReadiness> {
    return this.publishing.readiness(ctx, eventId);
  }

  /** Mở bán (không body): `draft` → `published` khi đủ điều kiện; trả `EventDetail`. */
  @Post(':eventId/publish')
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  publish(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventDetail> {
    return this.publishing.publish(ctx, eventId);
  }

  /** Ẩn (không body): `published` → `hidden`; trả `EventDetail`. */
  @Post(':eventId/hide')
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  hide(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventDetail> {
    return this.statuses.hide(ctx, eventId);
  }

  /** Hiện lại (không body): `hidden` → `published`; trả `EventDetail`. */
  @Post(':eventId/unhide')
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  unhide(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventDetail> {
    return this.statuses.unhide(ctx, eventId);
  }

  /** Kết thúc sớm (không body): `ended_manually_at` = `effective_end_at` = lúc bấm; status không đổi. */
  @Post(':eventId/end')
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  end(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventDetail> {
    return this.statuses.end(ctx, eventId);
  }
}
