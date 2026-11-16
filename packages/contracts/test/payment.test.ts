import { describe, expect, it } from 'vitest';
import {
  DISMISS_REASON_MAX,
  DismissReviewItemRequest,
  REVIEW_ACTIONS,
  REVIEW_APPROVE_BLOCKED_REASONS,
  ReviewActionResult,
  REVIEW_ITEM_REASONS,
  REVIEW_ITEM_RESOLUTIONS,
  REVIEW_ITEM_STATUSES,
  REVIEW_ITEM_TYPES,
  reviewItemResolutionsFor,
  reviewItemTypeSchema,
} from '../src/payment.js';

describe('review_items (Story 3.6)', () => {
  it('hằng khớp CHECK của bảng review_items', () => {
    expect(REVIEW_ITEM_TYPES).toEqual(['amount_mismatch', 'orphan', 'event_cancelled', 'duplicate_payment', 'unmatched']);
    expect(REVIEW_ITEM_REASONS).toEqual(['event_ended', 'event_locked', 'sold_out']);
    expect(REVIEW_ITEM_STATUSES).toEqual(['open', 'resolved']);
    expect(REVIEW_ITEM_RESOLUTIONS).toEqual(['approved', 'rejected', 'refunded', 'dismissed']);
    expect(reviewItemTypeSchema.safeParse('lost_race').success).toBe(false);
  });

  it('event_cancelled, duplicate_payment và unmatched chỉ kết thúc bằng refunded/dismissed; loại khác được mọi cách xử lý', () => {
    for (const type of ['event_cancelled', 'duplicate_payment', 'unmatched'] as const) {
      expect(reviewItemResolutionsFor(type)).toEqual(['refunded', 'dismissed']);
    }
    for (const type of ['amount_mismatch', 'orphan'] as const) {
      expect(reviewItemResolutionsFor(type)).toEqual(REVIEW_ITEM_RESOLUTIONS);
    }
  });
});

describe('thao tác trên mục Cần xử lý (Story 4.4-a)', () => {
  it('bốn thao tác; lý do tắt "Duyệt tay"', () => {
    expect(REVIEW_ACTIONS).toEqual(['approve', 'reject', 'refund', 'dismiss']);
    expect(REVIEW_APPROVE_BLOCKED_REASONS).toEqual(['event_cancelled', 'event_ended', 'event_locked']);
  });

  it('"Bỏ qua": lý do bắt buộc, 1–300 ký tự sau trim', () => {
    expect(DISMISS_REASON_MAX).toBe(300);
    expect(DismissReviewItemRequest.parse({ reason: '  Khách chuyển nhầm  ' })).toEqual({ reason: 'Khách chuyển nhầm' });
    expect(DismissReviewItemRequest.parse({ reason: ` ${'a'.repeat(300)} ` }).reason).toHaveLength(300);
    for (const reason of ['', '   ', 'a'.repeat(301), undefined, 42]) {
      expect(DismissReviewItemRequest.safeParse({ reason }).success, String(reason)).toBe(false);
    }
  });

  it('kết quả thao tác: mã Đơn, số Vé, số tiền (cho toast); mục unmatched không có Đơn', () => {
    const result = {
      itemId: '019a3b2c-0a01-7abc-8def-0123456789ab',
      action: 'approve',
      status: 'resolved',
      resolution: 'approved',
      orderCode: 'TK5R8W1CAB',
      orderStatus: 'paid',
      ticketCount: 2,
      amount: 250_000,
    };
    expect(ReviewActionResult.parse(result)).toEqual(result);
    const unmatched = { ...result, action: 'dismiss', resolution: 'dismissed', orderCode: null, orderStatus: null, ticketCount: 0 };
    expect(ReviewActionResult.parse(unmatched)).toEqual(unmatched);
    expect(ReviewActionResult.safeParse({ ...result, action: 'match' }).success).toBe(false);
    expect(ReviewActionResult.safeParse({ ...result, orderCode: 'TK1' }).success).toBe(false);
  });
});
