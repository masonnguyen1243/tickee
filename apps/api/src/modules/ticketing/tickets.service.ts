import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  SHARE_TOKEN_PATTERN,
  SharedTicketStatus,
  toEventIso,
  type BuyerTicket,
  type SharedTicketView,
  type TicketShareLink,
} from '@tickee/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { audit } from '../../platform/audit/index.js';
import type { Database, DbExecutor, Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { eventOpenForTickets, ticketEventById } from '../event/index.js';
import { ownTicket, ticketNotFound, ticketsOfUser, type OwnTicket, type OwnTicketDetail } from './my-tickets.js';
import { signTicketQr, TICKET_QR_KEYS, TicketQrKeys } from './qr.js';
import { tickets } from './schema.js';
import { hashShareToken, shareTokenOf } from './share-token.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Một câu cho mọi lý do link chia sẻ không mở được (không lộ lý do nào). */
const sharedTicketNotFound = () =>
  new AppError(ErrorCode.SHARED_TICKET_NOT_FOUND, 'Link không đúng hoặc không còn hiệu lực.');

/**
 * Marker `alert` của dòng log khi link chia sẻ hợp lệ nhưng khóa QR của Vé đã bị gỡ khỏi `TICKET_QR_KEYS` (xoay khóa sai,
 * AD-29). Cảnh báo vận hành (Story 4.6) bắt theo marker này.
 */
export const TICKET_QR_KEY_MISSING_ALERT = 'ticket_qr_key_missing';

/** Một dòng của Đơn cần phát Vé: Hạng vé, tên Hạng vé đã chụp lúc đặt, số Vé. */
export interface TicketIssueLine {
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
}

/** Đầu vào phát Vé của một Đơn vừa chuyển `paid`. `holderName`: tên Người mua của Đơn. */
export interface IssueTicketsInput {
  orderId: string;
  orderCode: string;
  eventId: string;
  organizationId: string;
  userId: string;
  holderName: string;
  issuedAt: Date;
  lines: readonly TicketIssueLine[];
}

/** Vé vừa phát. */
export interface IssuedTicket {
  id: string;
  seq: number;
}

/*
 * Phát và đọc Vé (Story 3.3), link chia sẻ Vé (Story 3.8, AD-29). Chỉ `ordering.markPaid` gọi `issueTickets`, trong `tx`
 * của chính nó (AD-1): Đơn `paid`, Vé (kèm hash link chia sẻ), audit và phễu cùng commit hoặc cùng rollback. `ticketing`
 * không import `ordering`.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger('TicketsService');

  constructor(@Inject(TICKET_QR_KEYS) private readonly keys: TicketQrKeys) {}

  /**
   * Phát N Vé cho Đơn trong `tx`: `seq` 1..N theo dòng có `ticket_type_id` tăng dần (trong một dòng liên tiếp),
   * `order_ticket_count` = N, `status = 'valid'`, ký bằng khóa QR hiện hành. Mỗi Vé có link chia sẻ phiên bản 1: id Vé
   * (`uuidv7()`) lấy trước để tính hash token, rồi một INSERT có đủ dòng. Phát lần hai cho cùng Đơn → vi phạm
   * `tickets_order_id_seq_key` (người gọi đã chặn bằng CAS trạng thái Đơn).
   */
  async issueTickets(tx: Tx, input: IssueTicketsInput): Promise<IssuedTicket[]> {
    const lines = [...input.lines].sort((a, b) =>
      a.ticketTypeId < b.ticketTypeId ? -1 : a.ticketTypeId > b.ticketTypeId ? 1 : 0,
    );
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    if (count < 1 || lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) {
      throw new Error('Phát Vé cần ít nhất một Vé và số Vé mỗi dòng là số nguyên dương');
    }
    const { rows: ids } = await tx.execute<{ id: string }>(
      sql`SELECT uuidv7()::text AS id FROM generate_series(1, ${count}::int)`,
    );
    const keyVersion = this.keys.currentVersion;
    const rows: (typeof tickets.$inferInsert)[] = [];
    let seq = 0;
    for (const line of lines) {
      for (let i = 0; i < line.quantity; i++) {
        const id = ids[seq]!.id;
        seq += 1;
        rows.push({
          id,
          orderId: input.orderId,
          eventId: input.eventId,
          organizationId: input.organizationId,
          userId: input.userId,
          ticketTypeId: line.ticketTypeId,
          seq,
          orderTicketCount: count,
          holderName: input.holderName,
          ticketTypeName: line.ticketTypeName,
          orderCode: input.orderCode,
          issuedAt: input.issuedAt,
          qrKeyVersion: keyVersion,
          shareVersion: 1,
          shareTokenHash: hashShareToken(shareTokenOf(this.keys, id, keyVersion, 1)),
        });
      }
    }
    const issued = await tx.insert(tickets).values(rows).returning({ id: tickets.id, seq: tickets.seq });
    return issued.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Vé của Đơn theo `seq`, kèm Mã QR vé và token link chia sẻ hiện hành, cả hai tính lại từ `qr_key_version` (và
   * `share_version`). Chưa phát → `[]`. Chỉ dùng cho chủ Đơn (`buyerScope`) và worker email Vé. Không lọc theo Sự kiện:
   * người gọi kiểm `eventOpenForTickets` (mô-đun `event`) trước khi gọi, để không ký gì cho Sự kiện đã hủy hay đã kết
   * thúc.
   */
  async ticketsOfOrder(db: DbExecutor, orderId: string): Promise<BuyerTicket[]> {
    const rows = await db
      .select({
        id: tickets.id,
        seq: tickets.seq,
        count: tickets.orderTicketCount,
        ticketTypeName: tickets.ticketTypeName,
        holderName: tickets.holderName,
        qrKeyVersion: tickets.qrKeyVersion,
        shareVersion: tickets.shareVersion,
      })
      .from(tickets)
      .where(eq(tickets.orderId, orderId))
      .orderBy(asc(tickets.seq));
    return rows.map(({ qrKeyVersion, shareVersion, ...ticket }) => ({
      ...ticket,
      qr: signTicketQr(this.keys, ticket.id, qrKeyVersion),
      shareToken: shareTokenOf(this.keys, ticket.id, qrKeyVersion, shareVersion),
    }));
  }

  /**
   * Mọi Vé của chính Người mua (`buyerScope`, Story 3.9 "Vé của tôi"): không ký Mã QR vé, không tính token chia sẻ; trạng
   * thái phía Người mua và `event.ended` theo đồng hồ DB (`my-tickets.ts`). Không theo thứ tự nào.
   */
  ticketsOfUser(db: DbExecutor, userId: string): Promise<OwnTicket[]> {
    return ticketsOfUser(db, userId);
  }

  /**
   * Một Vé của chính Người mua (`buyerScope`, Story 3.9 Chi tiết Vé): Mã QR vé và token chia sẻ chỉ khi Vé chưa hủy, Sự
   * kiện chưa hủy và chưa quá `effective_end_at`. Id sai dạng, không có, của người khác → `404 TICKET_NOT_FOUND`.
   */
  ownTicket(db: DbExecutor, userId: string, ticketId: string): Promise<OwnTicketDetail> {
    return ownTicket(db, this.keys, userId, ticketId);
  }

  /**
   * `GET /v1/shared-tickets/:token` (`shareScope`, AD-29): đúng một Vé theo hash của token. Chỉ đọc, không ghi gì (người
   * nhận link không thành chủ Vé). Token sai dạng hoặc không khớp, Vé `cancelled`, Sự kiện đã hủy, hay đồng hồ DB đã quá
   * `effective_end_at` (AD-14) → cùng một `404 SHARED_TICKET_NOT_FOUND`. Không trả tên, SĐT, email Người mua, mã Đơn hay
   * id user. Khóa `qr_key_version` của Vé không có trong `TICKET_QR_KEYS` của instance (khóa cũ đã gỡ, hoặc instance
   * chưa có khóa mới) → cũng `404` chung, kèm log `error` có marker `TICKET_QR_KEY_MISSING_ALERT` (id Vé, id Sự kiện,
   * phiên bản khóa của Vé và phiên bản hiện hành; không có token).
   */
  async sharedTicket(db: DbExecutor, token: string): Promise<SharedTicketView> {
    if (!SHARE_TOKEN_PATTERN.test(token)) throw sharedTicketNotFound();
    const [row] = await db
      .select({
        id: tickets.id,
        eventId: tickets.eventId,
        seq: tickets.seq,
        count: tickets.orderTicketCount,
        ticketTypeName: tickets.ticketTypeName,
        qrKeyVersion: tickets.qrKeyVersion,
        status: tickets.status,
        checkedInAt: tickets.checkedInAt,
      })
      .from(tickets)
      .where(eq(tickets.shareTokenHash, hashShareToken(token)));
    if (!row || row.status !== 'valid') throw sharedTicketNotFound();
    const event = await ticketEventById(db, row.eventId);
    if (!eventOpenForTickets(event)) throw sharedTicketNotFound();
    if (!this.keys.has(row.qrKeyVersion)) {
      // Kiểm sau các lý do 404 khác: chỉ cảnh báo khi link lẽ ra còn mở được. `currentVersion` phân biệt khóa cũ đã gỡ
      // (Vé có phiên bản nhỏ hơn) với instance chưa có khóa mới khi đang deploy dần (Vé có phiên bản lớn hơn).
      this.logger.error(
        {
          ticketId: row.id,
          eventId: row.eventId,
          qrKeyVersion: row.qrKeyVersion,
          currentVersion: this.keys.currentVersion,
          alert: TICKET_QR_KEY_MISSING_ALERT,
        },
        'Link chia sẻ Vé: TICKET_QR_KEYS của instance này không có khóa của Vé; trả 404',
      );
      throw sharedTicketNotFound();
    }
    return {
      eventName: event.name,
      eventStartsAt: toEventIso(event.startsAt),
      venue: event.venue,
      ticketTypeName: row.ticketTypeName,
      seq: row.seq,
      count: row.count,
      status: row.checkedInAt === null ? SharedTicketStatus.VALID : SharedTicketStatus.CHECKED_IN,
      qr: signTicketQr(this.keys, row.id, row.qrKeyVersion),
    };
  }

  /**
   * `POST /v1/me/tickets/:ticketId/share-link` (chủ Vé, `buyerScope`): "Tạo lại link". Một transaction: khóa Vé của
   * chính `userId` → kiểm Vé `valid`, Sự kiện chưa hủy, đồng hồ DB chưa quá `effective_end_at` → một `UPDATE` tăng
   * `share_version` và ghi hash của token mới (CAS theo phiên bản cũ) → audit `ticket.share_link_regenerated`. Link cũ
   * 404 ngay khi commit; Mã QR vé không đổi. Id sai dạng, Vé không có, của người khác, đã hủy hay quá hạn → `404
   * TICKET_NOT_FOUND`.
   */
  async regenerateShareLink(db: Database, userId: string, ticketId: string): Promise<TicketShareLink> {
    if (!UUID.test(ticketId)) throw ticketNotFound();
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: tickets.id,
          eventId: tickets.eventId,
          organizationId: tickets.organizationId,
          status: tickets.status,
          qrKeyVersion: tickets.qrKeyVersion,
          shareVersion: tickets.shareVersion,
        })
        .from(tickets)
        .where(and(eq(tickets.id, ticketId.toLowerCase()), eq(tickets.userId, userId)))
        .for('no key update');
      if (!row || row.status !== 'valid') throw ticketNotFound();
      if (!eventOpenForTickets(await ticketEventById(tx, row.eventId))) throw ticketNotFound();

      const shareVersion = row.shareVersion + 1;
      const shareToken = shareTokenOf(this.keys, row.id, row.qrKeyVersion, shareVersion);
      const [updated] = await tx
        .update(tickets)
        .set({ shareVersion, shareTokenHash: hashShareToken(shareToken) })
        .where(and(eq(tickets.id, row.id), eq(tickets.shareVersion, row.shareVersion)))
        .returning({ id: tickets.id });
      // Vé đã khóa nên CAS không thể thua; 0 dòng là lỗi lập trình → ném, cả `tx` rollback.
      if (!updated) throw new Error('Tạo lại link chia sẻ: CAS share_version thua dù đã khóa Vé');
      await audit.record(tx, {
        actorUserId: userId,
        organizationId: row.organizationId,
        action: 'ticket.share_link_regenerated',
        target: { type: 'ticket', id: row.id },
      });
      return { shareToken };
    });
  }
}
