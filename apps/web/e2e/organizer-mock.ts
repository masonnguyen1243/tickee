import type { Page } from '@playwright/test';
import type { EventSaleReason } from '@tickee/contracts';

import { apiError, WEB_ORIGIN, type Call, type Handler } from './identity-mock';

/*
 * API BTC giả bằng `page.route`: `/v1/orgs`, `/v1/orgs/**`, `/v1/org-invitations/**` và `/v1/me/memberships`
 * (xem `identity-mock.ts`). Mặc định `GET /me/memberships`, `GET /orgs/:id/notices` (dashboard luôn tải dải banner) và
 * `GET /orgs/:id/events` (trang đích luôn tải danh sách Sự kiện), `GET /orgs/:id/events/:eventId/ticket-types` → `[]`,
 * `GET /orgs/:id/event-sale-status` (thẻ Sự kiện và badge Tổng quan, Story 4.2-c) → `{ events: [] }` (mọi nhãn tính ở
 * máy khách như trước),
 * `GET /orgs/:id/events/:eventId/form` → `{ questions: [] }`, `GET /orgs/:id/events/:eventId/publish-readiness` → bốn
 * điều kiện luôn có, đều đạt (`readyConditions`), `GET /orgs/:id/events/:eventId/overview` → chưa có Đơn
 * (`emptyOverview`), SSE `GET /orgs/:id/events/:eventId/overview/live` → 503 (không realtime: polling 10 giây), SSE cấp
 * BTC `GET /orgs/:id/live` (khung dashboard luôn mở, Story 4.2-b) → 503 (dải banner polling 10 giây); lời gọi không có
 * handler → 500.
 */

export const ORG_ID = '019a3b2c-5678-7abc-8def-0123456789ab';
export const OTHER_ORG_ID = '019a3b2c-9999-7abc-8def-0123456789ab';

const ORGANIZER_PATH = /\/v1\/(orgs(\/|$)|org-invitations\/|me\/memberships$)/;
const NOTICES_KEY = /^GET \/orgs\/[^/]+\/notices$/;
const EVENTS_KEY = /^GET \/orgs\/[^/]+\/events$/;
const TICKET_TYPES_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/ticket-types$/;
const EVENT_FORM_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/form$/;
const READINESS_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/publish-readiness$/;
const OVERVIEW_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/overview$/;
const OVERVIEW_LIVE_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/overview\/live$/;
const ORG_LIVE_KEY = /^GET \/orgs\/[^/]+\/live$/;
const SALE_STATUS_KEY = /^GET \/orgs\/[^/]+\/event-sale-status$/;

/** Đường SSE cấp BTC (Story 4.2-b), để `fakeEventSource` chọn đúng stream giữa stream của khung và stream của trang. */
export const ORG_LIVE_URL = /\/v1\/orgs\/[^/]+\/live$/;

/** `EventOverview` của Sự kiện chưa có Đơn nào (Story 3.11). */
export const emptyOverview = () => ({ revenue: { amount: 0, paidOrders: 0 }, recentOrders: [] });

/** Bốn điều kiện mở bán luôn có (Story 2.10). */
export const ALWAYS_CONDITIONS = ['REFUND_POLICY', 'HAS_TICKET_TYPE', 'EVENT_NOT_ENDED', 'ORGANIZATION_NOT_LOCKED'];

/** `PublishReadiness` với các mã `codes`, đều đạt trừ các mã trong `unmet`. */
export const readiness = (codes: readonly string[] = ALWAYS_CONDITIONS, unmet: readonly string[] = []) => ({
  conditions: codes.map((code) => ({ code, satisfied: !unmet.includes(code) })),
});

/** Handler mặc định khi spec không khai báo. */
function defaultHandler(key: string): Handler | undefined {
  if (key === 'GET /me/memberships') return () => ({ status: 200, body: [] });
  if (NOTICES_KEY.test(key)) return () => ({ status: 200, body: [] });
  // Trang đích BTC luôn tải danh sách Sự kiện (Story 2.7): mặc định chưa có Sự kiện nào.
  if (EVENTS_KEY.test(key)) return () => ({ status: 200, body: [] });
  // Wizard bước 2 và tab "Hạng vé" luôn tải Hạng vé (Story 2.8): mặc định chưa có Hạng vé nào.
  if (TICKET_TYPES_KEY.test(key)) return () => ({ status: 200, body: [] });
  // Wizard bước 3–4 và tab "Form mua" luôn tải form mua (Story 2.9): mặc định chưa có câu hỏi riêng.
  if (EVENT_FORM_KEY.test(key)) return () => ({ status: 200, body: { questions: [] } });
  // Wizard bước 4 luôn tải điều kiện mở bán (Story 2.10): mặc định Sự kiện miễn phí đủ điều kiện.
  if (READINESS_KEY.test(key)) return () => ({ status: 200, body: readiness() });
  // Tab Tổng quan của Sự kiện đã rời nháp luôn tải số liệu và mở SSE (Story 3.11): mặc định chưa có Đơn, không realtime.
  if (OVERVIEW_KEY.test(key)) return () => ({ status: 200, body: emptyOverview() });
  if (OVERVIEW_LIVE_KEY.test(key)) return () => apiError(503, 'SERVICE_UNAVAILABLE');
  // Dải banner của khung dashboard mở SSE cấp BTC (Story 4.2-b): mặc định không realtime.
  if (ORG_LIVE_KEY.test(key)) return () => apiError(503, 'SERVICE_UNAVAILABLE');
  // Nhãn trạng thái bán của thẻ Sự kiện và badge Tổng quan (Story 4.2-c): mặc định không có Sự kiện nào → nhãn dự phòng.
  if (SALE_STATUS_KEY.test(key)) return () => ({ status: 200, body: { events: [] } });
  return undefined;
}

/** Một dòng của `GET /orgs/:id/event-sale-status` (Story 4.2-c). */
export const saleStatus = (eventId: string, reason: EventSaleReason | null = null, partial = false) => ({
  eventId,
  reason,
  partial,
});

/** Mức độ và chặn bán mặc định của từng mã, giống api (`reporting.notices`). */
const NOTICE_DEFAULTS: Record<string, { severity: string; blocking: boolean }> = {
  CLOSED_BETA_REVOKED: { severity: 'danger', blocking: true },
  CLOSED_BETA_PENDING: { severity: 'warning', blocking: false },
  PAYOUT_ACCOUNT_NOT_LINKED: { severity: 'danger', blocking: true },
  PAYMENT_SERVICE_SUSPENDED_TOKEN: { severity: 'danger', blocking: true },
  PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID: { severity: 'danger', blocking: true },
  PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING: { severity: 'danger', blocking: true },
  PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: { severity: 'danger', blocking: true },
};

/** Mã notice theo lý do ngắt dịch vụ thanh toán (như `PAYMENT_SERVICE_NOTICE_CODES` của contracts). */
export const PAYMENT_SERVICE_NOTICE: Record<string, string> = {
  token: 'PAYMENT_SERVICE_SUSPENDED_TOKEN',
  credential_invalid: 'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
  gateway_permission_missing: 'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
  tingee_disabled: 'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
};

/** Một thông báo trạng thái (`StatusNotice`) cho `GET /orgs/:id/notices`. */
export const statusNotice = (code: string, overrides: Record<string, unknown> = {}) => ({
  code,
  severity: NOTICE_DEFAULTS[code]?.severity ?? 'warning',
  blocking: NOTICE_DEFAULTS[code]?.blocking ?? false,
  dismissible: false,
  scope: 'organization',
  audience: ['owner', 'admin'],
  data: {},
  version: '2026-11-02T01:02:03.000Z',
  ...overrides,
});

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
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    // `x-reauth-token`: lần xác nhận lại của thao tác nhạy cảm (Story 2.13).
    'access-control-allow-headers': 'accept, content-type, x-reauth-token',
  };
  await page.route(
    (url) => ORGANIZER_PATH.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const path = new URL(request.url()).pathname.replace(/^.*\/v1/, '');
      const key = `${request.method()} ${path}`;
      calls.push({ method: request.method(), path, body: request.postDataJSON() as unknown });
      const handler = handlers[key] ?? defaultHandler(key);
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
