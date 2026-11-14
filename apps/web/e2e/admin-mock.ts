import type { Page, Request } from '@playwright/test';

import { apiError, WEB_ORIGIN, type Call, type Handler, type Reply } from './identity-mock';

/** Chặn trước mọi route admin: trả `Reply` để thay phản hồi, `undefined` để đi tiếp tới API giả có trạng thái. */
export type Gate = (request: Request) => Reply | undefined;

/*
 * API Quản trị Tingee giả bằng `page.route` cho `/v1/admin/**`. Khóa handler gồm cả query (vd.
 * `GET /admin/organizations?closedBeta=pending`) vì mỗi tab là một query khác nhau; lời gọi không có handler → 500.
 */

export type ClosedBetaStatus = 'pending' | 'approved' | 'revoked';

export type AdminOrganization = {
  id: string;
  name: string;
  ownerEmail: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  closedBetaStatus: ClosedBetaStatus;
  createdAt: string;
};

export const adminOrganization = (overrides: Partial<AdminOrganization> & Pick<AdminOrganization, 'id' | 'name'>) => ({
  ownerEmail: 'owner@vidu.vn',
  contactPhone: null,
  contactEmail: null,
  closedBetaStatus: 'pending' as ClosedBetaStatus,
  createdAt: '2026-11-01T03:00:00.000Z',
  ...overrides,
});

export const queueKey = (status: ClosedBetaStatus) => `GET /admin/organizations?closedBeta=${status}`;

/** Một BTC đang bị ngắt dịch vụ thanh toán (tab "Tạm ngừng bán", Story 4.2-b). */
export type SuspendedOrganization = {
  id: string;
  name: string;
  reason: 'token' | 'tingee_disabled' | 'credential_invalid' | 'gateway_permission_missing';
  since: string;
  checkedAt: string | null;
};

export const SUSPENDED_KEY = 'GET /admin/organizations/payment-service/suspended';
export const resumeKey = (id: string) => `POST /admin/organizations/${id}/payment-service/resume`;

/**
 * API admin có trạng thái: danh sách theo tab đọc từ `organizations`, Duyệt/Thu hồi đổi trạng thái theo đúng máy
 * trạng thái của api (bấm lại → 204; chuyển sai → 409). Tab "Tạm ngừng bán" đọc `suspended` (theo thứ tự truyền vào,
 * như api: ngắt lâu nhất trước); "Mở lại" gỡ BTC khỏi danh sách (204), BTC không còn trong danh sách → 409
 * `PAYMENT_SERVICE_NOT_SUSPENDED`. `gate` (nếu trả `Reply`) thay mọi phản hồi, để giả lập mất cờ, chưa bật 2FA, chưa
 * qua lớp hai…
 */
export async function mockAdminApi(
  page: Page,
  organizations: AdminOrganization[],
  {
    gate,
    handlers = {},
    suspended = [],
  }: { gate?: Gate; handlers?: Record<string, Handler>; suspended?: SuspendedOrganization[] } = {},
): Promise<Call[]> {
  const calls: Call[] = [];
  const cors = {
    'access-control-allow-origin': WEB_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'accept, content-type',
  };
  const transition = (id: string, action: 'approve' | 'revoke') => {
    const org = organizations.find((o) => o.id === id);
    if (!org) return apiError(404, 'NOT_FOUND');
    const to: ClosedBetaStatus = action === 'approve' ? 'approved' : 'revoked';
    const from: ClosedBetaStatus[] = action === 'approve' ? ['pending', 'revoked'] : ['approved'];
    if (org.closedBetaStatus === to) return { status: 204 };
    if (!from.includes(org.closedBetaStatus)) {
      return apiError(409, 'CLOSED_BETA_TRANSITION_INVALID', { closedBetaStatus: org.closedBetaStatus });
    }
    org.closedBetaStatus = to;
    return { status: 204 };
  };

  await page.route('**/v1/admin/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/v1/, '');
    const key = `${request.method()} ${path}${url.search}`;
    calls.push({ method: request.method(), path: `${path}${url.search}`, body: request.postDataJSON() as unknown });

    let reply = gate?.(request);
    if (!reply && handlers[key]) reply = await handlers[key](request);
    if (!reply) {
      const list = /^GET \/admin\/organizations\?closedBeta=(pending|approved|revoked)$/.exec(key);
      const change = /^POST \/admin\/organizations\/([^/]+)\/closed-beta\/(approve|revoke)$/.exec(key);
      const resume = /^POST \/admin\/organizations\/([^/]+)\/payment-service\/resume$/.exec(key);
      if (list) reply = { status: 200, body: organizations.filter((o) => o.closedBetaStatus === list[1]) };
      else if (change) reply = transition(decodeURIComponent(change[1]!), change[2] as 'approve' | 'revoke');
      else if (key === SUSPENDED_KEY) reply = { status: 200, body: suspended };
      else if (resume) {
        const index = suspended.findIndex((o) => o.id === decodeURIComponent(resume[1]!));
        if (index < 0) reply = apiError(409, 'PAYMENT_SERVICE_NOT_SUSPENDED');
        else {
          suspended.splice(index, 1);
          reply = { status: 204 };
        }
      } else reply = apiError(500, 'INTERNAL_ERROR');
    }
    return route.fulfill({
      status: reply.status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: reply.body === undefined ? '' : JSON.stringify(reply.body),
    });
  });
  return calls;
}
