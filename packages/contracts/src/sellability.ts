import { z } from 'zod';

import { EventDateTime, eventStatusSchema } from './event.js';
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
