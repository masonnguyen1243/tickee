import { z } from 'zod';

import { EventDateTime, eventStatusSchema, MAX_TICKETS_PER_ORDER_MAX, MAX_TICKETS_PER_ORDER_MIN } from './event.js';
import { PublicTicketType } from './ticket-type.js';

// ---------------------------------------------------------------------------------------------------------------
// Trang Sự kiện công khai và trạng thái bán (FR-7, Story 2.11-a, AD-21)
// ---------------------------------------------------------------------------------------------------------------

/**
 * `GET /v1/events/:slug` (không cần đăng nhập): phần tĩnh của trang Sự kiện. Sự kiện nháp và slug không tồn tại cùng
 * trả `404 EVENT_NOT_FOUND`; Sự kiện `hidden`, `cancelled` hoặc bị khóa vẫn trả 200 (Ẩn vẫn mở được bằng link). Không
 * chứa số vé: số vé còn lại và trạng thái bán lấy từ `GET /v1/events/:slug/availability`.
 */
export const PublicEvent = z.object({
  slug: z.string(),
  name: z.string(),
  status: eventStatusSchema,
  startsAt: EventDateTime,
  endsAt: EventDateTime,
  venue: z.string().nullable(),
  description: z.string().nullable(),
  refundPolicy: z.string().nullable(),
  /** Tên BTC. */
  organizationName: z.string(),
  /** Giới hạn Vé/Đơn (Story 2.8): trần tổng số Vé chọn được ở trang Sự kiện và Checkout (Story 3.1). */
  maxTicketsPerOrder: z.number().int().min(MAX_TICKETS_PER_ORDER_MIN).max(MAX_TICKETS_PER_ORDER_MAX),
  /** Hạng vé, tạo trước đứng trước. */
  ticketTypes: z.array(PublicTicketType),
});
export type PublicEvent = z.infer<typeof PublicEvent>;

/** Trạng thái bán của một Hạng vé. `unavailable`: cả Sự kiện không bán (xem `EventSaleReason`). */
export const TierSaleStatus = {
  ON_SALE: 'on_sale',
  NOT_STARTED: 'not_started',
  CLOSED: 'closed',
  SOLD_OUT: 'sold_out',
  PAUSED: 'paused',
  UNAVAILABLE: 'unavailable',
} as const;
export type TierSaleStatus = (typeof TierSaleStatus)[keyof typeof TierSaleStatus];
export const tierSaleStatusSchema = z.enum(TierSaleStatus);

/**
 * Lý do cấp Sự kiện, theo thứ tự ưu tiên (có nhiều lý do thì lấy lý do đứng trước). Bốn lý do đầu làm mọi Hạng vé
 * `unavailable`; `paused` nghĩa là có ít nhất một Hạng vé "Tạm ngừng bán". "Đã kết thúc" thắng "Ẩn" (Story 2.12): Sự
 * kiện ẩn đã kết thúc (bấm tay hoặc tự hết giờ) trả `ended`.
 */
export const EventSaleReason = {
  CANCELLED: 'cancelled',
  LOCKED: 'locked',
  ENDED: 'ended',
  HIDDEN: 'hidden',
  PAUSED: 'paused',
} as const;
export type EventSaleReason = (typeof EventSaleReason)[keyof typeof EventSaleReason];
export const eventSaleReasonSchema = z.enum(EventSaleReason);

/** Thứ tự ưu tiên của `EventSaleReason`. */
export const EVENT_SALE_REASON_ORDER: readonly EventSaleReason[] = Object.values(EventSaleReason);

/** Lý do làm mọi Hạng vé `unavailable`. */
export const EVENT_UNAVAILABLE_REASONS: readonly EventSaleReason[] = [
  EventSaleReason.CANCELLED,
  EventSaleReason.LOCKED,
  EventSaleReason.ENDED,
  EventSaleReason.HIDDEN,
];

export const TierAvailability = z.object({
  ticketTypeId: z.uuid(),
  status: tierSaleStatusSchema,
  /** Số vé còn bán được (`capacity − sold − held`, không âm). */
  remaining: z.number().int().min(0),
  saleStartsAt: EventDateTime.nullable(),
});
export type TierAvailability = z.infer<typeof TierAvailability>;

/** `GET /v1/events/:slug/availability` (không cần đăng nhập, cache tối đa 2 giây). Hạng vé tạo trước đứng trước. */
export const EventAvailability = z.object({
  eventReason: eventSaleReasonSchema.nullable(),
  tiers: z.array(TierAvailability),
});
export type EventAvailability = z.infer<typeof EventAvailability>;

// ---------------------------------------------------------------------------------------------------------------
// Trạng thái bán trên dashboard BTC (Story 4.2-c, retro Epic 2 C5)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Trạng thái bán cấp Sự kiện của một Sự kiện đã mở bán. `reason` = `eventReason` của cùng luật bán với trang công khai,
 * tạo Đơn và chốt link (AD-21), tính theo đồng hồ DB; `null` = đang mở bán. `partial`: `reason` là `paused` mà còn ít
 * nhất một Hạng vé `on_sale` (vd. Hạng vé 0đ vẫn bán khi dịch vụ thanh toán của BTC bị ngắt), khớp câu "một phần" của
 * trang công khai; Hạng vé còn lại hết vé, chưa mở hay đã đóng thì `false`, lý do khác luôn `false`.
 */
export const EventSaleStatus = z.object({
  eventId: z.uuid(),
  reason: eventSaleReasonSchema.nullable(),
  partial: z.boolean(),
});
export type EventSaleStatus = z.infer<typeof EventSaleStatus>;

/**
 * `GET /v1/orgs/:orgId/event-sale-status` (Owner và Admin, `events.manage`): trạng thái bán của mọi Sự kiện không còn nháp
 * của BTC. Sự kiện nháp không có trong danh sách (web tự hiện "Nháp").
 */
export const EventSaleStatusList = z.object({ events: z.array(EventSaleStatus) });
export type EventSaleStatusList = z.infer<typeof EventSaleStatusList>;

/** Đường API (sau `/v1`) của `EventSaleStatusList` một BTC. */
export const eventSaleStatusApiPath = (organizationId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/event-sale-status`;
