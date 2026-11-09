import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { FunnelEventInput } from '@tickee/contracts';
import { parseRequest, Public } from '../../platform/http/index.js';
import { FunnelService } from './funnel.service.js';

/**
 * `POST /v1/events/:slug/funnel-events` (không cần đăng nhập, không đọc session): ghi sự kiện phễu mua, luôn 204 khi
 * body hợp lệ và Sự kiện tồn tại (kể cả khi bị bỏ qua hay trùng). Body sai → `400 VALIDATION_FAILED`; slug lạ hoặc
 * Sự kiện nháp → `404 EVENT_NOT_FOUND`.
 */
@Public()
@Controller('events')
export class FunnelController {
  constructor(@Inject(FunnelService) private readonly funnel: FunnelService) {}

  @Post(':slug/funnel-events')
  @HttpCode(204)
  async record(@Param('slug') slug: string, @Body() body: unknown): Promise<void> {
    await this.funnel.record(slug, parseRequest(FunnelEventInput, body));
  }
}
