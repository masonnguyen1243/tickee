import { Controller, Get, Inject } from '@nestjs/common';
import { Permission, type EventSaleStatusList } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { DATABASE, dbNow, type Database } from '../../platform/db/index.js';
import { organizationSaleStatuses } from './sellability.js';

/** Một snapshot (REPEATABLE READ) và một `now()` cho mọi truy vấn; chỉ đọc. */
const READ_TRANSACTION = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * Trạng thái bán trên dashboard BTC (Story 4.2-c, retro Epic 2 C5): nhãn của thẻ Sự kiện ở trang chủ BTC và badge thẻ
 * "Thông tin" của tab Tổng quan lấy từ `ordering.sellability` thay vì tự tính ở web. Owner và Admin (`events.manage`,
 * như danh sách Sự kiện). Không đặt dưới `orgs/:orgId/events/…` để không đụng `GET …/events/:eventId`.
 */
@Controller('orgs/:orgId')
export class EventSaleStatusController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `GET /v1/orgs/:orgId/event-sale-status`: `{ events: [{ eventId, reason, partial }] }` cho mọi Sự kiện không còn nháp
   * của BTC (mới tạo trước), tính theo đồng hồ DB (AD-14) trong một transaction chỉ đọc.
   */
  @Get('event-sale-status')
  @RequirePermission(Permission.EVENTS_MANAGE)
  list(@Access() ctx: AccessContext): Promise<EventSaleStatusList> {
    return this.db.orm.transaction(
      async (tx) => ({ events: await organizationSaleStatuses(tx, ctx, await dbNow(tx)) }),
      READ_TRANSACTION,
    );
  }
}
