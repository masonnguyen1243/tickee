import { Controller, Get, Header, Inject, Logger, Param, Query, Res } from '@nestjs/common';
import {
  EventOrderExportQuery,
  EventOrderListQuery,
  Permission,
  type EventOrderDetail,
  type EventOrderPage,
} from '@tickee/contracts';
import type { Response } from 'express';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { dbErrorSummary, isDatabaseError } from '../../platform/logging/index.js';
import { EventOrdersService, type EventOrdersCsvExport } from './event-orders.service.js';

/**
 * Ghi `chunk` vào response theo backpressure: `write` trả `false` thì chờ `drain`. Trả `false` khi kết nối đã đóng (client
 * ngắt) trước hoặc trong lúc chờ: người gọi thôi đọc tiếp.
 */
function writeChunk(res: Response, chunk: string): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (open: boolean) => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(open);
    };
    const onDrain = () => settle(!res.destroyed);
    const onClose = () => settle(false);
    res.on('drain', onDrain);
    res.on('close', onClose);
  });
}

/**
 * Tab Đơn của Sự kiện (Story 6.1, FR-31): danh sách Đơn lọc ở server (`status`, `q`), phân trang `cursor` + `limit`, chi
 * tiết một Đơn, và xuất CSV cùng bộ lọc (Story 6.3). Chỉ Owner và Admin (`orders.view`); không phải thành viên (kể cả CTV
 * được giao Sự kiện) → `403 NOT_A_MEMBER` (guard). Dữ liệu Người mua nên `no-store`. Giá trị `q` chỉ nằm trên query: log
 * và span của api đã che query (`redactUrlQuery`), lỗi `400` không lặp lại giá trị. Tự cập nhật theo stream Tổng quan
 * (`…/overview/live`).
 */
@Controller('orgs/:orgId/events/:eventId/orders')
export class EventOrdersController {
  private readonly logger = new Logger('EventOrdersController');

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

  /**
   * `GET /v1/orgs/:orgId/events/:eventId/orders/export[?status=&q=]` (Story 6.3): file CSV mọi Đơn khớp bộ lọc, stream
   * theo lô. Khai báo trước `:code`. Query sai → `400 VALIDATION_FAILED`, Sự kiện lạ → `404 EVENT_NOT_FOUND`: cả hai là
   * JSON, trước khi gửi header CSV. Không chặn theo khóa BTC hay Sự kiện (Story 7.4).
   */
  @Get('export')
  @RequirePermission(Permission.ORDERS_VIEW)
  async export(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.orders.exportCsv(ctx, eventId, parseRequest(EventOrderExportQuery, query));
    await this.send(res, csv, { organizationId: ctx.organizationId, eventId });
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

  /**
   * Gửi file CSV: header (`text/csv; charset=utf-8`, `attachment; filename="…"`, `no-store`), rồi từng phần theo
   * backpressure. Client ngắt → thôi kéo phần kế tiếp (thôi đọc DB), không lỗi, không log lỗi. Lỗi giữa chừng → log (chỉ
   * loại lỗi và id, không dữ liệu cá nhân) rồi `destroy` kết nối: client nhận file cụt thành lỗi, không có dòng lỗi
   * trong file. Lỗi trước byte đầu tiên → ném lại cho `ErrorFilter` (JSON).
   */
  private async send(
    res: Response,
    csv: EventOrdersCsvExport,
    ids: { organizationId: string; eventId: string },
  ): Promise<void> {
    if (res.destroyed) {
      await csv.chunks.return();
      return;
    }
    res.status(200);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${csv.filename}"`);
    res.setHeader('cache-control', 'no-store');
    try {
      for await (const chunk of csv.chunks) {
        // `return` trong `for await` gọi `chunks.return()`: không đọc lô nào nữa.
        if (!(await writeChunk(res, chunk))) return;
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        // `ErrorFilter` trả JSON: gỡ mọi header CSV (Express giữ `content-type` đã đặt khi `res.json`).
        for (const header of ['content-type', 'content-disposition', 'cache-control']) res.removeHeader(header);
        throw err;
      }
      this.logger.error(
        { err: isDatabaseError(err) ? dbErrorSummary(err) : err, ...ids },
        'Xuất CSV danh sách Đơn dừng giữa chừng',
      );
      res.destroy();
    }
  }
}
