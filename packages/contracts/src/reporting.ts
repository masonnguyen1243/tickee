import { z } from 'zod';

import { ORDER_CODE_PATTERN, orderStatusSchema } from './order.js';
import { roleSchema, type PaymentServiceReason } from './organizer.js';
import { reviewItemTypeSchema } from './payment.js';

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
  /**
   * Dịch vụ thanh toán của BTC bị ngắt vì hết Token (`payment_service_reason` `token`, Story 4.2): mọi Hạng vé có phí
   * Tạm ngừng bán (danger, chặn bán, không đóng được). `data.tingeePortalUrl`: portal Tingee để mua thêm Token.
   */
  PAYMENT_SERVICE_SUSPENDED_TOKEN: 'PAYMENT_SERVICE_SUSPENDED_TOKEN',
  /**
   * Key Tingee hiện hành của BTC không còn dùng được (`credential_invalid`, Story 4.2): mọi Hạng vé có phí Tạm ngừng bán
   * tới khi Owner lưu key mới hợp lệ hoặc dò thấy key dùng lại được (danger, chặn bán, không đóng được).
   */
  PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID: 'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
  /**
   * Key Tingee của BTC chưa được cấp quyền "Cổng thanh toán" (`gateway_permission_missing`, 1133, Story 4.2): mọi Hạng
   * vé có phí Tạm ngừng bán tới khi Owner cấp quyền rồi bấm "Kiểm tra lại", hoặc lưu key mới hợp lệ (danger, chặn bán,
   * không đóng được).
   */
  PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING: 'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
  /**
   * Tingee đang khóa merchant của BTC (`tingee_disabled`, Story 4.2): mọi Hạng vé có phí Tạm ngừng bán (danger, chặn bán,
   * không đóng được).
   */
  PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: 'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
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
  // Bậc 4: một BTC chỉ có tối đa một trong bốn mã (mỗi lý do ngắt một mã).
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TOKEN,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED,
  StatusNoticeCode.PAYOUT_ACCOUNT_NOT_LINKED,
  StatusNoticeCode.CLOSED_BETA_PENDING,
];

/** Mã thông báo của từng lý do ngắt dịch vụ thanh toán (Story 4.2). */
export const PAYMENT_SERVICE_NOTICE_CODES: Readonly<Record<PaymentServiceReason, StatusNoticeCode>> = {
  token: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TOKEN,
  credential_invalid: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID,
  gateway_permission_missing: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING,
  tingee_disabled: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED,
};

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

// ---------------------------------------------------------------------------------------------------------------
// Tổng quan Sự kiện (Story 3.11, FR-31, UX-DR35): doanh thu + Đơn gần đây, đọc qua read model của `ordering`, `payment`
// ---------------------------------------------------------------------------------------------------------------

/** Số Đơn mới nhất của khối "Đơn gần đây". */
export const RECENT_ORDERS_LIMIT = 5;

/**
 * Loại Cần xử lý của một Đơn `review`: `type` và số tiền đã nhận (`payment_events.paid_amount`) của mục `review_items`
 * `open` cũ nhất của Đơn. `receivedAmount` `null` khi khoản tiền không ghi số tiền (không xảy ra với IPN `success`).
 */
export const RecentOrderReview = z.object({
  type: reviewItemTypeSchema,
  receivedAmount: z.number().int().nonnegative().nullable(),
});
export type RecentOrderReview = z.infer<typeof RecentOrderReview>;

/**
 * Một Đơn của khối "Đơn gần đây" (mọi trạng thái): mã Đơn, tên Người mua (bản chụp lúc đặt), tổng số Vé, tổng tiền,
 * trạng thái, lúc tạo, loại Cần xử lý (`review` khác `null` chỉ khi `status = 'review'` và Đơn còn mục `open`). Không có
 * id nội bộ, email hay SĐT.
 */
export const RecentOrder = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  buyerName: z.string(),
  ticketCount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
  status: orderStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  review: RecentOrderReview.nullable(),
});
export type RecentOrder = z.infer<typeof RecentOrder>;

/**
 * `GET /v1/orgs/:orgId/events/:eventId/overview` (Owner, Admin: `orders.view`): doanh thu = tổng `total_amount` của các
 * Đơn `paid` của Sự kiện, `paidOrders` = số Đơn `paid` (tính cả Đơn 0đ); `recentOrders` = tối đa `RECENT_ORDERS_LIMIT`
 * Đơn mới nhất ở mọi trạng thái, xếp theo lúc tạo rồi id, giảm dần. Web tải lại khi stream
 * `GET …/overview/live` báo `event_orders_changed`.
 */
export const EventOverview = z.object({
  revenue: z.object({
    amount: z.number().int().nonnegative(),
    paidOrders: z.number().int().nonnegative(),
  }),
  recentOrders: z.array(RecentOrder).max(RECENT_ORDERS_LIMIT),
});
export type EventOverview = z.infer<typeof EventOverview>;

/** Đường API (sau `/v1`) của `EventOverview`. */
export const eventOverviewApiPath = (organizationId: string, eventId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/overview`;

/** Đường SSE (sau `/v1`) của Tổng quan Sự kiện: chỉ đẩy `event_orders_changed` của Sự kiện này và `resync`. */
export const eventOverviewLiveApiPath = (organizationId: string, eventId: string): string =>
  `${eventOverviewApiPath(organizationId, eventId)}/live`;
