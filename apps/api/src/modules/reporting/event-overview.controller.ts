import { Controller, Get, Header, Inject, Param, Req, Res } from '@nestjs/common';
import { Permission, RealtimeTopic, type EventOverview } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { RealtimeHub } from '../../platform/realtime/index.js';
import { EventOverviewService } from './event-overview.service.js';

/** Topic theo Sự kiện mà Tổng quan tải lại: Đơn (Story 3.11) và check-in (Story 6.2). */
const EVENT_TOPICS: ReadonlySet<RealtimeTopic> = new Set([
  RealtimeTopic.EVENT_ORDERS_CHANGED,
  RealtimeTopic.EVENT_CHECKINS_CHANGED,
]);

/**
 * Tổng quan Sự kiện (Story 3.11, FR-31): doanh thu, 5 Đơn gần đây, số mục Cần xử lý (Story 4.3), số check-in và Vé theo
 * Hạng vé (Story 6.2), kèm stream SSE báo tải lại. Chỉ Owner và Admin (`orders.view`; CTV không có quyền này nên không
 * đăng ký được `event_orders_changed`).
 * Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`; BTC khác → `403 NOT_A_MEMBER` (guard). `live` khai
 * báo trước nên không đụng route nào khác.
 */
@Controller('orgs/:orgId/events/:eventId/overview')
export class EventOverviewController {
  constructor(
    @Inject(EventOverviewService) private readonly overviews: EventOverviewService,
    @Inject(RealtimeHub) private readonly realtime: RealtimeHub,
  ) {}

  /**
   * `GET /v1/orgs/:orgId/events/:eventId/overview/live` (AD-17): stream SSE, đẩy `event_orders_changed` và
   * `event_checkins_changed` (Story 6.2: thẻ check-in) có `eventId` và `organizationId` khớp,
   * `org_review_items_changed` có `organizationId` khớp (tín hiệu cấp BTC, Story 4.3: số mục Cần xử lý của
   * `needs-action-card`; mục của Sự kiện khác cũng tới, tải lại thừa nhưng rẻ), cùng `resync` khi hub vừa nối lại
   * `LISTEN`. Dữ liệu chỉ `{ type }`: web tự tải lại `GET …/overview` (tab Đơn và `Sheet` chi tiết Đơn dùng chung
   * stream, Story 6.1). Kiểm Sự kiện trước khi mở stream (404 là JSON, không treo); `LISTEN` chưa sẵn sàng → `503`.
   */
  @Get('live')
  @RequirePermission(Permission.ORDERS_VIEW)
  async live(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.overviews.assertEvent(ctx, eventId);
    const event = eventId.toLowerCase();
    const organization = ctx.organizationId;
    this.realtime.open(
      req,
      res,
      (signal) =>
        signal.organizationId === organization &&
        ((EVENT_TOPICS.has(signal.type) && signal.eventId === event) ||
          signal.type === RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED),
    );
  }

  /** `GET /v1/orgs/:orgId/events/:eventId/overview`: `EventOverview` (số liệu Đơn nên `no-store`). */
  @Get()
  @RequirePermission(Permission.ORDERS_VIEW)
  @Header('cache-control', 'no-store')
  overview(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventOverview> {
    return this.overviews.overview(ctx, eventId);
  }
}
