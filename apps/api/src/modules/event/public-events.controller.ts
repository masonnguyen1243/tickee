import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { PublicEvent } from '@tickee/contracts';
import { Public } from '../../platform/http/index.js';
import { EventService } from './event.service.js';

/** API công khai của Sự kiện (không cần đăng nhập). Sự kiện nháp và slug không tồn tại cùng `404 EVENT_NOT_FOUND`. */
@Public()
@Controller('events')
export class PublicEventsController {
  constructor(@Inject(EventService) private readonly events: EventService) {}

  @Get(':slug')
  get(@Param('slug') slug: string): Promise<PublicEvent> {
    return this.events.publicBySlug(slug);
  }
}
