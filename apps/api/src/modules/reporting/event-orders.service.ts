import { Inject, Injectable } from '@nestjs/common';
import {
  encodeEventOrderCursor,
  ErrorCode,
  EventOrderFilter,
  EventOrderHistoryKind,
  eventOrdersCsvFilename,
  ORDER_CODE_PATTERN,
  OrderStatus,
  type EventOrderCursorValue,
  type EventOrderDetail,
  type EventOrderExportValues,
  type EventOrderHistoryEntry,
  type EventOrderListValues,
  type EventOrderPage,
  type EventOrderRow,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { audit, type AuditAction } from '../../platform/audit/index.js';
import { DATABASE, type Database, type DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { assertEventOfOrganization, eventSlugOfOrganization } from '../event/index.js';
import {
  answerColumnsOf,
  answersOfOrders,
  eventOrderDetailOf,
  eventOrdersPageOf,
  type EventAnswerColumn,
  type EventOrderDetailRow,
  type EventOrderListRow,
  type EventOrdersPageFilter,
} from '../ordering/index.js';
import { openReviewsOf, reviewItemsOfOrder, type OpenReview, type OrderReviewItemRow } from '../payment/index.js';
import { checkinCountsOfOrders, orderTicketsOf } from '../ticketing/index.js';
import { eventOpenReviewItemsOf } from './event-open-reviews.js';
import { eventOrderCsvLine, eventOrdersCsvHead } from './event-orders-csv.js';

const orderNotFound = () => new AppError(ErrorCode.ORDER_NOT_FOUND, 'Không tìm thấy Đơn này.');

const iso = (value: Date): string => value.toISOString();

/** Chip trạng thái → trạng thái Đơn (chip "Cần xử lý" lọc theo mục `open`, không theo trạng thái). */
const FILTER_STATUSES: Readonly<Record<Exclude<EventOrderFilter, 'needs_action'>, readonly OrderStatus[]>> = {
  [EventOrderFilter.PAID]: [OrderStatus.PAID],
  [EventOrderFilter.PENDING]: [OrderStatus.PENDING],
  [EventOrderFilter.CANCELLED]: [OrderStatus.CANCELLED],
  [EventOrderFilter.REFUNDED]: [OrderStatus.REFUNDED],
};

/** Số Đơn mỗi lô khi xuất CSV (Story 6.3): mỗi lô một số câu truy vấn cố định, không nạp mọi Đơn vào bộ nhớ. */
export const EVENT_ORDERS_EXPORT_BATCH = 500;

/** Bộ lọc của danh sách và CSV, trừ vị trí và số Đơn mỗi trang. */
type OrdersFilter = Pick<EventOrdersPageFilter, 'statuses' | 'orderIds' | 'search'>;

/**
 * Bộ lọc dùng chung của danh sách (Story 6.1) và CSV (Story 6.3), cùng nghĩa: `q` khớp đầy đủ; chip trạng thái → trạng
 * thái Đơn; chip "Cần xử lý" → id các Đơn có mục `open` của Sự kiện ở mọi trạng thái (cùng cách `needs-action-card`
 * đếm). Có cả hai thì lấy giao. Người gọi đã kiểm Sự kiện thuộc BTC.
 */
async function ordersFilterOf(
  db: DbExecutor,
  ctx: AccessContext,
  eventId: string,
  query: EventOrderExportValues,
): Promise<OrdersFilter> {
  const filter: OrdersFilter = { search: query.q };
  if (query.status === EventOrderFilter.NEEDS_ACTION) {
    const items = await eventOpenReviewItemsOf(db, ctx, eventId);
    filter.orderIds = items.flatMap((item) => (item.orderId ? [item.orderId] : []));
  } else if (query.status !== undefined) {
    filter.statuses = FILTER_STATUSES[query.status];
  }
  return filter;
}

/** Bộ lọc của một lần xuất trong audit: tên chip và loại giá trị tìm, không bao giờ giá trị tìm. */
const exportAuditFields = (query: EventOrderExportValues): string[] => [
  ...(query.status !== undefined ? [`status:${query.status}`] : []),
  ...(query.q !== undefined ? [`q:${query.q.kind}`] : []),
];

/** Một lần xuất CSV đã kiểm và đã ghi audit: tên file và các phần của file theo thứ tự. */
export interface EventOrdersCsvExport {
  /** `don-<slug>-<yyyyMMdd-HHmm>.csv` (giờ Việt Nam). */
  filename: string;
  /**
   * Phần đầu (BOM + hàng tiêu đề), rồi mỗi lô Đơn một phần. Chỉ đọc DB khi được kéo phần kế tiếp: thôi lặp (`return`) là
   * thôi đọc DB.
   */
  chunks: AsyncGenerator<string, void, undefined>;
}

/** Audit của Đơn dựng lịch sử: "Đã thanh toán · Duyệt tay", "Đã hủy", "Đã hoàn tay" (Story 4.4). */
const ORDER_TRAIL_ACTIONS = ['order.paid', 'order.rejected', 'order.refunded'] as const satisfies readonly AuditAction[];

/** Dòng Đơn của response (không id nội bộ). */
function rowOf(order: EventOrderListRow, review: OpenReview | undefined): EventOrderRow {
  return {
    code: order.code,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    buyerPhone: order.buyerPhone,
    items: order.items.map((item) => ({ ticketTypeName: item.ticketTypeName, quantity: item.quantity })),
    totalAmount: order.totalAmount,
    paidAmount: order.paidAmount,
    status: order.status,
    createdAt: iso(new Date(order.createdAt)),
    paidAt: order.paidAt ? iso(order.paidAt) : null,
    review: review ? { type: review.type, receivedAmount: review.receivedAmount } : null,
  };
}

/**
 * Lịch sử Đơn (Design Notes của Story 6.1), dựng từ dữ liệu sẵn có, cũ trước: "Tạo Đơn" (`created_at`), mỗi mục Cần xử
 * lý ở mọi trạng thái (`review_items.created_at`), "Đã thanh toán · <nguồn>" (`paid_at`), "Hết hạn" (chỉ khi Đơn đang
 * `expired`: mốc sớm hơn giữa `expires_at` và `updated_at`, vì IPN `expired`/`canceled` hay link lỗi chuyển Đơn sang
 * `expired` trước hạn Giữ chỗ mà không đổi `expires_at`), "Đã hủy" / "Đã hoàn tay" (lúc ghi audit `order.rejected` /
 * `order.refunded`).
 * - Nguồn `manual` (duyệt tay, ghép với Đơn): `paid_at` là lúc tiền về, trước cả lúc mở mục Cần xử lý, nên mục "Đã thanh
 *   toán · Duyệt tay" lấy lúc BTC duyệt (audit `order.paid`); không có audit thì `paid_at`.
 * - Đơn `cancelled`/`refunded` không có audit tương ứng (vd. hủy Sự kiện, Story 7.1) → lúc Đơn đổi gần nhất
 *   (`updated_at`); Đơn `refunded` không có audit từ chối thì không có mục "Đã hủy" (không biết lúc hủy).
 * Không ghi người thao tác.
 */
function historyOf(
  order: EventOrderDetailRow,
  reviewItems: readonly OrderReviewItemRow[],
  trail: readonly { action: AuditAction; at: Date }[],
): EventOrderHistoryEntry[] {
  const trailAt = (action: AuditAction): Date | undefined => trail.find((entry) => entry.action === action)?.at;
  const history: EventOrderHistoryEntry[] = [
    { kind: EventOrderHistoryKind.CREATED, at: iso(new Date(order.createdAt)) },
    ...reviewItems.map((item) => ({
      kind: EventOrderHistoryKind.REVIEW_OPENED,
      at: iso(item.createdAt),
      reviewType: item.type,
    })),
  ];
  if (order.paidAt && order.paidSource) {
    const paidAt = (order.paidSource === 'manual' ? trailAt('order.paid') : undefined) ?? order.paidAt;
    history.push({ kind: EventOrderHistoryKind.PAID, at: iso(paidAt), paidSource: order.paidSource });
  }
  if (order.status === OrderStatus.EXPIRED) {
    // IPN `expired`/`canceled` hay link lỗi chuyển Đơn sang `expired` sớm mà không đổi `expires_at` (hạn Giữ chỗ).
    const expiredAt = order.updatedAt < order.expiresAt ? order.updatedAt : order.expiresAt;
    history.push({ kind: EventOrderHistoryKind.EXPIRED, at: iso(expiredAt) });
  }
  const rejectedAt = trailAt('order.rejected');
  if (order.status === OrderStatus.CANCELLED) {
    history.push({ kind: EventOrderHistoryKind.CANCELLED, at: iso(rejectedAt ?? order.updatedAt) });
  }
  if (order.status === OrderStatus.REFUNDED) {
    if (rejectedAt) history.push({ kind: EventOrderHistoryKind.CANCELLED, at: iso(rejectedAt) });
    history.push({ kind: EventOrderHistoryKind.REFUNDED, at: iso(trailAt('order.refunded') ?? order.updatedAt) });
  }
  // `sort` ổn định: cùng thời điểm thì giữ thứ tự trên ("Tạo Đơn", mục Cần xử lý, rồi thanh toán / kết thúc).
  return history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Tab Đơn của Sự kiện (Story 6.1, FR-31, AD-33): danh sách lọc ở server với phân trang keyset, chi tiết một Đơn, và xuất
 * CSV cùng bộ lọc (Story 6.3). Chỉ đọc qua read model của mô-đun sở hữu — `ordering` (Đơn, dòng, câu trả lời form),
 * `ticketing` (Vé của Đơn, đếm check-in), `payment` (mục Cần xử lý; ghép ở đây vì `ordering` không được gọi `payment`) —
 * và audit của Đơn (lịch sử "Đã hủy"/"Đã hoàn tay"). Mọi hàm đọc trong `orgScope` và `event_id`; số câu truy vấn cố định
 * cho mỗi trang/lô. Sự kiện được kiểm trước mọi lần đọc. Không log giá trị tìm, email hay SĐT.
 */
@Injectable()
export class EventOrdersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Một trang Đơn khớp bộ lọc, mới nhất trước. Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`. Chip "Cần
   * xử lý" lọc theo id các Đơn có mục `open` (cùng cách `needs-action-card` đếm); `review` của mỗi dòng là mục `open` cũ
   * nhất ở mọi trạng thái Đơn.
   */
  async list(ctx: AccessContext, eventId: string, query: EventOrderListValues): Promise<EventOrderPage> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const filter = await ordersFilterOf(this.db.orm, ctx, eventId, query);
    const page = await eventOrdersPageOf(this.db.orm, ctx, eventId, {
      ...filter,
      cursor: query.cursor,
      limit: query.limit,
    });
    const reviews = await openReviewsOf(
      this.db.orm,
      page.orders.map((o) => o.id),
    );
    return {
      orders: page.orders.map((order) => rowOf(order, reviews.get(order.id))),
      nextCursor: page.next ? encodeEventOrderCursor(page.next) : null,
    };
  }

  /**
   * Mở một lần xuất CSV (Story 6.3) mọi Đơn khớp bộ lọc, cùng bộ lọc và thứ tự với `list`. Sự kiện lạ, sai dạng hoặc của
   * BTC khác → `404 EVENT_NOT_FOUND` (trước khi có byte nào). Không chặn theo khóa BTC hay Sự kiện (Story 7.4: BTC bị khóa
   * vẫn xuất được). Ghi audit `event_orders.exported` trong transaction riêng trước khi trả về, tức trước byte đầu tiên.
   * Cột câu hỏi form tính trên mọi Đơn của Sự kiện (không theo bộ lọc). Không đếm tổng, không nạp mọi Đơn: các dòng đọc
   * theo lô khi người gọi kéo `chunks`.
   */
  async exportCsv(
    ctx: AccessContext,
    eventId: string,
    query: EventOrderExportValues,
    now: Date = new Date(),
  ): Promise<EventOrdersCsvExport> {
    const slug = await eventSlugOfOrganization(this.db.orm, ctx, eventId);
    const filter = await ordersFilterOf(this.db.orm, ctx, eventId, query);
    const columns = await answerColumnsOf(this.db.orm, ctx, eventId);
    await this.db.transaction((tx) =>
      audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event_orders.exported',
        target: { type: 'event', id: eventId.toLowerCase() },
        changedFields: exportAuditFields(query),
      }),
    );
    return { filename: eventOrdersCsvFilename(slug, now), chunks: this.csvChunks(ctx, eventId, filter, columns) };
  }

  /**
   * Phần đầu file, rồi mỗi lô `EVENT_ORDERS_EXPORT_BATCH` Đơn một phần, theo keyset `(created_at, mã Đơn)` giảm dần như
   * `list`: không mất, không lặp Đơn ở ranh giới lô. Số câu mỗi lô cố định: Đơn + dòng (`eventOrdersPageOf`), câu trả
   * lời, đếm check-in, mục Cần xử lý `open`. Không bọc trong một transaction (Design Notes: Đơn đổi trạng thái lúc xuất
   * có thể ra trạng thái cũ, như xem tab Đơn ở hai thời điểm).
   */
  private async *csvChunks(
    ctx: AccessContext,
    eventId: string,
    filter: OrdersFilter,
    columns: readonly EventAnswerColumn[],
  ): AsyncGenerator<string, void, undefined> {
    yield eventOrdersCsvHead(columns);
    let cursor: EventOrderCursorValue | undefined;
    do {
      const page = await eventOrdersPageOf(this.db.orm, ctx, eventId, {
        ...filter,
        cursor,
        limit: EVENT_ORDERS_EXPORT_BATCH,
      });
      if (page.orders.length === 0) return;
      const ids = page.orders.map((order) => order.id);
      const [answers, checkins, reviews] = await Promise.all([
        answersOfOrders(this.db.orm, ids),
        checkinCountsOfOrders(this.db.orm, ctx, eventId, ids),
        openReviewsOf(this.db.orm, ids),
      ]);
      yield page.orders
        .map((order) =>
          eventOrderCsvLine(
            order,
            { review: reviews.get(order.id), checkin: checkins.get(order.id), answers: answers.get(order.id) },
            columns,
          ),
        )
        .join('');
      cursor = page.next ?? undefined;
    } while (cursor !== undefined);
  }

  /**
   * Chi tiết Đơn `rawCode` (trim rồi viết hoa) của Sự kiện: dòng, nguồn thanh toán, lý do hủy, câu trả lời form, Vé và
   * lịch sử. Sự kiện lạ → `404 EVENT_NOT_FOUND` (kiểm trước mã Đơn); mã sai dạng, không có hoặc của Sự kiện/BTC khác →
   * `404 ORDER_NOT_FOUND`.
   */
  async detail(ctx: AccessContext, eventId: string, rawCode: string): Promise<EventOrderDetail> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const code = rawCode.trim().toUpperCase();
    if (!ORDER_CODE_PATTERN.test(code)) throw orderNotFound();
    const order = await eventOrderDetailOf(this.db.orm, ctx, eventId, code);
    if (!order) throw orderNotFound();
    const [tickets, reviewItems, reviews, trail] = await Promise.all([
      orderTicketsOf(this.db.orm, ctx, eventId, order.id),
      reviewItemsOfOrder(this.db.orm, ctx, order.id),
      openReviewsOf(this.db.orm, [order.id]),
      audit.trailOf(this.db.orm, {
        organizationId: ctx.organizationId,
        target: { type: 'order', id: order.id },
        actions: ORDER_TRAIL_ACTIONS,
      }),
    ]);
    return {
      ...rowOf(order, reviews.get(order.id)),
      paidSource: order.paidSource,
      cancelReason: order.cancelReason,
      answers: order.answers.map((a) => ({ label: a.label, answer: a.answer })),
      tickets: tickets.map((ticket) => ({
        seq: ticket.seq,
        orderTicketCount: ticket.orderTicketCount,
        ticketTypeName: ticket.ticketTypeName,
        holderName: ticket.holderName,
        status: ticket.status,
        cancelReason: ticket.cancelReason,
        checkedInAt: ticket.checkedInAt ? iso(ticket.checkedInAt) : null,
      })),
      history: historyOf(order, reviewItems, trail),
    };
  }
}
