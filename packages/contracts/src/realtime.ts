import { z } from 'zod';

// ---------------------------------------------------------------------------------------------------------------
// Realtime: tín hiệu, không phải dữ liệu (AD-17, Story 3.7)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Máy chủ phát Postgres `NOTIFY` trong cùng transaction với thay đổi (`realtime.notify(tx, topic, ids)`); mỗi instance
 * api giữ một kết nối `LISTEN`, lọc theo phạm vi của từng người đăng ký rồi đẩy SSE. Trình duyệt chỉ nhận `{ type }`,
 * coi mỗi tín hiệu là lời nhắc tải lại REST (REST là sự thật).
 */

/**
 * Danh mục topic (AD-17). Ai được đăng ký và REST cần tải lại:
 * - `order_changed`: Người mua của Đơn (`buyerScope`) → `GET /v1/me/orders/:code` (Story 3.7) và `GET /v1/me/tickets`
 *   (Story 3.9).
 * - `event_orders_changed`: Owner, Admin → Đơn gần đây, số liệu Sự kiện (Story 3.11).
 * - `event_checkins_changed`: Owner, Admin, CTV được giao → số liệu check-in.
 * - `org_review_items_changed`: Owner, Admin → số mục Cần xử lý.
 * - `org_status_changed`: thành viên BTC → `notices`, vai trò.
 */
export const RealtimeTopic = {
  ORDER_CHANGED: 'order_changed',
  EVENT_ORDERS_CHANGED: 'event_orders_changed',
  EVENT_CHECKINS_CHANGED: 'event_checkins_changed',
  ORG_REVIEW_ITEMS_CHANGED: 'org_review_items_changed',
  ORG_STATUS_CHANGED: 'org_status_changed',
} as const;
export type RealtimeTopic = (typeof RealtimeTopic)[keyof typeof RealtimeTopic];
export const REALTIME_TOPICS = Object.values(RealtimeTopic) as [RealtimeTopic, ...RealtimeTopic[]];
export const realtimeTopicSchema = z.enum(RealtimeTopic);

/**
 * Payload của `NOTIFY` (chỉ giữa các tiến trình của Tickee, không bao giờ tới trình duyệt): loại thay đổi, id đối tượng
 * đổi (vd. id Đơn), BTC và Sự kiện của nó. Không có PII, không có trạng thái: người đăng ký tự tải lại REST. Hub lọc
 * theo các id này sau khi đã kiểm quyền lúc mở stream.
 */
export const RealtimeSignal = z.strictObject({
  type: realtimeTopicSchema,
  id: z.uuid(),
  organizationId: z.uuid(),
  eventId: z.uuid(),
});
export type RealtimeSignal = z.infer<typeof RealtimeSignal>;

/**
 * Tín hiệu hub gửi mọi stream đang mở khi vừa nối lại `LISTEN` sau khi mất kết nối: tín hiệu trong khoảng mất kết nối đã
 * mất, nên người đăng ký tải lại REST một lần.
 */
export const REALTIME_RESYNC = 'resync';

/**
 * Dữ liệu một tin SSE (`data:` của sự kiện mặc định `message`): chỉ `{ type }` — topic của tín hiệu, hoặc
 * `REALTIME_RESYNC`. Trình duyệt không đọc gì khác; loại lạ vẫn là lời nhắc tải lại.
 */
export const RealtimeStreamMessage = z.object({ type: z.string() });
export type RealtimeStreamMessage = z.infer<typeof RealtimeStreamMessage>;

/** Heartbeat SSE: một dòng comment (`: …`) mỗi chừng này giây để proxy và trình duyệt không cắt kết nối rảnh. */
export const REALTIME_HEARTBEAT_SECONDS = 25;
