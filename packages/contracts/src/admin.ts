import { z } from 'zod';

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
