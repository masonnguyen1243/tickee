import { Inject, Injectable } from '@nestjs/common';
import {
  EventStatus,
  EXPIRED_ORDER_VISIBLE_MINUTES,
  OrderStatus,
  toEventIso,
  type BuyerOrderOrganizer,
  type MyPendingOrder,
  type MyTicketDetail,
  type MyTicketEvent,
  type MyTicketHistoryItem,
  type MyTicketItem,
  type MyTicketsView,
} from '@tickee/contracts';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type DbExecutor } from '../../platform/db/index.js';
import { ticketEventsByIds, type TicketEventRef } from '../event/index.js';
import { organizerContactOf } from '../organizer/index.js';
import { TicketsService, type OwnTicket } from '../ticketing/index.js';
import { buyerStatusOf } from './buyer-status.js';
import { orderItems, orders } from './schema.js';

/*
 * "Vé của tôi" và Chi tiết Vé (Story 3.9, `buyerScope`, AD-13). Chỉ `ordering` đọc được cả Đơn, Vé (`ticketing`) lẫn liên
 * hệ BTC (`organizer`), nên ghép ở đây: `ticketing` trả Vé của người gọi kèm trạng thái và có ký Mã QR vé hay không,
 * `ordering` thêm Đơn đang chờ, biên nhận và liên hệ BTC. Mọi mốc (`effective_end_at`, hạn Đơn, `serverNow`) so bằng đồng
 * hồ DB lúc request (AD-14). Danh sách chạy trong một transaction REPEATABLE READ chỉ đọc: mọi truy vấn cùng một `now()`
 * và cùng một snapshot, nên Đơn vừa `paid` giữa hai truy vấn không biến mất khỏi cả hai nhóm (hoặc còn là Đơn chờ, hoặc
 * đã là Vé).
 */

/** Transaction của `list`: một snapshot (REPEATABLE READ) và một `now()` cho mọi truy vấn; chỉ đọc. */
const LIST_TRANSACTION = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/** Trạng thái Đơn của nhóm "Đơn đang chờ" (chưa `paid`), ngoài Đơn `expired` còn trong cửa sổ hiển thị. */
const OPEN_STATUSES = [OrderStatus.PENDING, OrderStatus.REVIEW, OrderStatus.CANCELLED, OrderStatus.REFUNDED];

const eventOf = (event: TicketEventRef): MyTicketEvent => ({
  name: event.name,
  startsAt: toEventIso(event.startsAt),
  venue: event.venue,
});

/** So hai chuỗi để xếp ổn định (mã Đơn, id). */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Vé theo giờ Sự kiện (`direction` 1 tăng dần, −1 giảm dần), rồi mã Đơn, rồi "Vé k/N". */
const byEventTime =
  (direction: 1 | -1) =>
  (a: OwnTicket, b: OwnTicket): number =>
    direction * (a.event.startsAt.getTime() - b.event.startsAt.getTime()) ||
    compareText(a.orderCode, b.orderCode) ||
    a.seq - b.seq;

@Injectable()
export class MyTicketsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TicketsService) private readonly tickets: TicketsService,
  ) {}

  /**
   * `GET /v1/me/tickets`: chỉ Đơn và Vé có `user_id` = `userId`.
   * - `active`: Vé có Sự kiện chưa quá `effective_end_at`, theo giờ Sự kiện tăng dần.
   * - `pending`: Đơn chưa `paid` (`pending`/`review`/`cancelled`/`refunded`) của Sự kiện chưa kết thúc, cộng Đơn `expired`
   *   trong `EXPIRED_ORDER_VISIBLE_MINUTES` phút sau `expires_at`; mới nhất trước. `buyerStatus` theo `buyerStatusOf`.
   * - `history`: Vé có Sự kiện đã quá `effective_end_at`, theo giờ Sự kiện giảm dần.
   */
  list(userId: string): Promise<MyTicketsView> {
    return this.db.orm.transaction(async (tx) => {
      const { rows } = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
      const now = new Date(rows[0]!.now);
      const owned = await this.tickets.ticketsOfUser(tx, userId);
      const pending = await this.pendingOrders(tx, userId, now);
      return {
        serverNow: now.toISOString(),
        active: owned
          .filter((t) => !t.event.ended)
          .sort(byEventTime(1))
          .map(
            (t): MyTicketItem => ({
              id: t.id,
              event: eventOf(t.event),
              ticketTypeName: t.ticketTypeName,
              seq: t.seq,
              count: t.count,
              orderCode: t.orderCode,
              status: t.status,
            }),
          ),
        pending,
        history: owned
          .filter((t) => t.event.ended)
          .sort(byEventTime(-1))
          .map(
            (t): MyTicketHistoryItem => ({
              id: t.id,
              eventName: t.event.name,
              eventStartsAt: toEventIso(t.event.startsAt),
              ticketTypeName: t.ticketTypeName,
              seq: t.seq,
              count: t.count,
              attended: t.attended,
            }),
          ),
      };
    }, LIST_TRANSACTION);
  }

  /**
   * `GET /v1/me/tickets/:ticketId`: Vé của chính `userId` (`ticketing` quyết QR/token chia sẻ) + liên hệ BTC + biên nhận
   * của Đơn (mã Đơn, các dòng, tổng đã trả, thời điểm thanh toán). Vé của người khác hay id sai dạng → `404
   * TICKET_NOT_FOUND` (từ `ticketing`).
   */
  async detail(userId: string, ticketId: string): Promise<MyTicketDetail> {
    const db = this.db.orm;
    const ticket = await this.tickets.ownTicket(db, userId, ticketId);
    const [[order], items] = await Promise.all([
      db
        .select({
          code: orders.code,
          organizationId: orders.organizationId,
          totalAmount: orders.totalAmount,
          paidAt: orders.paidAt,
        })
        .from(orders)
        .where(and(eq(orders.id, ticket.orderId), eq(orders.userId, userId))),
      db
        .select({ name: orderItems.ticketTypeName, unitPrice: orderItems.unitPrice, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, ticket.orderId))
        .orderBy(asc(orderItems.ticketTypeId)),
    ]);
    // Vé chỉ phát trong `markPaid` của chính Đơn đó, cùng `user_id`: không thể thiếu.
    if (!order) throw new Error('Không đọc được Đơn của Vé');
    const organizer = await organizerContactOf(db, { organizationId: order.organizationId });
    if (!organizer) throw new Error('Không đọc được BTC của Đơn');
    return {
      id: ticket.id,
      event: eventOf(ticket.event),
      ticketTypeName: ticket.ticketTypeName,
      seq: ticket.seq,
      count: ticket.count,
      holderName: ticket.holderName,
      status: ticket.status,
      attended: ticket.attended,
      eventCancelled: ticket.event.status === EventStatus.CANCELLED,
      ended: ticket.event.ended,
      qr: ticket.qr,
      shareToken: ticket.shareToken,
      organizer,
      receipt: {
        orderCode: order.code,
        items: items.map((i) => ({ ...i, amount: i.unitPrice * i.quantity })),
        totalAmount: order.totalAmount,
        paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      },
    };
  }

  /**
   * Id mọi Đơn của `userId` lúc mở stream `GET /v1/me/tickets/live` (`orders_user_id_created_at_idx`). Đơn tạo sau đó
   * không có trong tập: web mở lại stream khi tập mã Đơn trong danh sách đổi.
   */
  async liveOrderIds(userId: string): Promise<ReadonlySet<string>> {
    const rows = await this.db.orm.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
    return new Set(rows.map((row) => row.id));
  }

  /** Nhóm "Đơn đang chờ" lúc `now` (đồng hồ DB của transaction `db`). */
  private async pendingOrders(db: DbExecutor, userId: string, now: Date): Promise<MyPendingOrder[]> {
    const rows = await db
      .select({
        id: orders.id,
        code: orders.code,
        status: orders.status,
        eventId: orders.eventId,
        organizationId: orders.organizationId,
        totalAmount: orders.totalAmount,
        expiresAt: orders.expiresAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          or(
            inArray(orders.status, OPEN_STATUSES),
            and(
              eq(orders.status, OrderStatus.EXPIRED),
              gt(sql`${orders.expiresAt} + make_interval(mins => ${EXPIRED_ORDER_VISIBLE_MINUTES})`, sql`now()`),
            ),
          ),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id));
    const events = await ticketEventsByIds(db, rows.map((row) => row.eventId));
    const open = rows.filter((row) => {
      const event = events.get(row.eventId);
      return event !== undefined && !event.ended;
    });
    if (open.length === 0) return [];

    const lines = await db
      .select({ orderId: orderItems.orderId, name: orderItems.ticketTypeName, quantity: orderItems.quantity })
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          open.map((row) => row.id),
        ),
      )
      .orderBy(asc(orderItems.orderId), asc(orderItems.ticketTypeId));
    const linesOf = new Map<string, { name: string; quantity: number }[]>();
    for (const { orderId, ...line } of lines) linesOf.set(orderId, [...(linesOf.get(orderId) ?? []), line]);

    const organizers = new Map<string, BuyerOrderOrganizer>();
    for (const organizationId of new Set(open.map((row) => row.organizationId))) {
      const organizer = await organizerContactOf(db, { organizationId });
      if (!organizer) throw new Error('Không đọc được BTC của Đơn');
      organizers.set(organizationId, organizer);
    }

    return open.map((row) => {
      const event = events.get(row.eventId)!;
      return {
        code: row.code,
        buyerStatus: buyerStatusOf(
          { status: row.status, expiresAt: row.expiresAt, eventCancelled: event.status === EventStatus.CANCELLED },
          now,
        ),
        event: eventOf(event),
        items: linesOf.get(row.id) ?? [],
        totalAmount: row.totalAmount,
        expiresAt: row.expiresAt.toISOString(),
        organizer: organizers.get(row.organizationId)!,
      };
    });
  }
}
