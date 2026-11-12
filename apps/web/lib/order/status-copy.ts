/*
 * Câu trạng thái Đơn phía Người mua (Story 3.7), dùng chung cho Trang Đơn (`order-view.tsx`) và `order-card` của "Vé của
 * tôi" (Story 3.9): một trạng thái chỉ có một câu ở mọi nơi.
 */

/** Đơn hết hạn vì dịch vụ thanh toán của BTC tạm ngừng (Tingee từ chối tạo link). */
export const SALES_PAUSED = 'Sự kiện tạm ngừng bán. Bạn thử lại sau nhé.';
/** Đơn `expired` (máy chủ báo): chỗ đã trả lại. */
export const HOLD_EXPIRED = 'Hết thời gian giữ chỗ. Chỗ đã được trả lại.';
/** `under_review`: mọi loại Cần xử lý cùng một câu (không lộ loại hay số tiền lệch). */
export const UNDER_REVIEW = 'BTC đang kiểm tra thanh toán';
/** `cancelled_by_organizer`. */
export const CANCELLED_BY_ORGANIZER = 'BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển.';
/** `event_cancelled`. */
export const EVENT_CANCELLED = 'Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền.';
/** `buyerStatus` lạ (máy chủ mới hơn bản web): trạng thái an toàn, không bao giờ trống hay kẹt. */
export const UNKNOWN_STATUS = 'Chúng tôi đang cập nhật trạng thái Đơn.';
/** Đồng hồ Giữ chỗ về 0 (hoặc máy chủ báo `confirming`) mà Đơn có link vẫn chờ: không tự hiện Hết hạn. */
export const CONFIRMING_PAYMENT = 'Đang xác nhận thanh toán';
