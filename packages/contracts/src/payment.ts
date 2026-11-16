import { z } from 'zod';

import { ORDER_CODE_PATTERN, orderStatusSchema } from './order.js';

// ---------------------------------------------------------------------------------------------------------------
// Cần xử lý: mục `review_items` của `payment` (FR-21, Story 3.6, AD-7)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Mỗi khoản tiền về (IPN `success` hợp lệ, không lặp, mã đúng định dạng Tickee) mà không thành Vé là đúng một mục Cần
 * xử lý của BTC sở hữu `ipnKey`. API (Story 3.6) và hàng Cần xử lý trên web (Story 4.3, 4.4) dùng chung các hằng ở đây.
 */

/**
 * Loại mục:
 * - `amount_mismatch`: số tiền về khác tổng tiền của Đơn.
 * - `orphan`: tiền về muộn mà không phát được Vé (`ReviewItemReason`).
 * - `event_cancelled`: tiền về cho Đơn của Sự kiện đã hủy (mỗi khoản tiền một mục).
 * - `duplicate_payment`: tiền về cho Đơn đã `paid`/`cancelled`/`refunded`/`review` (trả trùng).
 * - `unmatched`: mã đúng định dạng nhưng không có Đơn, hoặc Đơn thuộc BTC khác (không gắn Đơn).
 */
export const ReviewItemType = {
  AMOUNT_MISMATCH: 'amount_mismatch',
  ORPHAN: 'orphan',
  EVENT_CANCELLED: 'event_cancelled',
  DUPLICATE_PAYMENT: 'duplicate_payment',
  UNMATCHED: 'unmatched',
} as const;
export type ReviewItemType = (typeof ReviewItemType)[keyof typeof ReviewItemType];
export const REVIEW_ITEM_TYPES = Object.values(ReviewItemType) as [ReviewItemType, ...ReviewItemType[]];
export const reviewItemTypeSchema = z.enum(ReviewItemType);

/**
 * Lý do của mục `orphan` (chỉ loại này có, và luôn có): `event_ended` — tiền về sau `effective_end_at`; `event_locked` —
 * Đơn đã hết hạn mà Sự kiện hoặc BTC đang bị khóa (không bán lại); `sold_out` — Đơn đã hết hạn, một Hạng vé không còn đủ
 * chỗ để bán lại.
 */
export const ReviewItemReason = {
  EVENT_ENDED: 'event_ended',
  EVENT_LOCKED: 'event_locked',
  SOLD_OUT: 'sold_out',
} as const;
export type ReviewItemReason = (typeof ReviewItemReason)[keyof typeof ReviewItemReason];
export const REVIEW_ITEM_REASONS = Object.values(ReviewItemReason) as [ReviewItemReason, ...ReviewItemReason[]];
export const reviewItemReasonSchema = z.enum(ReviewItemReason);

/** Trạng thái mục: mới tạo `open`; BTC xử lý xong (Story 4.4) → `resolved` kèm `ReviewItemResolution`. */
export const ReviewItemStatus = {
  OPEN: 'open',
  RESOLVED: 'resolved',
} as const;
export type ReviewItemStatus = (typeof ReviewItemStatus)[keyof typeof ReviewItemStatus];
export const REVIEW_ITEM_STATUSES = Object.values(ReviewItemStatus) as [ReviewItemStatus, ...ReviewItemStatus[]];
export const reviewItemStatusSchema = z.enum(ReviewItemStatus);

/** Cách mục được xử lý (có đúng khi `resolved`): duyệt (phát Vé), từ chối, đã hoàn tay, bỏ qua. */
export const ReviewItemResolution = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REFUNDED: 'refunded',
  DISMISSED: 'dismissed',
} as const;
export type ReviewItemResolution = (typeof ReviewItemResolution)[keyof typeof ReviewItemResolution];
export const REVIEW_ITEM_RESOLUTIONS = Object.values(ReviewItemResolution) as [
  ReviewItemResolution,
  ...ReviewItemResolution[],
];
export const reviewItemResolutionSchema = z.enum(ReviewItemResolution);

/**
 * Loại mục không bao giờ phát Vé: chỉ kết thúc bằng `refunded` hoặc `dismissed` (`event_cancelled`: Sự kiện đã hủy thì
 * không duyệt phát Vé được).
 */
export const REFUND_ONLY_REVIEW_ITEM_TYPES: readonly ReviewItemType[] = [
  ReviewItemType.EVENT_CANCELLED,
  ReviewItemType.DUPLICATE_PAYMENT,
  ReviewItemType.UNMATCHED,
];

/** Cách xử lý được phép cho một loại mục. */
export const reviewItemResolutionsFor = (type: ReviewItemType): readonly ReviewItemResolution[] =>
  REFUND_ONLY_REVIEW_ITEM_TYPES.includes(type)
    ? [ReviewItemResolution.REFUNDED, ReviewItemResolution.DISMISSED]
    : REVIEW_ITEM_RESOLUTIONS;

// ---------------------------------------------------------------------------------------------------------------
// Thao tác trên mục Cần xử lý (Story 4.4-a, FR-21, AD-7)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Thao tác của Owner/Admin trên một mục (`POST /v1/orgs/:orgId/review-items/:itemId/{action}`, `review_queue.handle`).
 * Máy chủ tính thao tác được phép (`ReviewItemDetail.actions`), web chỉ hiển thị:
 * - `approve` ("Duyệt tay phát Vé"): mục `amount_mismatch`/`orphan` `open`, Đơn `review` → Đơn `paid` (nguồn `manual`,
 *   `paid_amount` = số tiền nhận của mục), Vé, email Vé; mục `resolved` `approved`.
 * - `reject` ("Từ chối"): cùng điều kiện với `approve` → Đơn `cancelled` (`cancel_reason` `rejected`), email báo Người
 *   mua; mục vẫn `open` (ở lại hàng tới khi "Đã hoàn tay").
 * - `refund` ("Đã hoàn tay"): mục `amount_mismatch`/`orphan` `open` có Đơn `cancelled` (`rejected`) → Đơn `refunded`,
 *   mục `refunded`; mục chỉ hoàn (`REFUND_ONLY_REVIEW_ITEM_TYPES`) `open` → chỉ đóng mục (Đơn, Vé, doanh thu giữ nguyên).
 * - `dismiss` ("Bỏ qua"): chỉ mục chỉ hoàn `open`, kèm lý do (`DismissReviewItemRequest`) → mục `dismissed`.
 */
export const ReviewAction = {
  APPROVE: 'approve',
  REJECT: 'reject',
  REFUND: 'refund',
  DISMISS: 'dismiss',
} as const;
export type ReviewAction = (typeof ReviewAction)[keyof typeof ReviewAction];
export const REVIEW_ACTIONS = Object.values(ReviewAction) as [ReviewAction, ...ReviewAction[]];
export const reviewActionSchema = z.enum(ReviewAction);

/**
 * Lý do "Duyệt tay phát Vé" bị tắt (theo thứ tự kiểm của máy chủ): Sự kiện đã hủy, đã kết thúc (đồng hồ DB quá
 * `effective_end_at`), hoặc đang bị khóa (Sự kiện hay BTC). API từ chối tương ứng bằng `409 EVENT_CANCELLED` /
 * `EVENT_ALREADY_ENDED` / `EVENT_LOCKED`.
 */
export const ReviewApproveBlockedReason = {
  EVENT_CANCELLED: 'event_cancelled',
  EVENT_ENDED: 'event_ended',
  EVENT_LOCKED: 'event_locked',
} as const;
export type ReviewApproveBlockedReason = (typeof ReviewApproveBlockedReason)[keyof typeof ReviewApproveBlockedReason];
export const REVIEW_APPROVE_BLOCKED_REASONS = Object.values(ReviewApproveBlockedReason) as [
  ReviewApproveBlockedReason,
  ...ReviewApproveBlockedReason[],
];
export const reviewApproveBlockedReasonSchema = z.enum(ReviewApproveBlockedReason);

/** Lý do "Bỏ qua": bỏ khoảng trắng hai đầu, 1–300 ký tự (lưu ở `review_items.dismiss_reason`). */
export const DISMISS_REASON_MAX = 300;
export const DismissReason = z.string().trim().min(1).max(DISMISS_REASON_MAX);

/** Body của `POST …/review-items/:itemId/dismiss`. Ba thao tác còn lại không có body. */
export const DismissReviewItemRequest = z.object({ reason: DismissReason });
export type DismissReviewItemRequest = z.input<typeof DismissReviewItemRequest>;

/**
 * `200` của mọi `POST …/review-items/:itemId/{action}`: trạng thái mục và Đơn sau thao tác, đủ để web dựng toast
 * ("Đã phát {n} Vé cho Đơn {mã}.", "Đã hủy Đơn {mã}. …", "Đã ghi nhận hoàn tay {số tiền}.", "Đã bỏ qua mục."). Gửi lại
 * đúng thao tác cho mục đã ở kết quả của thao tác đó trả cùng dạng (trạng thái hiện tại), không làm lại gì.
 * - `orderCode`, `orderStatus`: Đơn của mục; `null` với mục `unmatched`.
 * - `ticketCount`: số Vé của Đơn (tổng số lượng các dòng); 0 khi không có Đơn.
 * - `amount`: số tiền nhận của mục (`payment_events.paid_amount`); `null` khi khoản tiền không ghi số tiền.
 */
export const ReviewActionResult = z.object({
  itemId: z.uuid(),
  action: reviewActionSchema,
  status: reviewItemStatusSchema,
  resolution: reviewItemResolutionSchema.nullable(),
  orderCode: z.string().regex(ORDER_CODE_PATTERN).nullable(),
  orderStatus: orderStatusSchema.nullable(),
  ticketCount: z.number().int().nonnegative(),
  amount: z.number().int().nonnegative().nullable(),
});
export type ReviewActionResult = z.infer<typeof ReviewActionResult>;
