import { Inject, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  RECENT_ORDERS_LIMIT,
  type EventOverview,
  type EventOverviewTicketType,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { assertEventOfOrganization, ticketTypesOf } from '../event/index.js';
import { eventRevenueOf, inventoryOf, recentOrdersOf } from '../ordering/index.js';
import { openReviewsOf } from '../payment/index.js';
import { checkinCountsByTicketType } from '../ticketing/index.js';
import { eventOpenReviewItemsOf } from './event-open-reviews.js';

/**
 * Tổng quan Sự kiện (Story 3.11, FR-31, AD-33): doanh thu, Đơn gần đây, số mục Cần xử lý (Story 4.3), số check-in và Vé
 * theo Hạng vé (Story 6.2), chỉ đọc qua read model của mô-đun sở hữu — `ordering` (`eventRevenueOf`, `recentOrdersOf`,
 * `reviewOrdersOf`, `inventoryOf`), `payment` (`openReviewsOf`, `openReviewItemsOf`; ghép ở `reporting` vì `ordering`
 * không được gọi `payment`), `event` (`ticketTypesOf`) và `ticketing` (`checkinCountsByTicketType`). Không join bảng
 * của mô-đun khác, không truy vấn theo từng Đơn hay từng Hạng vé: số câu truy vấn cố định mỗi lần đọc. Đọc không khóa.
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
    const [revenue, recent, openReviewCount, ticketTypes, checkin] = await Promise.all([
      eventRevenueOf(this.db.orm, ctx, eventId),
      recentOrdersOf(this.db.orm, ctx, eventId, RECENT_ORDERS_LIMIT),
      this.eventOpenReviewCountOf(ctx, eventId),
      this.ticketTypeStockOf(ctx, eventId),
      this.checkinOf(ctx, eventId),
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
      checkin,
      ticketTypes,
    };
  }

  /**
   * Khối "Vé theo Hạng vé" (Story 6.2): Hạng vé của Sự kiện theo thứ tự `ticketTypesOf` (tạo trước đứng trước), kèm tồn
   * kho `inventoryOf` (hai câu, như `listTicketTypes`: Hạng vé bị xóa xen giữa, không còn dòng tồn kho, thì bỏ). Tên và
   * giá hiện tại; `remaining` = `max(0, capacity − sold − held)`. Không trả id nội bộ.
   */
  private async ticketTypeStockOf(ctx: AccessContext, eventId: string): Promise<EventOverviewTicketType[]> {
    const types = await ticketTypesOf(this.db.orm, ctx, eventId);
    const stock = await inventoryOf(
      this.db.orm,
      types.map((t) => t.id),
    );
    return types.flatMap((type) => {
      const row = stock.get(type.id);
      if (!row) return [];
      const { capacity, sold, held } = row;
      const remaining = Math.max(0, capacity - sold - held);
      return [{ name: type.name, price: type.price, capacity, sold, held, remaining }];
    });
  }

  /**
   * Thẻ check-in (Story 6.2): tổng các nhóm `checkinCountsByTicketType` (chỉ Vé `valid`; Vé hủy hay bị vô hiệu không
   * tính, kể cả đã check-in), cùng số với tab Check-in (`CheckinEvent`).
   */
  private async checkinOf(ctx: AccessContext, eventId: string): Promise<EventOverview['checkin']> {
    const groups = await checkinCountsByTicketType(this.db.orm, ctx, eventId);
    let checkedInCount = 0;
    let validTicketCount = 0;
    for (const group of groups) {
      checkedInCount += group.checkedInCount;
      validTicketCount += group.validTicketCount;
    }
    return { checkedInCount, validTicketCount };
  }

  /**
   * Số mục Cần xử lý `open` gắn Đơn của Sự kiện (`needs-action-card`, Story 4.3), ở mọi trạng thái Đơn (vd. trả trùng
   * cho Đơn `paid`). Cùng cách lấy với chip "Cần xử lý" của tab Đơn (`eventOpenReviewItemsOf`, Story 6.1).
   */
  private async eventOpenReviewCountOf(ctx: AccessContext, eventId: string): Promise<number> {
    return (await eventOpenReviewItemsOf(this.db.orm, ctx, eventId)).length;
  }
}
