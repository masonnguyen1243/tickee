import { z } from 'zod';

import {
  EventDateTime,
  EventInputDateTime,
  MAX_TICKETS_PER_ORDER_MAX,
  MAX_TICKETS_PER_ORDER_MIN,
  optionalText,
} from './event.js';

// ---------------------------------------------------------------------------------------------------------------
// Hạng vé và tồn kho (FR-7, Story 2.8)
// ---------------------------------------------------------------------------------------------------------------

/** Giá tối thiểu (đồng) của Hạng vé có phí: giá > 0 và < 2.000đ bị từ chối; 0đ là Hạng vé miễn phí. */
export const MIN_PAID_PRICE = 2_000;
/** Giá tối đa (đồng) của một Hạng vé. */
export const TICKET_TYPE_PRICE_MAX = 100_000_000;
/** Số suất tối đa của một Hạng vé. */
export const TICKET_TYPE_CAPACITY_MAX = 100_000;
/** Sự kiện miễn phí (mọi Hạng vé 0đ): tổng số suất tối đa. */
export const FREE_EVENT_TICKET_CAP = 200;
export const TICKET_TYPE_NAME_MAX = 100;
export const TICKET_TYPE_DESCRIPTION_MAX = 2_000;

/** Giờ mở/đóng bán: thiếu hoặc `null` → `null` (bỏ trống giờ mở = bán ngay khi mở bán; giờ đóng = đến khi kết thúc). */
const optionalSaleTime = EventInputDateTime.nullish().transform((v) => v ?? null);

/** Giá hợp lệ khi là 0đ (miễn phí) hoặc ≥ `MIN_PAID_PRICE`. */
export const isAllowedTicketPrice = (price: number): boolean => price === 0 || price >= MIN_PAID_PRICE;

/** Giờ đóng sau giờ mở khi có cả hai (giờ sai dạng đã lỗi ở chính trường đó, không báo thêm ở đây). */
function saleWindowValid(start: string | null, end: string | null): boolean {
  const s = start ? Date.parse(start) : NaN;
  const e = end ? Date.parse(end) : NaN;
  return Number.isNaN(s) || Number.isNaN(e) || e > s;
}

/**
 * `POST /v1/orgs/:orgId/events/:eventId/ticket-types` và `PATCH …/ticket-types/:ticketTypeId` (thay toàn bộ các trường
 * dưới đây). Giá là số nguyên đồng; giá > 0 và < 2.000đ lỗi ở `price`; có cả hai giờ bán thì giờ đóng phải sau giờ mở
 * (lỗi ở `saleEndsAt`).
 */
export const TicketTypeInput = z
  .object({
    name: z.string().trim().min(1).max(TICKET_TYPE_NAME_MAX),
    description: optionalText(TICKET_TYPE_DESCRIPTION_MAX),
    price: z.number().int().min(0).max(TICKET_TYPE_PRICE_MAX),
    capacity: z.number().int().min(1).max(TICKET_TYPE_CAPACITY_MAX),
    saleStartsAt: optionalSaleTime,
    saleEndsAt: optionalSaleTime,
  })
  // Giá âm đã lỗi ở `min(0)`: không báo trùng ở đây.
  .refine((v) => v.price < 0 || isAllowedTicketPrice(v.price), {
    path: ['price'],
    message: `giá phải là 0 hoặc ≥ ${MIN_PAID_PRICE}`,
  })
  .refine((v) => saleWindowValid(v.saleStartsAt, v.saleEndsAt), {
    path: ['saleEndsAt'],
    message: 'saleEndsAt phải sau saleStartsAt',
  });
export type TicketTypeInput = z.input<typeof TicketTypeInput>;

/** Các trường của `TicketTypeInput`, theo thứ tự (cũng là tên trường trong `changedFields` của `ticket_type.updated`). */
export const TICKET_TYPE_FIELDS = ['name', 'description', 'price', 'capacity', 'saleStartsAt', 'saleEndsAt'] as const;
export type TicketTypeField = (typeof TICKET_TYPE_FIELDS)[number];

/** Một Hạng vé kèm tồn kho (`sold`: đã bán, `held`: đang Giữ chỗ). */
export const TicketTypeDetail = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().int(),
  capacity: z.number().int(),
  saleStartsAt: EventDateTime.nullable(),
  saleEndsAt: EventDateTime.nullable(),
  sold: z.number().int(),
  held: z.number().int(),
  createdAt: EventDateTime,
  updatedAt: EventDateTime,
});
export type TicketTypeDetail = z.infer<typeof TicketTypeDetail>;

/** `GET /v1/orgs/:orgId/events/:eventId/ticket-types`: tạo trước đứng trước. */
export const TicketTypeList = z.array(TicketTypeDetail);
export type TicketTypeList = z.infer<typeof TicketTypeList>;

/** `PATCH /v1/orgs/:orgId/events/:eventId/order-limit` (trả `EventDetail`). */
export const EventOrderLimitInput = z.object({
  maxTicketsPerOrder: z.number().int().min(MAX_TICKETS_PER_ORDER_MIN).max(MAX_TICKETS_PER_ORDER_MAX),
});
export type EventOrderLimitInput = z.infer<typeof EventOrderLimitInput>;

/** `details` của `409 CAPACITY_BELOW_COMMITTED`: số suất tối thiểu = đã bán + đang Giữ chỗ. */
export const CapacityBelowCommittedDetails = z.object({ minimum: z.number().int() });
export type CapacityBelowCommittedDetails = z.infer<typeof CapacityBelowCommittedDetails>;

/** `details` của `409 FREE_EVENT_CAPACITY_EXCEEDED`: trần Vé của Sự kiện miễn phí. */
export const FreeEventCapacityExceededDetails = z.object({ limit: z.number().int() });
export type FreeEventCapacityExceededDetails = z.infer<typeof FreeEventCapacityExceededDetails>;

/**
 * Sự kiện miễn phí vượt trần: mọi Hạng vé 0đ và tổng số suất > `FREE_EVENT_TICKET_CAP`. Không có Hạng vé nào → `false`.
 */
export function exceedsFreeEventCap(ticketTypes: readonly { price: number; capacity: number }[]): boolean {
  if (ticketTypes.length === 0 || ticketTypes.some((t) => t.price > 0)) return false;
  return ticketTypes.reduce((sum, t) => sum + t.capacity, 0) > FREE_EVENT_TICKET_CAP;
}
