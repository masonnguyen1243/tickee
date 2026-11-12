import { Inject, Injectable } from '@nestjs/common';
import {
  CreateOrderRequest,
  ErrorCode,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  ORDER_CODE_PATTERN,
  orderRequestFor,
  OrderStatus,
  PAYMENT_LINK_GRACE_SECONDS,
  type BuyerOrderView,
  type CheckoutForm,
  type PendingOrderExistsDetails,
} from '@tickee/contracts';
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError, parseRequest } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { buyerFormQuestions, publicEventBySlug } from '../event/index.js';
import { TicketsService } from '../ticketing/index.js';
import { OrderPayments } from './mark-paid.js';
import { announceOrderCreated } from './order-changed.js';
import { ORDER_CODE_GENERATOR, type OrderCodeGenerator } from './order-code.js';
import { expireOrder, OrderQueues } from './order-jobs.js';
import { OrderRateLimiter } from './order-rate-limit.js';
import { buyerOrderView } from './order-view.js';
import { PaymentLinks } from './payment-link.js';
import { placeOrder, uniqueViolation, type Buyer, type PlacedOrder } from './place-order.js';
import { orders } from './schema.js';

/*
 * Checkout và tạo Đơn (Story 3.2, AD-2, AD-4, AD-31). Đơn tổng > 0: giữ chỗ rồi `pending` với hạn
 * `ORDER_HOLD_SECONDS`, TX1 đặt sẵn lượt tạo link; sau khi TX1 commit, hàm bảo đảm link (`PaymentLinks`, Story 3.4) gọi
 * Tingee ngoài transaction rồi TX2 gắn link. Đơn tổng 0đ (Story 3.3): bán ngay trong TX1 rồi `markPaid` nguồn `free`,
 * nên request trả Đơn `paid` kèm Vé.
 *
 * Tạo Đơn: kiểm khóa chống trùng và payload → tra Đơn theo `(user_id, Idempotency-Key)` (có → 200 Đơn cũ) → hết hạn Đơn
 * chờ cũ đã quá hạn (transaction riêng, cùng hàm với job) → Đơn chờ khác còn hạn → 409 (cùng khóa → 200) → queue sẵn
 * sàng → giới hạn tốc độ → TX1 (`placeOrder`, `place-order.ts`); commit xong mới phát `event_orders_changed` cho Tổng
 * quan Sự kiện bằng lệnh riêng (Story 3.11, `announceOrderCreated`). Lỗi unique sau rollback (hai request cùng khóa,
 * hay hai Đơn chờ đua nhau) → đọc lại: trả Đơn của bên thắng hoặc 409. Mọi lần trả Đơn đã có (cùng khóa) cũng đi qua
 * hàm bảo đảm link: Đơn chưa có link mà còn lượt thì thử tạo link.
 *
 * File này chỉ điều phối request: form checkout, tạo Đơn, tra Đơn của Người mua, thử lại link. Phần còn lại:
 * - TX1 (`placeOrder`) cùng luật bán, trần Vé miễn phí, INSERT Đơn và lỗi chỉ TX1 dùng: `place-order.ts`.
 * - Read model `BuyerOrderView` của Trang Đơn (`buyerOrderView`): `order-view.ts`.
 * - Hàm bảo đảm link: `payment-link.ts`; hết hạn Đơn: `order-jobs.ts`; `markPaid`: `mark-paid.ts`.
 */

/** Token DI của thời gian Giữ chỗ (giây) của Đơn mới; mặc định `ORDER_HOLD_SECONDS`, test tiêm số nhỏ. */
export const ORDER_HOLD = Symbol('ORDER_HOLD');

type OrderRow = typeof orders.$inferSelect;

const IDEMPOTENCY_KEY = 'orders_user_id_idempotency_key_key';
const ONE_PENDING_KEY = 'orders_one_pending_per_buyer_event_key';

const orderNotFound = () => new AppError(ErrorCode.ORDER_NOT_FOUND, 'Không tìm thấy Đơn này.');

const pendingExists = (code: string) => {
  const details: PendingOrderExistsDetails = { code };
  return new AppError(ErrorCode.PENDING_ORDER_EXISTS, 'Bạn đang có một Đơn chờ thanh toán cho Sự kiện này.', {
    details,
  });
};

/** `Idempotency-Key` thiếu hoặc không phải uuid → `400 VALIDATION_FAILED` (cùng dạng với `parseRequest`). */
function idempotencyKeyOf(raw: unknown): string {
  const parsed = IdempotencyKey.safeParse(raw);
  if (parsed.success) return parsed.data.toLowerCase();
  const issue = { path: `headers.${IDEMPOTENCY_KEY_HEADER}`, code: raw === undefined ? 'invalid_type' : 'invalid_format' };
  throw new AppError(ErrorCode.VALIDATION_FAILED, 'Yêu cầu không hợp lệ.', { details: { issues: [issue] } });
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
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` trong TX1 cần cả hai (hết hạn Đơn; email Vé của
    // Đơn 0đ). Trước giới hạn tốc độ: pg-boss lỗi thì không tới TX1, không tính lần thử.
    await this.queues.ready();
    await this.payments.ready();
    await this.limiter.consume(buyer.id, ip);

    const deps = { boss: this.boss, orderCode: this.orderCode, holdSeconds: this.holdSeconds, payments: this.payments };
    let placed: PlacedOrder;
    try {
      placed = await this.db.transaction((tx) => placeOrder(tx, deps, buyer, slug, key, body));
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
    // TX1 đã commit: báo Tổng quan Sự kiện có Đơn mới bằng lệnh riêng (lỗi chỉ log). Đường trả Đơn cũ ở trên không phát.
    await announceOrderCreated(this.db, placed);
    const orderId = placed.id;
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

  /** `BuyerOrderView` của Đơn, đọc ngoài transaction (`buyerOrderView`, `order-view.ts`). */
  private view(row: OrderRow): Promise<BuyerOrderView> {
    return buyerOrderView(this.db.orm, this.tickets, row);
  }
}
