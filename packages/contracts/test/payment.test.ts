import { describe, expect, it } from 'vitest';
import {
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
