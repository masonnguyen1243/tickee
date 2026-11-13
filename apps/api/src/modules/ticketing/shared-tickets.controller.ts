import { Controller, Get, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { SharedTicketView, TicketShareLink } from '@tickee/contracts';
import type { Request } from 'express';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { Public } from '../../platform/http/index.js';
import { TicketsService } from './tickets.service.js';

/**
 * Request đã qua guard session (route không `@Public`): `req.user` là user của session. Đọc trực tiếp, không import
 * `identity` (AD-10).
 */
type OwnerRequest = Request & { user: { id: string } };

/**
 * Link chia sẻ Vé (Story 3.8, AD-29). Hai đường duy nhất tới Vé ngoài Trang Đơn của chủ Vé:
 * - `GET /v1/shared-tickets/:token` (`@Public`, `shareScope`): ai cầm link thấy đúng một Vé, không PII. Chỉ đọc.
 * - `POST /v1/me/tickets/:ticketId/share-link` (cần đăng nhập, `buyerScope`): chủ Vé "Tạo lại link".
 * Mọi response `cache-control: no-store` (Mã QR vé, token). Log request che token trong đường dẫn (`pino-options.ts`).
 */
@Controller()
export class SharedTicketsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TicketsService) private readonly tickets: TicketsService,
  ) {}

  /**
   * `GET /v1/shared-tickets/:token`: `SharedTicketView` (Mã QR vé, Sự kiện, Hạng vé, "Vé k/N", trạng thái). Token sai,
   * Vé hủy, Sự kiện hủy, quá `effective_end_at`, khóa QR của Vé không có trong `TICKET_QR_KEYS` → cùng một `404
   * SHARED_TICKET_NOT_FOUND`.
   */
  @Public()
  @Get('shared-tickets/:token')
  @Header('cache-control', 'no-store')
  @Header('referrer-policy', 'no-referrer')
  shared(@Param('token') token: string): Promise<SharedTicketView> {
    return this.tickets.sharedTicket(this.db.orm, token);
  }

  /**
   * `POST /v1/me/tickets/:ticketId/share-link`: tạo lại link chia sẻ Vé của chính Người mua; `200` với token mới, link cũ
   * chết ngay, Mã QR vé không đổi. Vé của người khác, đã hủy hoặc quá `effective_end_at` → `404 TICKET_NOT_FOUND`.
   */
  @Post('me/tickets/:ticketId/share-link')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  regenerate(@Param('ticketId') ticketId: string, @Req() req: OwnerRequest): Promise<TicketShareLink> {
    return this.tickets.regenerateShareLink(this.db, req.user.id, ticketId);
  }
}
