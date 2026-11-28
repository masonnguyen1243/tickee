import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { manualCheckedInCount, type CheckinCounts } from './check-in.js';
import { tickets } from './schema.js';

/*
 * Read model cột "Check-in" của CSV danh sách Đơn (Story 6.3, AD-35) và các cột check-in của Google Sheets (Story 6.4,
 * 6.5): `reporting` và `integration` đọc qua hàm này (xuất từ `index.ts`), không join bảng `tickets`. Chỉ đếm, không trả
 * Vé nào (không id, không Mã QR vé, không token chia sẻ).
 */

/**
 * Số Vé `valid`, số trong đó đã check-in và số đã check-in tay của từng Đơn trong `orderIds` thuộc Sự kiện `eventId` của
 * BTC `scope`, một câu `GROUP BY order_id` (cùng luật với `checkinCountsByTicketType`: Vé đã hủy hay bị vô hiệu không
 * tính, kể cả khi đã check-in). Đơn không có Vé `valid` nào không có trong Map. `orderIds` rỗng → không truy vấn. Quét
 * theo `tickets_order_id_seq_key`.
 */
export async function checkinCountsOfOrders(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  eventId: string,
  orderIds: readonly string[],
): Promise<Map<string, CheckinCounts>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      orderId: tickets.orderId,
      checkedInCount: sql<number>`count(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL)`.mapWith(Number),
      validTicketCount: count(),
      manualCheckedInCount: manualCheckedInCount(),
    })
    .from(tickets)
    .where(
      and(
        orgScope(scope)(tickets),
        eq(tickets.eventId, eventId),
        inArray(tickets.orderId, [...orderIds]),
        eq(tickets.status, 'valid'),
      ),
    )
    .groupBy(tickets.orderId);
  return new Map(rows.map(({ orderId, ...counts }) => [orderId, counts]));
}
