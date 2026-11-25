import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { tickets } from './schema.js';

/*
 * Read model của tra tay (Story 5.5, FR-29, AD-35): `flows` lấy id Đơn khớp SĐT/email từ `ordering`, rồi đọc Vé ở đây.
 * Chỉ đọc bản chụp trên Vé (tên Người mua, Hạng vé, Vé k/N) và trạng thái check-in; không bao giờ có Mã QR vé.
 */

/** Một Vé tra được: `id` để check-in tay, bản chụp lúc phát và đã check-in hay chưa. */
export interface LookupTicketRow {
  id: string;
  holderName: string;
  ticketTypeName: string;
  seq: number;
  count: number;
  checkedIn: boolean;
}

/**
 * Vé `valid` của Sự kiện `eventId` (BTC `scope`) thuộc các Đơn `orderIds`, sắp theo mã Đơn rồi `seq`. Vé đã hủy hay bị
 * vô hiệu không có. `orderIds` rỗng → `[]` (không truy vấn). Quét theo `tickets_order_id_seq_key`.
 */
export async function validTicketsOfOrders(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  eventId: string,
  orderIds: readonly string[],
): Promise<LookupTicketRow[]> {
  if (orderIds.length === 0) return [];
  return db
    .select({
      id: tickets.id,
      holderName: tickets.holderName,
      ticketTypeName: tickets.ticketTypeName,
      seq: tickets.seq,
      count: tickets.orderTicketCount,
      checkedIn: sql<boolean>`${tickets.checkedInAt} IS NOT NULL`,
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
    .orderBy(asc(tickets.orderCode), asc(tickets.seq));
}
