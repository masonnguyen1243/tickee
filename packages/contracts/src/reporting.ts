import { z } from 'zod';

import { roleSchema } from './organizer.js';

// ---------------------------------------------------------------------------------------------------------------
// Thông báo trạng thái cho `status-banner` (AD-34, UX-DR8): `reporting.notices(scope)` là nguồn duy nhất
// ---------------------------------------------------------------------------------------------------------------

/**
 * Mã thông báo trạng thái. Web chỉ ánh xạ `code` sang nội dung; mức độ, chặn bán, đóng được hay không do api quyết.
 * Story sau thêm mã vào đây và vào `STATUS_NOTICE_PRIORITY` (khác `NoticeCode` của toast qua URL ở web).
 */
export const StatusNoticeCode = {
  /** Quản trị Tingee đã thu hồi Closed Beta: Hạng vé có phí Tạm ngừng bán (danger, chặn bán, không đóng được). */
  CLOSED_BETA_REVOKED: 'CLOSED_BETA_REVOKED',
  /** BTC chưa được duyệt Closed Beta (warning, không đóng được). */
  CLOSED_BETA_PENDING: 'CLOSED_BETA_PENDING',
  /**
   * BTC chưa có tài khoản nhận tiền hiện hành (chưa kết nối Tingee, đã kết nối nhưng chưa chọn tài khoản, hoặc đã hủy
   * liên kết hết): chưa bán được Vé có phí (danger, chặn bán, không đóng được).
   */
  PAYOUT_ACCOUNT_NOT_LINKED: 'PAYOUT_ACCOUNT_NOT_LINKED',
} as const;
export type StatusNoticeCode = (typeof StatusNoticeCode)[keyof typeof StatusNoticeCode];
export const statusNoticeCodeSchema = z.enum(StatusNoticeCode);

/**
 * Thứ tự ưu tiên (cao → thấp, EXPERIENCE › Thứ tự ưu tiên `status-banner`): 1 Bị khóa · 2 Đã hủy · 3 Closed Beta bị
 * thu hồi · 4 Token chạm hạn mức / Key Tingee không còn dùng được · 5 Chưa liên kết tài khoản nhận tiền · 6 Chờ duyệt
 * Closed Beta · 7 Ẩn/Tạm ngừng bán · 8 Mất quyền Google Sheets · 9 Token dưới ngưỡng · 10 Đã kết thúc. Mã mới chèn đúng
 * vị trí của nó.
 */
export const STATUS_NOTICE_PRIORITY: readonly StatusNoticeCode[] = [
  StatusNoticeCode.CLOSED_BETA_REVOKED,
  StatusNoticeCode.PAYOUT_ACCOUNT_NOT_LINKED,
  StatusNoticeCode.CLOSED_BETA_PENDING,
];

/** Mức độ, trùng tone của `status-banner`. */
export const StatusNoticeSeverity = {
  DANGER: 'danger',
  WARNING: 'warning',
  NEUTRAL: 'neutral',
} as const;
export type StatusNoticeSeverity = (typeof StatusNoticeSeverity)[keyof typeof StatusNoticeSeverity];

/** Phạm vi của thông báo: cả BTC (đầu vùng nội dung dashboard) hay một Sự kiện. */
export const StatusNoticeScope = {
  ORGANIZATION: 'organization',
  EVENT: 'event',
} as const;
export type StatusNoticeScope = (typeof StatusNoticeScope)[keyof typeof StatusNoticeScope];

/** Một thông báo trạng thái. */
export const StatusNotice = z.object({
  code: statusNoticeCodeSchema,
  severity: z.enum(StatusNoticeSeverity),
  /** Trạng thái này chặn bán (một phần hay toàn bộ). Banner chặn bán không bao giờ đóng được. */
  blocking: z.boolean(),
  /** Người xem đóng được (ẩn theo `code` + `version` tới hết phiên trình duyệt). */
  dismissible: z.boolean(),
  scope: z.enum(StatusNoticeScope),
  /** Vai thấy thông báo này; api chỉ trả thông báo có vai của người gọi. */
  audience: z.array(roleSchema).min(1),
  /** Tham số cho nội dung (vd. số Token); không bao giờ chứa PII. */
  data: z.record(z.string(), z.unknown()),
  /** Đổi mỗi khi trạng thái gốc đổi: banner đã đóng hiện lại khi `version` khác. */
  version: z.string().min(1),
});
export type StatusNotice = z.infer<typeof StatusNotice>;

/** `GET /v1/orgs/:orgId/notices`: đã lọc theo vai của người gọi, sắp theo `STATUS_NOTICE_PRIORITY`. */
export const StatusNoticeList = z.array(StatusNotice);
export type StatusNoticeList = z.infer<typeof StatusNoticeList>;

/** Hạng ưu tiên của một mã (0 = cao nhất). */
export function statusNoticeRank(code: StatusNoticeCode): number {
  return STATUS_NOTICE_PRIORITY.indexOf(code);
}

/** Bản sao đã sắp theo `STATUS_NOTICE_PRIORITY` (ổn định với các thông báo cùng mã). */
export function sortStatusNotices<T extends { code: StatusNoticeCode }>(notices: readonly T[]): T[] {
  return [...notices].sort((a, b) => statusNoticeRank(a.code) - statusNoticeRank(b.code));
}

/** Dashboard hiện tối đa chừng này banner; phần còn lại gộp thành "+N thông báo" mở `Sheet` (UX-DR8). */
export const STATUS_BANNER_LIMIT = 2;
