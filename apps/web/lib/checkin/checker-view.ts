import {
  CheckerAction,
  CheckerStatus,
  ErrorCode,
  formatVnDateTime,
  type CheckerListItem,
} from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';
import { ApiError } from '@/lib/api/errors';
import { messageOf } from '@/lib/api/message-of';

/*
 * CTV của Sự kiện (Story 5.6, FR-26, UX-DR33, UX-DR39): câu chữ và hàm thuần cho khối "CTV soát vé" của tab Check-in
 * (hàng, nút, hộp xác nhận, toast) và cho màn hết quyền của Màn quét. Kiểm bằng Vitest môi trường node; giờ luôn theo
 * giờ Việt Nam (không theo múi giờ máy).
 */

type Badge = { label: string; tone: StatusTone };

// ---------------------------------------------------------------------------------------------------------------
// Khối "CTV soát vé" ở tab Check-in
// ---------------------------------------------------------------------------------------------------------------

/** Chưa CTV nào nhận lời mời. */
export const NO_CHECKERS = 'Chưa có CTV nào nhận lời mời.';

/** Tài khoản của CTV không còn (api trả `name` và `email` đều `null`). */
export const DELETED_ACCOUNT = 'Tài khoản đã xóa';

/** Lý do tắt "Khôi phục": cùng nguồn "đã kết thúc" với "Tạo link mới" (`isEventEnded` của dashboard). */
export const RESTORE_DISABLED_ENDED = 'Sự kiện đã kết thúc';

export const CHECKER_STATUS_BADGE: Readonly<Record<CheckerStatus, Badge>> = {
  [CheckerStatus.ACTIVE]: { label: 'Đang hoạt động', tone: 'success' },
  [CheckerStatus.REVOKED]: { label: 'Đã thu hồi', tone: 'neutral' },
};

/** Nhãn nút của mỗi thao tác. */
export const CHECKER_ACTION_LABEL: Readonly<Record<CheckerAction, string>> = {
  [CheckerAction.REVOKE]: 'Thu hồi',
  [CheckerAction.RESTORE]: 'Khôi phục',
};

/** Thao tác hiện ở hàng CTV có trạng thái này: `active` → "Thu hồi", `revoked` → "Khôi phục". */
export const checkerActionOf = (status: CheckerStatus): CheckerAction =>
  status === CheckerStatus.ACTIVE ? CheckerAction.REVOKE : CheckerAction.RESTORE;

/** Tên gọi CTV trong hộp xác nhận và toast: tên, không có thì email, tài khoản không còn thì "CTV này". */
export const checkerName = (checker: Pick<CheckerListItem, 'name' | 'email'>): string =>
  checker.name ?? checker.email ?? 'CTV này';

export type CheckerRowView = {
  /** Dòng chính: tên, không có thì email, tài khoản không còn thì `DELETED_ACCOUNT`. */
  label: string;
  /** Email ở dòng `text-meta`; `null` khi dòng chính đã là email, hoặc tài khoản không còn. */
  email: string | null;
  /** "Nhận lúc HH:mm dd/MM/yyyy" (giờ Việt Nam). */
  accepted: string;
  badge: Badge;
  action: CheckerAction;
  actionLabel: string;
  /** Lý do tắt nút; `null` = bấm được. Chỉ "Khôi phục" bị tắt (Sự kiện đã kết thúc); "Thu hồi" luôn bấm được. */
  disabledReason: string | null;
};

/** Hàng của một CTV. `eventEnded`: Sự kiện đang hiện đã kết thúc (`isEventEnded`). */
export function checkerRowView(checker: CheckerListItem, eventEnded: boolean): CheckerRowView {
  const action = checkerActionOf(checker.status);
  return {
    label: checker.name ?? checker.email ?? DELETED_ACCOUNT,
    email: checker.name !== null ? checker.email : null,
    accepted: `Nhận lúc ${formatVnDateTime(checker.acceptedAt)}`,
    badge: CHECKER_STATUS_BADGE[checker.status],
    action,
    actionLabel: CHECKER_ACTION_LABEL[action],
    disabledReason: action === CheckerAction.RESTORE && eventEnded ? RESTORE_DISABLED_ENDED : null,
  };
}

export type CheckerDialogView = {
  title: string;
  /** Hậu quả của thao tác. */
  description: string;
  confirmLabel: string;
  /** "Thu hồi" phá hủy quyền (`destructive`); "Khôi phục" là xác nhận thường (`primary-on-light`). */
  confirmVariant: 'destructive' | 'primary-on-light';
  failureTitle: string;
  /** Toast sau khi xong. */
  success: string;
};

/** Hộp xác nhận "Thu hồi" / "Khôi phục" cho CTV `name` (`checkerName`). */
export function checkerDialogView(action: CheckerAction, name: string): CheckerDialogView {
  if (action === CheckerAction.REVOKE) {
    return {
      title: `Thu hồi quyền soát vé của ${name}?`,
      description: `${name} không quét hay tra tay được nữa, có hiệu lực từ lượt quét kế tiếp. Link mời không cho người này nhận lại; bạn có thể khôi phục sau.`,
      confirmLabel: 'Thu hồi',
      confirmVariant: 'destructive',
      failureTitle: 'Chưa thu hồi được',
      success: `Đã thu hồi quyền soát vé của ${name}.`,
    };
  }
  return {
    title: `Khôi phục quyền soát vé cho ${name}?`,
    description: `${name} quét và tra tay lại được cho Sự kiện này tới khi Sự kiện kết thúc.`,
    confirmLabel: 'Khôi phục',
    confirmVariant: 'primary-on-light',
    failureTitle: 'Chưa khôi phục được',
    success: `Đã khôi phục quyền soát vé cho ${name}.`,
  };
}

/** `404`: CTV (hoặc Sự kiện) không còn ở server; danh sách được tải lại. */
export const CHECKER_GONE_MESSAGE = 'CTV này không còn trong Sự kiện. Đã tải lại danh sách.';
/** `409 EVENT_ALREADY_ENDED` khi "Khôi phục": Sự kiện vừa kết thúc ở server; Sự kiện và danh sách được tải lại. */
export const RESTORE_ENDED_MESSAGE = 'Sự kiện đã kết thúc, không khôi phục được CTV. Đã tải lại.';

/** Lỗi "không còn" của thu hồi / khôi phục: CTV lạ hay của Sự kiện khác (`NOT_FOUND`), Sự kiện không còn. */
export const isCheckerGone = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === ErrorCode.NOT_FOUND || error.code === ErrorCode.EVENT_NOT_FOUND);

/** Sự kiện đã kết thúc ở server khi "Khôi phục" (dữ liệu Sự kiện trên trang đã cũ). */
export const isRestoreEnded = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCode.EVENT_ALREADY_ENDED;

// ---------------------------------------------------------------------------------------------------------------
// Màn hết quyền của Màn quét (UX-DR33)
// ---------------------------------------------------------------------------------------------------------------

/** Tiêu đề màn hết quyền khi CTV bị thu hồi hoặc Sự kiện đã kết thúc. */
export const NO_LONGER_CHECKER = 'Bạn không còn quyền soát vé cho Sự kiện này.';
/** Dòng mô tả thêm khi lý do là `EVENT_ENDED`. */
export const EVENT_ENDED_NOTE = 'Sự kiện đã kết thúc.';

/**
 * `403` của route CTV làm Màn quét thành màn hết quyền: người xem không quét được Sự kiện này (`NOT_A_MEMBER`, cả Sự kiện
 * lạ hay id sai dạng), CTV đã bị thu hồi (`CHECKER_REVOKED`), hoặc Sự kiện đã kết thúc với CTV (`EVENT_ENDED`).
 */
export const NO_ACCESS_CODES: readonly ErrorCode[] = [
  ErrorCode.NOT_A_MEMBER,
  ErrorCode.CHECKER_REVOKED,
  ErrorCode.EVENT_ENDED,
];

export const isNoAccessError = (error: unknown): boolean =>
  error instanceof ApiError && NO_ACCESS_CODES.includes(error.code);

export type NoAccessView = { title: string; description: string | null };

/**
 * Màn hết quyền của một lỗi `isNoAccessError`: `EVENT_ENDED` → `NO_LONGER_CHECKER` kèm `EVENT_ENDED_NOTE`; còn lại → câu
 * của api (không lộ tên Sự kiện), không có dòng mô tả.
 */
export function noAccessView(error: unknown): NoAccessView {
  if (error instanceof ApiError && error.code === ErrorCode.EVENT_ENDED) {
    return { title: NO_LONGER_CHECKER, description: EVENT_ENDED_NOTE };
  }
  return { title: messageOf(error), description: null };
}
