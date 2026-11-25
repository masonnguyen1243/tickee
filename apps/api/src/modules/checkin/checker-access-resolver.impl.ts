import { Inject, Injectable } from '@nestjs/common';
import type { CheckerAccessResolver, CheckerEventAccess } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { checkinEventById } from '../event/index.js';
import { checkerStatusOf } from './checkers.js';

/**
 * Cài đặt cổng `CheckerAccessResolver` của `platform/access` (AD-26): BTC sở hữu Sự kiện và `ended` (luật "đã kết thúc"
 * của cổng check-in, Story 5.6) đọc qua `event`, trạng thái CTV đọc từ bảng `checkers`. Mỗi request đọc lại, không
 * cache: thu hồi và hết quyền có hiệu lực ngay ở request kế tiếp.
 */
@Injectable()
export class CheckinAccessResolver implements CheckerAccessResolver {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async resolveEvent(userId: string, eventId: string): Promise<CheckerEventAccess | null> {
    const event = await checkinEventById(this.db.orm, eventId);
    if (!event) return null;
    const checker = await checkerStatusOf(this.db.orm, event, event.id, userId);
    return { organizationId: event.organizationId, checker, ended: event.ended };
  }
}
