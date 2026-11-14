import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { Permission, RealtimeTopic } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { RealtimeHub } from '../../platform/realtime/index.js';

/**
 * Stream SSE cấp BTC (Story 4.2-b, AD-17): báo dải `status-banner` của dashboard (và tổng quan Tài khoản nhận tiền) tải
 * lại khi cờ dịch vụ thanh toán của BTC bật, đổi lý do hoặc tắt. Hiện chỉ cờ này phát `org_status_changed`: duyệt/thu
 * hồi Closed Beta và liên kết/hủy liên kết tài khoản nhận tiền chưa phát (xem `deferred-work.md`), nên các banner đó chỉ
 * cập nhật khi mở trang hay quay lại tab. Owner và Admin (`org.read`, như `GET …/notices`); không phải thành viên → `403
 * NOT_A_MEMBER` (guard, JSON, không mở stream).
 */
@Controller('orgs/:orgId')
export class OrganizationLiveController {
  constructor(@Inject(RealtimeHub) private readonly realtime: RealtimeHub) {}

  /**
   * `GET /v1/orgs/:orgId/live`: chỉ đẩy `org_status_changed` có `organizationId` khớp (tín hiệu cấp BTC, không có
   * `eventId`), cùng `resync` khi hub vừa nối lại `LISTEN`. Dữ liệu chỉ `{ type }`: web tự tải lại REST. `LISTEN` chưa sẵn
   * sàng hoặc api đang tắt → `503`.
   */
  @Get('live')
  @RequirePermission(Permission.ORG_READ)
  live(@Access() ctx: AccessContext, @Req() req: Request, @Res() res: Response): void {
    const organization = ctx.organizationId;
    this.realtime.open(
      req,
      res,
      (signal) => signal.type === RealtimeTopic.ORG_STATUS_CHANGED && signal.organizationId === organization,
    );
  }
}
