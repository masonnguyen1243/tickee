import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus, RECENT_ORDERS_LIMIT, type EventOverview } from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { assertEventOfOrganization } from '../event/index.js';
import { eventRevenueOf, recentOrdersOf } from '../ordering/index.js';
import { openReviewsOf } from '../payment/index.js';
import { eventOpenReviewItemsOf } from './event-open-reviews.js';

/**
 * Tổng quan Sự kiện (Story 3.11, FR-31, AD-33): doanh thu, Đơn gần đây và số mục Cần xử lý (Story 4.3), chỉ đọc qua
 * read model của mô-đun sở hữu — `ordering` (`eventRevenueOf`, `recentOrdersOf`, `reviewOrdersOf`) và `payment`
 * (`openReviewsOf`, `openReviewItemsOf`; ghép ở `reporting` vì `ordering` không được gọi `payment`). Không join bảng của mô-đun
 * khác, không truy vấn theo từng Đơn.
 */
@Injectable()
export class EventOverviewService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND` (REST và SSE kiểm trước khi đọc hay mở stream). */
  assertEvent(ctx: AccessContext, eventId: string): Promise<void> {
    return assertEventOfOrganization(this.db.orm, ctx, eventId);
  }

  async overview(ctx: AccessContext, eventId: string): Promise<EventOverview> {
    await this.assertEvent(ctx, eventId);
    const [revenue, recent, openReviewCount] = await Promise.all([
      eventRevenueOf(this.db.orm, ctx, eventId),
      recentOrdersOf(this.db.orm, ctx, eventId, RECENT_ORDERS_LIMIT),
      this.eventOpenReviewCountOf(ctx, eventId),
    ]);
    const reviews = await openReviewsOf(
      this.db.orm,
      recent.filter((o) => o.status === OrderStatus.REVIEW).map((o) => o.id),
    );
    return {
      revenue,
      openReviewCount,
      recentOrders: recent.map((o) => {
        const review = o.status === OrderStatus.REVIEW ? reviews.get(o.id) : undefined;
        return {
          code: o.code,
          buyerName: o.buyerName,
          ticketCount: o.ticketCount,
          totalAmount: o.totalAmount,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
          review: review ? { type: review.type, receivedAmount: review.receivedAmount } : null,
        };
      }),
    };
  }

  /**
   * Số mục Cần xử lý `open` gắn Đơn của Sự kiện (`needs-action-card`, Story 4.3), ở mọi trạng thái Đơn (vd. trả trùng
   * cho Đơn `paid`). Cùng cách lấy với chip "Cần xử lý" của tab Đơn (`eventOpenReviewItemsOf`, Story 6.1).
   */
  private async eventOpenReviewCountOf(ctx: AccessContext, eventId: string): Promise<number> {
    return (await eventOpenReviewItemsOf(this.db.orm, ctx, eventId)).length;
  }
}
