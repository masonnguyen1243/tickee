import { EventStatus, formatVnDateTime, type CheckerInvite } from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';

/*
 * Khối "Link mời CTV" của tab Check-in (Story 5.1, UX-DR39): nhãn và tone trạng thái, thời điểm hết hạn, lý do tắt của
 * "Sao chép link" và "Tạo link mới", có hỏi trước khi tạo không. Hàm thuần, kiểm bằng Vitest môi trường node; giờ luôn
 * theo giờ Việt Nam (không theo múi giờ máy).
 */

type Badge = { label: string; tone: StatusTone };

export const CHECKER_INVITE_ACTIVE_BADGE: Badge = { label: 'Còn hạn', tone: 'success' };
export const CHECKER_INVITE_EXPIRED_BADGE: Badge = { label: 'Đã hết hạn', tone: 'neutral' };

/** Chưa có link nào cho Sự kiện. */
export const NO_CHECKER_INVITE = 'Chưa có link mời';

/** Lý do tắt "Tạo link mới" theo trạng thái Sự kiện. */
export const CREATE_INVITE_DISABLED = {
  draft: 'Đăng Sự kiện trước khi mời CTV.',
  ended: 'Sự kiện đã kết thúc, không tạo được link mời mới.',
  cancelled: 'Sự kiện đã hủy, không tạo được link mời mới.',
} as const;

/** Link còn hạn nhưng token không còn trong bộ nhớ (đã tải lại trang, hoặc người khác vừa tạo link). */
export const COPY_INVITE_NO_TOKEN = 'Link đầy đủ chỉ hiện ngay sau khi tạo. Tạo link mới để có link gửi đi.';
/** Link đã hết hạn, còn tạo được link mới. */
export const COPY_INVITE_EXPIRED = 'Link đã hết hạn. Tạo link mới để có link gửi đi.';
/** Link đã hết hạn, Sự kiện không còn cho tạo link (lý do nằm ở "Tạo link mới"). */
export const COPY_INVITE_EXPIRED_FINAL = 'Link đã hết hạn.';

/** Hậu quả của "Tạo link mới" khi đang có link còn hạn (`ConfirmDialog`). */
export const REPLACE_INVITE_CONSEQUENCES = 'Link cũ hết hiệu lực ngay. CTV đã nhận lời mời vẫn giữ quyền.';

export type CheckerInviteViewInput = {
  eventStatus: EventStatus;
  /** Sự kiện đã kết thúc (`isEventEnded` của dashboard: "Kết thúc" sớm hoặc quá `effectiveEndAt`). */
  eventEnded: boolean;
  /** `effectiveEndAt` của Sự kiện đang hiện: hạn hiệu lực của link không vượt mốc này. */
  effectiveEndAt: string;
  invite: CheckerInvite | null;
  /** Token của chính link này còn trong bộ nhớ (vừa tạo trong phiên trang). */
  hasToken: boolean;
};

export type CheckerInviteView = {
  /** Badge trạng thái link; `null` khi chưa có link (hiện `NO_CHECKER_INVITE`). */
  badge: Badge | null;
  /** "Hết hạn lúc HH:mm dd/MM/yyyy (giờ Việt Nam)"; `null` khi chưa có link. */
  expiry: string | null;
  /** Link còn hiệu lực theo cả api lẫn Sự kiện đang hiện (đã hủy/đã kết thúc thì hết). */
  active: boolean;
  /** Lý do tắt "Tạo link mới"; `null` = bấm được. */
  createDisabledReason: string | null;
  /** Lý do tắt "Sao chép link"; `null` = bấm được. Chỉ có nghĩa khi đã có link. */
  copyDisabledReason: string | null;
  /** "Tạo link mới" hỏi trước bằng `ConfirmDialog` (đang có link còn hạn); lần tạo đầu hay link đã hết hạn thì không. */
  confirmBeforeCreate: boolean;
};

function createDisabledReason(status: EventStatus, ended: boolean): string | null {
  if (status === EventStatus.CANCELLED) return CREATE_INVITE_DISABLED.cancelled;
  if (status === EventStatus.DRAFT) return CREATE_INVITE_DISABLED.draft;
  if (ended) return CREATE_INVITE_DISABLED.ended;
  return null;
}

/**
 * Trạng thái hiển thị của link mời CTV. `active` của api (đồng hồ DB) là gốc; Sự kiện đang hiện đã hủy hoặc đã kết thúc
 * (vd. vừa bấm "Kết thúc" ở Cài đặt, dữ liệu link chưa tải lại) cũng làm link hết hiệu lực, và hạn hiển thị không vượt
 * `effectiveEndAt` của Sự kiện, như api tính.
 */
export function checkerInviteView({
  eventStatus,
  eventEnded,
  effectiveEndAt,
  invite,
  hasToken,
}: CheckerInviteViewInput): CheckerInviteView {
  const createReason = createDisabledReason(eventStatus, eventEnded);
  if (!invite) {
    return {
      badge: null,
      expiry: null,
      active: false,
      createDisabledReason: createReason,
      copyDisabledReason: null,
      confirmBeforeCreate: false,
    };
  }
  const active = invite.active && eventStatus !== EventStatus.CANCELLED && !eventEnded;
  const expiresAt = Math.min(Date.parse(invite.expiresAt), Date.parse(effectiveEndAt));
  let copyReason: string | null = null;
  if (!active) copyReason = createReason ? COPY_INVITE_EXPIRED_FINAL : COPY_INVITE_EXPIRED;
  else if (!hasToken) copyReason = COPY_INVITE_NO_TOKEN;
  return {
    badge: active ? CHECKER_INVITE_ACTIVE_BADGE : CHECKER_INVITE_EXPIRED_BADGE,
    expiry: `Hết hạn lúc ${formatVnDateTime(new Date(expiresAt))} (giờ Việt Nam)`,
    active,
    createDisabledReason: createReason,
    copyDisabledReason: copyReason,
    confirmBeforeCreate: active,
  };
}
