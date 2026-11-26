import { Controller, Get, Header, Inject, Req, Res } from '@nestjs/common';
import { ErrorCode, Permission, RealtimeTopic, roleHasPermission, type CheckinEvent } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { EventAccess, RequirePermission, type EventAccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { RealtimeHub } from '../../platform/realtime/index.js';
import { checkinEventById, ticketTypesOf } from '../event/index.js';
import { checkinCountsByTicketType } from '../ticketing/index.js';

/**
 * Route CTV (`/v1/checkin/events/:eventId/…`, Story 5.2, AD-26): Owner/Admin của BTC sở hữu Sự kiện, hoặc CTV `active`
 * của đúng Sự kiện đó (`PermissionGuard`, nhánh Sự kiện). Người khác, Sự kiện lạ hoặc id sai dạng → `403 NOT_A_MEMBER`;
 * CTV bị thu hồi → `403 CHECKER_REVOKED`; CTV `active` khi Sự kiện đã kết thúc → `403 EVENT_ENDED` (Story 5.6).
 * `no-store`: response phụ thuộc quyền đọc lại ở mỗi request. `live` khai báo trước nên không đụng route nào khác.
 */
@Controller('checkin/events/:eventId')
export class CheckinEventController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RealtimeHub) private readonly realtime: RealtimeHub,
  ) {}

  /**
   * `GET /v1/checkin/events/:eventId/live` (Story 5.7, FR-30, AD-17): stream SSE dùng chung cho Owner, Admin và CTV
   * được giao, đẩy `event_checkins_changed` có `eventId` và `organizationId` khớp ctx, cùng `resync` khi hub vừa nối
   * lại `LISTEN`. Owner/Admin (quyền `orders.view`, như stream Tổng quan) nhận thêm `event_orders_changed` của Sự kiện
   * (Story 6.2, mục hoãn của 5.7): Vé mới phát chỉ phát tín hiệu Đơn, nên mẫu số N ở tab Check-in tăng mà không cần chờ
   * lần check-in kế tiếp. CTV (`role` `null`) không nhận topic Đơn (AD-17). Dữ liệu chỉ `{ type }`: web tự tải lại
   * `GET /v1/checkin/events/:eventId`. Guard nhánh Sự kiện quyết quyền trước khi mở stream (`403` là JSON, không treo);
   * `LISTEN` chưa sẵn sàng → `503`. Không kiểm lại quyền trên stream đang mở: thu hồi hay hết giờ không đóng stream,
   * lần tải lại kế tiếp nhận `403` và web tự đóng stream.
   */
  @Get('live')
  @RequirePermission(Permission.CHECKIN_SCAN)
  live(@EventAccess() ctx: EventAccessContext, @Req() req: Request, @Res() res: Response): void {
    // Guard đã chuẩn hóa `eventId` về chữ thường, như `eventId` của tín hiệu.
    const { eventId, organizationId } = ctx;
    const seesOrders = ctx.role !== null && roleHasPermission(ctx.role, Permission.ORDERS_VIEW);
    this.realtime.open(
      req,
      res,
      (signal) =>
        (signal.type === RealtimeTopic.EVENT_CHECKINS_CHANGED ||
          (seesOrders && signal.type === RealtimeTopic.EVENT_ORDERS_CHANGED)) &&
        signal.eventId === eventId &&
        signal.organizationId === organizationId,
    );
  }

  /**
   * Sự kiện của Màn quét và tab Check-in: id, tên, số Vé đã check-in trên tổng số Vé hợp lệ (chỉ Vé `valid` của Sự kiện),
   * và số đó theo từng Hạng vé (Story 5.7): mọi Hạng vé của Sự kiện theo thứ tự `ticketTypesOf` (tạo trước đứng trước),
   * tên hiện tại; Hạng vé không có Vé `valid` nào → `0/0`. Hai số tổng là tổng các hàng Hạng vé trả về, nên luôn khớp
   * các thanh.
   */
  @Get()
  @RequirePermission(Permission.CHECKIN_SCAN)
  @Header('cache-control', 'no-store')
  async get(@EventAccess() ctx: EventAccessContext): Promise<CheckinEvent> {
    const event = await checkinEventById(this.db.orm, ctx.eventId);
    // Guard vừa xác nhận Sự kiện thuộc BTC này; biến mất hay đổi BTC giữa chừng thì coi như không có quyền.
    if (!event || event.organizationId !== ctx.organizationId) {
      throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không có quyền soát vé cho Sự kiện này.');
    }
    const [types, groups] = await Promise.all([
      ticketTypesOf(this.db.orm, event, event.id),
      checkinCountsByTicketType(this.db.orm, event, event.id),
    ]);
    const byType = new Map(groups.map((group) => [group.ticketTypeId, group]));
    const ticketTypes = types.map((type) => ({
      ticketTypeId: type.id,
      name: type.name,
      checkedInCount: byType.get(type.id)?.checkedInCount ?? 0,
      validTicketCount: byType.get(type.id)?.validTicketCount ?? 0,
    }));
    let checkedInCount = 0;
    let validTicketCount = 0;
    for (const row of ticketTypes) {
      checkedInCount += row.checkedInCount;
      validTicketCount += row.validTicketCount;
    }
    return { eventId: event.id, eventName: event.name, checkedInCount, validTicketCount, ticketTypes };
  }
}
