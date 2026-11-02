import { ClosedBetaOrganizationList, type ClosedBetaAction, type ClosedBetaStatus } from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

/** Gốc khóa TanStack Query của khu Quản trị Tingee (invalidate cả ba tab một lần). */
export const CLOSED_BETA_QUEUE_QUERY_KEY = ['admin', 'closed-beta'] as const;
export const closedBetaQueueQueryKey = (status: ClosedBetaStatus) => [...CLOSED_BETA_QUEUE_QUERY_KEY, status] as const;

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
