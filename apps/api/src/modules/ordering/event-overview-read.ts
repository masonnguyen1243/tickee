import { OrderStatus } from '@tickee/contracts';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { orderItems, orders } from './schema.js';

/*
 * Read model của Đơn cho màn BTC của Sự kiện: Tổng quan Sự kiện (Story 3.11, AD-33; `reporting` đọc qua các hàm này,
 * xuất từ `index.ts`, không join bảng `orders`/`order_items`) và số Đơn đang chờ thanh toán của `Dialog` "Kết thúc"
 * (E3-2, `flows`). Như `paidBuyerCount`: hàm query thay cho view `ordering_read_*`, nên đổi cột
 * chỉ sửa ở đây. Mọi hàm lọc cả `organization_id` (`orgScope`) lẫn `event_id`; người gọi đã kiểm Sự kiện thuộc BTC.
 * Chỉ đọc bản chụp trên Đơn (tên Người mua, tổng tiền), không bao giờ trả email hay SĐT.
 */

/** Phạm vi BTC của người xem. */
export type EventOrdersScope = Pick<AccessContext, 'organizationId'>;

/** Doanh thu của Sự kiện: tổng `total_amount` của các Đơn `paid` và số Đơn đó (tính cả Đơn 0đ). */
export interface EventRevenue {
  amount: number;
  paidOrders: number;
}

/** Doanh thu của Sự kiện (Đơn `paid`); chưa có Đơn nào → `{ amount: 0, paidOrders: 0 }`. */
export async function eventRevenueOf(db: DbExecutor, scope: EventOrdersScope, eventId: string): Promise<EventRevenue> {
  const [row] = await db
    .select({
      // `bigint`: doanh thu một Sự kiện có thể vượt 2^31 đồng.
      amount: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)::bigint`.mapWith(Number),
      paidOrders: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(orders)
    .where(and(orgScope(scope)(orders), eq(orders.eventId, eventId), eq(orders.status, OrderStatus.PAID)));
  return { amount: row?.amount ?? 0, paidOrders: row?.paidOrders ?? 0 };
}

/** Một Đơn gần đây: `id` nội bộ chỉ để `reporting` tra mục Cần xử lý, không bao giờ ra response. */
export interface RecentOrderRow {
  id: string;
  code: string;
  buyerName: string;
  /** Tổng `quantity` các dòng của Đơn. */
  ticketCount: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: Date;
}

/**
 * `limit` Đơn mới nhất của Sự kiện ở mọi trạng thái, xếp theo `created_at` rồi `id`, giảm dần (index
 * `orders_event_id_created_at_idx`), kèm tổng số Vé. Hai câu: Đơn trước, rồi số Vé của đúng các Đơn đó (không gom dòng
 * của mọi Đơn của Sự kiện).
 */
export async function recentOrdersOf(
  db: DbExecutor,
  scope: EventOrdersScope,
  eventId: string,
  limit: number,
): Promise<RecentOrderRow[]> {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      buyerName: orders.buyerName,
      totalAmount: orders.totalAmount,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(orgScope(scope)(orders), eq(orders.eventId, eventId)))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);
  if (rows.length === 0) return [];
  const counts = await db
    .select({ orderId: orderItems.orderId, tickets: sql<number>`SUM(${orderItems.quantity})::int`.mapWith(Number) })
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(orderItems.orderId);
  const ticketsOf = new Map(counts.map((c) => [c.orderId, c.tickets]));
  return rows.map((r) => ({ ...r, ticketCount: ticketsOf.get(r.id) ?? 0 }));
}

/**
 * Số Đơn đang chờ thanh toán của Sự kiện (E3-2, `Dialog` "Kết thúc"): Đơn `pending` đã có link thanh toán và còn hạn
 * (`expires_at` > `now()` của DB). Người mua của các Đơn này có thể đang ở trang thanh toán Tingee. Đơn chưa có link,
 * link đã quá `expires_at` hay Đơn đã rời `pending` không tính.
 */
export async function pendingPaymentCountOf(db: DbExecutor, scope: EventOrdersScope, eventId: string): Promise<number> {
  const [row] = await db
    .select({ orders: sql<number>`count(*)::int`.mapWith(Number) })
    .from(orders)
    .where(
      and(
        orgScope(scope)(orders),
        eq(orders.eventId, eventId),
        eq(orders.status, OrderStatus.PENDING),
        isNotNull(orders.paymentLink),
        gt(orders.expiresAt, sql`now()`),
      ),
    );
  return row?.orders ?? 0;
}
