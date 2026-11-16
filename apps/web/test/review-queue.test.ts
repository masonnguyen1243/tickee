import { ReviewItemReason, ReviewItemType } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import {
  REVIEW_QUEUE_POLL_MS,
  reviewItemQueryKey,
  reviewQueueQueryKey,
  reviewQueueQueryPrefix,
  reviewQueueSummaryQueryKey,
} from '@/lib/reporting/api';
import {
  amountLine,
  amountSegments,
  EMPTY_VALUE,
  eventFilterLabel,
  paymentMethodLabel,
  REVIEW_QUEUE_EMPTY,
  REVIEW_REASON_LABEL,
  reviewLogLabel,
  reviewReasonLine,
  reviewTypeBadge,
  UNMATCHED_ORDER_LABEL,
} from '@/lib/reporting/review-queue';

/* Story 4.3: nhãn, dòng số tiền và nhật ký của hàng Cần xử lý (`needs-action-row`, `Sheet`). */

describe('needs-action-row', () => {
  it('badge loại: tên loại, tone danger cho cả 5 loại', () => {
    const labels: [ReviewItemType, string][] = [
      ['amount_mismatch', 'Lệch số tiền'],
      ['orphan', 'Thanh toán mồ côi'],
      ['unmatched', 'Giao dịch chưa khớp'],
      ['duplicate_payment', 'Thanh toán trùng'],
      ['event_cancelled', 'Sự kiện đã hủy'],
    ];
    for (const [type, label] of labels) expect(reviewTypeBadge(type), type).toEqual({ label, tone: 'danger' });
  });

  it('lệch số tiền: "nhận 250.000đ / Đơn 300.000đ", phần chênh tô danger', () => {
    expect(amountLine(250_000, 300_000)).toBe('nhận 250.000đ / Đơn 300.000đ');
    expect(amountSegments(250_000, 300_000)).toEqual([
      { text: 'nhận 250.000đ', danger: true },
      { text: ' / ', danger: false },
      { text: 'Đơn 300.000đ', danger: false },
    ]);
  });

  it('hai số bằng nhau (trả trùng, mồ côi) → không tô; thiếu một số → chỉ số còn lại, không tô', () => {
    expect(amountSegments(300_000, 300_000).some((s) => s.danger)).toBe(false);
    expect(amountLine(300_000, 300_000)).toBe('nhận 300.000đ / Đơn 300.000đ');
    expect(amountSegments(75_000, null)).toEqual([{ text: 'nhận 75.000đ', danger: false }]);
    expect(amountSegments(null, 300_000)).toEqual([{ text: 'Đơn 300.000đ', danger: false }]);
    expect(amountSegments(null, null)).toEqual([]);
  });

  it('mục chưa khớp: "Không khớp Đơn nào", ô trống "—"; hàng trống', () => {
    expect(UNMATCHED_ORDER_LABEL).toBe('Không khớp Đơn nào');
    expect(EMPTY_VALUE).toBe('—');
    expect(REVIEW_QUEUE_EMPTY).toBe('Không có gì cần xử lý.');
  });

  it('chip lọc: "Sự kiện: {tên}"', () => {
    expect(eventFilterLabel('Giải cầu lông')).toBe('Sự kiện: Giải cầu lông');
  });
});

describe('Sheet chi tiết', () => {
  it('lý do của mục mồ côi', () => {
    expect(Object.keys(REVIEW_REASON_LABEL).sort()).toEqual(Object.values(ReviewItemReason).sort());
    expect(reviewReasonLine('event_ended')).toBe('Lý do: Sự kiện đã kết thúc');
    expect(reviewReasonLine('event_locked')).toBe('Lý do: Sự kiện bị khóa');
    expect(reviewReasonLine('sold_out')).toBe('Lý do: Hết chỗ');
  });

  it('nhật ký: "Nhận tiền", "Mở mục · {loại}"', () => {
    expect(reviewLogLabel({ kind: 'payment_received' }, 'orphan')).toBe('Nhận tiền');
    expect(reviewLogLabel({ kind: 'item_opened' }, 'amount_mismatch')).toBe('Mở mục · Lệch số tiền');
  });

  it('phương thức: mã đã biết → nhãn, mã lạ giữ nguyên, không có → "—"', () => {
    expect(paymentMethodLabel('qr')).toBe('Quét mã QR');
    expect(paymentMethodLabel('QR')).toBe('Quét mã QR');
    expect(paymentMethodLabel('bank_transfer')).toBe('bank_transfer');
    expect(paymentMethodLabel(null)).toBe('—');
  });
});

describe('tải và tự cập nhật', () => {
  it('mọi khóa nằm dưới một gốc (tín hiệu làm mới cả badge, hàng, chi tiết); polling 10 giây', () => {
    const prefix = reviewQueueQueryPrefix('o');
    for (const key of [reviewQueueSummaryQueryKey('o'), reviewQueueQueryKey('o', null), reviewItemQueryKey('o', 'i')]) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
    expect(reviewQueueQueryKey('o', 'e')).not.toEqual(reviewQueueQueryKey('o', null));
    expect(reviewQueueQueryPrefix('o')).not.toEqual(reviewQueueQueryPrefix('p'));
    expect(REVIEW_QUEUE_POLL_MS).toBe(10_000);
  });
});
