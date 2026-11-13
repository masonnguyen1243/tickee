/*
 * Câu trạng thái Đơn phía Người mua (Story 3.7), dùng chung cho Trang Đơn (`order-view.tsx`) và `order-card` của "Vé của
 * tôi" (Story 3.9): một trạng thái chỉ có một câu ở mọi nơi.
 */

/**
 * Đơn hết hạn `sales_paused`: dịch vụ thanh toán của BTC tạm ngừng (Tingee từ chối tạo link), hoặc chốt link của E3-2
 * chặn (Sự kiện Kết thúc, Ẩn, bị khóa, đã hủy, hoặc BTC mất điều kiện bán Vé có phí). Sự kiện đã kết thúc thì Trang Đơn
 * hiện câu đã kết thúc thay câu này.
 */
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
/**
 * Đơn chưa trả (`awaiting_payment`/`confirming`/`expired`) mà Sự kiện đã kết thúc (E3-2): không màn thanh toán, không
 * "Thử lại", không "Mua lại"; kèm liên hệ BTC.
 */
export const EVENT_ENDED_UNPAID = 'Sự kiện đã kết thúc. Đơn này không thanh toán được nữa.';
/** Đồng hồ Giữ chỗ về 0 (hoặc máy chủ báo `confirming`) mà Đơn có link vẫn chờ: không tự hiện Hết hạn. */
export const CONFIRMING_PAYMENT = 'Đang xác nhận thanh toán';
