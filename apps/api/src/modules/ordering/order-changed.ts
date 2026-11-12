import { Logger } from '@nestjs/common';
import { RealtimeTopic } from '@tickee/contracts';
import type { Database, Tx } from '../../platform/db/index.js';
import { dbErrorSummary } from '../../platform/logging/index.js';
import { realtime, type RealtimeIds } from '../../platform/realtime/index.js';
import { orders } from './schema.js';

/** Cột cần cho tín hiệu `order_changed`, để `RETURNING` của mọi CAS đổi Đơn lấy kèm. */
export const orderSignalColumns = { id: orders.id, organizationId: orders.organizationId, eventId: orders.eventId };

/**
 * Phát `order_changed` cho Đơn vừa đổi trạng thái hoặc link (AD-17, Story 3.7), trong chính `tx` của thay đổi: commit thì
 * stream SSE của Người mua nhận tín hiệu và web tải lại `GET /v1/me/orders/:code`; rollback thì không có gì. Gọi ở mọi
 * chỗ đổi Đơn sau TX1 (`markPaid` trừ nguồn `free`, `pending/expired → review`, hết hạn, gắn link); không bao giờ trong
 * TX1 tạo Đơn.
 *
 * Cùng `tx` phát thêm `event_orders_changed` (Story 3.11) cho Tổng quan Sự kiện của Owner/Admin: mọi điểm đổi Đơn sau
 * TX1 đều đi qua đây. Đơn mới (kể cả Đơn 0đ, đã `paid` ngay trong TX1) phát riêng sau khi TX1 commit
 * (`announceOrderCreated`).
 */
export async function notifyOrderChanged(tx: Tx, order: RealtimeIds): Promise<void> {
  await realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, order);
  await notifyEventOrdersChanged(tx, order);
}

/**
 * Phát `event_orders_changed` (payload `{ id Đơn, organizationId, eventId }`) trong `tx`: stream Tổng quan của Sự kiện
 * (`GET /v1/orgs/:orgId/events/:eventId/overview/live`) nhận tín hiệu khi `tx` commit. Không gọi trong TX1 tạo Đơn.
 */
export function notifyEventOrdersChanged(tx: Tx, order: RealtimeIds): Promise<void> {
  return realtime.notify(tx, RealtimeTopic.EVENT_ORDERS_CHANGED, order);
}

const logger = new Logger('OrderSignals');

/**
 * Báo Tổng quan Sự kiện có Đơn mới (Story 3.11), *sau* khi TX1 tạo Đơn đã commit — Đơn có phí lẫn Đơn 0đ (Đơn 0đ đã
 * `paid` trong TX1 mà `markPaid` nguồn `free` không phát gì). AD-17 cấm `NOTIFY` trong TX1: commit có `NOTIFY` phải
 * giành khóa hàng đợi `NOTIFY` toàn cục trong lúc TX1 còn giữ khóa tồn kho. Đây là một transaction riêng chỉ có
 * `pg_notify`, không giữ khóa nào. Lỗi → chỉ log id, không ném: Đơn đã tạo và request vẫn thành công; dashboard tự đúng
 * lại ở lần tải lại kế tiếp (tín hiệu khác, `resync`, tab visible lại).
 */
export async function announceOrderCreated(db: Database, order: RealtimeIds): Promise<void> {
  try {
    await db.transaction((tx) => notifyEventOrdersChanged(tx, order));
  } catch (err) {
    // Lỗi DB chỉ log bản rút gọn (tên lớp, SQLSTATE): message của nó có câu SQL và params.
    logger.warn(
      { orderId: order.id, eventId: order.eventId, err: dbErrorSummary(err) },
      'Không phát được event_orders_changed sau khi tạo Đơn; bỏ qua',
    );
  }
}
