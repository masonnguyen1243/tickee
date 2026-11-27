import type { EventOrderCursorValue, OrderCancelReason, OrderSearch, OrderStatus } from '@tickee/contracts';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { orgScope } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import type { EventOrdersScope } from './event-overview-read.js';
import { orderAnswers, orderItems, orders, type PaidSource } from './schema.js';

/*
 * Read model của tab Đơn (Story 6.1, FR-31, AD-33) và CSV (Story 6.3): `reporting` đọc qua các hàm này (xuất từ
 * `index.ts`), không join `orders`/`order_items`/`order_answers`. Mọi hàm lọc `organization_id` (`orgScope`) và `event_id`
 * (người gọi đã kiểm Sự kiện thuộc BTC), trừ hàm theo lô id Đơn (id đã lọc ở câu trước). Số câu truy vấn cố định: danh
 * sách hai câu (Đơn, rồi dòng của đúng các Đơn đó), chi tiết ba câu, cột form một câu, câu trả lời của một lô một câu.
 * Trả bản chụp Người mua (tên, email, SĐT) vì màn này là của Owner/Admin; `id` nội bộ chỉ để `reporting` ghép, không bao
 * giờ ra response hay file.
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

// ---------------------------------------------------------------------------------------------------------------
// CSV (Story 6.3): cột câu hỏi form và câu trả lời theo lô
// ---------------------------------------------------------------------------------------------------------------

/** Một cột câu hỏi form của CSV: id câu hỏi (khóa ghép câu trả lời) và nhãn hiện ở hàng tiêu đề. */
export interface EventAnswerColumn {
  questionId: string;
  label: string;
}

/**
 * Cột câu hỏi form của Sự kiện `eventId` (BTC `scope`) cho CSV, theo Quyết định của Story 6.3: mỗi `question_id` có trong
 * câu trả lời của mọi Đơn của Sự kiện (không theo bộ lọc, nên mọi lần xuất của một Sự kiện có cùng cột) là một cột. Nhãn
 * là nhãn lúc đặt của Đơn mới nhất (`created_at`, rồi mã Đơn, giảm dần) có câu đó, nên đổi nhãn vẫn một cột với nhãn mới
 * nhất; câu đã xóa vẫn có cột vì Đơn cũ còn câu trả lời. Thứ tự: `position` của lần đặt đó; cùng `position` (vd. câu đã
 * xóa và câu thay chỗ nó) thì câu của Đơn mới hơn trước, rồi theo id câu hỏi. Một câu (`DISTINCT ON`).
 */
export async function answerColumnsOf(
  db: DbExecutor,
  scope: EventOrdersScope,
  eventId: string,
): Promise<EventAnswerColumn[]> {
  const latest = db
    .selectDistinctOn([orderAnswers.questionId], {
      questionId: orderAnswers.questionId,
      label: orderAnswers.label,
      position: orderAnswers.position,
      createdAt: orders.createdAt,
      code: orders.code,
    })
    .from(orderAnswers)
    .innerJoin(orders, eq(orders.id, orderAnswers.orderId))
    .where(and(orgScope(scope)(orders), eq(orders.eventId, eventId)))
    .orderBy(asc(orderAnswers.questionId), desc(orders.createdAt), desc(orders.code))
    .as('latest');
  return db
    .select({ questionId: latest.questionId, label: latest.label })
    .from(latest)
    .orderBy(asc(latest.position), desc(latest.createdAt), desc(latest.code), asc(latest.questionId));
}

/**
 * Câu trả lời form (bản chụp lúc đặt) của từng Đơn trong `orderIds` (một câu): id Đơn → (id câu hỏi → câu trả lời). Đơn
 * không trả lời câu nào không có trong kết quả. `orderIds` rỗng → không truy vấn. Người gọi truyền id Đơn đã lọc theo
 * BTC và Sự kiện (vd. từ `eventOrdersPageOf`).
 */
export async function answersOfOrders(
  db: DbExecutor,
  orderIds: readonly string[],
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  if (orderIds.length === 0) return result;
  const rows = await db
    .select({ orderId: orderAnswers.orderId, questionId: orderAnswers.questionId, answer: orderAnswers.answer })
    .from(orderAnswers)
    .where(inArray(orderAnswers.orderId, [...orderIds]));
  for (const { orderId, questionId, answer } of rows) {
    const answers = result.get(orderId);
    if (answers) answers.set(questionId, answer);
    else result.set(orderId, new Map([[questionId, answer]]));
  }
  return result;
}
