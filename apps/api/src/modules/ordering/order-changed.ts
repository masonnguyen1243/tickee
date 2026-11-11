import { RealtimeTopic } from '@tickee/contracts';
import type { Tx } from '../../platform/db/index.js';
import { realtime, type RealtimeIds } from '../../platform/realtime/index.js';
import { orders } from './schema.js';

/** Cột cần cho tín hiệu `order_changed`, để `RETURNING` của mọi CAS đổi Đơn lấy kèm. */
export const orderSignalColumns = { id: orders.id, organizationId: orders.organizationId, eventId: orders.eventId };

/**
 * Phát `order_changed` cho Đơn vừa đổi trạng thái hoặc link (AD-17, Story 3.7), trong chính `tx` của thay đổi: commit thì
 * stream SSE của Người mua nhận tín hiệu và web tải lại `GET /v1/me/orders/:code`; rollback thì không có gì. Gọi ở mọi
 * chỗ đổi Đơn sau TX1 (`markPaid` trừ nguồn `free`, `pending/expired → review`, hết hạn, gắn link); không bao giờ trong
 * TX1 tạo Đơn.
 */
export function notifyOrderChanged(tx: Tx, order: RealtimeIds): Promise<void> {
  return realtime.notify(tx, RealtimeTopic.ORDER_CHANGED, order);
}
