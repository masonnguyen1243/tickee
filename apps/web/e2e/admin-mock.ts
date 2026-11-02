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

/**
 * API admin có trạng thái: danh sách theo tab đọc từ `organizations`, Duyệt/Thu hồi đổi trạng thái theo đúng máy
 * trạng thái của api (bấm lại → 204; chuyển sai → 409). `gate` (nếu trả `Reply`) thay mọi phản hồi, để giả lập mất cờ,
 * chưa bật 2FA, chưa qua lớp hai…
 */
export async function mockAdminApi(
  page: Page,
  organizations: AdminOrganization[],
  { gate, handlers = {} }: { gate?: Gate; handlers?: Record<string, Handler> } = {},
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
      if (list) reply = { status: 200, body: organizations.filter((o) => o.closedBetaStatus === list[1]) };
      else if (change) reply = transition(decodeURIComponent(change[1]!), change[2] as 'approve' | 'revoke');
      else reply = apiError(500, 'INTERNAL_ERROR');
    }
    return route.fulfill({
      status: reply.status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: reply.body === undefined ? '' : JSON.stringify(reply.body),
    });
  });
  return calls;
}
