import { Inject, Injectable } from '@nestjs/common';
import {
  answerSnapshot,
  BuyerOrderStatus,
  CreateOrderRequest,
  ErrorCode,
  EVENT_UNAVAILABLE_REASONS,
  EventStatus,
  FREE_TICKET_LIMIT_MESSAGE,
  FunnelEventType,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  NotOnSaleReason,
  ORDER_CODE_PATTERN,
  orderRequestFor,
  OrderStatus,
  PAYMENT_LINK_GRACE_SECONDS,
  ticketCount,
  TierSaleStatus,
  toEventIso,
  type BuyerOrderPayment,
  type BuyerOrderView,
  type CheckoutForm,
  type EventAvailability,
  type NotOnSaleDetails,
  type PendingOrderExistsDetails,
  type TicketTypeSoldOutDetails,
} from '@tickee/contracts';
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { AppError, parseRequest } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import {
  buyerFormQuestions,
  lockSaleEventBySlug,
  publicEventBySlug,
  saleEventById,
  type TicketTypeRow,
} from '../event/index.js';
import { organizerContactOf, payoutRecipientOf } from '../organizer/index.js';
import { TicketsService } from '../ticketing/index.js';
import { buyerStatusOf } from './buyer-status.js';
import { holdInventory, sellInventory, type InventoryLine } from './inventory.service.js';
import { OrderPayments } from './mark-paid.js';
import { ORDER_CODE_ATTEMPTS, ORDER_CODE_GENERATOR, type OrderCodeGenerator } from './order-code.js';
import { enqueueOrderExpiry, expireOrder, OrderQueues } from './order-jobs.js';
import { OrderRateLimiter } from './order-rate-limit.js';
import { PaymentLinks } from './payment-link.js';
import { checkoutFunnelEvents, orderAnswers, orderItems, orders } from './schema.js';
import { saleFactsOf, saleStatusOf } from './sellability.js';

/*
 * Checkout và tạo Đơn (Story 3.2, AD-2, AD-4, AD-31). Đơn tổng > 0: giữ chỗ rồi `pending` với hạn
 * `ORDER_HOLD_SECONDS`, TX1 đặt sẵn lượt tạo link; sau khi TX1 commit, hàm bảo đảm link (`PaymentLinks`, Story 3.4) gọi
 * Tingee ngoài transaction rồi TX2 gắn link. Đơn tổng 0đ (Story 3.3): bán ngay trong TX1 rồi `markPaid` nguồn `free`,
 * nên request trả Đơn `paid` kèm Vé.
 *
 * Tạo Đơn: kiểm khóa chống trùng và payload → tra Đơn theo `(user_id, Idempotency-Key)` (có → 200 Đơn cũ) → hết hạn Đơn
 * chờ cũ đã quá hạn (transaction riêng, cùng hàm với job) → Đơn chờ khác còn hạn → 409 (cùng khóa → 200) → queue sẵn
 * sàng → giới hạn tốc độ → TX1. TX1 (một
 * transaction): khóa Sự kiện `FOR SHARE` → kiểm lại form, giới hạn Vé/Đơn và luật bán (`saleStatusOf`) trên dữ liệu đã
 * khóa → giữ chỗ (Đơn 0đ: bán) có điều kiện theo `ticket_type_id` tăng dần → Đơn `pending` + bản chụp (Đơn có phí: kèm
 * lượt tạo link) → `order_created` → enqueue job hết hạn bằng chính `tx` (Đơn 0đ: trần Vé miễn phí → `markPaid`, không
 * job). TX1 không gọi Tingee, không gửi email, không `NOTIFY`. Lỗi unique sau rollback (hai request cùng khóa, hay hai
 * Đơn chờ đua nhau) → đọc lại: trả Đơn của bên thắng hoặc 409. Mọi lần trả Đơn đã có (cùng khóa) cũng đi qua hàm bảo
 * đảm link: Đơn chưa có link mà còn lượt thì thử tạo link.
 */

/** Token DI của thời gian Giữ chỗ (giây) của Đơn mới; mặc định `ORDER_HOLD_SECONDS`, test tiêm số nhỏ. */
export const ORDER_HOLD = Symbol('ORDER_HOLD');

/** Người mua của request, đọc từ `req.user` của session (không import `identity`). */
export interface Buyer {
  id: string;
  email: string;
  name: string | null;
}

type OrderRow = typeof orders.$inferSelect;

const CODE_KEY = 'orders_code_key';
const IDEMPOTENCY_KEY = 'orders_user_id_idempotency_key_key';
const ONE_PENDING_KEY = 'orders_one_pending_per_buyer_event_key';

/** Tên unique index bị vi phạm (ở chính lỗi hoặc một tầng `cause` của Drizzle); không phải → `null`. */
function uniqueViolation(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof pg.DatabaseError && current.code === '23505') return current.constraint ?? null;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const orderNotFound = () => new AppError(ErrorCode.ORDER_NOT_FOUND, 'Không tìm thấy Đơn này.');

const pendingExists = (code: string) => {
  const details: PendingOrderExistsDetails = { code };
  return new AppError(ErrorCode.PENDING_ORDER_EXISTS, 'Bạn đang có một Đơn chờ thanh toán cho Sự kiện này.', {
    details,
  });
};

const soldOut = (ticketTypeId: string, ticketTypeName: string) => {
  const details: TicketTypeSoldOutDetails = { ticketTypeId, ticketTypeName };
  return new AppError(ErrorCode.TICKET_TYPE_SOLD_OUT, `Hạng vé ${ticketTypeName} vừa hết. Bạn chọn lại nhé.`, {
    details,
  });
};

const freeTicketLimitReached = () => new AppError(ErrorCode.FREE_TICKET_LIMIT_REACHED, FREE_TICKET_LIMIT_MESSAGE);

const notOnSale = (details: NotOnSaleDetails) =>
  new AppError(ErrorCode.NOT_ON_SALE, 'Sự kiện hoặc Hạng vé này hiện không nhận Đơn.', { details });

/** `Idempotency-Key` thiếu hoặc không phải uuid → `400 VALIDATION_FAILED` (cùng dạng với `parseRequest`). */
function idempotencyKeyOf(raw: unknown): string {
  const parsed = IdempotencyKey.safeParse(raw);
  if (parsed.success) return parsed.data.toLowerCase();
  const issue = { path: `headers.${IDEMPOTENCY_KEY_HEADER}`, code: raw === undefined ? 'invalid_type' : 'invalid_format' };
  throw new AppError(ErrorCode.VALIDATION_FAILED, 'Yêu cầu không hợp lệ.', { details: { issues: [issue] } });
}

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

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(OrderQueues) private readonly queues: OrderQueues,
    @Inject(OrderRateLimiter) private readonly limiter: OrderRateLimiter,
    @Inject(ORDER_CODE_GENERATOR) private readonly orderCode: OrderCodeGenerator,
    @Inject(ORDER_HOLD) private readonly holdSeconds: number,
    @Inject(OrderPayments) private readonly payments: OrderPayments,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(PaymentLinks) private readonly links: PaymentLinks,
  ) {}

  /**
   * `GET /v1/events/:slug/checkout`: câu hỏi riêng theo thứ tự và phần tự điền. Tên và SĐT lấy từ Đơn gần nhất của chính
   * Người mua; chưa có Đơn nào thì tên của tài khoản (nếu có), SĐT `null`. Email luôn là email tài khoản. Slug lạ hoặc
   * Sự kiện nháp → `404 EVENT_NOT_FOUND`.
   */
  async checkoutForm(buyer: Buyer, slug: string): Promise<CheckoutForm> {
    const event = await publicEventBySlug(this.db.orm, slug);
    const [questions, [last]] = await Promise.all([
      buyerFormQuestions(this.db.orm, event.id),
      this.db.orm
        .select({ name: orders.buyerName, phone: orders.buyerPhone })
        .from(orders)
        .where(eq(orders.userId, buyer.id))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(1),
    ]);
    return {
      questions,
      buyer: { name: last?.name ?? buyer.name ?? '', phone: last?.phone ?? null, email: buyer.email },
    };
  }

  /**
   * `POST /v1/events/:slug/orders`. `created`: Đơn mới (201); `false`: Đơn đã có theo khóa chống trùng (200, trạng thái
   * hiện tại, không giữ thêm chỗ; chưa có link mà còn lượt thì thử tạo link). Đơn có phí mới: tạo link ngay sau TX1
   * (timeout 5 giây), nên Đơn trả về có thể đã `expired` (Tingee báo tạm ngừng hoặc kết quả mơ hồ).
   */
  async create(
    buyer: Buyer,
    ip: string,
    slug: string,
    rawKey: unknown,
    body: unknown,
  ): Promise<{ order: BuyerOrderView; created: boolean }> {
    const key = idempotencyKeyOf(rawKey);
    parseRequest(CreateOrderRequest, body);
    const existing = await this.byKey(buyer.id, key);
    if (existing) return { order: await this.withPaymentLink(existing, buyer, ip), created: false };

    // Kiểm trước, ngoài transaction (lỗi ở đây không tính vào giới hạn tốc độ); TX1 kiểm lại trên dữ liệu đã khóa.
    const event = await publicEventBySlug(this.db.orm, slug);
    parseRequest(orderRequestFor(event, await buyerFormQuestions(this.db.orm, event.id)), body);
    await this.expireStalePending(buyer.id, event.id);
    const pending = await this.pendingOf(buyer.id, event.id);
    if (pending) {
      // Request cùng khóa vừa commit Đơn sau lần tra theo khóa ở trên: đó là Đơn của chính request này.
      if (pending.idempotencyKey === key) return { order: await this.withPaymentLink(pending, buyer, ip), created: false };
      throw pendingExists(pending.code);
    }
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` trong TX1 cần cả hai. Trước giới hạn tốc độ:
    // pg-boss lỗi thì không tới TX1, không tính lần thử.
    await this.queues.ready();
    await this.limiter.consume(buyer.id, ip);

    let orderId: string;
    try {
      orderId = await this.db.transaction((tx) => this.placeOrder(tx, buyer, slug, key, body));
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === IDEMPOTENCY_KEY || constraint === ONE_PENDING_KEY) {
        // Bên thua của hai request cùng khóa: cả phần giữ chỗ đã rollback; trả Đơn của bên thắng.
        const winner = await this.byKey(buyer.id, key);
        if (winner) return { order: await this.withPaymentLink(winner, buyer, ip), created: false };
        const other = await this.pendingOf(buyer.id, event.id);
        if (other) throw pendingExists(other.code);
      }
      throw err;
    }
    const row = await this.reload(orderId);
    // TX1 đã đặt sẵn lượt tạo link cho Đơn có phí: chính request này gọi Tingee (sau commit, ngoài transaction).
    if (row.status === OrderStatus.PENDING && row.paymentLinkAttemptAt !== null && row.paymentLink === null) {
      await this.links.ensure(row, { claimed: true });
      return { order: await this.view(await this.reload(orderId)), created: true };
    }
    return { order: await this.view(row), created: true };
  }

  /** `GET /v1/me/orders/:code`: Đơn của chính Người mua. Mã sai dạng, không có hoặc của người khác → `404 ORDER_NOT_FOUND`. */
  async mine(buyer: Buyer, code: string): Promise<BuyerOrderView> {
    return this.view(await this.ownOrder(buyer, code));
  }

  /**
   * Id Đơn cho stream `GET /v1/me/orders/:code/live` (Story 3.7): cùng phép sở hữu với `mine` (mã sai dạng, không có
   * hoặc của người khác → `404 ORDER_NOT_FOUND`, không mở stream).
   */
  async liveOrderId(buyer: Buyer, code: string): Promise<string> {
    return (await this.ownOrder(buyer, code)).id;
  }

  /**
   * `POST /v1/me/orders/:code/payment-link` (Story 3.4): thử tạo lại link cho cùng Đơn sau khi Tingee từ chối rõ ràng.
   * Đơn đủ điều kiện (`pending`, chưa có link, còn lượt, còn hạn) → hàm bảo đảm link (tính vào giới hạn tốc độ tạo Đơn);
   * không đủ → không gọi Tingee. Trả `BuyerOrderView` hiện tại. Đơn của người khác hay mã sai → `404 ORDER_NOT_FOUND`;
   * quá giới hạn tốc độ → `429 ORDER_RATE_LIMITED`, không gọi Tingee.
   */
  async retryPaymentLink(buyer: Buyer, ip: string, code: string): Promise<BuyerOrderView> {
    return this.withPaymentLink(await this.ownOrder(buyer, code), buyer, ip);
  }

  /** Đơn của chính Người mua theo mã. Mã sai dạng, không có hoặc của người khác → `404 ORDER_NOT_FOUND`. */
  private async ownOrder(buyer: Buyer, code: string): Promise<OrderRow> {
    if (!ORDER_CODE_PATTERN.test(code)) throw orderNotFound();
    const [row] = await this.db.orm
      .select()
      .from(orders)
      .where(and(eq(orders.code, code), eq(orders.userId, buyer.id)));
    if (!row) throw orderNotFound();
    return row;
  }

  /**
   * Hàm bảo đảm link (CAS giành lượt; Đơn không đủ điều kiện thì không làm gì) rồi `BuyerOrderView` của trạng thái sau đó.
   * Đơn đủ điều kiện: tính một lần thử vào giới hạn tốc độ tạo Đơn của Người mua trước khi giành lượt (mỗi lần Tingee từ
   * chối rõ ràng lại trả lượt, nên không có giới hạn này thì vòng thử lại gọi Tingee bằng key của BTC không ngừng); quá
   * giới hạn → `429 ORDER_RATE_LIMITED`. Không có lời gọi Tingee thì không đọc lại Đơn.
   */
  private async withPaymentLink(row: OrderRow, buyer: Buyer, ip: string): Promise<BuyerOrderView> {
    const attempted = await this.links.ensure(row, {
      claimed: false,
      beforeClaim: () => this.limiter.consume(buyer.id, ip),
    });
    return this.view(attempted ? await this.reload(row.id) : row);
  }

  private async reload(orderId: string): Promise<OrderRow> {
    const [row] = await this.db.orm.select().from(orders).where(eq(orders.id, orderId));
    if (!row) throw new Error('Không đọc lại được Đơn');
    return row;
  }

  /**
   * TX1. Trả id Đơn mới. Lỗi nghiệp vụ hoặc unique → ném, cả transaction rollback (không giữ chỗ, không bán, không Vé).
   * Đơn tổng > 0: giữ chỗ (`held += n`), Đơn `pending` hạn `holdSeconds` kèm lượt tạo link (`payment_link_attempt_at`,
   * cho lần gọi Tingee ngay sau commit), job hết hạn (a). Đơn tổng 0đ: bán (`sold += n`),
   * Đơn `pending` hạn = lúc tạo, kiểm trần Vé miễn phí của Người mua, rồi `markPaid` nguồn `free` (Đơn `paid` + Vé);
   * không job hết hạn.
   */
  private async placeOrder(tx: Tx, buyer: Buyer, slug: string, key: string, body: unknown): Promise<string> {
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

    const order = await this.insertOrder(
      tx,
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
      free ? sql`clock_timestamp()` : sql`clock_timestamp() + make_interval(secs => ${this.holdSeconds})`,
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
    if (!free) {
      await enqueueOrderExpiry(this.boss, tx, order.id, order.expiresAt);
      return order.id;
    }

    await this.assertFreeTicketLimit(tx, buyer.id, event.id, ticketCount(lines), event.maxTicketsPerOrder);
    const result = await this.payments.markPaid(tx, order.id, 'free', 0);
    // Đơn vừa chèn `pending` trong chính `tx` này: không bên nào khác chuyển được trước.
    if (result.outcome !== 'paid') throw new Error(`markPaid trả ${result.outcome} cho Đơn 0đ vừa tạo`);
    return order.id;
  }

  /**
   * Trần Vé miễn phí của Người mua (Story 3.3): số Vé trong các Đơn `paid` tổng 0đ của Người mua ở Sự kiện (Vé có phí
   * không tính) + `requested` ≤ giới hạn Vé/Đơn, nếu không → `409 FREE_TICKET_LIMIT_REACHED`. Chạy sau khi chèn Đơn
   * `pending`: TX1 khác của cùng Người mua cho cùng Sự kiện chờ ở unique Đơn chờ tới khi TX1 này commit (lúc đó Đơn đã
   * `paid`), nên câu đếm của bên chạy sau (READ COMMITTED, ảnh chụp mới mỗi câu) luôn thấy Vé vừa phát của bên kia.
   */
  private async assertFreeTicketLimit(
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
  private async insertOrder(
    tx: Tx,
    values: Omit<typeof orders.$inferInsert, 'code' | 'status' | 'expiresAt' | 'paymentLinkAttemptAt'>,
    expiresAt: SQL,
    claimPaymentLink: boolean,
  ): Promise<{ id: string; expiresAt: Date }> {
    for (let attempt = 1; ; attempt++) {
      const code = this.orderCode();
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

  private async byKey(userId: string, key: string): Promise<OrderRow | null> {
    const [row] = await this.db.orm
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, key)));
    return row ?? null;
  }

  /**
   * Đơn chờ cũ của chính Người mua cho Sự kiện đã quá hạn (job chưa kịp chạy): (a) chưa có link, quá `expires_at`; (c)
   * đã có link, quá `expires_at + PAYMENT_LINK_GRACE_SECONDS`. Hết hạn bằng chính hàm của job, mỗi Đơn một transaction
   * riêng trước TX1 (nhả rồi giữ chỗ trong cùng TX1 là hai lượt khóa tồn kho).
   */
  private async expireStalePending(userId: string, eventId: string): Promise<void> {
    const stale = await this.db.orm
      .select({ id: orders.id, paymentLink: orders.paymentLink })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.eventId, eventId),
          eq(orders.status, OrderStatus.PENDING),
          or(
            and(isNull(orders.paymentLink), lt(orders.expiresAt, sql`now()`)),
            and(
              isNotNull(orders.paymentLink),
              lt(sql`${orders.expiresAt} + make_interval(secs => ${PAYMENT_LINK_GRACE_SECONDS})`, sql`now()`),
            ),
          ),
        ),
      );
    for (const { id, paymentLink } of stale) await expireOrder(this.db, id, paymentLink === null ? 'hold' : 'link');
  }

  /** Đơn `pending` của Người mua cho Sự kiện (tối đa một, unique một phần); không có → `null`. */
  private async pendingOf(userId: string, eventId: string): Promise<OrderRow | null> {
    const [pending] = await this.db.orm
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.eventId, eventId), eq(orders.status, OrderStatus.PENDING)));
    return pending ?? null;
  }

  /**
   * Đơn + bản chụp + Sự kiện (tên, slug, giờ bắt đầu hiện tại, đã hủy chưa) + BTC → `BuyerOrderView`, kèm `serverNow`.
   * `buyerStatus` theo bảng của `buyerStatusOf` tại `serverNow`; Vé (theo `seq`, kèm Mã QR vé) chỉ khi `buyerStatus =
   * paid`; Đơn có phí kèm phần thanh toán (`paymentOf`); `organizer` là tên và kênh liên hệ BTC hiện tại.
   */
  private async view(row: OrderRow, db: DbExecutor = this.db.orm): Promise<BuyerOrderView> {
    const [items, answers, event, tickets, payment, organizer] = await Promise.all([
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
      saleEventById(db, row.eventId),
      row.status === OrderStatus.PAID ? this.tickets.ticketsOfOrder(db, row.id) : Promise.resolve([]),
      this.paymentOf(row, db),
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
      event: { slug: event.slug, name: event.name, startsAt: toEventIso(event.startsAt) },
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
      // Sự kiện đã hủy: không bao giờ hiện Mã QR vé.
      tickets: buyerStatus === BuyerOrderStatus.PAID ? tickets : [],
      organizer,
    };
  }

  /**
   * Phần thanh toán của Đơn có phí (Đơn 0đ → `null`): checkout URL chỉ khi `pending` và đã có link; lý do lần tạo link
   * gần nhất thất bại; người nhận tiền theo tài khoản đã chụp (chưa chụp: tài khoản mặc định hiện tại).
   */
  private async paymentOf(row: OrderRow, db: DbExecutor): Promise<BuyerOrderPayment | null> {
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
}
