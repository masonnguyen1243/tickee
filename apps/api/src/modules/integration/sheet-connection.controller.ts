import { Controller, Delete, Get, Header, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Permission, type EventSheetConnectionResponse, type SheetConnectStartResponse } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { SheetConnectionService } from './sheet-connection.service.js';

/**
 * Kết nối Google Sheets của Sự kiện ở tab Cài đặt (Story 6.4, FR-32): trạng thái, bắt đầu kết nối, ngắt kết nối. Chỉ Owner
 * và Admin (`events.manage`); không phải thành viên → `403 NOT_A_MEMBER` (guard); Sự kiện lạ hoặc của BTC khác → `404
 * EVENT_NOT_FOUND`. Không xác nhận lại (reauth), như xuất CSV. Response không bao giờ có token, `state` riêng hay id
 * spreadsheet; `no-store`.
 */
@Controller('orgs/:orgId/events/:eventId/google-sheets')
export class SheetConnectionController {
  constructor(@Inject(SheetConnectionService) private readonly sheets: SheetConnectionService) {}

  /** `GET /v1/orgs/:orgId/events/:eventId/google-sheets`: `{ connection }` (`null` khi chưa kết nối). */
  @Get()
  @RequirePermission(Permission.EVENTS_MANAGE)
  @Header('cache-control', 'no-store')
  status(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventSheetConnectionResponse> {
    return this.sheets.status(ctx, eventId);
  }

  /**
   * `POST …/google-sheets/connect` (không body): `{ authorizationUrl }` để web chuyển cả trang tới Google. Lỗi đi qua luồng
   * mutation thường (2FA, 401, toast). Đã có kết nối → `409 SHEETS_ALREADY_CONNECTED`.
   */
  @Post('connect')
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  @Header('cache-control', 'no-store')
  connect(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<SheetConnectStartResponse> {
    return this.sheets.startConnect(ctx, eventId);
  }

  /** `DELETE …/google-sheets`: ngắt kết nối (204). Không có kết nối → `404 SHEETS_NOT_CONNECTED`. */
  @Delete()
  @HttpCode(204)
  @RequirePermission(Permission.EVENTS_MANAGE)
  disconnect(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<void> {
    return this.sheets.disconnect(ctx, eventId);
  }
}
