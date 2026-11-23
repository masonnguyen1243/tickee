import { Inject, Injectable } from '@nestjs/common';
import type { CheckerAccessResolver, CheckerStatus } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { checkinEventById } from '../event/index.js';
import { checkerStatusOf } from './checkers.js';

/**
 * Cài đặt cổng `CheckerAccessResolver` của `platform/access` (AD-26): BTC sở hữu Sự kiện đọc qua `event`, trạng thái CTV
 * đọc từ bảng `checkers`. Mỗi request đọc lại, không cache: thu hồi có hiệu lực ngay ở request kế tiếp.
 */
@Injectable()
export class CheckinAccessResolver implements CheckerAccessResolver {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async resolveEvent(
    userId: string,
    eventId: string,
  ): Promise<{ organizationId: string; checker: CheckerStatus | null } | null> {
    const event = await checkinEventById(this.db.orm, eventId);
    if (!event) return null;
    const checker = await checkerStatusOf(this.db.orm, event, event.id, userId);
    return { organizationId: event.organizationId, checker };
  }
}
