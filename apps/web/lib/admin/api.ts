import {
  ADMIN_SUSPENDED_PAYMENT_SERVICES_API_PATH,
  adminPaymentServiceResumeApiPath,
  ClosedBetaOrganizationList,
  SuspendedPaymentServiceOrganizationList,
  type ClosedBetaAction,
  type ClosedBetaStatus,
} from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

/** Gốc khóa TanStack Query của khu Quản trị Tingee (invalidate mọi tab một lần). */
export const ADMIN_QUERY_KEY = ['admin'] as const;
/** Gốc khóa của ba tab Closed Beta. */
export const CLOSED_BETA_QUEUE_QUERY_KEY = [...ADMIN_QUERY_KEY, 'closed-beta'] as const;
export const closedBetaQueueQueryKey = (status: ClosedBetaStatus) => [...CLOSED_BETA_QUEUE_QUERY_KEY, status] as const;
/** Tab "Tạm ngừng bán": BTC đang bị ngắt dịch vụ thanh toán (Story 4.2-b). */
export const SUSPENDED_PAYMENT_SERVICES_QUERY_KEY = [...ADMIN_QUERY_KEY, 'payment-service', 'suspended'] as const;

/** `GET /v1/admin/organizations?closedBeta=…` (mỗi lần gọi api ghi một dòng audit `platform_admin.read`). */
export const fetchClosedBetaQueue = (status: ClosedBetaStatus, signal?: AbortSignal) =>
  apiRequest(`/admin/organizations?closedBeta=${encodeURIComponent(status)}`, {
    schema: ClosedBetaOrganizationList,
    init: { signal },
  });

/** 204 No Content. Đã ở trạng thái đích cũng 204; chuyển không hợp lệ → `CLOSED_BETA_TRANSITION_INVALID`. */
export const changeClosedBeta = (organizationId: string, action: ClosedBetaAction) =>
  apiRequest(`/admin/organizations/${encodeURIComponent(organizationId)}/closed-beta/${action}`, {
    schema: z.undefined(),
    init: { method: 'POST' },
  });

/**
 * `GET /v1/admin/organizations/payment-service/suspended`: BTC đang bị ngắt, ngắt lâu nhất trước (mỗi lần gọi api ghi một
 * dòng audit `platform_admin.read`).
 */
export const fetchSuspendedPaymentServices = (signal?: AbortSignal) =>
  apiRequest(ADMIN_SUSPENDED_PAYMENT_SERVICES_API_PATH, {
    schema: SuspendedPaymentServiceOrganizationList,
    init: { signal },
  });

/**
 * Mở lại dịch vụ thanh toán của một BTC: 204 No Content (Tickee Đối soát bù các Đơn đang mở). BTC không còn bị ngắt →
 * `PAYMENT_SERVICE_NOT_SUSPENDED`; id lạ → `NOT_FOUND`.
 */
export const resumePaymentService = (organizationId: string) =>
  apiRequest(adminPaymentServiceResumeApiPath(organizationId), { schema: z.undefined(), init: { method: 'POST' } });
