import { z } from 'zod';

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
