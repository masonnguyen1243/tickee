import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  ReviewItemLogKind,
  ReviewItemType,
  type ReviewItemDetail,
  type ReviewItemEvent,
  type ReviewItemLogEntry,
  type ReviewQueue,
  type ReviewQueueSummary,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { assertEventOfOrganization, eventNotFound, ticketEventsByIds } from '../event/index.js';
import { reviewOrdersOf } from '../ordering/index.js';
import { openReviewCountOf, openReviewItemsOf, reviewItemDetailOf } from '../payment/index.js';

const reviewItemNotFound = () => new AppError(ErrorCode.REVIEW_ITEM_NOT_FOUND, 'Không tìm thấy mục Cần xử lý này.');

const iso = (value: Date): string => value.toISOString();

/**
 * Hàng Cần xử lý của BTC (Story 4.3, FR-21, AD-33): chỉ đọc qua read model của mô-đun sở hữu — `payment` (mục và khoản
 * tiền: `openReviewItemsOf`, `openReviewCountOf`, `reviewItemDetailOf`), `ordering` (Đơn theo lô: `reviewOrdersOf`) và
 * `event` (tên Sự kiện: `ticketEventsByIds`). Ghép ở đây vì `payment` không được gọi `event`. Mọi hàm đọc trong
 * `orgScope` của người gọi; không trả email, SĐT hay trường thô của `payment_events`. Thao tác xử lý mục là Story 4.4.
 */
@Injectable()
export class ReviewQueueService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Mọi mục `open` của BTC, cũ nhất trước. Có `eventId`: Sự kiện phải thuộc BTC (`404 EVENT_NOT_FOUND`), chỉ giữ mục gắn
   * Đơn của Sự kiện đó (không có `unmatched`), kèm Sự kiện đang lọc.
   */
  async queue(ctx: AccessContext, eventId?: string): Promise<ReviewQueue> {
    const filter = eventId === undefined ? null : await this.eventOf(ctx, eventId);
    const items = await openReviewItemsOf(this.db.orm, ctx);
    const orders = await reviewOrdersOf(
      this.db.orm,
      ctx,
      items.flatMap((item) => (item.orderId ? [item.orderId] : [])),
    );
    const rows = items.flatMap((item) => {
      const order = item.orderId ? orders.get(item.orderId) : undefined;
      if (filter && order?.eventId !== filter.id) return [];
      return [{ item, order }];
    });
    const events = await ticketEventsByIds(
      this.db.orm,
      rows.flatMap(({ order }) => (order ? [order.eventId] : [])),
    );
    return {
      event: filter,
      items: rows.map(({ item, order }) => {
        const event = order ? events.get(order.eventId) : undefined;
        return {
          id: item.id,
          type: item.type,
          receivedAmount: item.receivedAmount,
          createdAt: iso(item.createdAt),
          order: order ? { code: order.code, buyerName: order.buyerName, totalAmount: order.totalAmount } : null,
          event: event ? { id: event.id, name: event.name } : null,
        };
      }),
    };
  }

  /** Số mục `open` của BTC (badge). */
  async summary(ctx: AccessContext): Promise<ReviewQueueSummary> {
    return { openCount: await openReviewCountOf(this.db.orm, ctx) };
  }

  /**
   * Chi tiết một mục ở mọi trạng thái: giao dịch, Đơn liên quan, Sự kiện và nhật ký dựng từ dữ liệu sẵn có ("Nhận tiền"
   * lúc `paid_at`, không có thì lúc Tickee nhận; "Mở mục" lúc tạo mục), cũ trước. Id sai dạng, không tồn tại hoặc của
   * BTC khác → `404 REVIEW_ITEM_NOT_FOUND`. "Mã Đơn trong giao dịch" chỉ trả cho mục `unmatched`.
   */
  async detail(ctx: AccessContext, itemId: string): Promise<ReviewItemDetail> {
    const row = await reviewItemDetailOf(this.db.orm, ctx, itemId);
    if (!row) throw reviewItemNotFound();
    const order = row.orderId ? (await reviewOrdersOf(this.db.orm, ctx, [row.orderId])).get(row.orderId) : undefined;
    const event = order ? (await ticketEventsByIds(this.db.orm, [order.eventId])).get(order.eventId) : undefined;
    const log: ReviewItemLogEntry[] = [
      { kind: ReviewItemLogKind.PAYMENT_RECEIVED, at: iso(row.paidAt ?? row.receivedAt) },
      { kind: ReviewItemLogKind.ITEM_OPENED, at: iso(row.createdAt) },
    ];
    // `sort` ổn định: cùng thời điểm thì "Nhận tiền" vẫn trước "Mở mục".
    log.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      id: row.id,
      type: row.type,
      reason: row.reason,
      status: row.status,
      resolution: row.resolution,
      createdAt: iso(row.createdAt),
      transaction: {
        receivedAmount: row.receivedAmount,
        transactionCode: row.transactionCode,
        paidAt: row.paidAt ? iso(row.paidAt) : null,
        receivedAt: iso(row.receivedAt),
        paymentMethod: row.paymentMethod,
        providerOrderId: row.type === ReviewItemType.UNMATCHED ? row.providerOrderId : null,
      },
      order: order
        ? {
            code: order.code,
            status: order.status,
            buyerName: order.buyerName,
            ticketCount: order.ticketCount,
            totalAmount: order.totalAmount,
            createdAt: iso(order.createdAt),
          }
        : null,
      event: event ? { id: event.id, name: event.name } : null,
      log,
    };
  }

  /** Sự kiện đang lọc: lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`. */
  private async eventOf(ctx: AccessContext, eventId: string): Promise<ReviewItemEvent> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const event = (await ticketEventsByIds(this.db.orm, [eventId])).get(eventId.toLowerCase());
    if (!event) throw eventNotFound();
    return { id: event.id, name: event.name };
  }
}
