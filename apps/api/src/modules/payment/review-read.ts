import { ReviewItemStatus, type ReviewItemType } from '@tickee/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../platform/db/index.js';
import { paymentEvents, reviewItems } from './schema.js';

/*
 * Read model Cần xử lý theo Đơn (Story 3.11, AD-33): `reporting` đọc qua hàm này (xuất từ `index.ts`), không join bảng
 * `review_items`/`payment_events`. Một câu cho cả danh sách Đơn (không N+1).
 */

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
