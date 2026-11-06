import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { PublicEvent } from '@tickee/contracts';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { Public } from '../../platform/http/index.js';
import { publicEventDetail } from './public-event.js';

/** API công khai của Sự kiện (không cần đăng nhập). Sự kiện nháp và slug không tồn tại cùng `404 EVENT_NOT_FOUND`. */
@Public()
@Controller('events')
export class PublicEventsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get(':slug')
  get(@Param('slug') slug: string): Promise<PublicEvent> {
    return publicEventDetail(this.db.orm, slug);
  }
}
