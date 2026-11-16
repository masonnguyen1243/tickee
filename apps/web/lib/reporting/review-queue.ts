import {
  DISMISS_REASON_MAX,
  ErrorCode,
  formatVnd,
  ReviewAction,
  ReviewApproveBlockedReason,
  ReviewItemLogKind,
  ReviewItemReason,
  ReviewItemStatus,
  type ReviewActionResult,
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

/** Người làm của dòng thao tác khi thành viên không có tên (vd. đăng nhập OTP) hay máy chủ không trả tên. */
export const REVIEW_ACTOR_FALLBACK = 'Thành viên BTC';

/** Tên người làm của dòng thao tác: tên thành viên; rỗng hoặc thiếu → "Thành viên BTC". */
export const reviewActorName = (name: string | undefined): string => name?.trim() || REVIEW_ACTOR_FALLBACK;

/**
 * Nhãn một dòng nhật ký: "Nhận tiền" · "Mở mục · Lệch số tiền"; dòng thao tác (Story 4.4) kèm tên người làm: "Duyệt tay
 * phát Vé · {tên}" · "Duyệt tay không thành · Hết chỗ · {tên}" · "Từ chối · {tên}" · "Đã hoàn tay · {tên}" · "Bỏ qua ·
 * {tên}" (lý do ở `reviewLogNote`).
 */
export function reviewLogLabel(entry: Pick<ReviewItemLogEntry, 'kind' | 'actorName'>, type: ReviewItemType): string {
  const by = (label: string) => `${label} · ${reviewActorName(entry.actorName)}`;
  switch (entry.kind) {
    case ReviewItemLogKind.PAYMENT_RECEIVED:
      return 'Nhận tiền';
    case ReviewItemLogKind.ITEM_OPENED:
      return `Mở mục · ${REVIEW_TYPE_LABEL[type]}`;
    case ReviewItemLogKind.APPROVED:
      return by('Duyệt tay phát Vé');
    case ReviewItemLogKind.APPROVE_SOLD_OUT:
      return by('Duyệt tay không thành · Hết chỗ');
    case ReviewItemLogKind.REJECTED:
      return by('Từ chối');
    case ReviewItemLogKind.REFUNDED:
      return by('Đã hoàn tay');
    case ReviewItemLogKind.DISMISSED:
      return by('Bỏ qua');
  }
}

/** Dòng phụ của dòng nhật ký: lý do "Bỏ qua" ("Lý do: …"); dòng khác hoặc không có lý do → `null`. */
export function reviewLogNote(entry: Pick<ReviewItemLogEntry, 'kind' | 'note'>): string | null {
  const note = entry.note?.trim();
  return entry.kind === ReviewItemLogKind.DISMISSED && note ? `Lý do: ${note}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Thao tác trên mục (Story 4.4-a): nhãn nút, lý do tắt, toast, lỗi tại chỗ
// ---------------------------------------------------------------------------------------------------------------

/** Nhãn nút thao tác (cũng là nút xác nhận của `Dialog`). */
export const REVIEW_ACTION_LABEL: Readonly<Record<ReviewAction, string>> = {
  [ReviewAction.APPROVE]: 'Duyệt tay phát Vé',
  [ReviewAction.REJECT]: 'Từ chối',
  [ReviewAction.REFUND]: 'Đã hoàn tay',
  [ReviewAction.DISMISS]: 'Bỏ qua',
};

/** Lý do nút "Duyệt tay phát Vé" bị tắt (hiện cạnh nút). */
export const APPROVE_BLOCKED_LABEL: Readonly<Record<ReviewApproveBlockedReason, string>> = {
  [ReviewApproveBlockedReason.EVENT_CANCELLED]: 'Sự kiện đã hủy',
  [ReviewApproveBlockedReason.EVENT_ENDED]: 'Sự kiện đã kết thúc',
  [ReviewApproveBlockedReason.EVENT_LOCKED]: 'Sự kiện đang bị khóa',
};

/** Mã lỗi API khi "Duyệt tay" bị từ chối vì Sự kiện → lý do tắt tương ứng. */
const APPROVE_BLOCKED_BY_ERROR: Readonly<Partial<Record<ErrorCode, ReviewApproveBlockedReason>>> = {
  [ErrorCode.EVENT_CANCELLED]: ReviewApproveBlockedReason.EVENT_CANCELLED,
  [ErrorCode.EVENT_ALREADY_ENDED]: ReviewApproveBlockedReason.EVENT_ENDED,
  [ErrorCode.EVENT_LOCKED]: ReviewApproveBlockedReason.EVENT_LOCKED,
};

/** Lỗi `409` của "Duyệt tay" vì Sự kiện (đã hủy, đã kết thúc, bị khóa) → lý do; lỗi khác → `null`. */
export const approveBlockedByError = (code: ErrorCode): ReviewApproveBlockedReason | null =>
  APPROVE_BLOCKED_BY_ERROR[code] ?? null;

/** Toast khi thua cuộc đua (`409 REVIEW_ACTION_NOT_ALLOWED`): thành viên khác vừa xử lý mục. */
export const REVIEW_ACTION_RACE_TOAST = 'Mục này vừa được xử lý.';

/** Lỗi tại chỗ khi "Duyệt tay" gặp hết chỗ (`409 TICKET_TYPE_SOLD_OUT`). */
export const APPROVE_SOLD_OUT_TITLE = 'Duyệt tay không thành · Hết chỗ';
export const APPROVE_SOLD_OUT_DESCRIPTION =
  'Hạng vé đã bán hết nên chưa phát được Vé. Đơn vẫn chờ xử lý: bạn có thể Từ chối rồi hoàn tiền cho khách.';

/** Lý do "Bỏ qua": trống sau khi bỏ khoảng trắng, hoặc dài quá `DISMISS_REASON_MAX` → câu lỗi tại ô; hợp lệ → `null`. */
export function dismissReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'Nhập lý do bỏ qua.';
  if (trimmed.length > DISMISS_REASON_MAX) return `Lý do tối đa ${DISMISS_REASON_MAX} ký tự.`;
  return null;
}

/**
 * Toast sau thao tác thành công (Story 4.4): "Đã phát {n} Vé cho Đơn {mã}." · "Đã hủy Đơn {mã}. Hoàn tiền cho khách rồi
 * bấm "Đã hoàn tay"." · "Đã ghi nhận hoàn tay {số tiền}." · "Đã bỏ qua mục.".
 */
export function reviewActionToast(result: Pick<ReviewActionResult, 'action' | 'orderCode' | 'ticketCount' | 'amount'>): string {
  switch (result.action) {
    case ReviewAction.APPROVE:
      return `Đã phát ${result.ticketCount} Vé cho Đơn ${result.orderCode ?? ''}.`;
    case ReviewAction.REJECT:
      return `Đã hủy Đơn ${result.orderCode ?? ''}. Hoàn tiền cho khách rồi bấm "Đã hoàn tay".`;
    case ReviewAction.REFUND:
      return result.amount === null ? 'Đã ghi nhận hoàn tay.' : `Đã ghi nhận hoàn tay ${formatVnd(result.amount)}.`;
    case ReviewAction.DISMISS:
      return 'Đã bỏ qua mục.';
  }
}

/** Mục đã rời hàng sau thao tác (`resolved`): `Sheet` đóng, focus về hàng kế tiếp. "Từ chối" giữ mục `open`. */
export const leftQueue = (result: Pick<ReviewActionResult, 'status'>): boolean =>
  result.status === ReviewItemStatus.RESOLVED;

/**
 * Hàng nhận focus khi mục `itemId` rời hàng: hàng kế tiếp, không có thì hàng trước đó; hàng chỉ còn mục này (hoặc không
 * thấy mục) → `null` (focus về tiêu đề trang).
 */
export function nextFocusItemId(itemIds: readonly string[], itemId: string): string | null {
  const index = itemIds.indexOf(itemId);
  if (index === -1) return null;
  return itemIds[index + 1] ?? itemIds[index - 1] ?? null;
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
