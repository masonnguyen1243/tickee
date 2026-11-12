import { Inject, Injectable, Module } from '@nestjs/common';
import { BuyerEmailKind, EventStatus, FunnelEventType, OrderStatus, ReviewItemReason } from '@tickee/contracts';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { audit } from '../../platform/audit/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { lockEventByIdForShare, organizationLocked, type PublicEventRef } from '../event/index.js';
import { TicketsService } from '../ticketing/index.js';
import { BuyerEmailQueues, enqueueBuyerEmail } from './buyer-email-jobs.js';
import { sellInventory, settleHeld } from './inventory.service.js';
import { notifyOrderChanged, orderSignalColumns } from './order-changed.js';
import { releaseOrderHeld } from './order-jobs.js';
import { checkoutFunnelEvents, orderItems, orders, type PaidSource } from './schema.js';

/**
 * Kết quả `markPaid` (AD-1, AD-7), đủ để bên gọi chọn mục Cần xử lý (Story 3.6):
 * - `paid`: Đơn vừa chuyển `paid` (từ `pending`, hoặc từ `expired` khi tiền về muộn còn chỗ) và Vé đã phát.
 * - `lost_race`: chỉ nguồn `free` — Đơn không còn `pending` (một lần gọi khác đã chuyển trước), không phát gì.
 * - `event_cancelled`: Sự kiện đã hủy.
 * - `duplicate_payment`: Đơn đã `paid`/`cancelled`/`refunded`/`review` (trả trùng).
 * - `mismatch`: số tiền ghi nhận khác `total_amount`.
 * - `orphan`: tiền về muộn mà không phát được Vé, kèm `reason` (`event_ended`/`event_locked`/`sold_out`).
 *
 * Khác `paid`/`lost_race`, Đơn `pending`/`expired` đã chuyển `review` trong `tx` (trừ `duplicate_payment`, và
 * `event_cancelled` khi Đơn ở trạng thái khác: giữ nguyên); bên gọi (`payment`) tạo `review_item` trong cùng `tx`.
 */
export type MarkPaidResult =
  | { outcome: 'paid' }
  | { outcome: 'lost_race' }
  | { outcome: 'event_cancelled' }
  | { outcome: 'duplicate_payment' }
  | { outcome: 'mismatch' }
  | { outcome: 'orphan'; reason: ReviewItemReason };
export type MarkPaidOutcome = MarkPaidResult['outcome'];

/** Tùy chọn của nguồn có phí. `paidAt`: lúc Tingee báo tiền về; thiếu → đồng hồ DB. Nguồn `free` bỏ qua. */
export interface MarkPaidOptions {
  paidAt?: Date | null;
}

/**
 * Phần của Đơn mà `payment` cần trước khi gọi `markPaid` (Story 3.5, 3.6): có Đơn không, Đơn của BTC nào (bước 1–2 của
 * thứ tự kiểm, dữ liệu không đổi của Đơn), trạng thái (IPN trạng thái chỉ hết hạn Đơn `pending`). Không có PII.
 */
export interface OrderForPayment {
  id: string;
  organizationId: string;
  status: OrderStatus;
  totalAmount: number;
  /**
   * Tài khoản nhận tiền của link thanh toán (chụp ở TX2, không đổi sau đó); `null` khi Đơn chưa có link. `payment` ràng
   * IPN ký bằng secret của credential đã thay với Đơn có link tạo bằng chính credential đó (AD-35).
   */
  payoutAccountId: string | null;
}

/** Đơn theo mã (`orders.code`), không khóa; không có → `null`. Người gọi đã kiểm mã đúng `ORDER_CODE_PATTERN`. */
export async function orderForPayment(db: DbExecutor, code: string): Promise<OrderForPayment | null> {
  const [row] = await db
    .select({
      id: orders.id,
      organizationId: orders.organizationId,
      status: orders.status,
      totalAmount: orders.totalAmount,
      payoutAccountId: orders.payoutAccountId,
    })
    .from(orders)
    .where(eq(orders.code, code));
  return row ?? null;
}

/** Đồng hồ DB (`clock_timestamp()`): `issued_at` của Vé, `paid_at` khi Tingee không báo, mốc so `effective_end_at`. */
async function dbClock(tx: Tx): Promise<Date> {
  const { rows } = await tx.execute<{ now: string | Date }>(sql`SELECT clock_timestamp() AS now`);
  return new Date(rows[0]!.now);
}

/** Một dòng của Đơn để chốt tồn kho và phát Vé. */
interface PaidLine {
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
}

/** Dòng của Đơn theo `ticket_type_id` tăng dần (thứ tự khóa tồn kho, AD-2). */
function linesOf(tx: Tx, orderId: string): Promise<PaidLine[]> {
  return tx
    .select({
      ticketTypeId: orderItems.ticketTypeId,
      ticketTypeName: orderItems.ticketTypeName,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.ticketTypeId));
}

/** Hạng vé thiếu chỗ khi bán lại Đơn hết hạn: ném trong savepoint để rollback các dòng đã bán. */
class SoldOut extends Error {
  constructor(readonly ticketTypeId: string) {
    super('Hạng vé không còn đủ chỗ');
  }
}

/**
 * Bán có điều kiện cả Đơn (`sold += n` từng dòng, theo `ticket_type_id` tăng dần) trong một savepoint: một Hạng vé thiếu
 * chỗ → rollback savepoint (không dòng nào được bán) → `false`. Đủ chỗ → `true`.
 */
async function sellAllOrNothing(tx: Tx, lines: readonly PaidLine[]): Promise<boolean> {
  try {
    await tx.transaction(async (sp) => {
      const missing = await sellInventory(sp, lines);
      if (missing) throw new SoldOut(missing);
    });
    return true;
  } catch (err) {
    if (err instanceof SoldOut) return false;
    throw err;
  }
}

/** Trạng thái Đơn còn chuyển được sang `review` khi khoản tiền không thành Vé (AD-3). */
type Reviewable = typeof OrderStatus.PENDING | typeof OrderStatus.EXPIRED;
const isReviewable = (status: OrderStatus): status is Reviewable =>
  status === OrderStatus.PENDING || status === OrderStatus.EXPIRED;

/**
 * CAS `from → review` (Đơn đã khóa nên không thể thua đua; 0 dòng là lỗi lập trình → ném, cả `tx` rollback). `pending`
 * thì nhả chỗ đang giữ (`held -= n`); `expired` đã nhả lúc hết hạn. Phát `order_changed` trong `tx` (Trang Đơn hiện "BTC
 * đang kiểm tra thanh toán").
 */
async function moveToReview(tx: Tx, orderId: string, from: Reviewable): Promise<void> {
  const [moved] = await tx
    .update(orders)
    .set({ status: OrderStatus.REVIEW })
    .where(and(eq(orders.id, orderId), eq(orders.status, from)))
    .returning(orderSignalColumns);
  if (!moved) throw new Error(`markPaid: CAS ${from} → review thua dù đã khóa Đơn`);
  if (from === OrderStatus.PENDING) await releaseOrderHeld(tx, orderId);
  await notifyOrderChanged(tx, moved);
}

const orphan = (reason: ReviewItemReason): MarkPaidResult => ({ outcome: 'orphan', reason });

/*
 * Đường duy nhất phát Vé (AD-1, Story 3.3): mọi nguồn ghi nhận thanh toán (`PAID_SOURCES`) đi qua `markPaid` trong `tx`
 * của bên gọi. Một transaction: khóa Sự kiện `FOR SHARE` → (nguồn có phí: khóa Đơn, thứ tự kiểm 3–7 của AD-7) → CAS Đơn
 * → `paid` (kèm `paid_at`, `paid_amount`, `paid_source`) → phép tồn kho theo nguồn → phát N Vé (`ticketing`, kèm link
 * chia sẻ) → enqueue email Vé (Story 3.8, mọi nguồn) → audit `order.paid` → phễu `paid` → tín hiệu `order_changed` (trừ
 * nguồn `free`). Mọi lần Đơn chuyển `review` cũng phát `order_changed`; tiền về muộn hết chỗ (`orphan` `sold_out`) còn
 * enqueue email báo Người mua. Không bao giờ phát Vé từ request của trình duyệt hay `returnUrl`.
 */
@Injectable()
export class OrderPayments {
  constructor(
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(BuyerEmailQueues) private readonly emailQueues: BuyerEmailQueues,
  ) {}

  /**
   * pg-boss đã start và queue email Người mua đã có: `markPaid` enqueue trong `tx` của bên gọi, nên bên gọi chờ việc này
   * trước transaction (lần trước lỗi thì làm lại).
   */
  ready(): Promise<void> {
    return this.emailQueues.ready();
  }

  /**
   * Ghi nhận khoản tiền `paidAmount` cho Đơn `orderId` trong `tx`.
   *
   * - `free` (Đơn tổng 0đ, TX1 đã bán có điều kiện): `paidAmount` phải là 0; CAS `pending → paid`, không đụng tồn kho,
   *   `paid_at` = Vé `issued_at` = đồng hồ DB. Đơn không còn `pending` → `lost_race`.
   * - `ipn` (Story 3.5, 3.6): khóa Sự kiện `FOR SHARE` rồi khóa Đơn `FOR NO KEY UPDATE`, rồi bước 3–7 của AD-7 trên
   *   trạng thái đã khóa, dừng ở nhánh đầu khớp:
   *   3. Sự kiện đã hủy → `event_cancelled` (Đơn `pending`/`expired` → `review`; trạng thái khác giữ nguyên, kể cả
   *      `cancelled`).
   *   4. Đơn `paid`/`cancelled`/`refunded`/`review` → `duplicate_payment` (không đổi gì).
   *   5. `paidAmount ≠ total_amount` → `mismatch` (Đơn → `review`).
   *   6. Tiền về muộn (Đơn `expired`, hoặc đồng hồ DB đã quá `effective_end_at`): quá `effective_end_at` → `orphan`
   *      `event_ended`; Đơn `expired` mà Sự kiện có `locked_at` hoặc BTC bị khóa → `orphan` `event_locked`; còn lại bán
   *      có điều kiện cả Đơn trong savepoint: đủ chỗ → CAS `expired → paid` + Vé như bước 7, thiếu một Hạng vé → `orphan`
   *      `sold_out` (không bán dòng nào). Mọi `orphan` đưa Đơn → `review`.
   *   7. Đơn `pending` → CAS `pending → paid`, `held -= n, sold += n`, Vé. Sự kiện bị khóa không chặn (Đơn đã trả tiền
   *      khi còn bán).
   *   `paid_at` = `options.paidAt` (thiếu → đồng hồ DB); Vé `issued_at` = đồng hồ DB. `pending → review` nhả `held`.
   *   `orphan` `sold_out` enqueue email báo Người mua (`orphan_sold_out`) trong `tx`.
   * - `reconciliation`, `manual`: chưa làm (Story 4.1, 4.4) → ném lỗi.
   *
   * `paid` luôn kèm đúng một job email Vé (`tickets`) trong `tx`. Bên gọi đã `ready()` trước transaction. Lỗi bất kỳ
   * (phát Vé, enqueue, audit…) → ném, cả `tx` rollback (không Vé, không job).
   */
  async markPaid(
    tx: Tx,
    orderId: string,
    source: PaidSource,
    paidAmount: number,
    options: MarkPaidOptions = {},
  ): Promise<MarkPaidResult> {
    if (source !== 'free' && source !== 'ipn') throw new Error(`markPaid: nguồn ${source} chưa hỗ trợ`);
    if (source === 'free' && paidAmount !== 0) throw new Error('markPaid: Đơn 0đ chỉ ghi nhận 0đ');

    const [current] = await tx
      .select({ eventId: orders.eventId, totalAmount: orders.totalAmount })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!current) throw new Error('markPaid: không có Đơn này');
    if (source === 'free' && current.totalAmount !== 0) throw new Error('markPaid: nguồn free chỉ dành cho Đơn tổng 0đ');

    // Thứ tự khóa: Sự kiện → Đơn → tồn kho theo id. TX1 đã khóa Sự kiện thì khóa lại không chờ.
    const event = await lockEventByIdForShare(tx, current.eventId);
    if (source === 'ipn') {
      return this.settleIpn(tx, orderId, event, current.totalAmount, paidAmount, options.paidAt ?? null);
    }
    // Đơn 0đ đã bán (`sold += n`) ngay trong TX1.
    const paid = await this.pay(tx, orderId, {
      from: OrderStatus.PENDING,
      source,
      paidAt: sql`clock_timestamp()`,
      paidAmount,
      issuedAt: null,
      lines: await linesOf(tx, orderId),
    });
    return paid ? { outcome: 'paid' } : { outcome: 'lost_race' };
  }

  /** Bước 3–7 của AD-7 cho IPN `success` (xem `markPaid`). Sự kiện đã khóa `FOR SHARE`. */
  private async settleIpn(
    tx: Tx,
    orderId: string,
    event: PublicEventRef,
    totalAmount: number,
    paidAmount: number,
    reportedPaidAt: Date | null,
  ): Promise<MarkPaidResult> {
    // Khóa Đơn trước khi kiểm: IPN khác mã vừa thắng thì bên chờ đọc lại Đơn đã `paid` → `duplicate_payment`, không phải
    // lệch tiền / tiền về muộn của một Đơn đã trả. `NO KEY UPDATE` (đúng khóa mà CAS bên dưới lấy), không phải `UPDATE`:
    // INSERT `payment_events` của bên gọi đã giữ `KEY SHARE` trên Đơn (khóa ngoại), `FOR UPDATE` sẽ deadlock giữa hai IPN
    // cùng Đơn.
    const [locked] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('no key update');
    if (!locked) throw new Error('markPaid: không có Đơn này');
    const status = locked.status;

    // 3. Sự kiện đã hủy.
    if (event.status === EventStatus.CANCELLED) {
      if (isReviewable(status)) await moveToReview(tx, orderId, status);
      return { outcome: 'event_cancelled' };
    }
    // 4. Đơn không còn chờ tiền.
    if (!isReviewable(status)) return { outcome: 'duplicate_payment' };
    // 5. Lệch tiền.
    if (paidAmount !== totalAmount) {
      await moveToReview(tx, orderId, status);
      return { outcome: 'mismatch' };
    }
    // 6. Tiền về muộn.
    const now = await dbClock(tx);
    if (now.getTime() > event.effectiveEndAt.getTime()) {
      await moveToReview(tx, orderId, status);
      return orphan(ReviewItemReason.EVENT_ENDED);
    }
    const lines = await linesOf(tx, orderId);
    if (status === OrderStatus.EXPIRED) {
      // Bán lại Đơn đã hết hạn: chỉ khóa Sự kiện/BTC chặn. Ẩn, đóng bán hay điều kiện bán có phí không chặn, vì Người
      // mua đã trả tiền khi còn bán (FR-14, AC 3.6).
      const eventLocked =
        event.lockedAt !== null || (await organizationLocked(tx, { organizationId: event.organizationId }));
      if (eventLocked) {
        await moveToReview(tx, orderId, status);
        return orphan(ReviewItemReason.EVENT_LOCKED);
      }
      if (!(await sellAllOrNothing(tx, lines))) {
        await moveToReview(tx, orderId, status);
        // Người mua đã trả tiền mà không có Vé: báo BTC sẽ liên hệ hoàn tiền (email cùng `tx`).
        await enqueueBuyerEmail(this.boss, tx, BuyerEmailKind.ORPHAN_SOLD_OUT, orderId);
        return orphan(ReviewItemReason.SOLD_OUT);
      }
    } else {
      // 7. Đơn `pending`: chốt bán phần đang giữ từ TX1.
      await settleHeld(tx, lines);
    }
    // Đơn đã khóa nên CAS không thể thua; 0 dòng là lỗi lập trình → ném, cả `tx` rollback (kể cả phép tồn kho trên).
    const paidAt = reportedPaidAt ?? now;
    if (!(await this.pay(tx, orderId, { from: status, source: 'ipn', paidAt, paidAmount, issuedAt: now, lines }))) {
      throw new Error(`markPaid: CAS ${status} → paid thua dù đã khóa Đơn`);
    }
    return { outcome: 'paid' };
  }

  /**
   * CAS `from → paid` (kèm `paid_at`, `paid_amount`, `paid_source`) → phát N Vé (`issued_at` = `issuedAt`, thiếu →
   * `paid_at`) → enqueue email Vé (`tickets`, id job cố định theo Đơn) → audit `order.paid` → phễu `paid` →
   * `order_changed` (trừ nguồn `free`: Đơn 0đ thành `paid` ngay trong TX1, không `NOTIFY` trong TX1, response tạo Đơn đã
   * mang kết quả). Phép tồn kho do bên gọi làm. 0 dòng (Đơn không còn ở `from`) → `false`, không làm gì.
   */
  private async pay(tx: Tx, orderId: string, input: PayInput): Promise<boolean> {
    const [order] = await tx
      .update(orders)
      .set({ status: OrderStatus.PAID, paidAt: input.paidAt, paidAmount: input.paidAmount, paidSource: input.source })
      .where(and(eq(orders.id, orderId), eq(orders.status, input.from)))
      .returning({
        id: orders.id,
        code: orders.code,
        userId: orders.userId,
        eventId: orders.eventId,
        organizationId: orders.organizationId,
        buyerName: orders.buyerName,
        funnelId: orders.funnelId,
        paidAt: orders.paidAt,
      });
    if (!order) return false;

    await this.tickets.issueTickets(tx, {
      orderId: order.id,
      orderCode: order.code,
      eventId: order.eventId,
      organizationId: order.organizationId,
      userId: order.userId,
      holderName: order.buyerName,
      issuedAt: input.issuedAt ?? order.paidAt!,
      lines: input.lines,
    });
    await enqueueBuyerEmail(this.boss, tx, BuyerEmailKind.TICKETS, order.id);
    await audit.record(tx, {
      actorUserId: null,
      organizationId: order.organizationId,
      action: 'order.paid',
      target: { type: 'order', id: order.id },
    });
    if (order.funnelId) {
      await tx
        .insert(checkoutFunnelEvents)
        .values({ eventId: order.eventId, type: FunnelEventType.PAID, funnelId: order.funnelId })
        .onConflictDoNothing({ target: [checkoutFunnelEvents.funnelId, checkoutFunnelEvents.type] });
    }
    if (input.source !== 'free') {
      await notifyOrderChanged(tx, { id: order.id, organizationId: order.organizationId, eventId: order.eventId });
    }
    return true;
  }
}

/** Đầu vào của `pay`: trạng thái nguồn của CAS, nguồn ghi nhận, giá trị `paid_*`, giờ phát Vé, dòng của Đơn. */
interface PayInput {
  from: typeof OrderStatus.PENDING | typeof OrderStatus.EXPIRED;
  source: PaidSource;
  paidAt: Date | SQL;
  paidAmount: number;
  issuedAt: Date | null;
  lines: readonly PaidLine[];
}

/**
 * `OrderPayments` (`markPaid`) cho mọi vai: `OrderingModule` (api, Đơn 0đ), `payment` (IPN ở api, Đối soát bù ở worker).
 * Kèm `BuyerEmailQueues` (tạo queue email Người mua mà `markPaid` enqueue vào). Không controller, không cấu hình; cần
 * `TicketingModule` (toàn cục: `TicketsService`), `JobsModule` và `DbModule` ở gốc DI.
 */
@Module({ providers: [OrderPayments, BuyerEmailQueues], exports: [OrderPayments] })
export class OrderPaymentsModule {}
