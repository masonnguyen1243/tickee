import { RealtimeTopic, ScanInvalidReason } from '@tickee/contracts';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { realtime } from '../../platform/realtime/index.js';
import { assertCheckinOpen } from '../event/index.js';
import { TICKET_CANCEL_REASON, tickets, type TicketCheckinMethod } from './schema.js';
import { enqueueSheetRowChanged } from './sheet-row-changed-queue.js';

/*
 * Check-in đúng một lần (FR-28, AD-15, Story 5.3, 5.4). Mọi check-in (quét, sau này tra tay) đi qua `checkIn`, trong `tx`
 * của bên gọi (READ COMMITTED): an toàn đồng thời dựa vào UPDATE có điều kiện, không dựa SERIALIZABLE. Hai lần quét song
 * song cùng một Vé: lần sau chờ khóa dòng của lần đầu, rồi đánh giá lại điều kiện `checked_in_at IS NULL` trên bản đã
 * commit nên không ghi gì. Gửi lại cùng `scanId` (client hủy lần gửi sau 3 giây rồi gửi lại, lần đầu có thể vẫn đang chạy
 * ở server) cũng chờ khóa đó rồi rơi vào nhánh phát lại: ở đường thường là UPDATE chờ khóa dòng; khi Sự kiện vừa đóng
 * trong lúc lần đầu còn chạy, `replayOf` đọc Vé `FOR SHARE` nên cũng chờ lần đầu commit rồi mới so. Kết quả chỉ đọc bản
 * chụp trên Vé (AD-35), không bao giờ có Mã QR vé, SĐT hay email.
 */

/**
 * Đầu vào check-in: Vé (id từ Mã QR vé đã kiểm chữ ký), Sự kiện và BTC của route, người quét, uuid của lần quét, và cách
 * check-in (`scan` ở Màn quét, `manual` khi tra tay; ghi vào `checkin_method`, Story 6.5).
 */
export interface CheckInInput {
  ticketId: string;
  eventId: string;
  organizationId: string;
  userId: string;
  scanId: string;
  method: TicketCheckinMethod;
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
 *    EVENT_ENDED`; không ghi gì. Riêng lần gửi lại cùng `scanId` của chính người quét đã check-in Vé này thì phát lại
 *    `ok` của lần đầu (`replayOf`, chỉ đọc ở nhánh đóng này, khóa dòng Vé `FOR SHARE` để chờ lần đầu còn đang chạy).
 * 2. UPDATE có điều kiện (`id`, `event_id`, `organization_id`, `status = 'valid'`, `checked_in_at IS NULL`) ghi
 *    `checked_in_at = now()`, người quét, `scanId` và `checkin_method`, `RETURNING` bản chụp và id Đơn. Được 1 dòng → `ok`,
 *    tín hiệu `event_checkins_changed` và job `integration.sheet_row_changed` của Đơn (Story 6.5) trong cùng `tx`.
 * 3. Được 0 dòng → đọc lại Vé theo id chỉ để phân loại (bản chụp chỉ trả khi Vé thuộc Sự kiện này): không có Vé →
 *    `BAD_SIGNATURE`; Vé của Sự kiện khác → `OTHER_EVENT`; cùng `scanId` và cùng người quét → phát lại `ok` (kể cả khi
 *    Vé đã bị hủy sau lần đầu); Vé đã hủy → `VOIDED` (`TICKET_CANCEL_REASON.VOIDED`) hoặc `CANCELLED`; cùng người quét,
 *    chưa tới 60 giây (đồng hồ DB) → `recent`; còn lại → `already` kèm lúc và người check-in.
 *
 * Phát lại theo `scanId` thắng mọi lý do đóng xảy ra sau lần đầu (AD-15): client gửi lại cùng `scanId` tới khi có phản
 * hồi, nên lần đầu đã ghi mà mất phản hồi vẫn nhận lại đúng kết quả xanh. `scanId` mới, hay người khác dùng `scanId` đó,
 * vẫn nhận lý do đóng.
 *
 * Chỉ nhánh 2 (check-in thật) enqueue `sheet_row_changed`; phát lại, `recent`, `already`, `invalid` không đổi gì nên không
 * enqueue. Bên gọi đã `SheetRowChangedQueues.ready()` trước transaction.
 */
export async function checkIn(tx: Tx, boss: PgBoss, input: CheckInInput): Promise<CheckInResult> {
  const { ticketId, eventId, organizationId, userId, scanId, method } = input;
  const closed = await assertCheckinOpen(tx, eventId);
  if (closed) {
    const replay = await replayOf(tx, input);
    return replay ? { outcome: 'ok', ...replay } : { outcome: 'invalid', reason: closed };
  }

  const [updated] = await tx
    .update(tickets)
    .set({ checkedInAt: sql`now()`, checkedInBy: userId, checkinScanId: scanId, checkinMethod: method })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.eventId, eventId),
        orgScope({ organizationId })(tickets),
        eq(tickets.status, 'valid'),
        isNull(tickets.checkedInAt),
      ),
    )
    .returning({ ...snapshot, orderId: tickets.orderId });
  if (updated) {
    const { orderId, ...ticket } = updated;
    await realtime.notify(tx, RealtimeTopic.EVENT_CHECKINS_CHANGED, { id: eventId, organizationId, eventId });
    await enqueueSheetRowChanged(boss, tx, { eventId, orderId });
    return { outcome: 'ok', ...ticket };
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
  // Phát lại đứng trước nhánh Vé hủy: Vé bị hủy hay vô hiệu sau lần đầu không đổi kết quả của lần quét đó.
  if (row.checkedInAt !== null && row.checkedInBy === userId && row.checkinScanId === scanId) {
    return {
      outcome: 'ok',
      holderName: row.holderName,
      seq: row.seq,
      count: row.count,
      ticketTypeName: row.ticketTypeName,
    };
  }
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
  if (row.checkedInBy === userId && row.recent) return { outcome: 'recent' };
  return { outcome: 'already', checkedInAt: row.checkedInAt, checkedInBy: row.checkedInBy };
}

/**
 * Bản chụp của lần check-in `scanId` khi Sự kiện đã đóng (bước 1 của `checkIn`): Vé thuộc Sự kiện và BTC này, đã
 * check-in bởi chính `userId` với đúng `scanId` (Vé đã hủy sau đó vẫn tính). Không có → `null`.
 *
 * Chỉ lọc theo `id`, `event_id`, BTC rồi khóa `FOR SHARE`, so người quét và `scanId` trong JS: lần đầu còn giữ dòng Vé
 * (UPDATE chưa commit) thì câu này chờ nó commit rồi đọc bản mới. Lọc thêm `checked_in_by`/`checkin_scan_id` trong
 * WHERE thì dòng bị loại theo bản cũ mà không chờ, và lần gửi lại nhận lý do đóng dù lần đầu ngay sau đó commit.
 */
async function replayOf(tx: Tx, input: CheckInInput): Promise<CheckedInTicket | null> {
  const [row] = await tx
    .select({
      ...snapshot,
      checkedInAt: tickets.checkedInAt,
      checkedInBy: tickets.checkedInBy,
      checkinScanId: tickets.checkinScanId,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.id, input.ticketId),
        eq(tickets.eventId, input.eventId),
        orgScope({ organizationId: input.organizationId })(tickets),
      ),
    )
    .for('share');
  if (!row || row.checkedInAt === null || row.checkedInBy !== input.userId || row.checkinScanId !== input.scanId) {
    return null;
  }
  return { holderName: row.holderName, seq: row.seq, count: row.count, ticketTypeName: row.ticketTypeName };
}

/**
 * Số Vé check-in: đã check-in trên tổng số Vé hợp lệ, và trong số đã check-in, số Vé check-in tay (`checkin_method =
 * 'manual'`, Story 6.5; Vé check-in trước Story 6.5 không tính là tay).
 */
export interface CheckinCounts {
  checkedInCount: number;
  validTicketCount: number;
  manualCheckedInCount: number;
}

/** `count(*)` các Vé đã check-in tay trong nhóm (dùng chung cho các read model đếm check-in). */
export const manualCheckedInCount = () =>
  sql<number>`count(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL AND ${tickets.checkinMethod} = 'manual')`.mapWith(
    Number,
  );

/** Số Vé check-in của một Hạng vé. */
export interface TicketTypeCheckinCounts extends CheckinCounts {
  ticketTypeId: string;
}

/**
 * Số Vé `valid` của Sự kiện `eventId` (BTC `scope`) và số trong đó đã check-in, theo từng Hạng vé (Story 5.7), một câu
 * `GROUP BY ticket_type_id` (cùng snapshot, nên tổng các nhóm luôn là tổng của Sự kiện). Vé đã hủy hay bị vô hiệu không
 * tính, kể cả khi đã check-in. Hạng vé chưa có Vé `valid` nào không có nhóm (bên gọi tự điền `0/0`). Không sắp thứ tự.
 * Quét theo index `tickets_event_id_idx`.
 */
export async function checkinCountsByTicketType(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  eventId: string,
): Promise<TicketTypeCheckinCounts[]> {
  return db
    .select({
      ticketTypeId: tickets.ticketTypeId,
      checkedInCount: sql<number>`count(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL)`.mapWith(Number),
      validTicketCount: count(),
      manualCheckedInCount: manualCheckedInCount(),
    })
    .from(tickets)
    .where(and(orgScope(scope)(tickets), eq(tickets.eventId, eventId), eq(tickets.status, 'valid')))
    .groupBy(tickets.ticketTypeId);
}
