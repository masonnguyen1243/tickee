import type { Page } from '@playwright/test';

import { apiError, WEB_ORIGIN, type Call, type Handler } from './identity-mock';

/*
 * API BTC giả bằng `page.route`: `/v1/orgs`, `/v1/orgs/**` và `/v1/me/memberships` (xem `identity-mock.ts`).
 * Mặc định `GET /me/memberships` → `[]`; lời gọi không có handler → 500.
 */

export const ORG_ID = '019a3b2c-5678-7abc-8def-0123456789ab';
export const OTHER_ORG_ID = '019a3b2c-9999-7abc-8def-0123456789ab';

const ORGANIZER_PATH = /\/v1\/(orgs(\/|$)|me\/memberships$)/;

export const organization = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    id: ORG_ID,
    name: 'CLB Cờ Vua Quận 3',
    role: 'owner',
    contactPhone: null,
    contactEmail: null,
    createdAt: '2026-10-29T01:02:03.000Z',
    ...overrides,
  },
});

export async function mockOrganizerApi(page: Page, handlers: Record<string, Handler> = {}): Promise<Call[]> {
  const calls: Call[] = [];
  const cors = {
    'access-control-allow-origin': WEB_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'accept, content-type',
  };
  await page.route(
    (url) => ORGANIZER_PATH.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const path = new URL(request.url()).pathname.replace(/^.*\/v1/, '');
      const key = `${request.method()} ${path}`;
      calls.push({ method: request.method(), path, body: request.postDataJSON() as unknown });
      const handler = handlers[key] ?? (key === 'GET /me/memberships' ? () => ({ status: 200, body: [] }) : undefined);
      const reply = handler ? await handler(request) : apiError(500, 'INTERNAL_ERROR');
      return route.fulfill({
        status: reply.status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: reply.body === undefined ? '' : JSON.stringify(reply.body),
      });
    },
  );
  return calls;
}
