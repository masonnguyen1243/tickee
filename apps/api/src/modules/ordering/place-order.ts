import {
  answerSnapshot,
  ErrorCode,
  EVENT_UNAVAILABLE_REASONS,
  FREE_TICKET_LIMIT_MESSAGE,
  FunnelEventType,
  NotOnSaleReason,
  orderRequestFor,
  OrderStatus,
  ticketCount,
  TierSaleStatus,
  type EventAvailability,
  type NotOnSaleDetails,
  type TicketTypeSoldOutDetails,
} from '@tickee/contracts';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import type { Tx } from '../../platform/db/index.js';
import { AppError, parseRequest } from '../../platform/http/index.js';
import { buyerFormQuestions, lockSaleEventBySlug, type TicketTypeRow } from '../event/index.js';
import { holdInventory, sellInventory, type InventoryLine } from './inventory.service.js';
import type { OrderPayments } from './mark-paid.js';
import { ORDER_CODE_ATTEMPTS, type OrderCodeGenerator } from './order-code.js';
import { enqueueOrderExpiry } from './order-jobs.js';
import { checkoutFunnelEvents, orderAnswers, orderItems, orders } from './schema.js';
import { saleFactsOf, saleStatusOf } from './sellability.js';

/*
 * TX1 của tạo Đơn (Story 3.2, 3.3, AD-2, AD-4): `placeOrder` cùng các luật và lỗi chỉ TX1 dùng. Hàm thường (không phải
 * provider Nest) nhận `tx` của người gọi và phụ thuộc (`PlaceOrderDeps`) do `OrdersService` truyền vào; phần điều phối
 * request trước và sau TX1 (khóa chống trùng, Đơn chờ, giới hạn tốc độ, đọc lại sau lỗi unique, tín hiệu sau commit,
 * tạo link) ở `orders.service.ts`.
 *
 * TX1 (một transaction): khóa Sự kiện `FOR SHARE` → kiểm lại form, giới hạn Vé/Đơn và luật bán (`saleStatusOf`) trên dữ
 * liệu đã khóa → giữ chỗ (Đơn 0đ: bán) có điều kiện theo `ticket_type_id` tăng dần → Đơn `pending` + bản chụp (Đơn có
 * phí: kèm lượt tạo link) → `order_created` → enqueue job hết hạn bằng chính `tx` (Đơn 0đ: trần Vé miễn phí →
 * `markPaid`, không job). TX1 không gọi Tingee, không gửi email, không `NOTIFY`.
 */

/** Người mua của request, đọc từ `req.user` của session (không import `identity`). */
export interface Buyer {
  id: string;
  email: string;
  name: string | null;
}

/** Đơn vừa tạo trong TX1: id, BTC và Sự kiện (payload tín hiệu `event_orders_changed` sau commit). */
export type PlacedOrder = { id: string; organizationId: string; eventId: string };

/** Phụ thuộc của TX1, do `OrdersService` truyền vào (DI giữ ở service: test override `ORDER_HOLD`, mã Đơn qua đó). */
export interface PlaceOrderDeps {
  boss: PgBoss;
  orderCode: OrderCodeGenerator;
  holdSeconds: number;
  payments: OrderPayments;
}

const CODE_KEY = 'orders_code_key';

/** Tên unique index bị vi phạm (ở chính lỗi hoặc một tầng `cause` của Drizzle); không phải → `null`. */
export function uniqueViolation(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof pg.DatabaseError && current.code === '23505') return current.constraint ?? null;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const soldOut = (ticketTypeId: string, ticketTypeName: string) => {
  const details: TicketTypeSoldOutDetails = { ticketTypeId, ticketTypeName };
  return new AppError(ErrorCode.TICKET_TYPE_SOLD_OUT, `Hạng vé ${ticketTypeName} vừa hết. Bạn chọn lại nhé.`, {
    details,
  });
};

const freeTicketLimitReached = () => new AppError(ErrorCode.FREE_TICKET_LIMIT_REACHED, FREE_TICKET_LIMIT_MESSAGE);

const notOnSale = (details: NotOnSaleDetails) =>
  new AppError(ErrorCode.NOT_ON_SALE, 'Sự kiện hoặc Hạng vé này hiện không nhận Đơn.', { details });

/**
 * Luật bán tại TX1 cho các dòng của Đơn (đã xếp theo `ticket_type_id`): Sự kiện không nhận Đơn → `NOT_ON_SALE` (không có
 * `ticketTypeId`); Hạng vé không có trong Sự kiện, tạm ngừng, chưa mở hay đã đóng → `NOT_ON_SALE` của Hạng vé đó; hết
 * chỗ → `TICKET_TYPE_SOLD_OUT`. Đủ chỗ hay không do câu giữ chỗ có điều kiện quyết định sau đó.
 */
function assertOnSale(
  availability: EventAvailability,
  lines: readonly InventoryLine[],
  tiers: ReadonlyMap<string, TicketTypeRow>,
): void {
  const reason = availability.eventReason;
  if (reason !== null && EVENT_UNAVAILABLE_REASONS.includes(reason)) {
    throw notOnSale({ reason: reason as NotOnSaleDetails['reason'] });
  }
  const statusOf = new Map(availability.tiers.map((t) => [t.ticketTypeId, t.status]));
  let firstSoldOut: string | null = null;
  for (const { ticketTypeId } of lines) {
    const status = statusOf.get(ticketTypeId);
    if (status === TierSaleStatus.ON_SALE) continue;
    if (status === TierSaleStatus.SOLD_OUT) {
      firstSoldOut ??= ticketTypeId;
      continue;
    }
    if (status === TierSaleStatus.PAUSED || status === TierSaleStatus.NOT_STARTED || status === TierSaleStatus.CLOSED) {
      throw notOnSale({ ticketTypeId, reason: status });
    }
    throw notOnSale({ ticketTypeId, reason: NotOnSaleReason.CLOSED });
  }
  if (firstSoldOut !== null) throw soldOut(firstSoldOut, tiers.get(firstSoldOut)?.name ?? '');
}

/**
 * TX1. Trả id Đơn mới kèm BTC và Sự kiện (cho tín hiệu sau commit). Lỗi nghiệp vụ hoặc unique → ném, cả transaction
 * rollback (không giữ chỗ, không bán, không Vé). Đơn tổng > 0: giữ chỗ (`held += n`), Đơn `pending` hạn
 * `holdSeconds` kèm lượt tạo link (`payment_link_attempt_at`, cho lần gọi Tingee ngay sau commit), job hết hạn (a).
 * Đơn tổng 0đ: bán (`sold += n`), Đơn `pending` hạn = lúc tạo, kiểm trần Vé miễn phí của Người mua, rồi `markPaid`
 * nguồn `free` (Đơn `paid` + Vé); không job hết hạn.
 */
export async function placeOrder(
  tx: Tx,
  deps: PlaceOrderDeps,
  buyer: Buyer,
  slug: string,
  key: string,
  body: unknown,
): Promise<PlacedOrder> {
  const event = await lockSaleEventBySlug(tx, slug);
  const questions = await buyerFormQuestions(tx, event.id);
  const input = parseRequest(orderRequestFor(event, questions), body);
  const lines: InventoryLine[] = input.items
    .map((i) => ({ ticketTypeId: i.ticketTypeId.toLowerCase(), quantity: i.quantity }))
    .sort((a, b) => (a.ticketTypeId < b.ticketTypeId ? -1 : 1));

  const facts = await saleFactsOf(tx, event);
  const tiers = new Map(facts.tiers.map((t) => [t.id, t]));
  assertOnSale(saleStatusOf(facts, new Date()), lines, tiers);
  // Mọi dòng đã qua `assertOnSale` nên đều là Hạng vé của Sự kiện: giá đã chốt lúc khóa.
  const items = lines.map((line) => {
    const tier = tiers.get(line.ticketTypeId)!;
    return { ...line, name: tier.name, unitPrice: tier.price };
  });
  const totalAmount = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const free = totalAmount === 0;

  const short = free ? await sellInventory(tx, lines) : await holdInventory(tx, lines);
  if (short !== null) throw soldOut(short, tiers.get(short)?.name ?? '');

  const order = await insertOrder(
    tx,
    deps.orderCode,
    {
      userId: buyer.id,
      eventId: event.id,
      organizationId: event.organizationId,
      totalAmount,
      buyerName: input.buyer.name,
      buyerPhone: input.buyer.phone,
      buyerEmail: buyer.email,
      refundPolicy: event.refundPolicy,
      idempotencyKey: key,
      funnelId: input.funnelId?.toLowerCase() ?? null,
    },
    // Đơn 0đ không Giữ chỗ; cột NOT NULL nên hạn = lúc tạo.
    free ? sql`clock_timestamp()` : sql`clock_timestamp() + make_interval(secs => ${deps.holdSeconds})`,
    // Đơn có phí: lượt tạo link cho lần gọi đầu thuộc về chính request này.
    !free,
  );
  await tx.insert(orderItems).values(
    items.map((i) => ({
      orderId: order.id,
      ticketTypeId: i.ticketTypeId,
      ticketTypeName: i.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
  );
  const answers = answerSnapshot(questions, input.answers);
  if (answers.length > 0) {
    await tx.insert(orderAnswers).values(
      answers.map((a) => ({
        orderId: order.id,
        questionId: a.questionId,
        position: a.position,
        label: a.label,
        kind: a.kind,
        answer: a.answer,
        optionId: a.optionId,
      })),
    );
  }
  if (input.funnelId) {
    await tx
      .insert(checkoutFunnelEvents)
      .values({ eventId: event.id, type: FunnelEventType.ORDER_CREATED, funnelId: input.funnelId.toLowerCase() })
      .onConflictDoNothing({ target: [checkoutFunnelEvents.funnelId, checkoutFunnelEvents.type] });
  }
  const placed: PlacedOrder = { id: order.id, organizationId: event.organizationId, eventId: event.id };
  if (!free) {
    await enqueueOrderExpiry(deps.boss, tx, order.id, order.expiresAt);
    return placed;
  }

  await assertFreeTicketLimit(tx, buyer.id, event.id, ticketCount(lines), event.maxTicketsPerOrder);
  const result = await deps.payments.markPaid(tx, order.id, 'free', 0);
  // Đơn vừa chèn `pending` trong chính `tx` này: không bên nào khác chuyển được trước.
  if (result.outcome !== 'paid') throw new Error(`markPaid trả ${result.outcome} cho Đơn 0đ vừa tạo`);
  return placed;
}

/**
 * Trần Vé miễn phí của Người mua (Story 3.3): số Vé trong các Đơn `paid` tổng 0đ của Người mua ở Sự kiện (Vé có phí
 * không tính) + `requested` ≤ giới hạn Vé/Đơn, nếu không → `409 FREE_TICKET_LIMIT_REACHED`. Chạy sau khi chèn Đơn
 * `pending`: TX1 khác của cùng Người mua cho cùng Sự kiện chờ ở unique Đơn chờ tới khi TX1 này commit (lúc đó Đơn đã
 * `paid`), nên câu đếm của bên chạy sau (READ COMMITTED, ảnh chụp mới mỗi câu) luôn thấy Vé vừa phát của bên kia.
 */
async function assertFreeTicketLimit(
  tx: Tx,
  userId: string,
  eventId: string,
  requested: number,
  limit: number,
): Promise<void> {
  const [row] = await tx
    .select({ tickets: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.eventId, eventId),
        eq(orders.status, OrderStatus.PAID),
        eq(orders.totalAmount, 0),
      ),
    );
  if (Number(row?.tickets ?? 0) + requested > limit) throw freeTicketLimitReached();
}

/**
 * INSERT Đơn `pending` với `expires_at` = `expiresAt` (tính theo `clock_timestamp()`, giờ lúc INSERT, không phải giờ
 * bắt đầu transaction: TX1 chờ khóa lâu thì hạn Giữ chỗ không bị ngắn đi), `claimPaymentLink` → lượt tạo link đặt
 * cùng lúc (`payment_link_attempt_at = clock_timestamp()`), trong một savepoint: trùng mã
 * (`orders_code_key`) thì sinh mã khác, tối đa `ORDER_CODE_ATTEMPTS` lần, mà không hủy phần đã giữ chỗ của TX1. Lỗi
 * unique khác ném ra ngoài.
 */
async function insertOrder(
  tx: Tx,
  orderCode: OrderCodeGenerator,
  values: Omit<typeof orders.$inferInsert, 'code' | 'status' | 'expiresAt' | 'paymentLinkAttemptAt'>,
  expiresAt: SQL,
  claimPaymentLink: boolean,
): Promise<{ id: string; expiresAt: Date }> {
  for (let attempt = 1; ; attempt++) {
    const code = orderCode();
    try {
      return await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(orders)
          .values({
            ...values,
            code,
            status: OrderStatus.PENDING,
            expiresAt,
            paymentLinkAttemptAt: claimPaymentLink ? sql`clock_timestamp()` : null,
          })
          .returning({ id: orders.id, expiresAt: orders.expiresAt });
        if (!row) throw new Error('INSERT orders không trả về dòng nào');
        return row;
      });
    } catch (err) {
      if (attempt < ORDER_CODE_ATTEMPTS && uniqueViolation(err) === CODE_KEY) continue;
      throw err;
    }
  }
}
