import { RealtimeTopic, ScanInvalidReason } from '@tickee/contracts';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { realtime } from '../../platform/realtime/index.js';
import { assertCheckinOpen } from '../event/index.js';
import { TICKET_CANCEL_REASON, tickets } from './schema.js';

/*
 * Check-in đúng một lần (FR-28, AD-15, Story 5.3). Mọi check-in (quét, sau này tra tay) đi qua `checkIn`, trong `tx` của
 * bên gọi (READ COMMITTED): an toàn đồng thời dựa vào UPDATE có điều kiện, không dựa SERIALIZABLE. Hai lần quét song song
 * cùng một Vé: lần sau chờ khóa dòng của lần đầu, rồi đánh giá lại điều kiện `checked_in_at IS NULL` trên bản đã commit
 * nên không ghi gì. Kết quả chỉ đọc bản chụp trên Vé (AD-35), không bao giờ có Mã QR vé, SĐT hay email.
 */

/** Đầu vào check-in: Vé (id từ Mã QR vé đã kiểm chữ ký), Sự kiện và BTC của route, người quét, uuid của lần quét. */
export interface CheckInInput {
  ticketId: string;
  eventId: string;
  organizationId: string;
  userId: string;
  scanId: string;
}

/** Bản chụp trên Vé cho kết quả xanh: tên Người mua · Vé k/N · Hạng vé. */
export interface CheckedInTicket {
  holderName: string;
  seq: number;
  count: number;
  ticketTypeName: string;
}

/**
 * Kết quả check-in. `already` mang id tài khoản người quét trước (`null` khi Vé được đánh dấu check-in mà không ghi người
 * quét, vd. dữ liệu cũ): bên gọi tự đổi thành nhãn hiển thị, vì `ticketing` không đọc `identity` hay `organizer`.
 */
export type CheckInResult =
  | ({ outcome: 'ok' } & CheckedInTicket)
  | { outcome: 'recent' }
  | { outcome: 'already'; checkedInAt: Date; checkedInBy: string | null }
  | { outcome: 'invalid'; reason: ScanInvalidReason };

/** Cùng người quét lại Vé mình vừa check-in trong chừng này giây → kết quả trung tính `recent`, không đỏ. */
export const CHECKIN_RECENT_SECONDS = 60;

const snapshot = {
  holderName: tickets.holderName,
  seq: tickets.seq,
  count: tickets.orderTicketCount,
  ticketTypeName: tickets.ticketTypeName,
};

/**
 * Check-in Vé `ticketId` ở Sự kiện `eventId` trong `tx`:
 * 1. `event.assertCheckinOpen` (khóa Sự kiện `FOR SHARE`): Sự kiện đã hủy → `invalid CANCELLED`; đã kết thúc → `invalid
 *    EVENT_ENDED`; không ghi gì.
 * 2. UPDATE có điều kiện (`id`, `event_id`, `organization_id`, `status = 'valid'`, `checked_in_at IS NULL`) ghi
 *    `checked_in_at = now()`, người quét và `scanId`, `RETURNING` bản chụp. Được 1 dòng → `ok` và tín hiệu
 *    `event_checkins_changed` trong cùng `tx`.
 * 3. Được 0 dòng → đọc lại Vé theo id chỉ để phân loại (bản chụp chỉ trả khi Vé thuộc Sự kiện này): không có Vé →
 *    `BAD_SIGNATURE`; Vé của Sự kiện khác → `OTHER_EVENT`; Vé đã hủy → `VOIDED` (`TICKET_CANCEL_REASON.VOIDED`) hoặc
 *    `CANCELLED`; cùng `scanId` và cùng người quét → phát lại `ok`; cùng người quét, chưa tới 60 giây (đồng hồ DB) →
 *    `recent`; còn lại → `already` kèm lúc và người check-in.
 */
export async function checkIn(tx: Tx, input: CheckInInput): Promise<CheckInResult> {
  const { ticketId, eventId, organizationId, userId, scanId } = input;
  const closed = await assertCheckinOpen(tx, eventId);
  if (closed) return { outcome: 'invalid', reason: closed };

  const [updated] = await tx
    .update(tickets)
    .set({ checkedInAt: sql`now()`, checkedInBy: userId, checkinScanId: scanId })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.eventId, eventId),
        orgScope({ organizationId })(tickets),
        eq(tickets.status, 'valid'),
        isNull(tickets.checkedInAt),
      ),
    )
    .returning(snapshot);
  if (updated) {
    await realtime.notify(tx, RealtimeTopic.EVENT_CHECKINS_CHANGED, { id: eventId, organizationId, eventId });
    return { outcome: 'ok', ...updated };
  }

  // Đọc theo id trên mọi BTC: chỉ để biết Vé của Sự kiện khác; ngoài `eventId` không trả gì của Vé đó.
  const [row] = await tx
    .select({
      ...snapshot,
      eventId: tickets.eventId,
      status: tickets.status,
      cancelReason: tickets.cancelReason,
      checkedInAt: tickets.checkedInAt,
      checkedInBy: tickets.checkedInBy,
      checkinScanId: tickets.checkinScanId,
      recent: sql<boolean>`${tickets.checkedInAt} > now() - make_interval(secs => ${CHECKIN_RECENT_SECONDS})`,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  if (!row) return { outcome: 'invalid', reason: ScanInvalidReason.BAD_SIGNATURE };
  if (row.eventId !== eventId) return { outcome: 'invalid', reason: ScanInvalidReason.OTHER_EVENT };
  if (row.status === 'cancelled') {
    return {
      outcome: 'invalid',
      reason: row.cancelReason === TICKET_CANCEL_REASON.VOIDED ? ScanInvalidReason.VOIDED : ScanInvalidReason.CANCELLED,
    };
  }
  if (row.checkedInAt === null) {
    // Vé `valid` của Sự kiện này, chưa check-in, mà UPDATE không khớp: chỉ có thể khi BTC của Vé khác BTC của Sự kiện.
    throw new Error('checkIn: UPDATE không ghi được Vé hợp lệ chưa check-in của Sự kiện (lệch BTC)');
  }
  if (row.checkedInBy === userId) {
    if (row.checkinScanId === scanId) {
      return {
        outcome: 'ok',
        holderName: row.holderName,
        seq: row.seq,
        count: row.count,
        ticketTypeName: row.ticketTypeName,
      };
    }
    if (row.recent) return { outcome: 'recent' };
  }
  return { outcome: 'already', checkedInAt: row.checkedInAt, checkedInBy: row.checkedInBy };
}

/** Số Vé check-in của một Sự kiện: đã check-in trên tổng số Vé hợp lệ. */
export interface CheckinCounts {
  checkedInCount: number;
  validTicketCount: number;
}

/**
 * Số Vé `valid` của Sự kiện `eventId` (BTC `scope`) và số trong đó đã check-in, một câu (cùng snapshot). Vé đã hủy hay
 * bị vô hiệu không tính, kể cả khi đã check-in. Quét theo index `tickets_event_id_idx`.
 */
export async function checkinCountsOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  eventId: string,
): Promise<CheckinCounts> {
  const [row] = await db
    .select({
      checkedInCount: sql<number>`count(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL)`.mapWith(Number),
      validTicketCount: count(),
    })
    .from(tickets)
    .where(and(orgScope(scope)(tickets), eq(tickets.eventId, eventId), eq(tickets.status, 'valid')));
  return { checkedInCount: row?.checkedInCount ?? 0, validTicketCount: row?.validTicketCount ?? 0 };
}
