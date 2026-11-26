import {
  ReviewItemStatus,
  type ReviewItemReason,
  type ReviewItemResolution,
  type ReviewItemType,
} from '@tickee/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { paymentEvents, reviewItems } from './schema.js';

/*
 * Read model Cần xử lý (Story 3.11, 4.3, AD-33): `reporting` đọc qua các hàm này (xuất từ `index.ts`), không join bảng
 * `review_items`/`payment_events`. Mỗi hàm một câu (không N+1). Hàm theo BTC lọc `orgScope` trên `review_items`; chỉ trả
 * các trường của khoản tiền mà màn BTC cần, không bao giờ `bill_id`, `merchant_id`, `request_id`.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Phạm vi BTC của người xem. */
export type ReviewScope = Pick<AccessContext, 'organizationId'>;

/** Mục Cần xử lý đang mở của một Đơn: loại và số tiền đã nhận của khoản tiền gắn với mục. */
export interface OpenReview {
  type: ReviewItemType;
  /** `payment_events.paid_amount`; `null` khi khoản tiền không ghi số tiền. */
  receivedAmount: number | null;
}

/**
 * Mục `review_items` `open` *cũ nhất* (`created_at`, rồi `id`) của từng Đơn trong `orderIds`, theo id Đơn. Đơn không có
 * mục `open` nào không có trong kết quả. Người gọi truyền id Đơn đã lọc theo BTC.
 */
export async function openReviewsOf(db: DbExecutor, orderIds: readonly string[]): Promise<Map<string, OpenReview>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([reviewItems.orderId], {
      orderId: reviewItems.orderId,
      type: reviewItems.type,
      receivedAmount: paymentEvents.paidAmount,
    })
    .from(reviewItems)
    .innerJoin(paymentEvents, eq(paymentEvents.id, reviewItems.paymentEventId))
    .where(and(inArray(reviewItems.orderId, [...orderIds]), eq(reviewItems.status, ReviewItemStatus.OPEN)))
    .orderBy(asc(reviewItems.orderId), asc(reviewItems.createdAt), asc(reviewItems.id));
  const result = new Map<string, OpenReview>();
  for (const row of rows) {
    if (row.orderId !== null) result.set(row.orderId, { type: row.type, receivedAmount: row.receivedAmount });
  }
  return result;
}

/** Một mục `open` của hàng Cần xử lý cấp BTC (Story 4.3). */
export interface OpenReviewItemRow {
  id: string;
  /** Đơn của mục; `null` đúng khi loại `unmatched`. */
  orderId: string | null;
  type: ReviewItemType;
  /** `payment_events.paid_amount`; `null` khi khoản tiền không ghi số tiền. */
  receivedAmount: number | null;
  createdAt: Date;
}

/**
 * Mọi mục `open` của BTC, cũ nhất trước (`created_at` rồi `id`, tăng dần; index
 * `review_items_organization_id_status_created_at_idx`), kèm số tiền đã nhận. Không phân trang: mục `open` của một BTC
 * thường chỉ vài chục.
 */
export function openReviewItemsOf(db: DbExecutor, scope: ReviewScope): Promise<OpenReviewItemRow[]> {
  return db
    .select({
      id: reviewItems.id,
      orderId: reviewItems.orderId,
      type: reviewItems.type,
      receivedAmount: paymentEvents.paidAmount,
      createdAt: reviewItems.createdAt,
    })
    .from(reviewItems)
    .innerJoin(paymentEvents, eq(paymentEvents.id, reviewItems.paymentEventId))
    .where(and(orgScope(scope)(reviewItems), eq(reviewItems.status, ReviewItemStatus.OPEN)))
    .orderBy(asc(reviewItems.createdAt), asc(reviewItems.id));
}

/** Một mục Cần xử lý của một Đơn (mọi trạng thái): loại, trạng thái, lúc mở mục. */
export interface OrderReviewItemRow {
  type: ReviewItemType;
  status: ReviewItemStatus;
  createdAt: Date;
}

/**
 * Mọi mục Cần xử lý (mọi trạng thái) gắn Đơn `orderId` của BTC `scope`, cũ nhất trước (`created_at` rồi `id`; index
 * `review_items_order_id_idx`): lịch sử Đơn của tab Đơn (Story 6.1). Mục `unmatched` đã ghép không gắn `order_id` nên
 * không có. Một câu.
 */
export function reviewItemsOfOrder(db: DbExecutor, scope: ReviewScope, orderId: string): Promise<OrderReviewItemRow[]> {
  return db
    .select({ type: reviewItems.type, status: reviewItems.status, createdAt: reviewItems.createdAt })
    .from(reviewItems)
    .where(and(orgScope(scope)(reviewItems), eq(reviewItems.orderId, orderId)))
    .orderBy(asc(reviewItems.createdAt), asc(reviewItems.id));
}

/** Số mục `open` của BTC (badge "Cần xử lý"). */
export async function openReviewCountOf(db: DbExecutor, scope: ReviewScope): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(reviewItems)
    .where(and(orgScope(scope)(reviewItems), eq(reviewItems.status, ReviewItemStatus.OPEN)));
  return row?.count ?? 0;
}

/** Chi tiết một mục (mọi trạng thái) và khoản tiền của nó, chỉ các trường màn BTC cần. */
export interface ReviewItemDetailRow {
  id: string;
  orderId: string | null;
  /**
   * Đơn được ghép (Story 4.4-b): `payment_events.order_id` của khoản tiền mục `unmatched` (liên kết ghi khi "Ghép với
   * Đơn"); chưa ghép, hoặc mục loại khác → `null`.
   */
  matchedOrderId: string | null;
  type: ReviewItemType;
  reason: ReviewItemReason | null;
  status: ReviewItemStatus;
  resolution: ReviewItemResolution | null;
  /** Lý do "Bỏ qua" (Story 4.4); có đúng khi `resolution = 'dismissed'`. */
  dismissReason: string | null;
  createdAt: Date;
  /** `payment_events.paid_amount`. */
  receivedAmount: number | null;
  /** `payment_events.provider_transaction_code`. */
  transactionCode: string | null;
  /** Lúc Tingee báo tiền về (`paid_at`); `null` khi IPN không báo. */
  paidAt: Date | null;
  /** Lúc Tickee nhận khoản tiền (`received_at`, đồng hồ DB). */
  receivedAt: Date;
  paymentMethod: string | null;
  /** `payment_events.provider_order_id`: mã Đơn ghi trong giao dịch. */
  providerOrderId: string;
}

/**
 * Mục `itemId` của BTC ở mọi trạng thái; id sai dạng, không tồn tại hoặc của BTC khác → `null` (sai dạng thì không chạm
 * DB). Mục `unmatched` đã ghép kèm Đơn được ghép (`matchedOrderId`, Story 4.4-b).
 */
export async function reviewItemDetailOf(
  db: DbExecutor,
  scope: ReviewScope,
  itemId: string,
): Promise<ReviewItemDetailRow | null> {
  if (!UUID.test(itemId)) return null;
  const [row] = await db
    .select({
      id: reviewItems.id,
      orderId: reviewItems.orderId,
      matchedOrderId: sql<string | null>`CASE WHEN ${reviewItems.type} = 'unmatched' THEN ${paymentEvents.orderId} END`,
      type: reviewItems.type,
      reason: reviewItems.reason,
      status: reviewItems.status,
      resolution: reviewItems.resolution,
      dismissReason: reviewItems.dismissReason,
      createdAt: reviewItems.createdAt,
      receivedAmount: paymentEvents.paidAmount,
      transactionCode: paymentEvents.providerTransactionCode,
      paidAt: paymentEvents.paidAt,
      receivedAt: paymentEvents.receivedAt,
      paymentMethod: paymentEvents.paymentMethod,
      providerOrderId: paymentEvents.providerOrderId,
    })
    .from(reviewItems)
    .innerJoin(paymentEvents, eq(paymentEvents.id, reviewItems.paymentEventId))
    .where(and(orgScope(scope)(reviewItems), eq(reviewItems.id, itemId)));
  return row ?? null;
}
