import { MATCHABLE_ORDER_STATUSES, ORDER_CODE_PATTERN, type OrderStatus } from '@tickee/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { orderItems, orders } from './schema.js';

/*
 * Read model của "Ghép với Đơn" (Story 4.4-b, AD-33): `payment` tìm Đơn được chọn theo mã, `reporting` liệt kê Đơn ứng
 * viên. Cả hai lọc `orgScope` (Đơn của BTC khác không bao giờ có trong kết quả). Chỉ đọc bản chụp trên Đơn (tên Người
 * mua, tổng tiền), không bao giờ trả email hay SĐT. Không khóa: trạng thái được kiểm lại dưới khóa trong `markPaid`.
 */

/** Phạm vi BTC của người xem. */
export type MatchScope = Pick<AccessContext, 'organizationId'>;

/** Đơn theo mã cho "Ghép với Đơn": `id` nội bộ để `payment` gọi `markPaid`, không bao giờ ra response. */
export interface MatchableOrder {
  id: string;
  code: string;
  status: OrderStatus;
  totalAmount: number;
}

/** Đơn mã `code` của BTC (không khóa); mã sai dạng, không có hoặc của BTC khác → `null` (sai dạng thì không chạm DB). */
export async function matchableOrderOf(db: DbExecutor, scope: MatchScope, code: string): Promise<MatchableOrder | null> {
  if (!ORDER_CODE_PATTERN.test(code)) return null;
  const [row] = await db
    .select({ id: orders.id, code: orders.code, status: orders.status, totalAmount: orders.totalAmount })
    .from(orders)
    .where(and(orgScope(scope)(orders), eq(orders.code, code)));
  return row ?? null;
}

/** Một Đơn ứng viên: `eventId` để `reporting` ghép tên và trạng thái Sự kiện, không ra response. */
export interface MatchCandidateRow {
  code: string;
  buyerName: string;
  eventId: string;
  status: (typeof MATCHABLE_ORDER_STATUSES)[number];
  /** Tổng `quantity` các dòng của Đơn. */
  ticketCount: number;
  createdAt: Date;
}

/**
 * Tối đa `limit` Đơn `expired`/`review` của BTC có `total_amount = amount` (tùy chọn chỉ Sự kiện `eventId`, người gọi đã
 * kiểm Sự kiện thuộc BTC), mới nhất trước (`created_at` rồi `id`, giảm dần; index `orders_match_candidates_idx`), kèm
 * tổng số Vé. Hai câu như `recentOrdersOf`: Đơn trước, rồi số Vé của đúng các Đơn đó.
 */
export async function matchCandidatesOf(
  db: DbExecutor,
  scope: MatchScope,
  query: { amount: number; eventId?: string; limit: number },
): Promise<MatchCandidateRow[]> {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      buyerName: orders.buyerName,
      eventId: orders.eventId,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        orgScope(scope)(orders),
        inArray(orders.status, [...MATCHABLE_ORDER_STATUSES]),
        eq(orders.totalAmount, query.amount),
        query.eventId === undefined ? undefined : eq(orders.eventId, query.eventId),
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(query.limit);
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
  return rows.map(({ id, status, ...row }) => ({
    ...row,
    status: status as MatchCandidateRow['status'],
    ticketCount: ticketsOf.get(id) ?? 0,
  }));
}
