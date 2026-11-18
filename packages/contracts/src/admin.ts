import { z } from 'zod';

import { paymentServiceReasonSchema } from './organizer.js';

// ---------------------------------------------------------------------------------------------------------------
// Quản trị Tingee: duyệt BTC vào Closed Beta (FR-37, AD-26, Story 2.5)
// ---------------------------------------------------------------------------------------------------------------

/** Màn "Duyệt Closed Beta" của web (chỉ Quản trị Tingee: cờ `platform_admin`, đã bật 2FA, đã qua lớp hai). */
export const ADMIN_PATH = '/admin';

/**
 * Trạng thái Closed Beta của BTC (cột `organizations.closed_beta_status`, do `organizer` sở hữu). BTC mới luôn
 * `pending`; chỉ BTC `approved` được bán Vé có phí khi chưa KYC (Story 2.10 đọc trạng thái này).
 */
export const ClosedBetaStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REVOKED: 'revoked',
} as const;
export type ClosedBetaStatus = (typeof ClosedBetaStatus)[keyof typeof ClosedBetaStatus];
export const closedBetaStatusSchema = z.enum(ClosedBetaStatus);

/** Thao tác của Quản trị Tingee trên trạng thái Closed Beta (`POST /v1/admin/organizations/:id/closed-beta/<thao tác>`). */
export const ClosedBetaAction = {
  APPROVE: 'approve',
  REVOKE: 'revoke',
} as const;
export type ClosedBetaAction = (typeof ClosedBetaAction)[keyof typeof ClosedBetaAction];

/**
 * Máy trạng thái Closed Beta: thao tác → trạng thái nguồn được phép và trạng thái đích. Duyệt nhận cả BTC bị thu hồi
 * (duyệt lại — quyết định 02/11/2026). Đã ở trạng thái đích thì thao tác là no-op (204, không audit); trạng thái khác
 * → `CLOSED_BETA_TRANSITION_INVALID`.
 */
export const CLOSED_BETA_TRANSITIONS: Readonly<
  Record<ClosedBetaAction, { readonly from: readonly ClosedBetaStatus[]; readonly to: ClosedBetaStatus }>
> = {
  approve: { from: [ClosedBetaStatus.PENDING, ClosedBetaStatus.REVOKED], to: ClosedBetaStatus.APPROVED },
  revoke: { from: [ClosedBetaStatus.APPROVED], to: ClosedBetaStatus.REVOKED },
};

/** Query `GET /v1/admin/organizations?closedBeta=pending|approved|revoked` (bắt buộc). */
export const ClosedBetaQueueQuery = z.object({ closedBeta: closedBetaStatusSchema });
export type ClosedBetaQueueQuery = z.input<typeof ClosedBetaQueueQuery>;

/** Một hàng của màn "Duyệt Closed Beta". Kênh liên hệ BTC để Tingee xác minh (PII, không bao giờ vào audit/log). */
export const ClosedBetaOrganization = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Email của Owner; `null` nếu BTC (bất thường) không có Owner. */
  ownerEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  closedBetaStatus: closedBetaStatusSchema,
  createdAt: z.iso.datetime(),
});
export type ClosedBetaOrganization = z.infer<typeof ClosedBetaOrganization>;

/** `GET /v1/admin/organizations?closedBeta=…`: BTC theo thời điểm tạo tăng dần (chờ lâu nhất trước). */
export const ClosedBetaOrganizationList = z.array(ClosedBetaOrganization);
export type ClosedBetaOrganizationList = z.infer<typeof ClosedBetaOrganizationList>;

/** `details` của lỗi `CLOSED_BETA_TRANSITION_INVALID`: trạng thái hiện tại của BTC. */
export const ClosedBetaTransitionInvalidDetails = z.object({ closedBetaStatus: closedBetaStatusSchema });
export type ClosedBetaTransitionInvalidDetails = z.infer<typeof ClosedBetaTransitionInvalidDetails>;

// ---------------------------------------------------------------------------------------------------------------
// Quản trị Tingee: BTC đang bị ngắt dịch vụ thanh toán (AD-32, Story 4.2)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Một BTC đang `suspended` (`GET /v1/admin/organizations/payment-service/suspended`): id, tên, lý do, lúc bắt đầu ngắt,
 * lần dò gần nhất (`null` khi chưa dò lần nào). Không có kênh liên hệ hay PII.
 */
export const SuspendedPaymentServiceOrganization = z.object({
  id: z.uuid(),
  name: z.string(),
  reason: paymentServiceReasonSchema,
  since: z.iso.datetime(),
  checkedAt: z.iso.datetime().nullable(),
});
export type SuspendedPaymentServiceOrganization = z.infer<typeof SuspendedPaymentServiceOrganization>;

/** `GET /v1/admin/organizations/payment-service/suspended`: BTC ngắt lâu nhất trước (`since` tăng dần, rồi id). */
export const SuspendedPaymentServiceOrganizationList = z.array(SuspendedPaymentServiceOrganization);
export type SuspendedPaymentServiceOrganizationList = z.infer<typeof SuspendedPaymentServiceOrganizationList>;

/** Đường API (sau `/v1`) của danh sách BTC đang bị ngắt dịch vụ thanh toán (GET). */
export const ADMIN_SUSPENDED_PAYMENT_SERVICES_API_PATH = '/admin/organizations/payment-service/suspended';

/**
 * Đường API (sau `/v1`) Quản trị Tingee mở lại dịch vụ thanh toán của một BTC (POST → 204; BTC không bị ngắt → 409
 * `PAYMENT_SERVICE_NOT_SUSPENDED`).
 */
export const adminPaymentServiceResumeApiPath = (organizationId: string): string =>
  `/admin/organizations/${encodeURIComponent(organizationId)}/payment-service/resume`;

// ---------------------------------------------------------------------------------------------------------------
// Quản trị Tingee: job trong dead-letter của pg-boss (AD-12, Story 4.6-d)
// ---------------------------------------------------------------------------------------------------------------

/** Danh sách dead-letter trả tối đa chừng này job, mới nhất trước; `total` là số job thật đang nằm trong dead-letter. */
export const DEAD_LETTER_JOBS_LIMIT = 200;

/** `reason` và `payload` của một job dead-letter dài tối đa chừng này ký tự (bị cắt bớt). */
export const DEAD_LETTER_TEXT_MAX_LENGTH = 300;

/**
 * Một job `created` trong một queue `*.dead-letter` (`GET /v1/admin/dead-letters`). Các trường `source*` là dấu vết
 * pg-boss ghi khi chép job hết retry sang dead-letter; `null` khi pg-boss không ghi (job chép tay vào dead-letter): job
 * như vậy không requeue được.
 */
export const DeadLetterJob = z.object({
  /** Id của job trong queue dead-letter (id mà email cảnh báo `dead_letter` nêu). */
  id: z.uuid(),
  /** Tên queue dead-letter (`<queue gốc>.dead-letter`). */
  queue: z.string(),
  /** Queue gốc: requeue tạo job mới ở đây. */
  sourceQueue: z.string().nullable(),
  /** Id job gốc đã hết retry (`z.guid`: id job gốc có thể do Tickee đặt, không bắt buộc đúng phiên bản UUID). */
  sourceJobId: z.guid().nullable(),
  /** Số lần thử lại của job gốc trước khi vào dead-letter (`source_retry_count`). */
  retryCount: z.number().int().nullable(),
  /** Lúc job vào dead-letter. */
  createdAt: z.iso.datetime(),
  /**
   * Lý do lỗi: `message` của output job gốc (không có thì JSON của cả output, bỏ mọi `stack`). Chuỗi dạng email và chuỗi
   * từ 9 chữ số trở lên thay bằng `[REDACTED]`; tối đa `DEAD_LETTER_TEXT_MAX_LENGTH` ký tự. `null` khi không có output.
   */
  reason: z.string().nullable(),
  /** JSON của payload (`data`), tối đa `DEAD_LETTER_TEXT_MAX_LENGTH` ký tự. */
  payload: z.string(),
});
export type DeadLetterJob = z.infer<typeof DeadLetterJob>;

/** `GET /v1/admin/dead-letters`: tối đa `DEAD_LETTER_JOBS_LIMIT` job mới vào dead-letter nhất trước, kèm tổng số job. */
export const DeadLetterJobList = z.object({
  items: z.array(DeadLetterJob),
  total: z.number().int().nonnegative(),
});
export type DeadLetterJobList = z.infer<typeof DeadLetterJobList>;

/** Tham số đường dẫn của requeue: id job dead-letter (sai dạng → 400 `VALIDATION_FAILED`). */
export const DeadLetterJobParams = z.object({ id: z.uuid() });
export type DeadLetterJobParams = z.infer<typeof DeadLetterJobParams>;

/** Đường API (sau `/v1`) của danh sách job dead-letter (GET). */
export const ADMIN_DEAD_LETTERS_API_PATH = '/admin/dead-letters';

/**
 * Đường API (sau `/v1`) Quản trị Tingee requeue một job dead-letter về queue gốc (POST → 204; job không còn trong
 * dead-letter → 409 `DEAD_LETTER_JOB_GONE`).
 */
export const adminDeadLetterRequeueApiPath = (jobId: string): string =>
  `${ADMIN_DEAD_LETTERS_API_PATH}/${encodeURIComponent(jobId)}/requeue`;
