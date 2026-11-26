import type { AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { reviewOrdersOf } from '../ordering/index.js';
import { openReviewItemsOf, type OpenReviewItemRow } from '../payment/index.js';

/**
 * Mục Cần xử lý `open` gắn Đơn của Sự kiện `eventId` (mọi trạng thái Đơn, vd. trả trùng cho Đơn `paid`), cũ nhất trước.
 * Một cách lấy cho cả `needs-action-card` (số mục, Story 4.3) và chip "Cần xử lý" của tab Đơn (id Đơn, Story 6.1), nên
 * danh sách khớp số trên thẻ. Mục `open` của một BTC chỉ vài chục: đọc cả hàng của BTC (`payment`), rồi Sự kiện của
 * các Đơn đó theo lô (`ordering`), lọc theo Sự kiện. Hai câu, không join bảng của mô-đun khác.
 */
export async function eventOpenReviewItemsOf(
  db: DbExecutor,
  ctx: Pick<AccessContext, 'organizationId'>,
  eventId: string,
): Promise<OpenReviewItemRow[]> {
  const items = await openReviewItemsOf(db, ctx);
  const orders = await reviewOrdersOf(
    db,
    ctx,
    items.flatMap((item) => (item.orderId ? [item.orderId] : [])),
  );
  const event = eventId.toLowerCase();
  return items.filter((item) => item.orderId !== null && orders.get(item.orderId)?.eventId === event);
}
