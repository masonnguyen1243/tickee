import { z } from 'zod';

import { EventDateTime } from './event.js';
import {
  BuyerOrderOrganizer,
  buyerOrderStatusSchema,
  ORDER_CODE_PATTERN,
  SHARE_TOKEN_PATTERN,
  TICKET_QR_PATTERN,
} from './order.js';

// ---------------------------------------------------------------------------------------------------------------
// Vé của tôi và Chi tiết Vé (FR-22, FR-24, Story 3.9, AD-13, AD-14, AD-17)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Một nơi gom mọi Vé và Đơn đang chờ của chính Người mua (`buyerScope`): ba nhóm Vé còn hiệu lực · Đơn đang chờ ·
 * Lịch sử, và Chi tiết Vé (Mã QR vé, chia sẻ, biên nhận). Mốc kết thúc của Sự kiện (`effective_end_at`) và hạn Đơn luôn
 * so bằng đồng hồ DB lúc request (AD-14). Danh sách không bao giờ có Mã QR vé: QR chỉ ở Chi tiết Vé.
 */

/** Trang "Vé của tôi" của web (bề mặt Người mua, cần đăng nhập). */
export const MY_TICKETS_PATH = '/tickets';

/** Trang Chi tiết Vé của web: `/tickets/:ticketId`. */
export const myTicketPath = (ticketId: string): string => `${MY_TICKETS_PATH}/${encodeURIComponent(ticketId)}`;

/** `GET /v1/me/tickets` (phiên Người mua), tương đối với gốc `/v1` như mọi đường dẫn web gọi qua `apiRequest`. */
export const MY_TICKETS_API_PATH = '/me/tickets';

/**
 * `GET /v1/me/tickets/live` (SSE, phiên Người mua): chỉ đẩy `order_changed` của các Đơn người gọi sở hữu lúc mở stream
 * (tín hiệu `{ type }`, web tự tải lại `GET /v1/me/tickets`). Đơn tạo sau lúc mở không có trong tập: web mở lại stream
 * khi tập mã Đơn trong danh sách đổi.
 */
export const MY_TICKETS_LIVE_API_PATH = `${MY_TICKETS_API_PATH}/live`;

/** `GET /v1/me/tickets/:ticketId` (phiên Người mua): Chi tiết Vé của chính Người mua. */
export const myTicketApiPath = (ticketId: string): string => `${MY_TICKETS_API_PATH}/${encodeURIComponent(ticketId)}`;

/**
 * Đơn `expired` còn nằm trong nhóm "Đơn đang chờ" chừng này phút sau `expires_at` (đồng hồ DB, Mason chốt 12/11): thẻ
 * hiện "Hết hạn" rồi tự rời nhóm ở lần tải sau mốc đó. Web không bao giờ tự suy ra "Hết hạn".
 */
export const EXPIRED_ORDER_VISIBLE_MINUTES = 30;

/**
 * Trạng thái Vé phía Người mua: `valid` (Hợp lệ), `checked_in` (Đã check-in), `cancelled` (Đã hủy: chính Vé đã hủy, hoặc
 * Sự kiện của Vé đã hủy). Vé đã hủy không bao giờ có Mã QR vé.
 */
export const MyTicketStatus = {
  VALID: 'valid',
  CHECKED_IN: 'checked_in',
  CANCELLED: 'cancelled',
} as const;
export type MyTicketStatus = (typeof MyTicketStatus)[keyof typeof MyTicketStatus];
export const myTicketStatusSchema = z.enum(MyTicketStatus);

/** Sự kiện in trên Vé: tên, giờ bắt đầu và địa điểm hiện tại. */
export const MyTicketEvent = z.object({
  name: z.string(),
  startsAt: EventDateTime,
  venue: z.string().nullable(),
});
export type MyTicketEvent = z.infer<typeof MyTicketEvent>;

/**
 * Một Vé còn hiệu lực (Sự kiện chưa quá `effective_end_at`): Sự kiện, tên Hạng vé đã chụp lúc phát, "Vé k/N", mã Đơn,
 * trạng thái. Không có Mã QR vé hay token link chia sẻ.
 */
export const MyTicketItem = z.object({
  id: z.uuid(),
  event: MyTicketEvent,
  ticketTypeName: z.string(),
  seq: z.number().int().min(1),
  count: z.number().int().min(1),
  orderCode: z.string().regex(ORDER_CODE_PATTERN),
  status: myTicketStatusSchema,
});
export type MyTicketItem = z.infer<typeof MyTicketItem>;

/** Một dòng của Đơn đang chờ: tên Hạng vé đã chụp lúc đặt × số Vé. */
export const MyPendingOrderItem = z.object({
  name: z.string(),
  quantity: z.number().int().min(1),
});
export type MyPendingOrderItem = z.infer<typeof MyPendingOrderItem>;

/**
 * Một Đơn chưa thành Vé (`order-card`, không bao giờ có QR): Đơn chưa `paid` của Sự kiện chưa kết thúc, `buyerStatus` ∈
 * `awaiting_payment` | `confirming` | `under_review` | `cancelled_by_organizer` | `event_cancelled`, cộng Đơn `expired`
 * trong `EXPIRED_ORDER_VISIBLE_MINUTES` phút sau `expires_at`. `buyerStatus` cùng bảng với `BuyerOrderView` (nhận cả chuỗi
 * lạ từ máy chủ mới hơn bản web). Không lộ loại Cần xử lý hay số tiền lệch. `expiresAt` đếm ngược theo
 * `MyTicketsView.serverNow`; `organizer`: tên và kênh liên hệ BTC hiện tại.
 */
export const MyPendingOrder = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  buyerStatus: z.union([buyerOrderStatusSchema, z.string()]),
  event: MyTicketEvent,
  items: z.array(MyPendingOrderItem).min(1),
  totalAmount: z.number().int().min(0),
  expiresAt: EventDateTime,
  organizer: BuyerOrderOrganizer,
});
export type MyPendingOrder = z.infer<typeof MyPendingOrder>;

/**
 * Một Vé đã sang lịch sử (Sự kiện đã quá `effective_end_at`): tên và giờ bắt đầu của Sự kiện, Hạng vé, "Vé k/N" và đã
 * check-in hay chưa (`attended`). Không có QR, không có link chia sẻ.
 */
export const MyTicketHistoryItem = z.object({
  id: z.uuid(),
  eventName: z.string(),
  eventStartsAt: EventDateTime,
  ticketTypeName: z.string(),
  seq: z.number().int().min(1),
  count: z.number().int().min(1),
  attended: z.boolean(),
});
export type MyTicketHistoryItem = z.infer<typeof MyTicketHistoryItem>;

/**
 * `200` của `GET /v1/me/tickets` (`buyerScope`, `cache-control: no-store`): chỉ Đơn và Vé có `user_id` = người gọi, không
 * phân trang. `serverNow`: giờ DB lúc trả lời (đếm ngược của Đơn chờ không theo đồng hồ máy).
 * - `active`: theo giờ Sự kiện tăng dần.
 * - `pending`: Đơn mới nhất trước.
 * - `history`: theo giờ Sự kiện giảm dần.
 */
export const MyTicketsView = z.object({
  serverNow: EventDateTime,
  active: z.array(MyTicketItem),
  pending: z.array(MyPendingOrder),
  history: z.array(MyTicketHistoryItem),
});
export type MyTicketsView = z.infer<typeof MyTicketsView>;

/** Một dòng biên nhận: tên Hạng vé, giá một Vé, số Vé, thành tiền (bản chụp lúc đặt). */
export const MyTicketReceiptLine = z.object({
  name: z.string(),
  unitPrice: z.number().int().min(0),
  quantity: z.number().int().min(1),
  amount: z.number().int().min(0),
});
export type MyTicketReceiptLine = z.infer<typeof MyTicketReceiptLine>;

/**
 * Biên nhận của Đơn đã phát Vé (Mason chốt 12/11): mã Đơn, các dòng, tổng đã trả (Đơn 0đ: web ghi "Miễn phí"), thời điểm
 * thanh toán (`null` chỉ khi dữ liệu cũ thiếu). Web ghi "Tiền đã chuyển thẳng cho {BTC}" (tên BTC ở
 * `MyTicketDetail.organizer`) cho Đơn có phí.
 */
export const MyTicketReceipt = z.object({
  orderCode: z.string().regex(ORDER_CODE_PATTERN),
  items: z.array(MyTicketReceiptLine).min(1),
  totalAmount: z.number().int().min(0),
  paidAt: EventDateTime.nullable(),
});
export type MyTicketReceipt = z.infer<typeof MyTicketReceipt>;

/**
 * `200` của `GET /v1/me/tickets/:ticketId` (`buyerScope`, `cache-control: no-store`). Vé không thuộc người gọi, hoặc id
 * sai dạng → `404 TICKET_NOT_FOUND`.
 * - `status`: như `MyTicketItem.status`; `attended`: Vé đã check-in (kể cả Vé hủy sau đó).
 * - `eventCancelled`: Sự kiện đã hủy (web ghi "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền." thay cho kênh liên hệ BTC).
 * - `ended`: đồng hồ DB đã quá `effective_end_at` (web chỉ hiện hàng lịch sử).
 * - `qr`, `shareToken`: chỉ khi Vé `valid`/`checked_in`, Sự kiện chưa hủy và chưa kết thúc; ngược lại cả hai `null` (máy
 *   chủ không ký QR).
 * - `organizer`: tên và kênh liên hệ BTC hiện tại; `receipt`: biên nhận của Đơn (có cả khi Vé đã sang lịch sử).
 */
export const MyTicketDetail = z.object({
  id: z.uuid(),
  event: MyTicketEvent,
  ticketTypeName: z.string(),
  seq: z.number().int().min(1),
  count: z.number().int().min(1),
  holderName: z.string(),
  status: myTicketStatusSchema,
  attended: z.boolean(),
  eventCancelled: z.boolean(),
  ended: z.boolean(),
  qr: z.string().regex(TICKET_QR_PATTERN).nullable(),
  shareToken: z.string().regex(SHARE_TOKEN_PATTERN).nullable(),
  organizer: BuyerOrderOrganizer,
  receipt: MyTicketReceipt,
});
export type MyTicketDetail = z.infer<typeof MyTicketDetail>;
