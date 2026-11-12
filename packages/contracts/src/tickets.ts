import { z } from 'zod';

import { EventDateTime } from './event.js';
import { SHARE_TOKEN_PATTERN, TICKET_QR_PATTERN } from './order.js';

// ---------------------------------------------------------------------------------------------------------------
// Link chia sẻ Vé (FR-22, FR-23, Story 3.8, AD-29)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Mỗi Vé có một link chia sẻ khó đoán: `{WEB_ORIGIN}/xem-ve#<token>`. Token (128 bit, base64url 22 ký tự) do máy chủ suy
 * ra bằng khóa bí mật từ id Vé và phiên bản link (`tickets.share_version`); DB chỉ lưu hash. Token nằm sau `#` nên không
 * tới server web, không vào log web hay header `Referer`; trang `/xem-ve` đọc token ở trình duyệt rồi gọi
 * `GET /v1/shared-tickets/:token` (không đăng nhập, không kèm cookie). Chủ Vé "Tạo lại link" thì link cũ chết ngay, Mã QR
 * vé không đổi.
 */

/** Trang xem Vé được chia sẻ của web (công khai, token sau `#`). */
export const SHARED_TICKET_PATH = '/xem-ve';

/** Link chia sẻ Vé: `{webOrigin}/xem-ve#<token>` (bỏ `/` thừa ở cuối origin). */
export const sharedTicketUrl = (webOrigin: string, token: string): string =>
  `${webOrigin.replace(/\/+$/, '')}${SHARED_TICKET_PATH}#${token}`;

/** `GET /v1/shared-tickets/:token` (công khai), tương đối với gốc `/v1` như mọi đường dẫn web gọi qua `apiRequest`. */
export const sharedTicketApiPath = (token: string): string => `/shared-tickets/${encodeURIComponent(token)}`;

/** `POST /v1/me/tickets/:ticketId/share-link` (chủ Vé): tạo lại link chia sẻ, link cũ chết ngay. */
export const ticketShareLinkApiPath = (ticketId: string): string =>
  `/me/tickets/${encodeURIComponent(ticketId)}/share-link`;

/** Trạng thái Vé trên trang chia sẻ: còn hợp lệ, hoặc đã check-in (QR mờ + badge "Đã check-in"). */
export const SharedTicketStatus = {
  VALID: 'valid',
  CHECKED_IN: 'checked_in',
} as const;
export type SharedTicketStatus = (typeof SharedTicketStatus)[keyof typeof SharedTicketStatus];
export const sharedTicketStatusSchema = z.enum(SharedTicketStatus);

/**
 * `200` của `GET /v1/shared-tickets/:token` (`shareScope`, `cache-control: no-store`): đúng một Vé, gồm tên, giờ bắt đầu
 * và địa điểm hiện tại của Sự kiện, tên Hạng vé đã chụp lúc phát, "Vé k/N" (`seq`/`count`), trạng thái và Mã QR vé.
 * Không bao giờ có tên, SĐT, email Người mua, mã Đơn hay id user. Token sai dạng hoặc không khớp, Vé đã hủy, Sự kiện đã
 * hủy, hay giờ máy chủ đã quá `effective_end_at` → cùng một `404 SHARED_TICKET_NOT_FOUND`.
 */
export const SharedTicketView = z.object({
  eventName: z.string(),
  eventStartsAt: EventDateTime,
  venue: z.string().nullable(),
  ticketTypeName: z.string(),
  seq: z.number().int().min(1),
  count: z.number().int().min(1),
  status: sharedTicketStatusSchema,
  qr: z.string().regex(TICKET_QR_PATTERN),
});
export type SharedTicketView = z.infer<typeof SharedTicketView>;

/** `200` của `POST /v1/me/tickets/:ticketId/share-link`: token của link mới (`sharedTicketUrl` dựng link). */
export const TicketShareLink = z.object({ shareToken: z.string().regex(SHARE_TOKEN_PATTERN) });
export type TicketShareLink = z.infer<typeof TicketShareLink>;
