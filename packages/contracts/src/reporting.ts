import { z } from 'zod';

import { ORDER_CODE_PATTERN, OrderStatus, orderStatusSchema } from './order.js';
import {
  OrganizationSection,
  organizationSectionPath,
  roleSchema,
  type PaymentServiceReason,
} from './organizer.js';
import {
  reviewActionSchema,
  reviewApproveBlockedReasonSchema,
  reviewItemReasonSchema,
  reviewItemResolutionSchema,
  reviewItemStatusSchema,
  reviewItemTypeSchema,
  type ReviewAction,
} from './payment.js';

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
   * Tingee từ chối VA của tài khoản nhận tiền mặc định (`payout_account_not_allowed`, nhóm
   * `PAYMENT_ACCOUNT_NOT_ALLOWED` của `create-link`, Story 4.2-d): mọi Hạng vé có phí Tạm ngừng bán tới khi Owner cho
   * phép VA trên Cổng thanh toán rồi bấm "Kiểm tra lại", đặt tài khoản khác làm mặc định, hủy tài khoản mặc định hoặc
   * lưu key mới hợp lệ (danger, chặn bán, không đóng được).
   */
  PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED: 'PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED',
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
  /**
   * Token khả dụng của BTC dưới ngưỡng cảnh báo Owner đặt (Story 4.5-b; `organizations.token_below_threshold_since`):
   * warning, không chặn bán, đóng được; audience theo danh mục thông báo (`NOTIFICATION_CATALOG.token_below_threshold`:
   * chỉ Owner). `version` = lúc vượt ngưỡng (ISO): lần vượt mới thì banner đã đóng hiện lại. `data.tingeePortalUrl`:
   * portal Tingee để mua thêm Token. Không có khi BTC đang Tạm ngừng bán vì hết Token (banner của 4.2 đã báo). Giá trị
   * mã trùng loại thông báo trong danh mục (`NotificationKind.TOKEN_BELOW_THRESHOLD`).
   */
  TOKEN_BELOW_THRESHOLD: 'token_below_threshold',
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
  // Bậc 4: một BTC chỉ có tối đa một trong năm mã (mỗi lý do ngắt một mã).
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TOKEN,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED,
  StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED,
  StatusNoticeCode.PAYOUT_ACCOUNT_NOT_LINKED,
  StatusNoticeCode.CLOSED_BETA_PENDING,
  // Bậc 9 (Story 4.5-b).
  StatusNoticeCode.TOKEN_BELOW_THRESHOLD,
];

/** Mã thông báo của từng lý do ngắt dịch vụ thanh toán (Story 4.2). */
export const PAYMENT_SERVICE_NOTICE_CODES: Readonly<Record<PaymentServiceReason, StatusNoticeCode>> = {
  token: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_TOKEN,
  credential_invalid: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID,
  gateway_permission_missing: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING,
  payout_account_not_allowed: StatusNoticeCode.PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED,
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

/** Đường API (sau `/v1`) của `StatusNoticeList` một BTC. */
export const statusNoticesApiPath = (organizationId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/notices`;

/**
 * Đường SSE (sau `/v1`) cấp BTC (Story 4.2-b, AD-17; Owner và Admin: `org.read`): chỉ đẩy tín hiệu cấp BTC của BTC này
 * (`org_status_changed`, và `org_review_items_changed` khi vai có `review_queue.handle`, Story 4.3) cùng `resync`. Web
 * tải lại `notices` (dải banner), tổng quan Tài khoản nhận tiền, badge và hàng Cần xử lý. Với `org_status_changed`, hiện
 * cờ dịch vụ thanh toán (bật, đổi lý do, tắt) và cảnh báo Token (vượt ngưỡng, về trên ngưỡng, Owner tắt cảnh báo; Story
 * 4.5-b) phát; Closed Beta và tài khoản nhận tiền chưa phát (xem `deferred-work.md`).
 */
export const organizationLiveApiPath = (organizationId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/live`;

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
 * Đơn mới nhất ở mọi trạng thái, xếp theo lúc tạo rồi id, giảm dần; `openReviewCount` = số mục Cần xử lý `open` gắn Đơn
 * của Sự kiện (`needs-action-card`, Story 4.3; mục `unmatched` không gắn Sự kiện nào nên không tính). Web tải lại khi
 * stream `GET …/overview/live` báo `event_orders_changed` hoặc `org_review_items_changed`.
 */
export const EventOverview = z.object({
  revenue: z.object({
    amount: z.number().int().nonnegative(),
    paidOrders: z.number().int().nonnegative(),
  }),
  recentOrders: z.array(RecentOrder).max(RECENT_ORDERS_LIMIT),
  openReviewCount: z.number().int().nonnegative(),
});
export type EventOverview = z.infer<typeof EventOverview>;

/** Đường API (sau `/v1`) của `EventOverview`. */
export const eventOverviewApiPath = (organizationId: string, eventId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/overview`;

/**
 * Đường SSE (sau `/v1`) của Tổng quan Sự kiện: đẩy `event_orders_changed` của Sự kiện này, `org_review_items_changed`
 * của BTC (tín hiệu cấp BTC: mọi mục của BTC, kể cả mục của Sự kiện khác; tải lại thừa nhưng rẻ) và `resync`.
 */
export const eventOverviewLiveApiPath = (organizationId: string, eventId: string): string =>
  `${eventOverviewApiPath(organizationId, eventId)}/live`;

// ---------------------------------------------------------------------------------------------------------------
// Hàng Cần xử lý của BTC (Story 4.3, FR-21): gộp mọi Sự kiện, đọc qua read model của `payment`, `ordering`, `event`
// ---------------------------------------------------------------------------------------------------------------

/**
 * Tham số lọc theo Sự kiện của trang Cần xử lý trên web (`/btc/{id}/can-xu-ly?suKien={eventId}`): link "Xử lý ở trang
 * Cần xử lý" trong `Sheet` chi tiết Đơn của tab Đơn (Story 6.1) dẫn tới đây. `needs-action-card` dẫn sang tab Đơn đã lọc
 * Cần xử lý.
 */
export const REVIEW_QUEUE_EVENT_PARAM = 'suKien';

/** Trang Cần xử lý của web; có `eventId` thì lọc theo Sự kiện đó. */
export function reviewQueuePath(organizationId: string, eventId?: string): string {
  const base = organizationSectionPath(organizationId, OrganizationSection.REVIEW_QUEUE);
  return eventId ? `${base}?${REVIEW_QUEUE_EVENT_PARAM}=${encodeURIComponent(eventId)}` : base;
}

/** Sự kiện của một mục (tên hiện tại), hoặc Sự kiện đang lọc của hàng. */
export const ReviewItemEvent = z.object({ id: z.uuid(), name: z.string() });
export type ReviewItemEvent = z.infer<typeof ReviewItemEvent>;

/** Đơn của một mục trên hàng: mã, tên Người mua (bản chụp lúc đặt), tổng tiền. Không email, không SĐT. */
export const ReviewQueueOrder = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  buyerName: z.string(),
  totalAmount: z.number().int().nonnegative(),
});
export type ReviewQueueOrder = z.infer<typeof ReviewQueueOrder>;

/**
 * Một mục `open` của hàng (`needs-action-row`): loại, số tiền đã nhận (`payment_events.paid_amount`; `null` khi khoản
 * tiền không ghi số tiền), lúc mở mục, Đơn và Sự kiện của Đơn. Mục `unmatched` không gắn Đơn: `order` và `event` `null`.
 */
export const ReviewQueueItem = z.object({
  id: z.uuid(),
  type: reviewItemTypeSchema,
  receivedAmount: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  order: ReviewQueueOrder.nullable(),
  event: ReviewItemEvent.nullable(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItem>;

/**
 * `GET /v1/orgs/:orgId/review-items[?eventId=]` (Owner, Admin: `review_queue.handle`; `no-store`): mọi mục `open` của
 * BTC ở mọi Sự kiện, cũ nhất trước (lúc tạo rồi id, tăng dần); không phân trang. Có `eventId`: chỉ mục gắn Đơn của Sự
 * kiện đó (không có mục `unmatched`), `event` là Sự kiện đang lọc; Sự kiện lạ, sai dạng hoặc của BTC khác → `404
 * EVENT_NOT_FOUND`. Không lọc → `event` `null`.
 */
export const ReviewQueue = z.object({
  event: ReviewItemEvent.nullable(),
  items: z.array(ReviewQueueItem),
});
export type ReviewQueue = z.infer<typeof ReviewQueue>;

/** Query của `GET /v1/orgs/:orgId/review-items`: `eventId` tùy chọn (id Sự kiện để lọc). */
export const ReviewQueueQuery = z.object({ eventId: z.string().max(200).optional() });
export type ReviewQueueQuery = z.input<typeof ReviewQueueQuery>;

/** `GET /v1/orgs/:orgId/review-items/summary`: số mục `open` của BTC (badge "Cần xử lý" ở sidebar và tab bar). */
export const ReviewQueueSummary = z.object({ openCount: z.number().int().nonnegative() });
export type ReviewQueueSummary = z.infer<typeof ReviewQueueSummary>;

/** Badge "Cần xử lý" hiện tối đa số này; lớn hơn thì "99+". */
export const REVIEW_BADGE_MAX = 99;

/**
 * Giao dịch của một mục (phần "Giao dịch" của `Sheet`): số tiền nhận, mã giao dịch Tingee, lúc Tingee báo trả
 * (`paidAt`, có thể `null`) và lúc Tickee nhận (`receivedAt`), phương thức. `providerOrderId` ("Mã Đơn trong giao dịch")
 * chỉ có với mục `unmatched`. Không bao giờ có `bill_id`, `merchant_id`, `request_id`.
 */
export const ReviewItemTransaction = z.object({
  receivedAmount: z.number().int().nonnegative().nullable(),
  transactionCode: z.string().nullable(),
  paidAt: z.iso.datetime({ offset: true }).nullable(),
  receivedAt: z.iso.datetime({ offset: true }),
  paymentMethod: z.string().nullable(),
  providerOrderId: z.string().nullable(),
});
export type ReviewItemTransaction = z.infer<typeof ReviewItemTransaction>;

/** Đơn liên quan của một mục (phần "Đơn liên quan" của `Sheet`). Không email, không SĐT. */
export const ReviewItemOrder = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  status: orderStatusSchema,
  buyerName: z.string(),
  ticketCount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ReviewItemOrder = z.infer<typeof ReviewItemOrder>;

/**
 * Loại dòng nhật ký của mục: `payment_received` — Tingee báo tiền về (`paid_at`, không có thì lúc Tickee nhận);
 * `item_opened` — mục được mở (`created_at`). Dòng thao tác (Story 4.4, dựng từ audit của mục, lúc thao tác):
 * `approved` — duyệt tay phát Vé; `approve_sold_out` — duyệt tay không thành vì hết chỗ (Đơn giữ `review`, mục vẫn
 * `open`); `rejected` — từ chối (Đơn bị hủy); `refunded` — đã hoàn tay; `dismissed` — bỏ qua (kèm lý do); `matched` —
 * đã ghép với Đơn (Story 4.4-b, kèm mã Đơn); `match_sold_out` — ghép không thành vì hết chỗ (Đơn giữ nguyên, mục vẫn
 * `open`).
 */
export const ReviewItemLogKind = {
  PAYMENT_RECEIVED: 'payment_received',
  ITEM_OPENED: 'item_opened',
  APPROVED: 'approved',
  APPROVE_SOLD_OUT: 'approve_sold_out',
  REJECTED: 'rejected',
  REFUNDED: 'refunded',
  DISMISSED: 'dismissed',
  MATCHED: 'matched',
  MATCH_SOLD_OUT: 'match_sold_out',
} as const;
export type ReviewItemLogKind = (typeof ReviewItemLogKind)[keyof typeof ReviewItemLogKind];

/**
 * Một dòng nhật ký. Dòng thao tác có `actorName`: tên thành viên đã làm (chuỗi rỗng khi tài khoản không có tên, vd.
 * đăng nhập OTP; web hiện "Thành viên BTC"). Dòng `dismissed` có `note`: lý do "Bỏ qua"; dòng `matched` có `note`: mã
 * Đơn đã ghép. Dòng dữ liệu sẵn có (`payment_received`, `item_opened`) không có hai trường này.
 */
export const ReviewItemLogEntry = z.object({
  kind: z.enum(ReviewItemLogKind),
  at: z.iso.datetime({ offset: true }),
  actorName: z.string().optional(),
  note: z.string().optional(),
});
export type ReviewItemLogEntry = z.infer<typeof ReviewItemLogEntry>;

/**
 * `GET /v1/orgs/:orgId/review-items/:itemId` (Owner, Admin: `review_queue.handle`; `no-store`): chi tiết một mục ở mọi
 * trạng thái — loại, lý do (`orphan`), trạng thái, cách xử lý, giao dịch, Đơn liên quan, Sự kiện, nhật ký (cũ trước).
 * Mục `unmatched` đã ghép (Story 4.4-b): `order`, `event` là Đơn được ghép và Sự kiện của nó (qua liên kết giao dịch →
 * Đơn); chưa ghép thì `null`. Id sai dạng, không tồn tại hoặc của BTC khác → `404 REVIEW_ITEM_NOT_FOUND`.
 * - `actions` (Story 4.4): thao tác được phép ở trạng thái hiện tại của mục và Đơn, theo thứ tự hiện nút (máy chủ tính,
 *   web chỉ hiển thị); mục đã xử lý → rỗng.
 * - `approveBlockedReason`: có `approve` trong `actions` mà Sự kiện không còn cho duyệt (đã hủy, đã kết thúc, bị khóa)
 *   → nút tắt kèm lý do; còn lại `null`.
 */
export const ReviewItemDetail = z.object({
  id: z.uuid(),
  type: reviewItemTypeSchema,
  reason: reviewItemReasonSchema.nullable(),
  status: reviewItemStatusSchema,
  resolution: reviewItemResolutionSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  transaction: ReviewItemTransaction,
  order: ReviewItemOrder.nullable(),
  event: ReviewItemEvent.nullable(),
  log: z.array(ReviewItemLogEntry),
  actions: z.array(reviewActionSchema),
  approveBlockedReason: reviewApproveBlockedReasonSchema.nullable(),
});
export type ReviewItemDetail = z.infer<typeof ReviewItemDetail>;

/** Đường API (sau `/v1`) của `ReviewQueue`; có `eventId` thì kèm `?eventId=`. */
export const reviewItemsApiPath = (organizationId: string, eventId?: string): string => {
  const base = `/orgs/${encodeURIComponent(organizationId)}/review-items`;
  return eventId === undefined ? base : `${base}?eventId=${encodeURIComponent(eventId)}`;
};

/** Đường API (sau `/v1`) của `ReviewQueueSummary`. */
export const reviewItemsSummaryApiPath = (organizationId: string): string =>
  `${reviewItemsApiPath(organizationId)}/summary`;

/** Đường API (sau `/v1`) của `ReviewItemDetail`. */
export const reviewItemApiPath = (organizationId: string, itemId: string): string =>
  `${reviewItemsApiPath(organizationId)}/${encodeURIComponent(itemId)}`;

/**
 * Đường API (sau `/v1`) của một thao tác trên mục (Story 4.4): `POST …/review-items/:itemId/{approve,reject,refund,
 * dismiss,match}`, header `Idempotency-Key` (uuid) bắt buộc, trả `ReviewActionResult`.
 */
export const reviewItemActionApiPath = (organizationId: string, itemId: string, action: ReviewAction): string =>
  `${reviewItemApiPath(organizationId, itemId)}/${action}`;

// ---------------------------------------------------------------------------------------------------------------
// "Ghép với Đơn" (Story 4.4-b): Đơn ứng viên cho một mục `unmatched`
// ---------------------------------------------------------------------------------------------------------------

/** Số Đơn ứng viên tối đa mỗi lần đọc (mới nhất trước); nhiều hơn thì `truncated`. Không phân trang. */
export const MATCH_CANDIDATES_LIMIT = 100;

/** Trạng thái Đơn ghép được: đã hết hạn, hoặc đang Cần xử lý. Không bao giờ `pending`/`paid`/`cancelled`/`refunded`. */
export const MATCHABLE_ORDER_STATUSES = [OrderStatus.EXPIRED, OrderStatus.REVIEW] as const;
export const matchableOrderStatusSchema = z.enum(MATCHABLE_ORDER_STATUSES);

/**
 * Một Đơn ứng viên: mã, tên Người mua (bản chụp lúc đặt), Sự kiện (tên hiện tại), trạng thái, số Vé, lúc tạo.
 * `blockedReason`: Sự kiện của Đơn không còn cho phát Vé (đã hủy / đã kết thúc theo đồng hồ DB / bị khóa) → web hiện
 * dòng tắt kèm lý do; còn lại `null`. Không email, không SĐT, không id nội bộ của Đơn.
 */
export const MatchCandidate = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN),
  buyerName: z.string(),
  event: ReviewItemEvent,
  status: matchableOrderStatusSchema,
  ticketCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  blockedReason: reviewApproveBlockedReasonSchema.nullable(),
});
export type MatchCandidate = z.infer<typeof MatchCandidate>;

/**
 * `GET /v1/orgs/:orgId/review-items/:itemId/match-candidates[?eventId=]` (Owner, Admin: `review_queue.handle`;
 * `no-store`): Đơn của BTC ở trạng thái `expired`/`review` có `total_amount` bằng số tiền nhận của giao dịch, mới nhất
 * trước (lúc tạo rồi id, giảm dần), tối đa `MATCH_CANDIDATES_LIMIT`; `truncated` khi còn Đơn khác. Có `eventId`: chỉ Đơn
 * của Sự kiện đó (Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`). Mục lạ hoặc của BTC khác → `404
 * REVIEW_ITEM_NOT_FOUND`; mục không có thao tác `match` (đã xử lý, không phải `unmatched`) → danh sách rỗng.
 */
export const MatchCandidates = z.object({
  candidates: z.array(MatchCandidate).max(MATCH_CANDIDATES_LIMIT),
  truncated: z.boolean(),
});
export type MatchCandidates = z.infer<typeof MatchCandidates>;

/** Query của `GET …/match-candidates`: `eventId` tùy chọn (id Sự kiện để lọc). */
export const MatchCandidatesQuery = z.object({ eventId: z.string().max(200).optional() });
export type MatchCandidatesQuery = z.input<typeof MatchCandidatesQuery>;

/** Đường API (sau `/v1`) của `MatchCandidates`; có `eventId` thì kèm `?eventId=`. */
export const reviewItemMatchCandidatesApiPath = (organizationId: string, itemId: string, eventId?: string): string => {
  const base = `${reviewItemApiPath(organizationId, itemId)}/match-candidates`;
  return eventId === undefined ? base : `${base}?eventId=${encodeURIComponent(eventId)}`;
};
