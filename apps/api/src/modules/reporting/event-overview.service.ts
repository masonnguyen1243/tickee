import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus, RECENT_ORDERS_LIMIT, type EventOverview } from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { assertEventOfOrganization } from '../event/index.js';
import { eventRevenueOf, recentOrdersOf, reviewOrdersOf } from '../ordering/index.js';
import { openReviewItemsOf, openReviewsOf } from '../payment/index.js';

/**
 * Tổng quan Sự kiện (Story 3.11, FR-31, AD-33): doanh thu, Đơn gần đây và số mục Cần xử lý (Story 4.3), chỉ đọc qua
 * read model của mô-đun sở hữu — `ordering` (`eventRevenueOf`, `recentOrdersOf`, `reviewOrdersOf`) và `payment`
 * (`openReviewsOf`, `openReviewItemsOf`; ghép ở đây vì `ordering` không được gọi `payment`). Không join bảng của mô-đun
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
   * cho Đơn `paid`). Mục `open` của một BTC chỉ vài chục: đọc cả hàng của BTC rồi lọc theo Sự kiện của Đơn.
   */
  private async eventOpenReviewCountOf(ctx: AccessContext, eventId: string): Promise<number> {
    const items = await openReviewItemsOf(this.db.orm, ctx);
    const orders = await reviewOrdersOf(
      this.db.orm,
      ctx,
      items.flatMap((item) => (item.orderId ? [item.orderId] : [])),
    );
    const event = eventId.toLowerCase();
    return items.filter((item) => item.orderId && orders.get(item.orderId)?.eventId === event).length;
  }
}
