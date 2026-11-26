import { and, asc, eq } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { tickets, type TicketCancelReason, type TicketStatus } from './schema.js';

/*
 * Read model Vé của một Đơn cho tab Đơn của BTC (Story 6.1, FR-31, AD-35): `reporting` đọc qua hàm này (xuất từ
 * `index.ts`), không join bảng `tickets`. Chỉ bản chụp trên Vé lúc phát (Vé k/N, Hạng vé, tên Người mua), trạng thái và
 * lúc check-in; không bao giờ Mã QR vé, token chia sẻ, người quét hay id lần quét.
 */

/** Một Vé của Đơn. */
export interface OrderTicketRow {
  seq: number;
  orderTicketCount: number;
  ticketTypeName: string;
  holderName: string;
  status: TicketStatus;
  cancelReason: TicketCancelReason | null;
  checkedInAt: Date | null;
}

/**
 * Mọi Vé (mọi trạng thái) của Đơn `orderId` thuộc Sự kiện `eventId` của BTC `scope`, theo `seq` (index
 * `tickets_order_id_seq_key`). Đơn chưa phát Vé → `[]`. Một câu.
 */
export async function orderTicketsOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  eventId: string,
  orderId: string,
): Promise<OrderTicketRow[]> {
  const rows = await db
    .select({
      seq: tickets.seq,
      orderTicketCount: tickets.orderTicketCount,
      ticketTypeName: tickets.ticketTypeName,
      holderName: tickets.holderName,
      status: tickets.status,
      cancelReason: tickets.cancelReason,
      checkedInAt: tickets.checkedInAt,
    })
    .from(tickets)
    .where(and(orgScope(scope)(tickets), eq(tickets.eventId, eventId), eq(tickets.orderId, orderId)))
    .orderBy(asc(tickets.seq));
  // `cancel_reason` là text không CHECK: nơi ghi chỉ dùng `TICKET_CANCEL_REASON`.
  return rows.map((row) => ({ ...row, cancelReason: row.cancelReason as TicketCancelReason | null }));
}
