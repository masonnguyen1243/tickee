import {
  BuyerOrderStatus,
  EventStatus,
  OrderStatus,
  toEventIso,
  type BuyerOrderPayment,
  type BuyerOrderView,
} from '@tickee/contracts';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../platform/db/index.js';
import { eventOpenForTickets, saleEventById } from '../event/index.js';
import { organizerContactOf, payoutRecipientOf } from '../organizer/index.js';
import type { TicketsService } from '../ticketing/index.js';
import { buyerStatusOf } from './buyer-status.js';
import { orderAnswers, orderItems, type orders } from './schema.js';

/*
 * Read model `BuyerOrderView` của Trang Đơn: hàm thường (không phải provider Nest) nhận `db` của người gọi (ngoài
 * transaction hay trong `tx`) và `TicketsService` để đọc Vé. Người gọi: `OrdersService` (tạo Đơn, tra Đơn, thử lại
 * link).
 */

type OrderRow = typeof orders.$inferSelect;

/**
 * Đơn + bản chụp + Sự kiện (tên, slug, giờ bắt đầu hiện tại, đã hủy chưa, đã kết thúc chưa theo đồng hồ DB) + BTC →
 * `BuyerOrderView`, kèm `serverNow`. `buyerStatus` theo bảng của `buyerStatusOf` tại `serverNow`; Vé (theo `seq`, kèm
 * Mã QR vé và token link chia sẻ) chỉ khi `buyerStatus = paid` và Sự kiện chưa kết thúc: Vé chỉ đọc sau khi đọc xong
 * Sự kiện (cùng đợt với các truy vấn khác), Sự kiện không còn dùng được cho Vé (`eventOpenForTickets`: đã hủy hay đã quá
 * `effective_end_at`, FR-24, AD-14) thì không đọc Vé, không ký gì. Đơn có phí kèm phần thanh toán (`paymentOf`);
 * `organizer` là tên và kênh liên hệ BTC hiện tại.
 */
export async function buyerOrderView(db: DbExecutor, tickets: TicketsService, row: OrderRow): Promise<BuyerOrderView> {
  const eventRead = saleEventById(db, row.eventId);
  const [items, answers, event, ownTickets, payment, organizer] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id))
      .orderBy(asc(orderItems.ticketTypeId)),
    db
      .select()
      .from(orderAnswers)
      .where(eq(orderAnswers.orderId, row.id))
      .orderBy(asc(orderAnswers.position)),
    eventRead,
    eventRead.then((saleEvent) => {
      // Sự kiện đã hủy hay đã kết thúc (đồng hồ DB): không đọc Vé, không ký Mã QR vé, không tính token chia sẻ.
      const withTickets = row.status === OrderStatus.PAID && eventOpenForTickets(saleEvent);
      return withTickets ? tickets.ticketsOfOrder(db, row.id) : [];
    }),
    paymentOf(row, db),
    organizerContactOf(db, { organizationId: row.organizationId }),
  ]);
  if (!organizer) throw new Error('Không đọc được BTC của Đơn');
  const now = new Date();
  const buyerStatus = buyerStatusOf(
    { status: row.status, expiresAt: row.expiresAt, eventCancelled: event.status === EventStatus.CANCELLED },
    now,
  );
  return {
    code: row.code,
    buyerStatus,
    event: { slug: event.slug, name: event.name, startsAt: toEventIso(event.startsAt), ended: event.ended },
    items: items.map((i) => ({
      ticketTypeId: i.ticketTypeId,
      name: i.ticketTypeName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      amount: i.unitPrice * i.quantity,
    })),
    totalAmount: row.totalAmount,
    buyer: { name: row.buyerName, phone: row.buyerPhone, email: row.buyerEmail },
    answers: answers.map((a) => ({ questionId: a.questionId, label: a.label, answer: a.answer })),
    refundPolicy: row.refundPolicy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    serverNow: now.toISOString(),
    payment,
    // Chỉ trả Vé khi `buyerStatus = paid`.
    tickets: buyerStatus === BuyerOrderStatus.PAID ? ownTickets : [],
    organizer,
  };
}

/**
 * Phần thanh toán của Đơn có phí (Đơn 0đ → `null`): checkout URL chỉ khi `pending` và đã có link; lý do lần tạo link
 * gần nhất thất bại; người nhận tiền theo tài khoản đã chụp (chưa chụp: tài khoản mặc định hiện tại).
 */
async function paymentOf(row: OrderRow, db: DbExecutor): Promise<BuyerOrderPayment | null> {
  if (row.totalAmount === 0) return null;
  const recipient = await payoutRecipientOf(db, {
    organizationId: row.organizationId,
    payoutAccountId: row.payoutAccountId,
  });
  if (!recipient) throw new Error('Không đọc được BTC của Đơn');
  return {
    checkoutUrl: row.status === OrderStatus.PENDING ? row.paymentLink : null,
    linkError: row.paymentLinkError,
    recipient,
  };
}
