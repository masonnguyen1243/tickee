import { ErrorCode, REVIEW_ACTIONS, ReviewApproveBlockedReason, ReviewItemReason, ReviewItemType } from '@tickee/contracts';
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
  APPROVE_BLOCKED_LABEL,
  APPROVE_SOLD_OUT_TITLE,
  approveBlockedByError,
  dismissReasonError,
  EMPTY_VALUE,
  eventFilterLabel,
  leftQueue,
  nextFocusItemId,
  paymentMethodLabel,
  REVIEW_ACTION_LABEL,
  REVIEW_ACTION_RACE_TOAST,
  REVIEW_ACTOR_FALLBACK,
  REVIEW_QUEUE_EMPTY,
  REVIEW_REASON_LABEL,
  reviewActionToast,
  reviewActorName,
  reviewLogLabel,
  reviewLogNote,
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

describe('nhật ký: dòng thao tác (Story 4.4)', () => {
  it('kèm tên người làm; tên rỗng hoặc thiếu → "Thành viên BTC"', () => {
    expect(REVIEW_ACTOR_FALLBACK).toBe('Thành viên BTC');
    expect(reviewActorName('Lê Minh')).toBe('Lê Minh');
    expect(reviewActorName('  ')).toBe('Thành viên BTC');
    expect(reviewActorName(undefined)).toBe('Thành viên BTC');
    const by = (kind: Parameters<typeof reviewLogLabel>[0]['kind'], actorName?: string) =>
      reviewLogLabel({ kind, actorName }, 'amount_mismatch');
    expect(by('approved', 'Lê Minh')).toBe('Duyệt tay phát Vé · Lê Minh');
    expect(by('approve_sold_out', 'Lê Minh')).toBe('Duyệt tay không thành · Hết chỗ · Lê Minh');
    expect(by('rejected', '')).toBe('Từ chối · Thành viên BTC');
    expect(by('refunded')).toBe('Đã hoàn tay · Thành viên BTC');
    expect(by('dismissed', 'An')).toBe('Bỏ qua · An');
  });

  it('dòng "Bỏ qua" kèm lý do; dòng khác không có dòng phụ', () => {
    expect(reviewLogNote({ kind: 'dismissed', note: 'Khách chuyển nhầm' })).toBe('Lý do: Khách chuyển nhầm');
    expect(reviewLogNote({ kind: 'dismissed' })).toBeNull();
    expect(reviewLogNote({ kind: 'refunded', note: 'x' })).toBeNull();
    expect(reviewLogNote({ kind: 'payment_received' })).toBeNull();
  });
});

describe('thao tác trên mục (Story 4.4)', () => {
  it('nhãn nút cho cả 4 thao tác', () => {
    expect(Object.keys(REVIEW_ACTION_LABEL).sort()).toEqual([...REVIEW_ACTIONS].sort());
    expect(REVIEW_ACTION_LABEL).toEqual({
      approve: 'Duyệt tay phát Vé',
      reject: 'Từ chối',
      refund: 'Đã hoàn tay',
      dismiss: 'Bỏ qua',
    });
  });

  it('lý do tắt "Duyệt tay": đủ mọi lý do; lỗi 409 của Sự kiện → lý do tương ứng, lỗi khác → null', () => {
    expect(Object.keys(APPROVE_BLOCKED_LABEL).sort()).toEqual(Object.values(ReviewApproveBlockedReason).sort());
    expect(APPROVE_BLOCKED_LABEL).toEqual({
      event_cancelled: 'Sự kiện đã hủy',
      event_ended: 'Sự kiện đã kết thúc',
      event_locked: 'Sự kiện đang bị khóa',
    });
    expect(approveBlockedByError(ErrorCode.EVENT_CANCELLED)).toBe('event_cancelled');
    expect(approveBlockedByError(ErrorCode.EVENT_ALREADY_ENDED)).toBe('event_ended');
    expect(approveBlockedByError(ErrorCode.EVENT_LOCKED)).toBe('event_locked');
    expect(approveBlockedByError(ErrorCode.TICKET_TYPE_SOLD_OUT)).toBeNull();
    expect(approveBlockedByError(ErrorCode.REVIEW_ACTION_NOT_ALLOWED)).toBeNull();
    expect(APPROVE_SOLD_OUT_TITLE).toBe('Duyệt tay không thành · Hết chỗ');
  });

  it('toast đúng câu của từng thao tác', () => {
    const base = { orderCode: 'TK5R8W1CAB', ticketCount: 2, amount: 250_000 };
    expect(reviewActionToast({ ...base, action: 'approve' })).toBe('Đã phát 2 Vé cho Đơn TK5R8W1CAB.');
    expect(reviewActionToast({ ...base, action: 'reject' })).toBe(
      'Đã hủy Đơn TK5R8W1CAB. Hoàn tiền cho khách rồi bấm "Đã hoàn tay".',
    );
    expect(reviewActionToast({ ...base, action: 'refund' })).toBe('Đã ghi nhận hoàn tay 250.000đ.');
    expect(reviewActionToast({ ...base, action: 'refund', amount: null })).toBe('Đã ghi nhận hoàn tay.');
    expect(reviewActionToast({ ...base, action: 'dismiss', orderCode: null })).toBe('Đã bỏ qua mục.');
    expect(REVIEW_ACTION_RACE_TOAST).toBe('Mục này vừa được xử lý.');
  });

  it('mục rời hàng khi resolved; "Từ chối" giữ mục open', () => {
    expect(leftQueue({ status: 'resolved' })).toBe(true);
    expect(leftQueue({ status: 'open' })).toBe(false);
  });

  it('lý do "Bỏ qua": bắt buộc, 1–300 ký tự sau trim', () => {
    expect(dismissReasonError('')).toBe('Nhập lý do bỏ qua.');
    expect(dismissReasonError('   ')).toBe('Nhập lý do bỏ qua.');
    expect(dismissReasonError(' Khách chuyển nhầm ')).toBeNull();
    expect(dismissReasonError(` ${'a'.repeat(300)} `)).toBeNull();
    expect(dismissReasonError('a'.repeat(301))).toBe('Lý do tối đa 300 ký tự.');
  });

  it('focus sau khi mục rời hàng: hàng kế tiếp, không có thì hàng trước, hết hàng → null (tiêu đề trang)', () => {
    expect(nextFocusItemId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextFocusItemId(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextFocusItemId(['a', 'b', 'c'], 'c')).toBe('b');
    expect(nextFocusItemId(['a'], 'a')).toBeNull();
    expect(nextFocusItemId(['a', 'b'], 'x')).toBeNull();
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
