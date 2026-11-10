import { Inject, Injectable } from '@nestjs/common';
import type { BuyerTicket } from '@tickee/contracts';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { signTicketQr, TICKET_QR_KEYS, TicketQrKeys } from './qr.js';
import { tickets } from './schema.js';

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
 * Phát và đọc Vé (Story 3.3). Chỉ `ordering.markPaid` gọi `issueTickets`, trong `tx` của chính nó (AD-1): Đơn `paid`,
 * Vé, audit và phễu cùng commit hoặc cùng rollback. `ticketing` không import `ordering`.
 */
@Injectable()
export class TicketsService {
  constructor(@Inject(TICKET_QR_KEYS) private readonly keys: TicketQrKeys) {}

  /**
   * Phát N Vé cho Đơn trong `tx`: `seq` 1..N theo dòng có `ticket_type_id` tăng dần (trong một dòng liên tiếp),
   * `order_ticket_count` = N, `status = 'valid'`, ký bằng khóa QR hiện hành. Phát lần hai cho cùng Đơn → vi phạm
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
    const rows: (typeof tickets.$inferInsert)[] = [];
    let seq = 0;
    for (const line of lines) {
      for (let i = 0; i < line.quantity; i++) {
        seq += 1;
        rows.push({
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
          qrKeyVersion: this.keys.currentVersion,
        });
      }
    }
    const issued = await tx.insert(tickets).values(rows).returning({ id: tickets.id, seq: tickets.seq });
    return issued.sort((a, b) => a.seq - b.seq);
  }

  /** Vé của Đơn theo `seq`, kèm Mã QR vé tính lại từ `qr_key_version`. Chưa phát → `[]`. */
  async ticketsOfOrder(db: DbExecutor, orderId: string): Promise<BuyerTicket[]> {
    const rows = await db
      .select({
        id: tickets.id,
        seq: tickets.seq,
        count: tickets.orderTicketCount,
        ticketTypeName: tickets.ticketTypeName,
        holderName: tickets.holderName,
        qrKeyVersion: tickets.qrKeyVersion,
      })
      .from(tickets)
      .where(eq(tickets.orderId, orderId))
      .orderBy(asc(tickets.seq));
    return rows.map(({ qrKeyVersion, ...ticket }) => ({
      ...ticket,
      qr: signTicketQr(this.keys, ticket.id, qrKeyVersion),
    }));
  }
}
