import { Controller, Get, Header, Inject, Param, Req, Res } from '@nestjs/common';
import { RealtimeTopic, type MyTicketDetail, type MyTicketsView } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { RealtimeHub } from '../../platform/realtime/index.js';
import { MyTicketsService } from './my-tickets.service.js';

/**
 * Request đã qua guard session (route không `@Public`): `req.user` là user của session. Đọc trực tiếp, không import
 * `identity` (AD-10).
 */
type BuyerRequest = Request & { user: { id: string } };

/**
 * "Vé của tôi" và Chi tiết Vé (Story 3.9, `buyerScope`, AD-13). Cần đăng nhập, đã đồng ý NĐ 13 và đã qua lớp hai (guard
 * toàn cục của `identity`); chỉ dữ liệu có `user_id` = người gọi. Response có Mã QR vé, token chia sẻ và thông tin cá
 * nhân nên `cache-control: no-store`. `live` khai báo trước `:ticketId` để Express khớp đúng route.
 */
@Controller('me/tickets')
export class MyTicketsController {
  constructor(
    @Inject(MyTicketsService) private readonly myTickets: MyTicketsService,
    @Inject(RealtimeHub) private readonly realtime: RealtimeHub,
  ) {}

  /** `GET /v1/me/tickets`: ba nhóm Vé còn hiệu lực · Đơn đang chờ · Lịch sử, kèm `serverNow` (không có QR). */
  @Get()
  @Header('cache-control', 'no-store')
  list(@Req() req: BuyerRequest): Promise<MyTicketsView> {
    return this.myTickets.list(req.user.id);
  }

  /**
   * `GET /v1/me/tickets/live` (AD-17): stream SSE, chỉ đẩy `order_changed` của các Đơn người gọi sở hữu lúc mở stream
   * (lọc theo tập id tra lúc mở, vì payload `RealtimeSignal` không có `userId`) và `resync` khi hub vừa nối lại `LISTEN`.
   * Dữ liệu chỉ `{ type }`: web tự tải lại `GET /v1/me/tickets`. Không đăng nhập → `401`; máy chủ đang tắt → `503`.
   */
  @Get('live')
  async live(@Req() req: BuyerRequest, @Res() res: Response): Promise<void> {
    const ids = await this.myTickets.liveOrderIds(req.user.id);
    this.realtime.open(req, res, (signal) => signal.type === RealtimeTopic.ORDER_CHANGED && ids.has(signal.id));
  }

  /**
   * `GET /v1/me/tickets/:ticketId`: Chi tiết Vé (QR và token chia sẻ chỉ khi Vé còn dùng được) kèm biên nhận và liên hệ
   * BTC. Vé không thuộc người gọi hoặc id sai dạng → `404 TICKET_NOT_FOUND`.
   */
  @Get(':ticketId')
  @Header('cache-control', 'no-store')
  detail(@Param('ticketId') ticketId: string, @Req() req: BuyerRequest): Promise<MyTicketDetail> {
    return this.myTickets.detail(req.user.id, ticketId);
  }
}
