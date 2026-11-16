import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  EventStatus,
  MATCH_CANDIDATES_LIMIT,
  ReviewAction,
  ReviewApproveBlockedReason,
  ReviewItemLogKind,
  ReviewItemType,
  type MatchCandidates,
  type ReviewItemDetail,
  type ReviewItemEvent,
  type ReviewItemLogEntry,
  type ReviewQueue,
  type ReviewQueueSummary,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import { audit, type AuditAction } from '../../platform/audit/index.js';
import { DATABASE, type Database, type DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import {
  assertEventOfOrganization,
  eventNotFound,
  organizationLocked,
  ticketEventsByIds,
  type TicketEventRef,
} from '../event/index.js';
import { matchCandidatesOf, reviewOrdersOf } from '../ordering/index.js';
import { memberNamesOf } from '../organizer/index.js';
import { openReviewCountOf, openReviewItemsOf, reviewActionsFor, reviewItemDetailOf } from '../payment/index.js';

const reviewItemNotFound = () => new AppError(ErrorCode.REVIEW_ITEM_NOT_FOUND, 'Không tìm thấy mục Cần xử lý này.');

const iso = (value: Date): string => value.toISOString();

/** Dòng audit của mục (Story 4.4) → loại dòng nhật ký thao tác. */
const ACTION_LOG_KIND = {
  'review_item.approve': ReviewItemLogKind.APPROVED,
  'review_item.approve_sold_out': ReviewItemLogKind.APPROVE_SOLD_OUT,
  'review_item.reject': ReviewItemLogKind.REJECTED,
  'review_item.refund': ReviewItemLogKind.REFUNDED,
  'review_item.dismiss': ReviewItemLogKind.DISMISSED,
  'review_item.match': ReviewItemLogKind.MATCHED,
  'review_item.match_sold_out': ReviewItemLogKind.MATCH_SOLD_OUT,
} as const satisfies Partial<Record<AuditAction, ReviewItemLogKind>>;
const ITEM_ACTIONS = Object.keys(ACTION_LOG_KIND) as (keyof typeof ACTION_LOG_KIND)[];

/**
 * Lý do Sự kiện không còn cho phát Vé tay ("Duyệt tay phát Vé", Đơn ứng viên của "Ghép với Đơn"), cùng thứ tự kiểm với
 * `markPaid` nguồn `manual`: Sự kiện đã hủy → đã kết thúc (đồng hồ DB quá `effective_end_at`, `ended` đọc từ `event`) →
 * Sự kiện hoặc BTC bị khóa (`organizationLocked` của BTC của Sự kiện). Không có Sự kiện → `null` (API vẫn kiểm lại khi
 * bấm).
 */
function blockedReasonOf(
  event: TicketEventRef | undefined,
  organizationLocked: boolean,
): ReviewApproveBlockedReason | null {
  if (!event) return null;
  if (event.status === EventStatus.CANCELLED) return ReviewApproveBlockedReason.EVENT_CANCELLED;
  if (event.ended) return ReviewApproveBlockedReason.EVENT_ENDED;
  if (event.lockedAt !== null || organizationLocked) return ReviewApproveBlockedReason.EVENT_LOCKED;
  return null;
}

/** `blockedReasonOf` kèm đọc khóa BTC của Sự kiện (chỉ khi cần). */
async function approveBlockedReasonOf(
  db: DbExecutor,
  event: TicketEventRef | undefined,
): Promise<ReviewApproveBlockedReason | null> {
  const reason = blockedReasonOf(event, false);
  if (reason !== null || !event) return reason;
  return blockedReasonOf(event, await organizationLocked(db, { organizationId: event.organizationId }));
}

/**
 * Hàng Cần xử lý của BTC (Story 4.3, FR-21, AD-33): chỉ đọc qua read model của mô-đun sở hữu — `payment` (mục và khoản
 * tiền: `openReviewItemsOf`, `openReviewCountOf`, `reviewItemDetailOf`), `ordering` (Đơn theo lô: `reviewOrdersOf`; Đơn
 * ứng viên của "Ghép với Đơn", Story 4.4-b: `matchCandidatesOf`) và `event` (tên Sự kiện: `ticketEventsByIds`). Ghép ở
 * đây vì `payment` không được gọi `event`. Mọi hàm đọc trong
 * `orgScope` của người gọi; không trả email, SĐT hay trường thô của `payment_events`. Chi tiết mục còn đọc audit của mục
 * (nhật ký thao tác, Story 4.4) và tên thành viên qua `organizer`; thao tác xử lý mục nằm ở `payment`.
 */
@Injectable()
export class ReviewQueueService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Mọi mục `open` của BTC, cũ nhất trước. Có `eventId`: Sự kiện phải thuộc BTC (`404 EVENT_NOT_FOUND`), chỉ giữ mục gắn
   * Đơn của Sự kiện đó (không có `unmatched`), kèm Sự kiện đang lọc.
   */
  async queue(ctx: AccessContext, eventId?: string): Promise<ReviewQueue> {
    const filter = eventId === undefined ? null : await this.eventOf(ctx, eventId);
    const items = await openReviewItemsOf(this.db.orm, ctx);
    const orders = await reviewOrdersOf(
      this.db.orm,
      ctx,
      items.flatMap((item) => (item.orderId ? [item.orderId] : [])),
    );
    const rows = items.flatMap((item) => {
      const order = item.orderId ? orders.get(item.orderId) : undefined;
      if (filter && order?.eventId !== filter.id) return [];
      return [{ item, order }];
    });
    const events = await ticketEventsByIds(
      this.db.orm,
      rows.flatMap(({ order }) => (order ? [order.eventId] : [])),
    );
    return {
      event: filter,
      items: rows.map(({ item, order }) => {
        const event = order ? events.get(order.eventId) : undefined;
        return {
          id: item.id,
          type: item.type,
          receivedAmount: item.receivedAmount,
          createdAt: iso(item.createdAt),
          order: order ? { code: order.code, buyerName: order.buyerName, totalAmount: order.totalAmount } : null,
          event: event ? { id: event.id, name: event.name } : null,
        };
      }),
    };
  }

  /** Số mục `open` của BTC (badge). */
  async summary(ctx: AccessContext): Promise<ReviewQueueSummary> {
    return { openCount: await openReviewCountOf(this.db.orm, ctx) };
  }

  /**
   * Chi tiết một mục ở mọi trạng thái: giao dịch, Đơn liên quan, Sự kiện và nhật ký, cũ trước. Nhật ký dựng từ dữ liệu
   * sẵn có ("Nhận tiền" lúc `paid_at`, không có thì lúc Tickee nhận; "Mở mục" lúc tạo mục) và từ audit của mục (Story
   * 4.4: mỗi thao tác một dòng lúc thao tác, kèm tên thành viên đã làm qua `organizer`; dòng "Bỏ qua" kèm lý do lưu ở
   * mục). Thao tác được phép (`actions`) do `payment.reviewActionsFor` tính trên mục và Đơn; có "Duyệt tay" thì kèm lý
   * do tắt nếu Sự kiện không còn cho duyệt. Id sai dạng, không tồn tại hoặc của BTC khác → `404
   * REVIEW_ITEM_NOT_FOUND`. "Mã Đơn trong giao dịch" chỉ trả cho mục `unmatched`.
   */
  async detail(ctx: AccessContext, itemId: string): Promise<ReviewItemDetail> {
    const row = await reviewItemDetailOf(this.db.orm, ctx, itemId);
    if (!row) throw reviewItemNotFound();
    // Mục `unmatched` đã ghép (Story 4.4-b): Đơn được ghép qua liên kết giao dịch → Đơn.
    const orderId = row.orderId ?? row.matchedOrderId;
    const order = orderId ? (await reviewOrdersOf(this.db.orm, ctx, [orderId])).get(orderId) : undefined;
    const event = order ? (await ticketEventsByIds(this.db.orm, [order.eventId])).get(order.eventId) : undefined;
    const actions = reviewActionsFor({
      type: row.type,
      status: row.status,
      resolution: row.resolution,
      order: order ? { status: order.status, cancelReason: order.cancelReason } : null,
    });
    const approveBlockedReason = actions.includes(ReviewAction.APPROVE)
      ? await approveBlockedReasonOf(this.db.orm, event)
      : null;
    const log: ReviewItemLogEntry[] = [
      { kind: ReviewItemLogKind.PAYMENT_RECEIVED, at: iso(row.paidAt ?? row.receivedAt) },
      { kind: ReviewItemLogKind.ITEM_OPENED, at: iso(row.createdAt) },
      ...(await this.actionLogOf(ctx, row.id, {
        dismissReason: row.dismissReason,
        matchedOrderCode: row.matchedOrderId ? (order?.code ?? null) : null,
      })),
    ];
    // `sort` ổn định: cùng thời điểm thì giữ thứ tự trên ("Nhận tiền", "Mở mục", rồi thao tác theo thứ tự ghi).
    log.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      id: row.id,
      type: row.type,
      reason: row.reason,
      status: row.status,
      resolution: row.resolution,
      createdAt: iso(row.createdAt),
      transaction: {
        receivedAmount: row.receivedAmount,
        transactionCode: row.transactionCode,
        paidAt: row.paidAt ? iso(row.paidAt) : null,
        receivedAt: iso(row.receivedAt),
        paymentMethod: row.paymentMethod,
        providerOrderId: row.type === ReviewItemType.UNMATCHED ? row.providerOrderId : null,
      },
      order: order
        ? {
            code: order.code,
            status: order.status,
            buyerName: order.buyerName,
            ticketCount: order.ticketCount,
            totalAmount: order.totalAmount,
            createdAt: iso(order.createdAt),
          }
        : null,
      event: event ? { id: event.id, name: event.name } : null,
      log,
      actions,
      approveBlockedReason,
    };
  }

  /**
   * Dòng thao tác của mục từ audit (`review_item.*`, chỉ của BTC người xem), cũ trước, kèm tên thành viên đã làm (rỗng
   * khi tài khoản không có tên hoặc không còn là thành viên: web hiện tên chung). Dòng "Bỏ qua" kèm lý do của mục; dòng
   * "Đã ghép với Đơn" kèm mã Đơn được ghép (đọc qua liên kết, audit không chứa giá trị).
   */
  private async actionLogOf(
    ctx: AccessContext,
    itemId: string,
    notes: { dismissReason: string | null; matchedOrderCode: string | null },
  ): Promise<ReviewItemLogEntry[]> {
    const trail = await audit.trailOf(this.db.orm, {
      organizationId: ctx.organizationId,
      target: { type: 'review_item', id: itemId },
      actions: ITEM_ACTIONS,
    });
    if (trail.length === 0) return [];
    const names = await memberNamesOf(
      this.db.orm,
      ctx,
      trail.flatMap((entry) => (entry.actorUserId ? [entry.actorUserId] : [])),
    );
    return trail.map((entry) => {
      const kind = ACTION_LOG_KIND[entry.action as keyof typeof ACTION_LOG_KIND];
      const actorName = entry.actorUserId ? (names.get(entry.actorUserId) ?? '') : '';
      const note =
        kind === ReviewItemLogKind.DISMISSED
          ? notes.dismissReason
          : kind === ReviewItemLogKind.MATCHED
            ? notes.matchedOrderCode
            : null;
      return { kind, at: iso(entry.at), actorName, ...(note !== null ? { note } : {}) };
    });
  }

  /**
   * Đơn ứng viên của "Ghép với Đơn" cho mục `itemId` (Story 4.4-b): Đơn `expired`/`review` của BTC có `total_amount`
   * bằng số tiền nhận, tùy chọn chỉ Sự kiện `eventId`, mới nhất trước, tối đa `MATCH_CANDIDATES_LIMIT` (`truncated` khi
   * còn Đơn khác). Mỗi Đơn kèm Sự kiện (tên hiện tại) và lý do tắt nếu Sự kiện không còn cho phát Vé (đã hủy / đã kết
   * thúc theo đồng hồ DB / bị khóa). Mục lạ, sai dạng hoặc của BTC khác → `404 REVIEW_ITEM_NOT_FOUND`; Sự kiện lạ, sai
   * dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`; mục không có `match` (đã xử lý, không phải `unmatched`) hoặc khoản
   * tiền không ghi số tiền → danh sách rỗng.
   */
  async matchCandidates(ctx: AccessContext, itemId: string, eventId?: string): Promise<MatchCandidates> {
    const row = await reviewItemDetailOf(this.db.orm, ctx, itemId);
    if (!row) throw reviewItemNotFound();
    if (eventId !== undefined) await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const actions = reviewActionsFor({ type: row.type, status: row.status, resolution: row.resolution, order: null });
    if (!actions.includes(ReviewAction.MATCH) || row.receivedAmount === null) return { candidates: [], truncated: false };

    const rows = await matchCandidatesOf(this.db.orm, ctx, {
      amount: row.receivedAmount,
      eventId: eventId?.toLowerCase(),
      limit: MATCH_CANDIDATES_LIMIT + 1,
    });
    const page = rows.slice(0, MATCH_CANDIDATES_LIMIT);
    const events = await ticketEventsByIds(
      this.db.orm,
      page.map((r) => r.eventId),
    );
    // Mọi Đơn ứng viên thuộc BTC người xem: đọc khóa BTC một lần.
    const locked = page.length > 0 && (await organizationLocked(this.db.orm, ctx));
    return {
      candidates: page.flatMap((candidate) => {
        const event = events.get(candidate.eventId);
        if (!event) return [];
        return [
          {
            code: candidate.code,
            buyerName: candidate.buyerName,
            event: { id: event.id, name: event.name },
            status: candidate.status,
            ticketCount: candidate.ticketCount,
            createdAt: iso(candidate.createdAt),
            blockedReason: blockedReasonOf(event, locked),
          },
        ];
      }),
      truncated: rows.length > MATCH_CANDIDATES_LIMIT,
    };
  }

  /** Sự kiện đang lọc: lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`. */
  private async eventOf(ctx: AccessContext, eventId: string): Promise<ReviewItemEvent> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const event = (await ticketEventsByIds(this.db.orm, [eventId])).get(eventId.toLowerCase());
    if (!event) throw eventNotFound();
    return { id: event.id, name: event.name };
  }
}
