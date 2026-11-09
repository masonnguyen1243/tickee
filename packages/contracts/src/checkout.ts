import { z } from 'zod';

import { MAX_TICKETS_PER_ORDER_MAX } from './event.js';

// ---------------------------------------------------------------------------------------------------------------
// Chọn Vé và vào Checkout (FR-3, FR-12, Story 3.1, AD-19)
// ---------------------------------------------------------------------------------------------------------------

/** Trang Sự kiện công khai của web. */
export const eventPagePath = (slug: string): string => `/e/${encodeURIComponent(slug)}`;

/** Trang Checkout của web (bề mặt Người mua, cần đăng nhập). */
export const checkoutPath = (slug: string): string => `${eventPagePath(slug)}/checkout`;

/**
 * Tham số query mang lựa chọn Vé, ở cả trang Sự kiện (điền sẵn stepper) và Checkout: `items=<ticketTypeId>:<qty>[,…]`.
 * URL là nguồn duy nhất của lựa chọn (AD-19): không lưu trong localStorage hay cookie.
 */
export const SELECTION_PARAM = 'items';

/** Tham số query mang `funnelId` từ "Mua" qua màn đăng nhập tới Checkout (chỉ khi phải đăng nhập). */
export const FUNNEL_ID_PARAM = 'f';

/** Một dòng lựa chọn: Hạng vé và số Vé (1–50). */
export const TicketSelectionItem = z.object({
  ticketTypeId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER_MAX),
});
export type TicketSelectionItem = z.infer<typeof TicketSelectionItem>;

/** Lựa chọn Vé: ít nhất một dòng, không trùng Hạng vé. Giới hạn Vé/Đơn của Sự kiện kiểm ở nơi có `PublicEvent`. */
export const TicketSelection = z
  .array(TicketSelectionItem)
  .min(1)
  .refine((items) => new Set(items.map((i) => i.ticketTypeId)).size === items.length, {
    message: 'Hạng vé bị trùng',
  });
export type TicketSelection = z.infer<typeof TicketSelection>;

/** Số lượng dạng chữ: số nguyên dương thập phân, không dấu, không số 0 đứng đầu. */
const QUANTITY_TEXT = /^[1-9][0-9]*$/;

/**
 * Đọc `items` từ URL. Sai bất kỳ chỗ nào (chuỗi rác, id không phải uuid, số lượng ≤ 0 / không nguyên / > 50, id trùng)
 * → `null`: lựa chọn bị sửa tay sai coi như không có lựa chọn. Giữ thứ tự trong chuỗi.
 */
export function parseSelection(raw: unknown): TicketSelection | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const items: { ticketTypeId: string; quantity: number }[] = [];
  for (const part of raw.split(',')) {
    const [ticketTypeId, quantity, ...rest] = part.split(':');
    if (ticketTypeId === undefined || quantity === undefined || rest.length > 0) return null;
    if (!QUANTITY_TEXT.test(quantity)) return null;
    items.push({ ticketTypeId, quantity: Number(quantity) });
  }
  const parsed = TicketSelection.safeParse(items);
  return parsed.success ? parsed.data : null;
}

/** Ngược của `parseSelection`: `<ticketTypeId>:<qty>,…` theo thứ tự đã cho. */
export function serializeSelection(items: readonly TicketSelectionItem[]): string {
  return items.map((i) => `${i.ticketTypeId}:${i.quantity}`).join(',');
}

// ---------------------------------------------------------------------------------------------------------------
// Phễu mua (SM-C2): `checkout_funnel_events` không PII, không `user_id`
// ---------------------------------------------------------------------------------------------------------------

export const FunnelEventType = {
  /** Bấm "Mua"/"Đăng ký" trên trang Sự kiện. */
  BUY_CLICKED: 'buy_clicked',
  /** Đăng nhập xong và tới Checkout sau một lần "Mua" phải đăng nhập. */
  LOGIN_COMPLETED: 'login_completed',
} as const;
export type FunnelEventType = (typeof FunnelEventType)[keyof typeof FunnelEventType];
/** Loại sự kiện phễu ghi được (CHECK của `checkout_funnel_events.type`). */
export const FUNNEL_EVENT_TYPES = [FunnelEventType.BUY_CLICKED, FunnelEventType.LOGIN_COMPLETED] as const;

/**
 * `POST /v1/events/:slug/funnel-events` (không cần đăng nhập, trả 204). `funnelId` là uuid do trình duyệt sinh lúc bấm
 * "Mua", nối `buy_clicked` với `login_completed`. `loginRequired`: lúc bấm chưa đăng nhập (người đã đăng nhập sẵn
 * không tính vào mẫu số SM-C2). Không nhận trường nào khác (không PII).
 */
export const FunnelEventInput = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal(FunnelEventType.BUY_CLICKED),
    funnelId: z.uuid(),
    loginRequired: z.boolean(),
  }),
  z.strictObject({
    type: z.literal(FunnelEventType.LOGIN_COMPLETED),
    funnelId: z.uuid(),
  }),
]);
export type FunnelEventInput = z.infer<typeof FunnelEventInput>;
