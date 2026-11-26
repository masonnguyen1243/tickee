import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { EventOrderListQuery, Permission, type EventOrderDetail, type EventOrderPage } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { EventOrdersService } from './event-orders.service.js';

/**
 * Tab Đơn của Sự kiện (Story 6.1, FR-31): danh sách Đơn lọc ở server (`status`, `q`), phân trang `cursor` + `limit`, và
 * chi tiết một Đơn. Chỉ Owner và Admin (`orders.view`); không phải thành viên (kể cả CTV được giao Sự kiện) → `403
 * NOT_A_MEMBER` (guard). Dữ liệu Người mua nên `no-store`. Giá trị `q` chỉ nằm trên query: log và span của api đã che
 * query (`redactUrlQuery`), lỗi `400` không lặp lại giá trị. Tự cập nhật theo stream Tổng quan (`…/overview/live`).
 */
@Controller('orgs/:orgId/events/:eventId/orders')
export class EventOrdersController {
  constructor(@Inject(EventOrdersService) private readonly orders: EventOrdersService) {}

  /**
   * `GET /v1/orgs/:orgId/events/:eventId/orders[?status=&q=&cursor=&limit=]`: `EventOrderPage`. Query sai (status lạ,
   * `q` không nhận ra, cursor hỏng, `limit` ngoài 1–100) → `400 VALIDATION_FAILED`.
   */
  @Get()
  @RequirePermission(Permission.ORDERS_VIEW)
  @Header('cache-control', 'no-store')
  list(@Access() ctx: AccessContext, @Param('eventId') eventId: string, @Query() query: unknown): Promise<EventOrderPage> {
    return this.orders.list(ctx, eventId, parseRequest(EventOrderListQuery, query));
  }

  /** `GET /v1/orgs/:orgId/events/:eventId/orders/:code`: `EventOrderDetail`. */
  @Get(':code')
  @RequirePermission(Permission.ORDERS_VIEW)
  @Header('cache-control', 'no-store')
  detail(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('code') code: string,
  ): Promise<EventOrderDetail> {
    return this.orders.detail(ctx, eventId, code);
  }
}
