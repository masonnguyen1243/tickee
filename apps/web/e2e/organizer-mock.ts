import type { Page, Request } from '@playwright/test';
import type { EventSaleReason } from '@tickee/contracts';

import { hasCheckinMock } from './checkin-mock';
import { apiError, WEB_ORIGIN, type Call, type Handler } from './identity-mock';

/*
 * API BTC giả bằng `page.route`: `/v1/orgs`, `/v1/orgs/**`, `/v1/org-invitations/**`, `/v1/me/memberships`, và số liệu
 * check-in của tab Check-in (Story 5.7) `GET /v1/checkin/events/:eventId` cùng SSE `…/live` (xem `identity-mock.ts`;
 * spec nào cài thêm `mockCheckinApi`, trước hay sau, thì API CTV giả đó nhận mọi `/v1/checkin/**`). Mặc định
 * `GET /me/memberships`, `GET /orgs/:id/notices` (dashboard luôn tải dải banner) và
 * `GET /orgs/:id/events` (trang đích luôn tải danh sách Sự kiện), `GET /orgs/:id/events/:eventId/ticket-types` → `[]`,
 * `GET /orgs/:id/event-sale-status` (thẻ Sự kiện và badge Tổng quan, Story 4.2-c) → `{ events: [] }` (mọi nhãn tính ở
 * máy khách như trước),
 * `GET /orgs/:id/events/:eventId/form` → `{ questions: [] }`, `GET /orgs/:id/events/:eventId/publish-readiness` → bốn
 * điều kiện luôn có, đều đạt (`readyConditions`), `GET /orgs/:id/events/:eventId/overview` → chưa có Đơn
 * (`emptyOverview`), SSE `GET /orgs/:id/events/:eventId/overview/live` → 503 (không realtime: polling 10 giây),
 * `GET /orgs/:id/events/:eventId/orders` (tab Đơn, Story 6.1) → chưa có Đơn (`emptyOrderPage`),
 * `GET /orgs/:id/events/:eventId/orders/:code` → 404 `ORDER_NOT_FOUND`, SSE cấp
 * BTC `GET /orgs/:id/live` (khung dashboard luôn mở, Story 4.2-b) → 503 (dải banner polling 10 giây),
 * `GET /orgs/:id/review-items/summary` (badge "Cần xử lý" của khung, Story 4.3) → `{ openCount: 0 }`,
 * `GET /orgs/:id/review-items` (trang Cần xử lý) → hàng trống không lọc, `GET /orgs/:id/token` (trang Token, Story 4.5-a)
 * → BTC chưa có tài khoản nhận tiền mặc định, không có link portal, chưa đặt ngưỡng cảnh báo (Story 4.5-b),
 * `GET /orgs/:id/events/:eventId/checkers` (tab Check-in, Story 5.6) → chưa có CTV, `GET /checkin/events/:eventId` (khối
 * `checkin-progress` của tab Check-in, Story 5.7) → chưa có Hạng vé, Vé nào (`emptyCheckinEvent`), SSE
 * `GET /checkin/events/:eventId/live` → 503 (không realtime: polling 10 giây); lời gọi không có handler → 500.
 *
 * Ảnh Sự kiện (Story 4.8-b): `presignReply` cho handler `POST /orgs/:id/event-images`, `mockImageStorage` giả object
 * storage (host riêng, không qua api) cho PUT của trình duyệt và ảnh công khai.
 */

export const ORG_ID = '019a3b2c-5678-7abc-8def-0123456789ab';
export const OTHER_ORG_ID = '019a3b2c-9999-7abc-8def-0123456789ab';

const ORGANIZER_PATH = /\/v1\/(orgs(\/|$)|org-invitations\/|me\/memberships$|checkin\/events\/[^/]+(\/live)?$)/;
const CHECKIN_PATH = /\/v1\/checkin\//;
const NOTICES_KEY = /^GET \/orgs\/[^/]+\/notices$/;
const EVENTS_KEY = /^GET \/orgs\/[^/]+\/events$/;
const TICKET_TYPES_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/ticket-types$/;
const EVENT_FORM_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/form$/;
const READINESS_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/publish-readiness$/;
const OVERVIEW_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/overview$/;
const OVERVIEW_LIVE_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/overview\/live$/;
const EVENT_ORDERS_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/orders$/;
const EVENT_ORDER_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/orders\/[^/]+$/;
const ORG_LIVE_KEY = /^GET \/orgs\/[^/]+\/live$/;
const SALE_STATUS_KEY = /^GET \/orgs\/[^/]+\/event-sale-status$/;
const REVIEW_SUMMARY_KEY = /^GET \/orgs\/[^/]+\/review-items\/summary$/;
const REVIEW_ITEMS_KEY = /^GET \/orgs\/[^/]+\/review-items$/;
const TOKEN_KEY = /^GET \/orgs\/[^/]+\/token$/;
const CHECKERS_KEY = /^GET \/orgs\/[^/]+\/events\/[^/]+\/checkers$/;
const CHECKIN_EVENT_KEY = /^GET \/checkin\/events\/([^/]+)$/;
const CHECKIN_EVENT_LIVE_KEY = /^GET \/checkin\/events\/[^/]+\/live$/;

/** Đường SSE cấp BTC (Story 4.2-b), để `fakeEventSource` chọn đúng stream giữa stream của khung và stream của trang. */
export const ORG_LIVE_URL = /\/v1\/orgs\/[^/]+\/live$/;

/** `CheckinEvent` (Story 5.7) của Sự kiện chưa có Hạng vé, Vé nào: tổng 0/0. */
export const emptyCheckinEvent = (eventId: string) => ({
  eventId,
  eventName: 'Sự kiện',
  checkedInCount: 0,
  validTicketCount: 0,
  ticketTypes: [],
});

/**
 * `EventOverview` của Sự kiện chưa có Đơn nào (Story 3.11), không có mục Cần xử lý (Story 4.3), chưa có Vé hay Hạng vé
 * nào (Story 6.2: check-in 0/0, không có khối "Vé theo Hạng vé").
 */
export const emptyOverview = () => ({
  revenue: { amount: 0, paidOrders: 0 },
  recentOrders: [],
  openReviewCount: 0,
  checkin: { checkedInCount: 0, validTicketCount: 0 },
  ticketTypes: [],
});

/** `EventOrderPage` của Sự kiện chưa có Đơn nào (tab Đơn, Story 6.1). */
export const emptyOrderPage = () => ({ orders: [], nextCursor: null });

/** Một lần đọc Token được (`TokenReading` `ok`, Story 4.5-a): khả dụng = số dư + hạn mức như api. */
export const tokenReading = (balance: number, creditLimit: number, readAt = '2026-11-16T03:04:05.000Z') => ({
  status: 'ok',
  balance,
  creditLimit,
  available: balance + creditLimit,
  readAt,
});

/** Trạng thái cảnh báo Token (`TokenAlert`, Story 4.5-b): mặc định chưa đặt ngưỡng, không dưới ngưỡng. */
export const tokenAlert = (threshold: number | null = null, belowThresholdSince: string | null = null) => ({
  threshold,
  belowThresholdSince,
});

/**
 * `TokenOverview` (Story 4.5-a): `tingeePortalUrl` chỉ khi truyền (api chỉ trả cho Owner); `alert` (Story 4.5-b) mặc
 * định chưa đặt ngưỡng.
 */
export const tokenOverview = (
  reading: unknown = { status: 'no_payout_account' },
  tingeePortalUrl?: string,
  alert: ReturnType<typeof tokenAlert> = tokenAlert(),
) => ({
  reading,
  ...(tingeePortalUrl === undefined ? {} : { tingeePortalUrl }),
  alert,
});

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
  // Tab Đơn (Story 6.1): mặc định chưa có Đơn nào; chi tiết một Đơn → không tìm thấy.
  if (EVENT_ORDERS_KEY.test(key)) return () => ({ status: 200, body: emptyOrderPage() });
  if (EVENT_ORDER_KEY.test(key)) return () => apiError(404, 'ORDER_NOT_FOUND');
  // Dải banner của khung dashboard mở SSE cấp BTC (Story 4.2-b): mặc định không realtime.
  if (ORG_LIVE_KEY.test(key)) return () => apiError(503, 'SERVICE_UNAVAILABLE');
  // Nhãn trạng thái bán của thẻ Sự kiện và badge Tổng quan (Story 4.2-c): mặc định không có Sự kiện nào → nhãn dự phòng.
  if (SALE_STATUS_KEY.test(key)) return () => ({ status: 200, body: { events: [] } });
  // Khung dashboard luôn tải số mục Cần xử lý cho badge (Story 4.3): mặc định 0 (không badge).
  if (REVIEW_SUMMARY_KEY.test(key)) return () => ({ status: 200, body: { openCount: 0 } });
  if (REVIEW_ITEMS_KEY.test(key)) return () => ({ status: 200, body: { event: null, items: [] } });
  // Trang Token (Story 4.5-a): mặc định chưa có tài khoản nhận tiền mặc định (api không gọi Tingee), không link portal.
  if (TOKEN_KEY.test(key)) return () => ({ status: 200, body: tokenOverview() });
  // Tab Check-in luôn tải danh sách CTV (Story 5.6): mặc định chưa CTV nào nhận lời mời.
  if (CHECKERS_KEY.test(key)) return () => ({ status: 200, body: { checkers: [] } });
  // Tab Check-in luôn tải số liệu check-in và mở SSE (Story 5.7): mặc định chưa có Vé, không realtime.
  const checkinEvent = CHECKIN_EVENT_KEY.exec(key);
  if (checkinEvent) return () => ({ status: 200, body: emptyCheckinEvent(decodeURIComponent(checkinEvent[1]!)) });
  if (CHECKIN_EVENT_LIVE_KEY.test(key)) return () => apiError(503, 'SERVICE_UNAVAILABLE');
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
  PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED: { severity: 'danger', blocking: true },
  PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: { severity: 'danger', blocking: true },
  token_below_threshold: { severity: 'warning', blocking: false },
};

/** Mã notice theo lý do ngắt dịch vụ thanh toán (như `PAYMENT_SERVICE_NOTICE_CODES` của contracts). */
export const PAYMENT_SERVICE_NOTICE: Record<string, string> = {
  token: 'PAYMENT_SERVICE_SUSPENDED_TOKEN',
  credential_invalid: 'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
  gateway_permission_missing: 'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
  payout_account_not_allowed: 'PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED',
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
    // `x-reauth-token`: lần xác nhận lại của thao tác nhạy cảm (Story 2.13). `idempotency-key`: thao tác trên mục Cần
    // xử lý (Story 4.4).
    'access-control-allow-headers': 'accept, content-type, x-reauth-token, idempotency-key',
  };
  await page.route(
    (url) => ORGANIZER_PATH.test(url.pathname),
    async (route) => {
      const request = route.request();
      // Trang có API CTV giả (cài trước `mockOrganizerApi`): nhường cho nó.
      if (CHECKIN_PATH.test(new URL(request.url()).pathname) && hasCheckinMock(page)) return route.fallback();
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

// ---------------------------------------------------------------------------------------------------------------
// Ảnh Sự kiện (Story 4.8-b)
// ---------------------------------------------------------------------------------------------------------------

/** Object storage giả: host riêng, trình duyệt PUT thẳng vào đây (CORS) rồi đọc ảnh công khai. */
export const STORAGE_ORIGIN = 'http://storage.test';
const STORAGE_BUCKET = `${STORAGE_ORIGIN}/tickee-event-images`;

/** Key ảnh Sự kiện thứ `n` của BTC giả, đúng dạng `orgs/{orgId}/events/{uuid}.{ext}`. */
export const eventImageKey = (n: number, ext: 'jpg' | 'png' | 'webp' = 'png') =>
  `orgs/${ORG_ID}/events/019a3b2c-0a00-7abc-8def-${String(n).padStart(12, '0')}.${ext}`;

/** URL công khai của `key` trên storage giả (`S3_PUBLIC_BASE_URL/{key}`). */
export const eventImageUrl = (key: string) => `${STORAGE_BUCKET}/${key}`;

/** URL upload (presigned PUT) của `key` trên storage giả. */
export const eventImageUploadUrl = (key: string) => `${STORAGE_BUCKET}/${key}?X-Amz-Signature=e2e`;

/** Phản hồi `POST /orgs/:id/event-images`: presign cho `key`, hạn sau `ttlMs` (mặc định 5 phút như api). */
export const presignReply = (key: string, ttlMs = 5 * 60_000) => ({
  status: 200,
  body: { key, uploadUrl: eventImageUploadUrl(key), expiresAt: new Date(Date.now() + ttlMs).toISOString() },
});

/** PNG 1×1 hợp lệ: storage giả trả cho mọi `GET` ảnh có trong `objects` lúc khởi tạo hoặc đã PUT. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Một lần PUT trình duyệt gửi lên storage giả. */
export type StoragePut = { key: string; contentType: string | undefined; body: Buffer | null };

export type ImageStorageOptions = {
  /** Key đã có trên storage (ảnh hiện có của Sự kiện): `GET` trả PNG. Key khác chưa PUT → 404. */
  objects?: string[];
  /** Mã trạng thái của PUT (mặc định 200); `'abort'` = mất mạng. Gọi trước khi ghi nhận object. */
  put?: (request: Request) => number | 'abort' | Promise<number | 'abort'>;
};

/**
 * Giả object storage bằng `page.route` theo host: `OPTIONS` (preflight của PUT) → 204 cho phép `PUT` và `content-type`;
 * `PUT` ghi lại `content-type` và byte nhận được; `GET` trả PNG nhỏ cho object đã có. Trả danh sách lần PUT.
 */
export async function mockImageStorage(page: Page, { objects = [], put }: ImageStorageOptions = {}): Promise<StoragePut[]> {
  const puts: StoragePut[] = [];
  const stored = new Set(objects);
  const cors = {
    'access-control-allow-origin': WEB_ORIGIN,
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': 'content-type',
  };
  await page.route(
    (url) => url.origin === STORAGE_ORIGIN,
    async (route) => {
      const request = route.request();
      const key = decodeURIComponent(new URL(request.url()).pathname.replace(/^\/tickee-event-images\//, ''));
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (request.method() === 'PUT') {
        const status = put ? await put(request) : 200;
        if (status === 'abort') return route.abort('internetdisconnected');
        puts.push({ key, contentType: request.headers()['content-type'], body: request.postDataBuffer() });
        if (status < 300) stored.add(key);
        // PUT bị giữ có thể đã bị trình duyệt hủy (chọn ảnh khác, "Gỡ ảnh"): trả lời muộn thì bỏ qua lỗi.
        return route.fulfill({ status, headers: cors, body: '' }).catch(() => undefined);
      }
      if (request.method() === 'GET' && stored.has(key)) {
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: TINY_PNG });
      }
      return route.fulfill({ status: 404, headers: cors, body: '' });
    },
  );
  return puts;
}
