import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import {
  EventDraftInput,
  Permission,
  type EventBuyerCount,
  type EventDetail,
  type EventPendingPaymentCount,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { PublicPageQueues } from '../modules/event/index.js';
import { EventChangeEmailQueues } from '../modules/ordering/index.js';
import { Access, RequirePermission, type AccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { parseRequest } from '../platform/http/index.js';
import { BOSS } from '../platform/jobs/index.js';
import { eventBuyerCount, eventPendingPaymentCount, updateEvent } from './event-update.flow.js';

/**
 * Sửa thông tin Sự kiện (Story 2.12), số Người mua (Story 3.10) và số Đơn đang chờ thanh toán (E3-2). Owner và Admin
 * (`events.manage`). Đặt ở flows vì lệnh sửa ghi `event` và enqueue email của `ordering` trong một transaction, còn hai
 * số đếm đọc Đơn của `ordering`. Các route khác của Sự kiện ở `modules/event/events.controller.ts`. Sự kiện lạ, sai dạng
 * hoặc của BTC khác → 404 `EVENT_NOT_FOUND`. Lệnh sửa kiểm body trước, chờ hai queue sẵn sàng (ngoài transaction) rồi
 * mới chạy flow.
 */
@Controller('orgs/:orgId/events/:eventId')
export class EventEditController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(PublicPageQueues) private readonly publicPageQueues: PublicPageQueues,
    @Inject(EventChangeEmailQueues) private readonly emailQueues: EventChangeEmailQueues,
  ) {}

  /** Sửa Sự kiện (thay toàn bộ các trường của `EventDraftInput`); slug không đổi. */
  @Patch()
  @RequirePermission(Permission.EVENTS_MANAGE)
  async update(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ): Promise<EventDetail> {
    const input = parseRequest(EventDraftInput, body);
    await Promise.all([this.publicPageQueues.ready(), this.emailQueues.ready()]);
    return updateEvent(this.db, this.boss, ctx, eventId, input);
  }

  /** Số Người mua (`user_id` có Đơn `paid`) của Sự kiện: `{ buyers }`. */
  @Get('buyer-count')
  @RequirePermission(Permission.EVENTS_MANAGE)
  buyerCount(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventBuyerCount> {
    return eventBuyerCount(this.db, ctx, eventId);
  }

  /** Số Đơn đang chờ thanh toán (`pending`, có link, còn hạn) của Sự kiện: `{ orders }`. Web hỏi trước `Dialog` "Kết thúc". */
  @Get('pending-payment-count')
  @RequirePermission(Permission.EVENTS_MANAGE)
  pendingPaymentCount(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
  ): Promise<EventPendingPaymentCount> {
    return eventPendingPaymentCount(this.db, ctx, eventId);
  }
}
