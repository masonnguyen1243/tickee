import type { Page, Request } from '@playwright/test';

import { PORT } from '../playwright.config';

/*
 * API `/v1/identity/*` giả bằng `page.route` (không cần api thật), dùng chung cho các spec đăng nhập.
 * Bản build phải có NEXT_PUBLIC_API_BASE_URL (nhúng lúc build); route khớp mọi host qua `**\/v1/identity/**`.
 */

export const WEB_ORIGIN = `http://localhost:${PORT}`;
export const EMAIL = 'an.nguyen@vidu.vn';
export const USER_ID = '019a3b2c-1234-7abc-8def-0123456789ab';

export type Reply = { status: number; body?: unknown };
export type Handler = (request: Request) => Reply | Promise<Reply>;
export type Call = { method: string; path: string; body: unknown };

export const apiError = (status: number, code: string, details: unknown = null): Reply => ({
  status,
  body: { error: { code, message: 'Lỗi giả lập', details } },
});

export const unauthenticated = (): Reply => apiError(401, 'UNAUTHENTICATED');
export const me = (consentedAt: string | null, twoFactorEnabled = false): Reply => ({
  status: 200,
  body: { id: USER_ID, email: EMAIL, consentedAt, twoFactorEnabled },
});

/** Giả lập `/v1/identity/*`; mặc định `me` → 401 (chưa đăng nhập). Trả về danh sách lời gọi để kiểm. */
export async function mockIdentityApi(page: Page, handlers: Record<string, Handler> = {}): Promise<Call[]> {
  const calls: Call[] = [];
  const cors = {
    'access-control-allow-origin': WEB_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'accept, content-type',
  };
  await page.route('**/v1/identity/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(request.url()).pathname.replace(/^.*\/v1/, '');
    const key = `${request.method()} ${path}`;
    calls.push({ method: request.method(), path, body: request.postDataJSON() as unknown });
    const handler = handlers[key] ?? (key === 'GET /identity/me' ? unauthenticated : undefined);
    const reply = handler ? await handler(request) : apiError(500, 'INTERNAL_ERROR');
    return route.fulfill({
      status: reply.status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: reply.body === undefined ? '' : JSON.stringify(reply.body),
    });
  });
  return calls;
}

