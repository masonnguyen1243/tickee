import { ErrorCode, EventStatus, MyTicketStatus } from '@tickee/contracts';
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { eventOpenForTickets, ticketEventById, ticketEventsByIds, type TicketEventRef } from '../event/index.js';
import { signTicketQr, type TicketQrKeys } from './qr.js';
import { tickets, type TicketStatus } from './schema.js';
import { shareTokenOf } from './share-token.js';

/*
 * Read model Vé theo `user_id` cho "Vé của tôi" và Chi tiết Vé (Story 3.9, `buyerScope`, AD-13). `ticketing` tự quyết
 * trạng thái Vé phía Người mua và có ký Mã QR vé hay không (đọc Sự kiện qua `event`, `ended` theo đồng hồ DB, AD-14);
 * `ordering` ghép thêm Đơn đang chờ, biên nhận và liên hệ BTC. Chỉ đọc, không ghi gì. Không import `ordering`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Một câu cho mọi lý do không trả Vé của chính Người mua (không lộ Vé nào có thật). */
export const ticketNotFound = () => new AppError(ErrorCode.TICKET_NOT_FOUND, 'Không tìm thấy Vé này.');

/** Một Vé của chính Người mua, kèm Sự kiện của Vé (tên, giờ, địa điểm hiện tại, trạng thái, `ended` theo đồng hồ DB). */
export interface OwnTicket {
  id: string;
  orderId: string;
  orderCode: string;
  ticketTypeName: string;
  seq: number;
  count: number;
  holderName: string;
  /** `cancelled` khi chính Vé đã hủy hoặc Sự kiện đã hủy; còn lại `checked_in` nếu đã check-in, không thì `valid`. */
  status: MyTicketStatus;
  /** Đã check-in (kể cả Vé bị hủy sau đó): "Đã tham dự" / "Chưa check-in" của hàng lịch sử. */
  attended: boolean;
  event: TicketEventRef;
}

/**
 * Một Vé của chính Người mua cho Chi tiết Vé: Mã QR vé và token link chia sẻ hiện hành chỉ khi Vé chưa hủy, Sự kiện chưa
 * hủy và đồng hồ DB chưa quá `effective_end_at`; còn lại cả hai `null` (không ký).
 */
export interface OwnTicketDetail extends OwnTicket {
  qr: string | null;
  shareToken: string | null;
}

const ownColumns = {
  id: tickets.id,
  orderId: tickets.orderId,
  orderCode: tickets.orderCode,
  eventId: tickets.eventId,
  ticketTypeName: tickets.ticketTypeName,
  seq: tickets.seq,
  count: tickets.orderTicketCount,
  holderName: tickets.holderName,
  status: tickets.status,
  checkedInAt: tickets.checkedInAt,
  qrKeyVersion: tickets.qrKeyVersion,
  shareVersion: tickets.shareVersion,
};

interface OwnRow {
  id: string;
  orderId: string;
  orderCode: string;
  ticketTypeName: string;
  seq: number;
  count: number;
  holderName: string;
  status: TicketStatus;
  checkedInAt: Date | null;
}

function ownTicketOf(row: OwnRow, event: TicketEventRef): OwnTicket {
  const cancelled = row.status === 'cancelled' || event.status === EventStatus.CANCELLED;
  const checkedIn = row.checkedInAt !== null;
  return {
    id: row.id,
    orderId: row.orderId,
    orderCode: row.orderCode,
    ticketTypeName: row.ticketTypeName,
    seq: row.seq,
    count: row.count,
    holderName: row.holderName,
    status: cancelled ? MyTicketStatus.CANCELLED : checkedIn ? MyTicketStatus.CHECKED_IN : MyTicketStatus.VALID,
    attended: checkedIn,
    event,
  };
}

/**
 * Mọi Vé của `userId` (không ký Mã QR vé, không tính token chia sẻ), không theo thứ tự nào: `ordering` chia nhóm theo
 * `event.ended` và xếp. Hai truy vấn: Vé theo `tickets_user_id_event_id_idx`, rồi Sự kiện theo danh sách id. Chạy trong
 * `tx` của người gọi thì `ended` cùng một `now()` với các truy vấn khác của request.
 */
export async function ticketsOfUser(db: DbExecutor, userId: string): Promise<OwnTicket[]> {
  const rows = await db.select(ownColumns).from(tickets).where(eq(tickets.userId, userId));
  const events = await ticketEventsByIds(db, rows.map((row) => row.eventId));
  return rows.flatMap((row) => {
    const event = events.get(row.eventId);
    return event ? [ownTicketOf(row, event)] : [];
  });
}

/**
 * Một Vé của chính `userId` (Chi tiết Vé). Id sai dạng, không có hoặc Vé của người khác → `404 TICKET_NOT_FOUND`. Vé đã
 * hủy, Sự kiện đã hủy hay đã quá `effective_end_at` vẫn trả về, chỉ không có `qr`/`shareToken`.
 */
export async function ownTicket(
  db: DbExecutor,
  keys: TicketQrKeys,
  userId: string,
  ticketId: string,
): Promise<OwnTicketDetail> {
  if (!UUID.test(ticketId)) throw ticketNotFound();
  const [row] = await db
    .select(ownColumns)
    .from(tickets)
    .where(and(eq(tickets.id, ticketId.toLowerCase()), eq(tickets.userId, userId)));
  if (!row) throw ticketNotFound();
  const event = await ticketEventById(db, row.eventId);
  // FK `tickets.event_id → events.id`: không thể thiếu.
  if (!event) throw new Error('Không đọc được Sự kiện của Vé');
  const own = ownTicketOf(row, event);
  // Vé chưa hủy và Sự kiện còn dùng được cho Vé (chưa hủy, chưa quá `effective_end_at`).
  const open = row.status !== 'cancelled' && eventOpenForTickets(event);
  return {
    ...own,
    qr: open ? signTicketQr(keys, row.id, row.qrKeyVersion) : null,
    shareToken: open ? shareTokenOf(keys, row.id, row.qrKeyVersion, row.shareVersion) : null,
  };
}
