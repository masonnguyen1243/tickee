import {
  DISMISS_REASON_MAX,
  ErrorCode,
  formatVnd,
  MATCH_CANDIDATES_LIMIT,
  ReviewAction,
  ReviewApproveBlockedReason,
  ReviewItemLogKind,
  ReviewItemReason,
  ReviewItemStatus,
  type MatchCandidate,
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
 * {tên}" (lý do ở `reviewLogNote`) · "Đã ghép với Đơn {mã} · {tên}" · "Ghép với Đơn không thành · Hết chỗ · {tên}"
 * (Story 4.4-b).
 */
export function reviewLogLabel(
  entry: Pick<ReviewItemLogEntry, 'kind' | 'actorName' | 'note'>,
  type: ReviewItemType,
): string {
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
    case ReviewItemLogKind.MATCHED: {
      const code = entry.note?.trim();
      return by(code ? `Đã ghép với Đơn ${code}` : 'Đã ghép với Đơn');
    }
    case ReviewItemLogKind.MATCH_SOLD_OUT:
      return by('Ghép với Đơn không thành · Hết chỗ');
  }
}

/**
 * Dòng phụ của dòng nhật ký: lý do "Bỏ qua" ("Lý do: …"); dòng khác (kể cả "Đã ghép với Đơn": mã Đơn nằm trong nhãn) hoặc
 * không có lý do → `null`.
 */
export function reviewLogNote(entry: Pick<ReviewItemLogEntry, 'kind' | 'note'>): string | null {
  const note = entry.note?.trim();
  return entry.kind === ReviewItemLogKind.DISMISSED && note ? `Lý do: ${note}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Thao tác trên mục (Story 4.4-a): nhãn nút, lý do tắt, toast, lỗi tại chỗ
// ---------------------------------------------------------------------------------------------------------------

/** Nhãn nút thao tác (cũng là nút xác nhận của `Dialog`, trừ "Ghép với Đơn": xác nhận là `MATCH_CONFIRM_LABEL`). */
export const REVIEW_ACTION_LABEL: Readonly<Record<ReviewAction, string>> = {
  [ReviewAction.APPROVE]: 'Duyệt tay phát Vé',
  [ReviewAction.REJECT]: 'Từ chối',
  [ReviewAction.REFUND]: 'Đã hoàn tay',
  [ReviewAction.DISMISS]: 'Bỏ qua',
  [ReviewAction.MATCH]: 'Ghép với Đơn',
};

/** Tiêu đề lỗi tại chỗ (footer hoặc `Dialog`) khi thao tác chưa làm được. */
export const REVIEW_ACTION_FAILURE_TITLE: Readonly<Record<ReviewAction, string>> = {
  [ReviewAction.APPROVE]: 'Chưa duyệt tay được',
  [ReviewAction.REJECT]: 'Chưa từ chối được',
  [ReviewAction.REFUND]: 'Chưa ghi nhận được',
  [ReviewAction.DISMISS]: 'Chưa bỏ qua được',
  [ReviewAction.MATCH]: 'Chưa ghép được',
};

/**
 * Nút đi đầu `actions` (máy chủ xếp theo thứ tự hiện nút) là nút chính: "Duyệt tay phát Vé", "Ghép với Đơn" (mục chưa
 * khớp), hoặc "Đã hoàn tay" khi không có hai nút đó. Nút còn lại là nút phụ.
 */
export const isPrimaryReviewAction = (actions: readonly ReviewAction[], action: ReviewAction): boolean =>
  actions[0] === action;

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

/** "Ghép với Đơn" gặp `409 MATCH_ORDER_NOT_ELIGIBLE`: Đơn đã chọn vừa đổi trạng thái (vd. giao dịch khác vừa ghép vào). */
export const MATCH_ORDER_CHANGED = 'Đơn này vừa đổi trạng thái. Chọn Đơn khác.';

/** "Ghép với Đơn" gặp hết chỗ (`409 TICKET_TYPE_SOLD_OUT`): Đơn giữ nguyên, mục vẫn ở hàng. */
export const matchSoldOutMessage = (orderCode: string): string => `Đơn ${orderCode} không còn đủ chỗ.`;

/** Lỗi tại chỗ của một thao tác: tiêu đề và câu mô tả. */
export type ReviewActionFailure = { title: string; description?: string };

/**
 * Lỗi dứt khoát của thao tác (không thử lại cùng khóa: nơi gọi bỏ khóa, tải lại chi tiết/ứng viên và báo tại chỗ):
 * - hết chỗ (`409 TICKET_TYPE_SOLD_OUT`): "Duyệt tay" → "Duyệt tay không thành · Hết chỗ"; "Ghép" → "Đơn {mã} không còn
 *   đủ chỗ.";
 * - Sự kiện không còn cho phát Vé (`409 EVENT_CANCELLED` / `EVENT_ALREADY_ENDED` / `EVENT_LOCKED`): lý do của Sự kiện;
 * - "Ghép" vào Đơn không còn ghép được (`409 MATCH_ORDER_NOT_ELIGIBLE`): "Đơn này vừa đổi trạng thái. Chọn Đơn khác.".
 * Lỗi khác (mạng, máy chủ; thua cuộc đua xử lý riêng) → `null`.
 */
export function reviewActionSettledFailure(
  input: { action: ReviewAction; orderCode?: string },
  code: ErrorCode,
): ReviewActionFailure | null {
  const title = REVIEW_ACTION_FAILURE_TITLE[input.action];
  const blocked = approveBlockedByError(code);
  if (input.action === ReviewAction.APPROVE) {
    if (code === ErrorCode.TICKET_TYPE_SOLD_OUT) {
      return { title: APPROVE_SOLD_OUT_TITLE, description: APPROVE_SOLD_OUT_DESCRIPTION };
    }
    return blocked ? { title, description: `${APPROVE_BLOCKED_LABEL[blocked]}.` } : null;
  }
  if (input.action === ReviewAction.MATCH) {
    const orderCode = input.orderCode ?? '';
    if (code === ErrorCode.TICKET_TYPE_SOLD_OUT) return { title, description: matchSoldOutMessage(orderCode) };
    if (code === ErrorCode.MATCH_ORDER_NOT_ELIGIBLE) return { title, description: MATCH_ORDER_CHANGED };
    return blocked ? { title, description: `Đơn ${orderCode}: ${APPROVE_BLOCKED_LABEL[blocked]}.` } : null;
  }
  return null;
}

/** Lý do "Bỏ qua": trống sau khi bỏ khoảng trắng, hoặc dài quá `DISMISS_REASON_MAX` → câu lỗi tại ô; hợp lệ → `null`. */
export function dismissReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'Nhập lý do bỏ qua.';
  if (trimmed.length > DISMISS_REASON_MAX) return `Lý do tối đa ${DISMISS_REASON_MAX} ký tự.`;
  return null;
}

/**
 * Toast sau thao tác thành công (Story 4.4): "Đã phát {n} Vé cho Đơn {mã}." · "Đã hủy Đơn {mã}. Hoàn tiền cho khách rồi
 * bấm "Đã hoàn tay"." · "Đã ghi nhận hoàn tay {số tiền}." · "Đã bỏ qua mục." · "Đã ghép giao dịch vào Đơn {mã}. Đã phát
 * {n} Vé.".
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
    case ReviewAction.MATCH:
      return `Đã ghép giao dịch vào Đơn ${result.orderCode ?? ''}. Đã phát ${result.ticketCount} Vé.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// "Ghép với Đơn" (Story 4.4-b): `Dialog` chọn Đơn ứng viên
// ---------------------------------------------------------------------------------------------------------------

/** Tiêu đề `Dialog` (cùng nhãn nút mở) và nút xác nhận. */
export const MATCH_DIALOG_TITLE = 'Ghép với Đơn';
export const MATCH_CONFIRM_LABEL = 'Ghép và phát Vé';

/** Lựa chọn "không lọc" của ô chọn Sự kiện. */
export const MATCH_ALL_EVENTS = 'Mọi Sự kiện';

/** Danh sách bị cắt ở `MATCH_CANDIDATES_LIMIT` Đơn mới nhất. */
export const MATCH_TRUNCATED_NOTE = `Chỉ hiện ${MATCH_CANDIDATES_LIMIT} Đơn mới nhất. Chọn Sự kiện để thu hẹp.`;

/** Không có ứng viên: "Không có Đơn hết hạn hay Cần xử lý nào cùng số tiền {số tiền}." (không rõ số tiền → bỏ số). */
export const matchEmptyText = (amount: number | null): string =>
  amount === null
    ? 'Không có Đơn hết hạn hay Cần xử lý nào cùng số tiền.'
    : `Không có Đơn hết hạn hay Cần xử lý nào cùng số tiền ${formatVnd(amount)}.`;

/** Ứng viên chọn được: Sự kiện của Đơn còn cho phát Vé (`blockedReason` `null`). */
export const matchSelectable = (candidate: Pick<MatchCandidate, 'blockedReason'>): boolean =>
  candidate.blockedReason === null;

/**
 * Đơn đang chọn sau mỗi lần tải lại ứng viên: còn trong danh sách và chọn được → giữ; biến mất (vd. vừa được ghép ở nơi
 * khác, đổi bộ lọc Sự kiện) hoặc bị tắt → bỏ chọn.
 */
export function matchSelection(candidates: readonly MatchCandidate[] | undefined, code: string | null): string | null {
  if (code === null || !candidates) return null;
  const candidate = candidates.find((c) => c.code === code);
  return candidate && matchSelectable(candidate) ? code : null;
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
