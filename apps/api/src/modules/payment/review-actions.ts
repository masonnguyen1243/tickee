import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  OrderCancelReason,
  OrderStatus,
  RealtimeTopic,
  REFUND_ONLY_REVIEW_ITEM_TYPES,
  ReviewAction,
  ReviewItemReason,
  ReviewItemResolution,
  ReviewItemStatus,
  type ReviewActionResult,
  type ReviewItemType as ReviewItemTypeValue,
} from '@tickee/contracts';
import { and, eq } from 'drizzle-orm';
import type { AccessContext } from '../../platform/access/index.js';
import { audit, type AuditAction } from '../../platform/audit/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { realtime } from '../../platform/realtime/index.js';
import {
  notifyEventOrdersChanged,
  OrderPayments,
  OrderReviewDecisions,
  reviewOrdersOf,
  type MarkPaidResult,
  type ReviewOrderRow,
} from '../ordering/index.js';
import { UUID } from './review-read.js';
import { paymentEvents, reviewItems } from './schema.js';

/*
 * Thao tác của Owner/Admin trên mục Cần xử lý (Story 4.4-a, FR-21, AD-7): "Duyệt tay phát Vé", "Từ chối", "Đã hoàn
 * tay", "Bỏ qua". `payment` sở hữu `review_items` và gọi `ordering` cho mọi thay đổi của Đơn (kiểm Sự kiện nằm trong
 * `markPaid`, nên `payment` không cần `event`). Mỗi thao tác một transaction: khóa mục theo `(id, organization_id)` →
 * kiểm bảng thao tác (`reviewActionsFor`) → gọi `ordering` → CAS mục → audit → tín hiệu realtime, tất cả trong `tx`.
 *
 * Idempotency theo trạng thái (không có bảng idempotency chung): mỗi thao tác là một chuyển trạng thái có CAS, nên gửi
 * lại sau khi đã thắng chỉ gặp trạng thái đích (`reviewActionDone`) → `200` trạng thái hiện tại, không làm lại gì. Thao
 * tác không được phép ở trạng thái hiện tại (kể cả bên thua khi hai thành viên bấm cùng lúc) → `409
 * REVIEW_ACTION_NOT_ALLOWED`.
 */

/** Đơn của mục, phần cần cho bảng thao tác. */
export interface ReviewActionOrderState {
  status: OrderStatus;
  cancelReason: OrderCancelReason | null;
}

/** Trạng thái của mục và Đơn của nó mà bảng thao tác xét. */
export interface ReviewActionState {
  type: ReviewItemTypeValue;
  status: ReviewItemStatus;
  resolution: ReviewItemResolution | null;
  /** Đơn của mục; `null` với mục `unmatched`. */
  order: ReviewActionOrderState | null;
}

const isRefundOnly = (type: ReviewItemTypeValue) => REFUND_ONLY_REVIEW_ITEM_TYPES.includes(type);
const isRejectedOrder = (order: ReviewActionOrderState | null) =>
  order?.status === OrderStatus.CANCELLED && order.cancelReason === OrderCancelReason.REJECTED;

/**
 * Bảng thao tác (hàm thuần, `reporting` dùng cho `ReviewItemDetail.actions`), theo thứ tự hiện nút:
 * - mục `amount_mismatch`/`orphan` `open`, Đơn `review` → `approve`, `reject`;
 * - mục `amount_mismatch`/`orphan` `open`, Đơn `cancelled` (`rejected`) → `refund`;
 * - mục `event_cancelled`/`duplicate_payment`/`unmatched` `open` → `refund`, `dismiss`;
 * - mục `resolved`, hoặc Đơn ở trạng thái khác → không có thao tác.
 * Không có `refund`/`dismiss` khi Đơn còn `review` (không có `review → refunded`), không có `dismiss` cho Đơn đã từ chối.
 */
export function reviewActionsFor(state: ReviewActionState): ReviewAction[] {
  if (state.status !== ReviewItemStatus.OPEN) return [];
  if (isRefundOnly(state.type)) return [ReviewAction.REFUND, ReviewAction.DISMISS];
  if (state.order?.status === OrderStatus.REVIEW) return [ReviewAction.APPROVE, ReviewAction.REJECT];
  if (isRejectedOrder(state.order)) return [ReviewAction.REFUND];
  return [];
}

/**
 * Mục đã ở đúng kết quả của thao tác `action` (gửi lại sau khi đã thắng → `200`, không làm lại): `approve` → mục
 * `approved`; `reject` → mục `amount_mismatch`/`orphan` còn `open` và Đơn `cancelled` (`rejected`); `refund` → mục
 * `refunded`; `dismiss` → mục `dismissed`.
 */
export function reviewActionDone(action: ReviewAction, state: ReviewActionState): boolean {
  switch (action) {
    case ReviewAction.APPROVE:
      return state.resolution === ReviewItemResolution.APPROVED;
    case ReviewAction.REJECT:
      return state.status === ReviewItemStatus.OPEN && !isRefundOnly(state.type) && isRejectedOrder(state.order);
    case ReviewAction.REFUND:
      return state.resolution === ReviewItemResolution.REFUNDED;
    case ReviewAction.DISMISS:
      return state.resolution === ReviewItemResolution.DISMISSED;
  }
}

/** Một thao tác đã kiểm đầu vào: `dismiss` kèm lý do (đã trim, 1–300 ký tự). */
export type ReviewActionRequest =
  | { action: typeof ReviewAction.APPROVE | typeof ReviewAction.REJECT | typeof ReviewAction.REFUND }
  | { action: typeof ReviewAction.DISMISS; reason: string };

const reviewItemNotFound = () => new AppError(ErrorCode.REVIEW_ITEM_NOT_FOUND, 'Không tìm thấy mục Cần xử lý này.');
const actionNotAllowed = () =>
  new AppError(ErrorCode.REVIEW_ACTION_NOT_ALLOWED, 'Mục này vừa được xử lý hoặc không còn làm được thao tác này.');

/** Kết quả `markPaid` nguồn `manual` chưa duyệt được (không đổi gì) → lỗi trả về. Hết chỗ xử lý riêng (ghi nhật ký). */
function approvalBlocked(result: Exclude<MarkPaidResult, { outcome: 'paid' }>): AppError {
  if (result.outcome === 'event_cancelled') {
    return new AppError(ErrorCode.EVENT_CANCELLED, 'Sự kiện đã hủy: không duyệt tay phát Vé được.');
  }
  if (result.outcome === 'orphan' && result.reason === ReviewItemReason.EVENT_ENDED) {
    return new AppError(ErrorCode.EVENT_ALREADY_ENDED, 'Sự kiện đã kết thúc: không duyệt tay phát Vé được.');
  }
  if (result.outcome === 'orphan' && result.reason === ReviewItemReason.EVENT_LOCKED) {
    return new AppError(ErrorCode.EVENT_LOCKED, 'Sự kiện đang bị khóa: không duyệt tay phát Vé được.');
  }
  if (result.outcome === 'lost_race') return actionNotAllowed();
  // `already_settled`, `duplicate_payment`, `mismatch`, `orphan` `sold_out` không bao giờ tới đây với nguồn `manual`.
  throw new Error(`markPaid nguồn manual trả ${result.outcome}`);
}

/** Mục đã khóa, kèm khoản tiền của nó. */
interface LockedItem {
  id: string;
  organizationId: string;
  orderId: string | null;
  type: ReviewItemTypeValue;
  status: ReviewItemStatus;
  resolution: ReviewItemResolution | null;
  receivedAmount: number | null;
  paidAt: Date | null;
  receivedAt: Date;
}

/** Kết quả của transaction: đã đổi / đã ở đích (gửi lại) / duyệt tay hết chỗ (đã ghi nhật ký, ném `409` sau commit). */
type Outcome = 'changed' | 'unchanged' | 'sold_out';

@Injectable()
export class ReviewActionsService {
  private readonly logger = new Logger('ReviewActions');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OrderPayments) private readonly payments: OrderPayments,
    @Inject(OrderReviewDecisions) private readonly decisions: OrderReviewDecisions,
  ) {}

  /**
   * Làm thao tác `request` trên mục `itemId` của BTC `ctx` (người làm `ctx.userId`). Mục sai dạng, lạ hoặc của BTC khác →
   * `404 REVIEW_ITEM_NOT_FOUND`. Duyệt tay hết chỗ → dòng audit `review_item.approve_sold_out` được commit (nhật ký "Duyệt
   * tay không thành · Hết chỗ"), rồi `409 TICKET_TYPE_SOLD_OUT`.
   */
  async perform(ctx: AccessContext, itemId: string, request: ReviewActionRequest): Promise<ReviewActionResult> {
    if (!UUID.test(itemId)) throw reviewItemNotFound();
    const id = itemId.toLowerCase();
    // Duyệt tay enqueue email Vé, Từ chối enqueue email báo hủy, trong `tx`: queue phải sẵn sàng trước transaction.
    if (request.action === ReviewAction.APPROVE) await this.payments.ready();
    if (request.action === ReviewAction.REJECT) await this.decisions.ready();

    const { outcome, result } = await this.db.transaction(async (tx) => {
      const locked = await this.lockItem(tx, ctx, id);
      const order = locked.orderId ? await this.orderOf(tx, ctx, locked.orderId) : null;
      const state: ReviewActionState = { ...locked, order };
      let outcome: Outcome = 'unchanged';
      if (!reviewActionDone(request.action, state)) {
        if (!reviewActionsFor(state).includes(request.action)) throw actionNotAllowed();
        outcome = await this.apply(tx, ctx, locked, request);
      }
      // Kết quả đọc trong `tx` (mục còn khóa): thao tác song song của thành viên khác không lẫn vào response này.
      const result = outcome === 'sold_out' ? null : await this.resultOf(tx, ctx, locked.id, request.action);
      return { outcome, result };
    });

    this.logger.log(
      { organizationId: ctx.organizationId, reviewItemId: id, action: request.action, outcome },
      'Thao tác trên mục Cần xử lý',
    );
    if (!result) {
      throw new AppError(ErrorCode.TICKET_TYPE_SOLD_OUT, 'Hạng vé không còn đủ chỗ: chưa duyệt tay được. Đơn giữ nguyên.');
    }
    return result;
  }

  /** `SELECT … FOR UPDATE` mục theo `(id, organization_id)`; khoản tiền đọc kèm (bảng chỉ INSERT, không khóa). */
  private async lockItem(tx: Tx, ctx: AccessContext, itemId: string): Promise<LockedItem> {
    const [row] = await tx
      .select({
        id: reviewItems.id,
        organizationId: reviewItems.organizationId,
        orderId: reviewItems.orderId,
        type: reviewItems.type,
        status: reviewItems.status,
        resolution: reviewItems.resolution,
        paymentEventId: reviewItems.paymentEventId,
      })
      .from(reviewItems)
      .where(and(eq(reviewItems.id, itemId), eq(reviewItems.organizationId, ctx.organizationId)))
      .for('update');
    if (!row) throw reviewItemNotFound();
    const [payment] = await tx
      .select({ receivedAmount: paymentEvents.paidAmount, paidAt: paymentEvents.paidAt, receivedAt: paymentEvents.receivedAt })
      .from(paymentEvents)
      .where(eq(paymentEvents.id, row.paymentEventId));
    if (!payment) throw new Error('review_items trỏ tới payment_events không có');
    const { paymentEventId: _paymentEventId, ...item } = row;
    return { ...item, ...payment };
  }

  private async orderOf(tx: Tx, ctx: AccessContext, orderId: string): Promise<ReviewActionOrderState | null> {
    const order = (await reviewOrdersOf(tx, ctx, [orderId])).get(orderId);
    return order ? { status: order.status, cancelReason: order.cancelReason } : null;
  }

  /** Thao tác đã được phép trên mục đã khóa (xem `reviewActionsFor`). */
  private async apply(
    tx: Tx,
    ctx: AccessContext,
    item: LockedItem,
    request: ReviewActionRequest,
  ): Promise<Outcome> {
    const decision = { orderId: item.orderId!, organizationId: ctx.organizationId, actorUserId: ctx.userId };
    switch (request.action) {
      case ReviewAction.APPROVE: {
        if (item.receivedAmount === null) throw actionNotAllowed();
        const result = await this.payments.markPaid(tx, decision.orderId, 'manual', item.receivedAmount, {
          // Lúc tiền về như IPN đã ghi (Tingee báo, không có thì lúc Tickee nhận); Vé phát theo đồng hồ DB.
          paidAt: item.paidAt ?? item.receivedAt,
          manual: { organizationId: ctx.organizationId, actorUserId: ctx.userId },
        });
        if (result.outcome === 'orphan' && result.reason === ReviewItemReason.SOLD_OUT) {
          // Đơn giữ `review`, mục vẫn `open`; chỉ nhật ký thêm một dòng.
          await this.recordItem(tx, ctx, item, 'review_item.approve_sold_out');
          return 'sold_out';
        }
        if (result.outcome !== 'paid') throw approvalBlocked(result);
        // `markPaid` đã phát `order_changed` + `event_orders_changed`.
        await this.closeItem(tx, ctx, item, ReviewItemResolution.APPROVED, null, 'review_item.approve');
        return 'changed';
      }
      case ReviewAction.REJECT: {
        if (!(await this.decisions.reject(tx, decision))) throw actionNotAllowed();
        // Mục vẫn `open` (ở lại hàng tới khi "Đã hoàn tay"); chi tiết mục đổi (Đơn, thao tác, nhật ký).
        await this.recordItem(tx, ctx, item, 'review_item.reject');
        return 'changed';
      }
      case ReviewAction.REFUND: {
        if (isRefundOnly(item.type)) {
          // Mục chỉ hoàn: chỉ đóng mục; Đơn (kể cả Đơn đã từ chối của mục khác), Vé, doanh thu giữ nguyên.
          await this.closeItem(tx, ctx, item, ReviewItemResolution.REFUNDED, null, 'review_item.refund');
          await this.notifyOrderUnchanged(tx, ctx, item);
        } else {
          // Mục lệch tiền/mồ côi của Đơn đã từ chối (bảng thao tác đã kiểm): Đơn → `refunded`, rồi đóng mục.
          if (!(await this.decisions.refund(tx, decision))) throw actionNotAllowed();
          await this.closeItem(tx, ctx, item, ReviewItemResolution.REFUNDED, null, 'review_item.refund');
        }
        return 'changed';
      }
      case ReviewAction.DISMISS: {
        await this.closeItem(tx, ctx, item, ReviewItemResolution.DISMISSED, request.reason, 'review_item.dismiss');
        await this.notifyOrderUnchanged(tx, ctx, item);
        return 'changed';
      }
    }
  }

  /** CAS `open → resolved` kèm cách xử lý (mục đã khóa: 0 dòng là lỗi lập trình), audit, tín hiệu mục. */
  private async closeItem(
    tx: Tx,
    ctx: AccessContext,
    item: LockedItem,
    resolution: ReviewItemResolution,
    dismissReason: string | null,
    action: AuditAction,
  ): Promise<void> {
    const [closed] = await tx
      .update(reviewItems)
      .set({ status: ReviewItemStatus.RESOLVED, resolution, dismissReason })
      .where(
        and(
          eq(reviewItems.id, item.id),
          eq(reviewItems.organizationId, ctx.organizationId),
          eq(reviewItems.status, ReviewItemStatus.OPEN),
        ),
      )
      .returning({ id: reviewItems.id });
    if (!closed) throw new Error('CAS review_items open → resolved thua dù đã khóa mục');
    await this.recordItem(tx, ctx, item, action);
  }

  /**
   * Audit thao tác trên mục (chỉ id, không giá trị) và `org_review_items_changed` cấp BTC: badge, hàng và `Sheet` đang
   * mở của mọi thành viên tải lại khi `tx` commit.
   */
  private async recordItem(tx: Tx, ctx: AccessContext, item: LockedItem, action: AuditAction): Promise<void> {
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action,
      target: { type: 'review_item', id: item.id },
    });
    await realtime.notifyOrganization(tx, RealtimeTopic.ORG_REVIEW_ITEMS_CHANGED, ctx.organizationId);
  }

  /** Mục đóng mà Đơn không đổi: `event_orders_changed` của Sự kiện của Đơn (Tổng quan đếm mục mở), nếu mục có Đơn. */
  private async notifyOrderUnchanged(tx: Tx, ctx: AccessContext, item: LockedItem): Promise<void> {
    if (!item.orderId) return;
    const order = (await reviewOrdersOf(tx, ctx, [item.orderId])).get(item.orderId);
    if (order) await notifyEventOrdersChanged(tx, { id: order.id, organizationId: ctx.organizationId, eventId: order.eventId });
  }

  /** Trạng thái của mục và Đơn sau thao tác, đọc trong `tx` của thao tác (trước commit), cho toast của web. */
  private async resultOf(tx: Tx, ctx: AccessContext, itemId: string, action: ReviewAction): Promise<ReviewActionResult> {
    const [row] = await tx
      .select({
        status: reviewItems.status,
        resolution: reviewItems.resolution,
        orderId: reviewItems.orderId,
        amount: paymentEvents.paidAmount,
      })
      .from(reviewItems)
      .innerJoin(paymentEvents, eq(paymentEvents.id, reviewItems.paymentEventId))
      .where(and(eq(reviewItems.id, itemId), eq(reviewItems.organizationId, ctx.organizationId)));
    if (!row) throw reviewItemNotFound();
    const order: ReviewOrderRow | undefined = row.orderId
      ? (await reviewOrdersOf(tx, ctx, [row.orderId])).get(row.orderId)
      : undefined;
    return {
      itemId,
      action,
      status: row.status,
      resolution: row.resolution,
      orderCode: order?.code ?? null,
      orderStatus: order?.status ?? null,
      ticketCount: order?.ticketCount ?? 0,
      amount: row.amount,
    };
  }
}
