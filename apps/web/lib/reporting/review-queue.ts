import {
  formatVnd,
  ReviewItemLogKind,
  ReviewItemReason,
  type ReviewItemLogEntry,
  type ReviewItemType,
} from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';

import { REVIEW_TYPE_LABEL } from './overview';

/*
 * Hàng Cần xử lý của BTC (Story 4.3, FR-21): nhãn, dòng số tiền và nhật ký của `needs-action-row`, `Sheet` chi tiết và
 * `needs-action-card`. Hàm thuần, kiểm bằng Vitest môi trường node.
 */

/** Hàng trống, và `needs-action-card` khi Sự kiện không có mục nào. */
export const REVIEW_QUEUE_EMPTY = 'Không có gì cần xử lý.';

/** Mã Đơn của mục `unmatched` (không gắn Đơn nào). */
export const UNMATCHED_ORDER_LABEL = 'Không khớp Đơn nào';

/** Ô trống (Người mua, Sự kiện của mục `unmatched`; trường giao dịch không có). */
export const EMPTY_VALUE = '—';

/** Toast mất mạng của trang Cần xử lý (một lần mỗi lần mất mạng, `id` cố định). */
export const REVIEW_QUEUE_OFFLINE_TOAST = 'Mất kết nối. Đang thử lại…';
export const REVIEW_QUEUE_OFFLINE_TOAST_ID = 'review-queue-offline';

/** `status-badge` loại mục: tên loại (`REVIEW_TYPE_LABEL`), tone `danger` cho cả 5 loại. */
export const reviewTypeBadge = (type: ReviewItemType): { label: string; tone: StatusTone } => ({
  label: REVIEW_TYPE_LABEL[type],
  tone: 'danger',
});

/** Lý do của mục `orphan`. */
export const REVIEW_REASON_LABEL: Readonly<Record<ReviewItemReason, string>> = {
  [ReviewItemReason.EVENT_ENDED]: 'Sự kiện đã kết thúc',
  [ReviewItemReason.EVENT_LOCKED]: 'Sự kiện bị khóa',
  [ReviewItemReason.SOLD_OUT]: 'Hết chỗ',
};

/** "Lý do: Hết chỗ" (chỉ mục `orphan` có lý do). */
export const reviewReasonLine = (reason: ReviewItemReason): string => `Lý do: ${REVIEW_REASON_LABEL[reason]}`;

/** Một đoạn của dòng số tiền; `danger` = phần chênh (tô `danger-text`). */
export type AmountSegment = { text: string; danger: boolean };

/**
 * Dòng số tiền của `needs-action-row`: "nhận 250.000đ / Đơn 300.000đ". Phần chênh ("nhận …") tô `danger-text` chỉ khi
 * hai số đều có và khác nhau. Thiếu một số thì chỉ ghi số còn lại (mục `unmatched`: chỉ "nhận …"); thiếu cả hai → `[]`.
 */
export function amountSegments(receivedAmount: number | null, orderAmount: number | null): AmountSegment[] {
  const differs = receivedAmount !== null && orderAmount !== null && receivedAmount !== orderAmount;
  const segments: AmountSegment[] = [];
  if (receivedAmount !== null) segments.push({ text: `nhận ${formatVnd(receivedAmount)}`, danger: differs });
  if (receivedAmount !== null && orderAmount !== null) segments.push({ text: ' / ', danger: false });
  if (orderAmount !== null) segments.push({ text: `Đơn ${formatVnd(orderAmount)}`, danger: false });
  return segments;
}

/** Dòng số tiền dạng chữ (tên truy cập, kiểm thử). */
export const amountLine = (receivedAmount: number | null, orderAmount: number | null): string =>
  amountSegments(receivedAmount, orderAmount)
    .map((s) => s.text)
    .join('');

/** Nhãn một dòng nhật ký: "Nhận tiền" · "Mở mục · Lệch số tiền". */
export function reviewLogLabel(entry: Pick<ReviewItemLogEntry, 'kind'>, type: ReviewItemType): string {
  switch (entry.kind) {
    case ReviewItemLogKind.PAYMENT_RECEIVED:
      return 'Nhận tiền';
    case ReviewItemLogKind.ITEM_OPENED:
      return `Mở mục · ${REVIEW_TYPE_LABEL[type]}`;
  }
}

const PAYMENT_METHOD_LABEL: Readonly<Record<string, string>> = { qr: 'Quét mã QR' };

/** Phương thức thanh toán Tingee báo: mã đã biết → nhãn; mã lạ giữ nguyên; không có → "—". */
export const paymentMethodLabel = (method: string | null): string =>
  method === null ? EMPTY_VALUE : (PAYMENT_METHOD_LABEL[method.toLowerCase()] ?? method);

/** Chip lọc của trang Cần xử lý: "Sự kiện: {tên}". */
export const eventFilterLabel = (name: string): string => `Sự kiện: ${name}`;

/** Giá trị của `needs-action-card`: "{n} mục Cần xử lý"; 0 → "Không có gì cần xử lý.". */
export const needsActionValue = (count: number): string => (count > 0 ? `${count} mục Cần xử lý` : REVIEW_QUEUE_EMPTY);

/** Liên kết của `needs-action-card` (chỉ khi có mục). */
export const NEEDS_ACTION_LINK = 'Xem các mục Cần xử lý';
