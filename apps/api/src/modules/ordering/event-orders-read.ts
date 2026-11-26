import type { EventOrderCursorValue, OrderCancelReason, OrderSearch, OrderStatus } from '@tickee/contracts';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { orgScope } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import type { EventOrdersScope } from './event-overview-read.js';
import { orderAnswers, orderItems, orders, type PaidSource } from './schema.js';

/*
 * Read model của tab Đơn (Story 6.1, FR-31, AD-33): `reporting` đọc qua các hàm này (xuất từ `index.ts`), không join
 * `orders`/`order_items`/`order_answers`. Mọi hàm lọc `organization_id` (`orgScope`) và `event_id` (người gọi đã kiểm Sự
 * kiện thuộc BTC). Số câu truy vấn cố định: danh sách hai câu (Đơn, rồi dòng của đúng các Đơn đó), chi tiết ba câu. Trả
 * bản chụp Người mua (tên, email, SĐT) vì màn này là của Owner/Admin; `id` nội bộ chỉ để `reporting` ghép, không bao giờ
 * ra response.
 */

/** `created_at` dạng ISO UTC đủ micro giây (`Date` của JS chỉ tới mili giây): nguyên chuỗi này vào cursor. */
const createdAtMicros = sql<string>`to_char(${orders.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Một dòng của Đơn: tên Hạng vé và số Vé. */
export interface EventOrderItemRow {
  ticketTypeName: string;
  quantity: number;
}

/** Một Đơn của tab Đơn. */
export interface EventOrderListRow {
  id: string;
  code: string;
  buyerName: string;
  buyerEmail: string;
  /** E.164. */
  buyerPhone: string;
  totalAmount: number;
  paidAmount: number | null;
  status: OrderStatus;
  /** `created_at` ISO UTC đủ micro giây. */
  createdAt: string;
  paidAt: Date | null;
  /** Theo Hạng vé (id Hạng vé tăng dần, như thứ tự "Vé k/N"). */
  items: EventOrderItemRow[];
}

/** Bộ lọc một trang: các điều kiện có mặt lấy giao (AND). */
export interface EventOrdersPageFilter {
  /** Chỉ các trạng thái này. */
  statuses?: readonly OrderStatus[];
  /** Chỉ các Đơn này (vd. Đơn có mục Cần xử lý `open`); rỗng → trang rỗng, không chạm DB. */
  orderIds?: readonly string[];
  /** Khớp đầy đủ mã Đơn, SĐT E.164 hoặc `lower(buyer_email)`. */
  search?: OrderSearch;
  /** Vị trí của Đơn cuối trang trước: chỉ Đơn đứng sau nó. */
  cursor?: EventOrderCursorValue;
  limit: number;
}

/** Một trang: Đơn khớp, và vị trí của Đơn cuối khi còn trang sau (`null` khi hết). */
export interface EventOrdersPageRows {
  orders: EventOrderListRow[];
  next: EventOrderCursorValue | null;
}

/** Điều kiện khớp đầy đủ của ô tìm (như tra tay Story 5.5: không index riêng, quét trong phạm vi Sự kiện). */
function searchCondition(search: OrderSearch): SQL {
  switch (search.kind) {
    case 'code':
      return eq(orders.code, search.code);
    case 'phone':
      return eq(orders.buyerPhone, search.phone);
    case 'email':
      return sql`lower(${orders.buyerEmail}) = ${search.email}`;
  }
}

/**
 * Một trang Đơn của Sự kiện, mới nhất trước: `created_at` rồi mã Đơn, giảm dần (index `orders_event_id_created_at_idx`).
 * Keyset `(created_at, code) < (cursor)` so ở Postgres với `created_at` đủ micro giây; lấy `limit + 1` Đơn để biết còn
 * trang sau. Câu thứ hai lấy dòng của đúng các Đơn trên trang.
 */
export async function eventOrdersPageOf(
  db: DbExecutor,
  scope: EventOrdersScope,
  eventId: string,
  filter: EventOrdersPageFilter,
): Promise<EventOrdersPageRows> {
  if (filter.orderIds !== undefined && filter.orderIds.length === 0) return { orders: [], next: null };
  const conditions: SQL[] = [orgScope(scope)(orders), eq(orders.eventId, eventId)];
  if (filter.statuses !== undefined) conditions.push(inArray(orders.status, [...filter.statuses]));
  if (filter.orderIds !== undefined) conditions.push(inArray(orders.id, [...new Set(filter.orderIds)]));
  if (filter.search !== undefined) conditions.push(searchCondition(filter.search));
  if (filter.cursor !== undefined) {
    conditions.push(
      sql`(${orders.createdAt}, ${orders.code}) < (${filter.cursor.createdAt}::timestamptz, ${filter.cursor.code})`,
    );
  }
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      buyerName: orders.buyerName,
      buyerEmail: orders.buyerEmail,
      buyerPhone: orders.buyerPhone,
      totalAmount: orders.totalAmount,
      paidAmount: orders.paidAmount,
      status: orders.status,
      createdAt: createdAtMicros,
      paidAt: orders.paidAt,
    })
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt), desc(orders.code))
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  const next = rows.length > filter.limit && last ? { createdAt: last.createdAt, code: last.code } : null;
  if (page.length === 0) return { orders: [], next: null };
  const itemsOf = await itemsOfOrders(
    db,
    page.map((r) => r.id),
  );
  return { orders: page.map((r) => ({ ...r, items: itemsOf.get(r.id) ?? [] })), next };
}

/** Câu trả lời form của Đơn (bản chụp lúc đặt). */
export interface EventOrderAnswerRow {
  label: string;
  answer: string;
}

/** Chi tiết một Đơn của tab Đơn. */
export interface EventOrderDetailRow extends EventOrderListRow {
  paidSource: PaidSource | null;
  cancelReason: OrderCancelReason | null;
  /** Hạn Giữ chỗ (lịch sử "Hết hạn" của Đơn `expired`). */
  expiresAt: Date;
  /** Lúc Đơn đổi gần nhất (lịch sử "Đã hủy"/"Đã hoàn tay" khi không có audit). */
  updatedAt: Date;
  /** Theo vị trí câu hỏi lúc đặt; nhãn lúc đặt, kể cả câu đã bị xóa. */
  answers: EventOrderAnswerRow[];
}

/**
 * Đơn mã `code` (đã chuẩn hóa) của Sự kiện `eventId` thuộc BTC `scope`, kèm dòng và câu trả lời form; không có, hoặc của
 * Sự kiện/BTC khác → `null`. Ba câu: Đơn, dòng, câu trả lời.
 */
export async function eventOrderDetailOf(
  db: DbExecutor,
  scope: EventOrdersScope,
  eventId: string,
  code: string,
): Promise<EventOrderDetailRow | null> {
  const [row] = await db
    .select({
      id: orders.id,
      code: orders.code,
      buyerName: orders.buyerName,
      buyerEmail: orders.buyerEmail,
      buyerPhone: orders.buyerPhone,
      totalAmount: orders.totalAmount,
      paidAmount: orders.paidAmount,
      status: orders.status,
      createdAt: createdAtMicros,
      paidAt: orders.paidAt,
      paidSource: orders.paidSource,
      cancelReason: orders.cancelReason,
      expiresAt: orders.expiresAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(and(orgScope(scope)(orders), eq(orders.eventId, eventId), eq(orders.code, code)));
  if (!row) return null;
  const [itemsOf, answers] = await Promise.all([
    itemsOfOrders(db, [row.id]),
    db
      .select({ label: orderAnswers.label, answer: orderAnswers.answer })
      .from(orderAnswers)
      .where(eq(orderAnswers.orderId, row.id))
      .orderBy(asc(orderAnswers.position), asc(orderAnswers.id)),
  ]);
  return { ...row, items: itemsOf.get(row.id) ?? [], answers };
}

/** Dòng của từng Đơn trong `orderIds` (một câu), theo id Hạng vé tăng dần. */
async function itemsOfOrders(db: DbExecutor, orderIds: string[]): Promise<Map<string, EventOrderItemRow[]>> {
  const rows = await db
    .select({ orderId: orderItems.orderId, ticketTypeName: orderItems.ticketTypeName, quantity: orderItems.quantity })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.orderId), asc(orderItems.ticketTypeId));
  const result = new Map<string, EventOrderItemRow[]>();
  for (const { orderId, ...item } of rows) {
    const list = result.get(orderId);
    if (list) list.push(item);
    else result.set(orderId, [item]);
  }
  return result;
}
