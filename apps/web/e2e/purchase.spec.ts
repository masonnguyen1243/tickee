import type { Locator, Page, Route } from '@playwright/test';

import { PORT_PUBLIC_EVENT } from '../playwright.config';
import { expect, test } from './fixtures';
import {
  apiError,
  corsHeaders,
  EMAIL,
  me,
  mockIdentityApi,
  unauthenticated,
  type Handler,
  type Reply,
} from './identity-mock';
import {
  SLUG_BUY,
  SLUG_DRAFT,
  SLUG_FREE,
  SLUG_HIDDEN,
  TIER_FREE_ID,
  TIER_FREE_ONLY_ID,
  TIER_PAID_ID,
} from './public-event-api';
import { expectQrImageEncodes } from './qr-image';

/*
 * Story 3.1: chọn Vé trên trang Sự kiện (`quantity-stepper`, `purchase-bar`), bấm "Mua" → đăng nhập → Checkout đúng
 * lựa chọn, phễu `buy_clicked`/`login_completed`. Story 3.2: form mua ở Checkout, "Gửi Đơn" (lỗi tại trường, hết chỗ,
 * Đơn chờ, lỗi mạng rồi "Thử lại" cùng khóa) và trang Đơn `/orders/:code`. Phần tĩnh (trang Sự kiện và Checkout) SSR
 * từ API giả `e2e/public-event-api.ts`; `/availability`, `/funnel-events`, `/identity/*`, `/checkout`, `/orders` và
 * `/me/orders` gọi từ trình duyệt nên giả bằng `page.route`. Sự kiện `SLUG_BUY`: "Vé phổ thông" 0đ rồi "Vé VIP"
 * 300.000đ, giới hạn 4 Vé/Đơn. Story 3.4: màn thanh toán của Trang Đơn (`payment-summary`, `recipient-trust-block`,
 * `countdown-chip`), redirect toàn trang sang trang Tingee giả (`CHECKOUT_URL`), "Thử lại" tạo link, đồng hồ về 0
 * (`page.clock`), tạm ngừng bán.
 */

const ORIGIN = `http://localhost:${PORT_PUBLIC_EVENT}`;
test.use({ baseURL: ORIGIN });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VIP = 'Vé VIP';
const BASIC = 'Vé phổ thông';
const CHECKOUT = `/e/${SLUG_BUY}/checkout`;

type Tier = { ticketTypeId: string; status: string; remaining: number; saleStartsAt: null };
type Availability = { eventReason: string | null; tiers: Tier[] };

const tier = (ticketTypeId: string, patch: Partial<Tier> = {}): Tier => ({
  ticketTypeId,
  status: 'on_sale',
  remaining: 50,
  saleStartsAt: null,
  ...patch,
});
const ok = (tiers: Tier[], eventReason: string | null = null): Availability => ({ eventReason, tiers });
const ON_SALE = ok([tier(TIER_FREE_ID, { remaining: 20 }), tier(TIER_PAID_ID, { remaining: 3 })]);

/** Giả `/availability`; trả về hàm đổi phản hồi. */
async function mockAvailability(page: Page, initial: Availability) {
  let body = initial;
  await page.route('**/v1/events/*/availability', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(body),
    }),
  );
  return {
    set: (next: Availability) => {
      body = next;
    },
  };
}

type FunnelCall = { slug: string; body: { type: string; funnelId: string; loginRequired?: boolean } };

/** Giả `POST /v1/events/:slug/funnel-events` (204, hoặc lỗi mạng khi `fail`); trả về danh sách lời gọi. */
async function mockFunnel(page: Page, { fail = false } = {}): Promise<FunnelCall[]> {
  const calls: FunnelCall[] = [];
  const cors = {
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  await page.route('**/v1/events/*/funnel-events', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const slug = decodeURIComponent(/\/events\/([^/]+)\/funnel-events/.exec(request.url())![1]!);
    calls.push({ slug, body: request.postDataJSON() as FunnelCall['body'] });
    if (fail) return route.abort('failed');
    return route.fulfill({ status: 204, headers: cors });
  });
  return calls;
}

const ORDER_CODE = 'TK8F3Q2AXM';
const Q_SIZE = '019a3b2c-0900-7abc-8def-000000000001';
const Q_LEVEL = '019a3b2c-0900-7abc-8def-000000000002';
const OPT_BEGINNER = '019a3b2c-0a00-7abc-8def-000000000001';
const OPT_GOOD = '019a3b2c-0a00-7abc-8def-000000000002';
const Q_SHIRT = '019a3b2c-0900-7abc-8def-000000000003';
const QUESTIONS = [
  { id: Q_SIZE, position: 0, label: 'Size áo', kind: 'text', required: true, options: [] },
  {
    id: Q_LEVEL,
    position: 1,
    label: 'Trình độ',
    kind: 'choice',
    required: true,
    options: [
      { id: OPT_BEGINNER, label: 'Mới chơi' },
      { id: OPT_GOOD, label: 'Khá' },
    ],
  },
  {
    id: Q_SHIRT,
    position: 2,
    label: 'Nhận áo',
    kind: 'choice',
    required: false,
    options: [
      { id: '019a3b2c-0a00-7abc-8def-000000000003', label: 'Có' },
      { id: '019a3b2c-0a00-7abc-8def-000000000004', label: 'Không' },
    ],
  },
];
const PREFILL = { name: 'Nguyễn Văn An', phone: '+84912345678', email: EMAIL };

/** Trang thanh toán của Tingee (giả): "Thanh toán" redirect toàn trang tới đây. */
const CHECKOUT_URL = `https://pay.tingee.test/checkout/${ORDER_CODE}?r=1`;
const ORGANIZER = 'CLB Chạy Bộ Phố Cổ';
const SERVER_NOW = '2026-11-10T01:00:00.000Z';
/** Phần thanh toán giả (Story 3.4): đã có link, người nhận là tài khoản mặc định của BTC. */
const payment = (patch: Record<string, unknown> = {}) => ({
  checkoutUrl: CHECKOUT_URL,
  linkError: null,
  recipient: { organizationName: ORGANIZER, accountName: 'NGUYEN VAN TUAN', bankName: 'Vietcombank' },
  ...patch,
});

/** `BuyerOrderView` giả (Đơn 2 Vé VIP, đang chờ thanh toán, đã có link thanh toán 15 phút). */
const buyerOrder = (patch: Record<string, unknown> = {}) => ({
  code: ORDER_CODE,
  buyerStatus: 'awaiting_payment',
  event: { slug: SLUG_BUY, name: 'Giải chạy Hồ Gươm mùa thu 2026', startsAt: '2099-11-15T07:00:00+07:00' },
  items: [{ ticketTypeId: TIER_PAID_ID, name: VIP, unitPrice: 300_000, quantity: 2, amount: 600_000 }],
  totalAmount: 600_000,
  buyer: { name: 'Nguyễn Văn An', phone: '+84912345678', email: EMAIL },
  answers: [{ questionId: Q_SIZE, label: 'Size áo', answer: 'M' }],
  refundPolicy: 'Hoàn 100% nếu hủy trước 7 ngày.',
  createdAt: '2026-11-10T01:00:00.000Z',
  expiresAt: '2026-11-10T01:15:00.000Z',
  serverNow: SERVER_NOW,
  payment: payment(),
  tickets: [],
  organizer: { name: ORGANIZER, contactPhone: '0901234567', contactEmail: 'lienhe@clbchaybo.vn' },
  ...patch,
});

const FREE_CODE = 'TKFREE2345';
const FREE_EVENT_NAME = 'Workshop pha cà phê miễn phí';
const FREE_TIER = 'Vé tham dự';
/** Id Vé giả thứ `n` (uuid, nhóm cuối 12 chữ số). */
const ticketId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
/** Mã QR vé giả đúng mẫu `t<k>.<ticketId>.<sig>` (Story 3.3): chữ ký đúng 43 ký tự base64url. */
const ticketQr = (n: number) => `t1.${ticketId(n)}.${String(n).padStart(43, 'q')}`;
/** Token link chia sẻ giả (Story 3.8): 22 ký tự base64url. */
const shareToken = (n: number) => `share${String(n).padStart(17, 'S')}`;
/** Đơn 0đ đã `paid` với `count` Vé (Story 3.3). */
const freeOrder = (count = 2) =>
  buyerOrder({
    code: FREE_CODE,
    buyerStatus: 'paid',
    event: { slug: SLUG_FREE, name: FREE_EVENT_NAME, startsAt: '2099-11-15T07:00:00+07:00' },
    items: [{ ticketTypeId: TIER_FREE_ONLY_ID, name: FREE_TIER, unitPrice: 0, quantity: count, amount: 0 }],
    totalAmount: 0,
    payment: null,
    tickets: Array.from({ length: count }, (_, i) => ({
      id: ticketId(i + 1),
      seq: i + 1,
      count,
      ticketTypeName: FREE_TIER,
      holderName: 'Nguyễn Văn An',
      qr: ticketQr(i + 1),
      shareToken: shareToken(i + 1),
    })),
  });

type OrderCall = { key: string | null; body: Record<string, unknown> };
type OrdersMockOptions = {
  /** Phần tự điền của `GET …/checkout`. */
  buyer?: { name: string; phone: string | null; email: string };
  /** Phản hồi của lần gửi Đơn thứ `n` (từ 0); `'abort'` = lỗi mạng. Mặc định 201 `buyerOrder()`. */
  submit?: (call: OrderCall, n: number) => Reply | 'abort';
  /** `GET /me/orders/:code` theo mã; mã khác → 404 `ORDER_NOT_FOUND`. */
  orders?: Record<string, Reply>;
  /** Phản hồi của lần thử lại link thứ `n` (`POST /me/orders/:code/payment-link`); mặc định 404. */
  retryLink?: (code: string, n: number) => Reply | Promise<Reply>;
};

/** SSE `GET /me/orders/:code/live` giả của spec này: luôn 503 (không có realtime), Trang Đơn rơi về polling. */
const NO_LIVE: Reply = apiError(503, 'SERVICE_UNAVAILABLE');

/**
 * Giả `GET /events/:slug/checkout`, `POST /events/:slug/orders`, `GET /me/orders/:code`, `POST
 * /me/orders/:code/payment-link` và SSE `GET /me/orders/:code/live` (503: realtime ở `order-live.spec.ts`); trả về các
 * lần gửi Đơn, số lần tải form mua và mã Đơn của các lần thử lại link.
 */
async function mockOrders(
  page: Page,
  options: OrdersMockOptions = {},
): Promise<{ calls: OrderCall[]; checkoutLoads: () => number; retries: string[] }> {
  const cors = corsHeaders(ORIGIN);
  const calls: OrderCall[] = [];
  let checkoutLoads = 0;
  const submit = options.submit ?? ((): Reply => ({ status: 201, body: buyerOrder() }));
  const orders = options.orders ?? { [ORDER_CODE]: { status: 200, body: buyerOrder() } };
  const reply = (route: Route, r: Reply) =>
    route.fulfill({
      status: r.status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: r.body === undefined ? '' : JSON.stringify(r.body),
    });
  await page.route('**/v1/events/*/checkout', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    checkoutLoads += 1;
    return reply(route, { status: 200, body: { questions: QUESTIONS, buyer: options.buyer ?? PREFILL } });
  });
  await page.route('**/v1/events/*/orders', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const call = { key: request.headers()['idempotency-key'] ?? null, body: request.postDataJSON() as Record<string, unknown> };
    calls.push(call);
    const result = submit(call, calls.length - 1);
    return result === 'abort' ? route.abort('failed') : reply(route, result);
  });
  await page.route('**/v1/me/orders/*', (route) => {
    const code = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    return reply(route, orders[code] ?? apiError(404, 'ORDER_NOT_FOUND'));
  });
  await page.route('**/v1/me/orders/*/live', (route) => reply(route, NO_LIVE));
  const retries: string[] = [];
  await page.route('**/v1/me/orders/*/payment-link', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const code = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2)!);
    retries.push(code);
    const result = options.retryLink ? await options.retryLink(code, retries.length - 1) : apiError(404, 'ORDER_NOT_FOUND');
    return reply(route, result);
  });
  return { calls, checkoutLoads: () => checkoutLoads, retries };
}

/** `/identity/*` giả với `me` đổi theo trạng thái đăng nhập; OTP gửi/nhận luôn thành công. Kèm Checkout/Đơn giả mặc định. */
async function mockAccount(page: Page, initial: { signedIn: boolean; consentRequired?: boolean }) {
  await mockOrders(page);
  /** `meFails`: `me` trả 500 (api lỗi), bất kể trạng thái đăng nhập. */
  const state = { signedIn: initial.signedIn, consentedAt: initial.consentRequired ? null : CONSENTED, meFails: false };
  const handlers: Record<string, Handler> = {
    'GET /identity/me': () => {
      if (state.meFails) return apiError(500, 'INTERNAL_ERROR');
      return state.signedIn ? me(state.consentedAt) : unauthenticated();
    },
    'POST /identity/otp': (): Reply => ({ status: 200, body: { resendAfterSeconds: 60 } }),
    'POST /identity/otp/verify': (): Reply => {
      state.signedIn = true;
      return { status: 200, body: { consentRequired: state.consentedAt === null } };
    },
    'POST /identity/consent': () => {
      state.consentedAt = CONSENTED;
      return me(CONSENTED);
    },
  };
  const calls = await mockIdentityApi(page, handlers, { origin: ORIGIN });
  return { state, calls };
}

const stepperValue = (page: Page, name: string) =>
  page.getByRole('group', { name: `Số vé ${name}` }).locator('[data-slot="quantity-stepper-value"]');
const plus = (page: Page, name: string) => page.getByRole('button', { name: `Tăng số vé ${name}` });
const minus = (page: Page, name: string) => page.getByRole('button', { name: `Giảm số vé ${name}` });
const bar = (page: Page) => page.locator('[data-slot="purchase-bar"]');

async function pick(page: Page, name: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await plus(page, name).click();
  await expect(stepperValue(page, name)).toHaveText(String(times));
}

/** Ở trần: bấm "+" bằng Enter và Space không tăng số Vé, không đổi tổng. */
async function expectPlusBlockedByKeyboard(page: Page, name: string, value: string, total: string): Promise<void> {
  await plus(page, name).focus();
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key);
    await expect(stepperValue(page, name)).toHaveText(value);
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText(total);
  }
  await expect(plus(page, name)).toBeFocused();
}

/** `returnTo` của màn đăng nhập hiện tại, tách thành đường dẫn và query. */
function returnToOf(page: Page): URL {
  const returnTo = new URL(page.url()).searchParams.get('returnTo');
  expect(returnTo).toBeTruthy();
  return new URL(returnTo!, ORIGIN);
}

async function expectSummary(page: Page, lines: string[], count: number, total: string): Promise<void> {
  const summary = page.locator('[data-slot="order-summary"]');
  await expect(page.getByRole('heading', { level: 1, name: 'Tóm tắt Đơn' })).toBeVisible();
  await expect(summary.locator('[data-slot="order-summary-line"]')).toHaveText(lines);
  await expect(summary.locator('[data-slot="order-summary-count"]')).toHaveText(`Tổng · ${count} vé`);
  await expect(summary.locator('[data-slot="order-summary-total"]')).toHaveText(total);
}

async function signInWithOtp(page: Page): Promise<void> {
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input').first().fill('123456');
}

const switchTabAway = (page: Page) =>
  page.evaluate(() => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    };
    setVisibility('hidden');
    setVisibility('visible');
  });

test.describe('chọn Vé', () => {
  test.beforeEach(async ({ page }) => {
    await mockAccount(page, { signedIn: false });
    await mockFunnel(page);
  });

  test('stepper: trần "+" = min(số còn lại, giới hạn còn lại), aria-label, tổng tức thì', async ({ page }) => {
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);

    await expect(page.locator('[data-slot="order-limit-note"]')).toContainText('Tối đa 4 vé mỗi Đơn');
    await expect(stepperValue(page, VIP)).toHaveText('0');
    await expect(minus(page, VIP)).toBeDisabled();

    // VIP còn 3: chọn 3 thì "+" của VIP tắt (hết chỗ).
    await pick(page, VIP, 3);
    await expect(plus(page, VIP)).toBeDisabled();
    await expect(bar(page)).toContainText('Tổng · 3 vé');
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText('900.000đ');
    await expectPlusBlockedByKeyboard(page, VIP, '3', '900.000đ');
    // Lý do "+" tắt được đọc kèm nút: dòng "Tối đa N vé mỗi Đơn".
    const noteId = await plus(page, VIP).getAttribute('aria-describedby');
    expect(noteId).toBeTruthy();
    await expect(page.locator(`[id="${noteId}"]`)).toHaveAttribute('data-slot', 'order-limit-note');
    await expect(plus(page, BASIC)).toHaveAttribute('aria-describedby', noteId!);

    // Phổ thông còn 20 nhưng giới hạn 4: "+" tắt ở 1.
    await expect(plus(page, BASIC)).toBeEnabled();
    await plus(page, BASIC).click();
    await expect(stepperValue(page, BASIC)).toHaveText('1');
    await expect(plus(page, BASIC)).toBeDisabled();
    await expect(bar(page)).toContainText('Tổng · 4 vé');
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText('900.000đ');
    await expectPlusBlockedByKeyboard(page, BASIC, '1', '900.000đ');
    await expect(bar(page)).toContainText('Tổng · 4 vé');
    await expect(bar(page).getByRole('button', { name: 'Mua' })).toBeEnabled();

    // Bớt một Vé VIP → phổ thông lại tăng được; nút vừa chạm đáy vẫn giữ focus.
    await minus(page, VIP).click();
    await expect(plus(page, BASIC)).toBeEnabled();
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText('600.000đ');
    await minus(page, BASIC).focus();
    await page.keyboard.press('Enter');
    await expect(stepperValue(page, BASIC)).toHaveText('0');
    await expect(minus(page, BASIC)).toBeFocused();
  });

  test('thanh: chưa chọn → nút tắt + lời nhắc; hết sạch → "Hết vé"; không hạng nào bán được → không có thanh', async ({
    page,
  }) => {
    const availability = await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await expect(bar(page)).toContainText('Chọn vé để tiếp tục');
    await expect(bar(page).getByRole('button', { name: 'Mua' })).toBeDisabled();

    const soldOut = { status: 'sold_out', remaining: 0 };
    availability.set(ok([tier(TIER_FREE_ID, soldOut), tier(TIER_PAID_ID, soldOut)]));
    await page.reload();
    await expect(bar(page)).toHaveText('Hết vé');
    await expect(bar(page).getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('group', { name: /^Số vé/ })).toHaveCount(0);

    availability.set(
      ok([tier(TIER_FREE_ID, { status: 'sold_out', remaining: 0 }), tier(TIER_PAID_ID, { status: 'paused' })], 'paused'),
    );
    await page.reload();
    await expect(page.locator('[data-slot="status-banner"]')).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="order-limit-note"]')).toHaveCount(0);
  });

  test('Sự kiện miễn phí: giá "Miễn phí", chọn 2 → tổng "Miễn phí", nút "Đăng ký"', async ({ page }) => {
    await mockAvailability(page, ok([tier(TIER_FREE_ONLY_ID)]));
    await page.goto(`/e/${SLUG_FREE}`);

    await expect(page.locator('[data-slot="ticket-tier-price"]')).toHaveText('Miễn phí');
    await pick(page, 'Vé tham dự', 2);
    await expect(bar(page)).toContainText('Tổng · 2 vé');
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText('Miễn phí');
    await expect(bar(page).getByRole('button', { name: 'Đăng ký' })).toBeEnabled();
    await expect(bar(page).getByRole('button', { name: 'Mua' })).toHaveCount(0);
  });

  test('số vé giảm khi quay lại tab → lựa chọn bị kẹp xuống, không bao giờ vượt', async ({ page }) => {
    const availability = await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 3);

    availability.set(ok([tier(TIER_FREE_ID, { remaining: 20 }), tier(TIER_PAID_ID, { remaining: 1 })]));
    await switchTabAway(page);
    await expect(stepperValue(page, VIP)).toHaveText('1');
    await expect(plus(page, VIP)).toBeDisabled();
    await expect(bar(page)).toContainText('Tổng · 1 vé');

    // Còn lại tăng trở lại: lựa chọn không tự tăng.
    availability.set(ON_SALE);
    await switchTabAway(page);
    await expect(plus(page, VIP)).toBeEnabled();
    await expect(stepperValue(page, VIP)).toHaveText('1');
  });

  test('?items= điền sẵn stepper (kẹp theo số vé còn); items sai → bỏ qua', async ({ page }) => {
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:3`);
    await expect(stepperValue(page, VIP)).toHaveText('3');
    await expect(stepperValue(page, BASIC)).toHaveText('1');
    await expect(bar(page)).toContainText('Tổng · 4 vé');

    await page.goto(`/e/${SLUG_BUY}?items=${TIER_PAID_ID}:0`);
    await expect(stepperValue(page, VIP)).toHaveText('0');
    await expect(bar(page)).toContainText('Chọn vé để tiếp tục');
  });
});

test.describe('bấm Mua', () => {
  test('chưa đăng nhập → đăng nhập OTP → Checkout đúng lựa chọn; buy_clicked rồi login_completed, bỏ f', async ({
    page,
  }) => {
    await mockAccount(page, { signedIn: false });
    const funnel = await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 2);
    await bar(page).getByRole('button', { name: 'Mua' }).click();

    await page.waitForURL('**/dang-nhap?returnTo=*');
    const returnTo = returnToOf(page);
    expect(returnTo.pathname).toBe(CHECKOUT);
    expect(returnTo.searchParams.get('items')).toBe(`${TIER_PAID_ID}:2`);
    const funnelId = returnTo.searchParams.get('f')!;
    expect(funnelId).toMatch(UUID);
    await expect.poll(() => funnel.map((c) => c.body)).toEqual([{ type: 'buy_clicked', funnelId, loginRequired: true }]);
    expect(funnel[0]!.slug).toBe(SLUG_BUY);

    await signInWithOtp(page);
    await page.waitForURL((url) => url.pathname === CHECKOUT && !url.searchParams.has('f'));
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_PAID_ID}:2`);
    await expectSummary(page, [`${VIP}2 × 300.000đ600.000đ`], 2, '600.000đ');
    await expect
      .poll(() => funnel.map((c) => c.body))
      .toEqual([
        { type: 'buy_clicked', funnelId, loginRequired: true },
        { type: 'login_completed', funnelId },
      ]);
  });

  test('đăng nhập lần đầu qua /dong-y → Checkout đúng lựa chọn', async ({ page }) => {
    await mockAccount(page, { signedIn: false, consentRequired: true });
    const funnel = await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, BASIC, 1);
    await pick(page, VIP, 1);
    await bar(page).getByRole('button', { name: 'Mua' }).click();
    await page.waitForURL('**/dang-nhap?returnTo=*');
    const funnelId = returnToOf(page).searchParams.get('f')!;

    await signInWithOtp(page);
    await page.waitForURL('**/dong-y?returnTo=*');
    await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
    await page.waitForURL((url) => url.pathname === CHECKOUT && !url.searchParams.has('f'));
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_FREE_ID}:1,${TIER_PAID_ID}:1`);
    await expectSummary(page, [`${BASIC}1 × Miễn phíMiễn phí`, `${VIP}1 × 300.000đ300.000đ`], 2, '300.000đ');
    await expect.poll(() => funnel.map((c) => c.body.type)).toEqual(['buy_clicked', 'login_completed']);
    expect(funnel[1]!.body.funnelId).toBe(funnelId);
  });

  test('đăng nhập Google từ "Mua" (trang trung gian /dang-nhap/google) → Checkout đúng lựa chọn', async ({ page }) => {
    const account = await mockAccount(page, { signedIn: false });
    const funnel = await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 3);
    await bar(page).getByRole('button', { name: 'Mua' }).click();
    await page.waitForURL('**/dang-nhap?returnTo=*');
    const returnTo = returnToOf(page);

    // Google xong thì api 302 về `/dang-nhap/google?returnTo=…` (cùng `returnTo`, giữ query) với cookie session mới.
    account.state.signedIn = true;
    await page.goto(`/dang-nhap/google?returnTo=${encodeURIComponent(`${returnTo.pathname}${returnTo.search}`)}`);
    await page.waitForURL((url) => url.pathname === CHECKOUT && !url.searchParams.has('f'));
    await expectSummary(page, [`${VIP}3 × 300.000đ900.000đ`], 3, '900.000đ');
    await expect.poll(() => funnel.map((c) => c.body.type)).toEqual(['buy_clicked', 'login_completed']);
  });

  test('đã đăng nhập → thẳng Checkout kèm f (rồi bỏ khỏi URL), buy_clicked loginRequired false', async ({ page }) => {
    await mockAccount(page, { signedIn: true });
    const funnel = await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 1);
    await pick(page, BASIC, 2);
    await bar(page).getByRole('button', { name: 'Mua' }).click();

    await page.waitForURL((url) => url.pathname === CHECKOUT && !url.searchParams.has('f'));
    expect(new URL(page.url()).search).toBe(`?items=${TIER_FREE_ID}:2,${TIER_PAID_ID}:1`);
    await expectSummary(page, [`${BASIC}2 × Miễn phíMiễn phí`, `${VIP}1 × 300.000đ300.000đ`], 3, '300.000đ');
    await expect.poll(() => funnel.length).toBeGreaterThanOrEqual(1);
    const funnelId = funnel[0]!.body.funnelId;
    expect(funnel[0]!.body).toEqual({ type: 'buy_clicked', funnelId: expect.stringMatching(UUID), loginRequired: false });
    // Checkout luôn báo `login_completed` khi có `f`; API chỉ ghi khi lần "Mua" đó phải đăng nhập.
    await expect.poll(() => funnel.map((c) => c.body)).toEqual([
      { type: 'buy_clicked', funnelId, loginRequired: false },
      { type: 'login_completed', funnelId },
    ]);
  });

  test('`me` lỗi 500 lúc bấm Mua → vẫn vào Checkout (không về đăng nhập), loginRequired false; "Thử lại" khi `me` hồi lại', async ({
    page,
  }) => {
    const account = await mockAccount(page, { signedIn: true });
    account.state.meFails = true;
    const funnel = await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 1);
    await bar(page).getByRole('button', { name: 'Mua' }).click();

    await page.waitForURL((url) => url.pathname === CHECKOUT);
    const url = new URL(page.url());
    expect(url.searchParams.get('items')).toBe(`${TIER_PAID_ID}:1`);
    expect(url.searchParams.get('f')).toMatch(UUID);
    await expect.poll(() => funnel.map((c) => c.body.loginRequired)).toEqual([false]);
    // Query `me` tự thử lại 5xx 2 lần trước khi báo lỗi.
    await expect(page.getByText('Chưa tải được tài khoản')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="order-summary"]')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(CHECKOUT);

    account.state.meFails = false;
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expectSummary(page, [`${VIP}1 × 300.000đ300.000đ`], 1, '300.000đ');
  });

  test('gửi phễu lỗi → vẫn điều hướng; Back từ màn đăng nhập → lựa chọn còn nguyên', async ({ page }) => {
    await mockAccount(page, { signedIn: false });
    const funnel = await mockFunnel(page, { fail: true });
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 2);
    await bar(page).getByRole('button', { name: 'Mua' }).click();

    await page.waitForURL('**/dang-nhap?returnTo=*');
    await expect.poll(() => funnel.length).toBeGreaterThanOrEqual(1);

    await page.goBack();
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_BUY}`);
    await expect(stepperValue(page, VIP)).toHaveText('2');
    await expect(bar(page)).toContainText('Tổng · 2 vé');
  });
});

test.describe('Checkout', () => {
  test('chưa đăng nhập mở thẳng Checkout → màn đăng nhập, returnTo là URL hiện tại kèm query', async ({ page }) => {
    await mockAccount(page, { signedIn: false });
    await mockFunnel(page);
    const target = `${CHECKOUT}?items=${TIER_PAID_ID}:1`;
    await page.goto(target);
    await page.waitForURL('**/dang-nhap?returnTo=*');
    const returnTo = returnToOf(page);
    expect(`${returnTo.pathname}${returnTo.search}`).toBe(target);
    await expect(page.locator('[data-slot="order-summary"]')).toHaveCount(0);
  });

  test('đã đăng nhập mà chưa đồng ý mở Checkout → /dong-y với returnTo là Checkout, đồng ý xong về đúng Checkout', async ({
    page,
  }) => {
    await mockAccount(page, { signedIn: true, consentRequired: true });
    await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    const target = `${CHECKOUT}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:2`;
    await page.goto(target);
    await page.waitForURL('**/dong-y?returnTo=*');
    const returnTo = returnToOf(page);
    expect(`${returnTo.pathname}${returnTo.search}`).toBe(target);

    await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
    await page.waitForURL((url) => url.pathname === CHECKOUT);
    expect(new URL(page.url()).search).toBe(`?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:2`);
    await expectSummary(page, [`${BASIC}1 × Miễn phíMiễn phí`, `${VIP}2 × 300.000đ600.000đ`], 3, '600.000đ');
  });

  for (const [label, url, expected] of [
    ['id lạ', `${CHECKOUT}?items=019a3b2c-0800-7abc-8def-0000000000ff:1`, `/e/${SLUG_BUY}`],
    ['số lượng 0', `${CHECKOUT}?items=${TIER_PAID_ID}:0`, `/e/${SLUG_BUY}`],
    ['số lượng không nguyên', `${CHECKOUT}?items=${TIER_PAID_ID}:1.5`, `/e/${SLUG_BUY}`],
    ['tổng > giới hạn', `${CHECKOUT}?items=${TIER_FREE_ID}:3,${TIER_PAID_ID}:2`, `/e/${SLUG_BUY}`],
    ['chuỗi rác', `${CHECKOUT}?items=rac`, `/e/${SLUG_BUY}`],
    ['thiếu items', CHECKOUT, `/e/${SLUG_BUY}`],
    ['Sự kiện không bán (Ẩn)', `/e/${SLUG_HIDDEN}/checkout?items=${TIER_PAID_ID}:1`, `/e/${SLUG_HIDDEN}`],
    ['Sự kiện nháp', `/e/${SLUG_DRAFT}/checkout?items=${TIER_PAID_ID}:1`, `/e/${SLUG_DRAFT}`],
  ] as const) {
    test(`items sai (${label}) → về trang Sự kiện`, async ({ page }) => {
      await mockAccount(page, { signedIn: true });
      await mockAvailability(page, ON_SALE);
      await page.goto(url);
      await page.waitForURL((u) => u.pathname === expected && u.search === '');
    });
  }

  test('"Sửa lựa chọn" → trang Sự kiện điền sẵn lựa chọn, kẹp theo số vé còn', async ({ page }) => {
    await mockAccount(page, { signedIn: true });
    await mockAvailability(page, ok([tier(TIER_FREE_ID, { remaining: 20 }), tier(TIER_PAID_ID, { remaining: 2 })]));
    await page.goto(`${CHECKOUT}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:3`);
    await expectSummary(page, [`${BASIC}1 × Miễn phíMiễn phí`, `${VIP}3 × 300.000đ900.000đ`], 4, '900.000đ');

    await page.getByRole('link', { name: 'Sửa lựa chọn' }).click();
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_BUY}`);
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_FREE_ID}:1,${TIER_PAID_ID}:3`);
    await expect(stepperValue(page, BASIC)).toHaveText('1');
    await expect(stepperValue(page, VIP)).toHaveText('2');
    await expect(bar(page)).toContainText('Tổng · 3 vé');
  });
});

/** Trả lời hai câu hỏi bắt buộc của form giả. */
async function answerQuestions(page: Page): Promise<void> {
  await page.getByLabel('Size áo').fill('M');
  await page.getByRole('radio', { name: 'Khá' }).check();
}

const sendButton = (page: Page) => bar(page).getByRole('button', { name: 'Gửi Đơn' });

test.describe('Gửi Đơn', () => {
  test.beforeEach(async ({ page }) => {
    await mockAccount(page, { signedIn: true });
    await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
  });

  test('form tự điền, Email chỉ đọc, dòng chia sẻ BTC; Gửi Đơn → body đúng, Idempotency-Key, funnelId, sang Trang Đơn', async ({
    page,
  }) => {
    const orders = await mockOrders(page);
    const funnelId = '5f0c6b8e-2a4d-4c1e-9b7a-3d2f1e0a9c8b';
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:2&f=${funnelId}`);
    await page.waitForURL((url) => url.pathname === CHECKOUT && !url.searchParams.has('f'));

    await expect(page.getByLabel('Tên')).toHaveValue('Nguyễn Văn An');
    await expect(page.getByLabel('Số điện thoại')).toHaveValue('0912345678');
    const email = page.getByLabel('Email');
    await expect(email).toHaveValue(EMAIL);
    await expect(email).toHaveAttribute('readonly', '');
    await expect(page.locator('[data-slot="checkout-share-note"]')).toHaveText(
      'Thông tin trong form sẽ được chia sẻ cho CLB Chạy Bộ Phố Cổ.',
    );
    await expect(bar(page)).toContainText('Tổng · 2 vé');
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText('600.000đ');

    await answerQuestions(page);
    // Câu chọn không bắt buộc: chọn nhầm thì "Bỏ chọn" xóa câu trả lời (không gửi lên).
    const yes = page.getByRole('radio', { name: 'Có', exact: true });
    await expect(page.getByRole('button', { name: 'Bỏ chọn Nhận áo' })).toHaveCount(0);
    await yes.check();
    await page.getByRole('button', { name: 'Bỏ chọn Nhận áo' }).click();
    await expect(yes).not.toBeChecked();
    await expect(page.getByRole('radio', { name: 'Không', exact: true })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Bỏ chọn Nhận áo' })).toHaveCount(0);
    // Câu bắt buộc không có "Bỏ chọn".
    await expect(page.getByRole('button', { name: 'Bỏ chọn Trình độ' })).toHaveCount(0);
    await sendButton(page).click();
    await page.waitForURL(`**/orders/${ORDER_CODE}`);
    expect(orders.calls).toHaveLength(1);
    expect(orders.calls[0]!.key).toMatch(UUID);
    expect(orders.calls[0]!.body).toEqual({
      items: [{ ticketTypeId: TIER_PAID_ID, quantity: 2 }],
      buyer: { name: 'Nguyễn Văn An', phone: '0912345678' },
      answers: { [Q_SIZE]: 'M', [Q_LEVEL]: OPT_GOOD },
      funnelId,
    });
    // Đơn có phí (Story 3.4): sang màn thanh toán của chính Đơn đó.
    await expect(page.locator('[data-slot="payment-amount"]')).toHaveText('600.000đ');
    await expect(page.locator('[data-slot="order-code"]')).toHaveText(ORDER_CODE);
    await expect(page.locator('[data-slot="order-summary-total"]')).toHaveText('600.000đ');
  });

  test('lỗi tại trường khi rời trường và khi gửi; 375×667: focus trường lỗi đầu tiên, không bị thanh che; không gửi', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const orders = await mockOrders(page, { buyer: { name: '', phone: null, email: EMAIL } });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:1`);

    const name = page.getByLabel('Tên');
    await expect(name).toHaveValue('');
    await name.focus();
    await name.blur();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    const nameError = await name.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${nameError}"]`)).toHaveText('Nhập tên của bạn.');
    await name.fill('An');
    await expect(page.locator(`[id="${nameError}"]`)).toHaveText('');

    const phone = page.getByLabel('Số điện thoại');
    await phone.fill('12345');
    await phone.blur();
    await expect(page.getByText('Số điện thoại chưa đúng (vd. 0912 345 678).')).toBeVisible();
    await phone.fill('0912 345 678');
    await expect(page.getByText('Số điện thoại chưa đúng (vd. 0912 345 678).')).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await sendButton(page).click();
    const size = page.getByLabel('Size áo');
    await expect(size).toBeFocused();
    await expect(size).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Câu này bắt buộc.')).toBeVisible();
    await expect(page.getByText('Chọn một phương án.')).toBeVisible();
    const box = (await size.boundingBox())!;
    const barBox = (await bar(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(barBox.y);
    expect(orders.calls).toHaveLength(0);
  });

  test('hết chỗ → toast "Hạng vé {tên} vừa hết. Bạn chọn lại nhé." + về trang Sự kiện, hạng đó = 0, hạng khác giữ', async ({
    page,
  }) => {
    await mockOrders(page, {
      submit: () => apiError(409, 'TICKET_TYPE_SOLD_OUT', { ticketTypeId: TIER_PAID_ID, ticketTypeName: VIP }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:2`);
    await answerQuestions(page);
    await sendButton(page).click();
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_BUY}`);
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_FREE_ID}:1`);
    await expect(page.getByText(`Hạng vé ${VIP} vừa hết. Bạn chọn lại nhé.`)).toBeVisible();
    await expect(stepperValue(page, VIP)).toHaveText('0');
    await expect(stepperValue(page, BASIC)).toHaveText('1');
  });

  test('Hạng vé không bán → toast + về trang Sự kiện, hạng đó = 0', async ({ page }) => {
    await mockOrders(page, { submit: () => apiError(409, 'NOT_ON_SALE', { ticketTypeId: TIER_PAID_ID, reason: 'closed' }) });
    await page.goto(`${CHECKOUT}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:1`);
    await answerQuestions(page);
    await sendButton(page).click();
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_BUY}`);
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_FREE_ID}:1`);
    await expect(page.getByText(`Hạng vé ${VIP} đã đóng bán. Bạn chọn lại nhé.`)).toBeVisible();
  });

  test('đã có Đơn chờ → sang Trang Đơn đó + toast', async ({ page }) => {
    const pendingCode = 'TKPENDNG23';
    await mockOrders(page, {
      submit: () => apiError(409, 'PENDING_ORDER_EXISTS', { code: pendingCode }),
      orders: { [pendingCode]: { status: 200, body: buyerOrder({ code: pendingCode }) } },
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:1`);
    await answerQuestions(page);
    await sendButton(page).click();
    await page.waitForURL(`**/orders/${pendingCode}`);
    await expect(page.getByText('Bạn đang có một Đơn chờ thanh toán cho Sự kiện này.')).toBeVisible();
    await expect(page.locator('[data-slot="order-code"]')).toHaveText(pendingCode);
  });

  test('lỗi mạng → "Chưa gửi được Đơn…" + "Thử lại" cùng khóa, form giữ nguyên dữ liệu', async ({ page }) => {
    const orders = await mockOrders(page, {
      submit: (_call, n) => (n === 0 ? 'abort' : { status: 201, body: buyerOrder() }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:2`);
    await answerQuestions(page);
    await sendButton(page).click();
    await expect(page.locator('[data-slot="checkout-submit-error"]')).toContainText(
      'Chưa gửi được Đơn. Kiểm tra kết nối rồi thử lại.',
    );
    expect(new URL(page.url()).pathname).toBe(CHECKOUT);
    await expect(page.getByLabel('Size áo')).toHaveValue('M');
    await expect(page.getByRole('radio', { name: 'Khá' })).toBeChecked();
    await expect(page.getByLabel('Tên')).toHaveValue('Nguyễn Văn An');

    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.waitForURL(`**/orders/${ORDER_CODE}`);
    expect(orders.calls).toHaveLength(2);
    expect(orders.calls[1]!.key).toMatch(UUID);
    expect(orders.calls[1]!.key).toBe(orders.calls[0]!.key);
    expect(orders.calls[1]!.body).toEqual(orders.calls[0]!.body);
  });

  test('lỗi máy chủ (5xx) → cũng "Thử lại" được', async ({ page }) => {
    await mockOrders(page, {
      submit: (_call, n) => (n === 0 ? apiError(500, 'INTERNAL_ERROR') : { status: 200, body: buyerOrder() }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:2`);
    await answerQuestions(page);
    await sendButton(page).click();
    await expect(page.locator('[data-slot="checkout-submit-error"]')).toContainText('Chưa gửi được Đơn.');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await page.waitForURL(`**/orders/${ORDER_CODE}`);
  });

  test('400 tại items (giới hạn Vé/Đơn vừa đổi) → toast + về trang Sự kiện giữ lựa chọn', async ({ page }) => {
    await mockOrders(page, {
      submit: () => apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'items', code: 'too_big' }] }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:2`);
    await answerQuestions(page);
    await sendButton(page).click();
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_BUY}`);
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_FREE_ID}:1,${TIER_PAID_ID}:2`);
    await expect(page.getByText('Lựa chọn vé không còn hợp lệ. Bạn chọn lại nhé.')).toBeVisible();
  });

  test('400 tại câu hỏi lạ (BTC vừa đổi form) → "Form mua vừa thay đổi…" và tải lại form mua', async ({ page }) => {
    const orders = await mockOrders(page, {
      submit: () =>
        apiError(400, 'VALIDATION_FAILED', {
          issues: [{ path: 'answers.019a3b2c-0900-7abc-8def-0000000000ff', code: 'custom' }],
        }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:1`);
    await answerQuestions(page);
    expect(orders.checkoutLoads()).toBe(1);
    await sendButton(page).click();
    await expect(page.locator('[data-slot="checkout-submit-error"]')).toHaveText(
      'Form mua vừa thay đổi. Kiểm tra lại rồi gửi.',
    );
    await expect(page.locator('[data-slot="checkout-submit-error"]').getByRole('button')).toHaveCount(0);
    await expect.poll(() => orders.checkoutLoads()).toBe(2);
    expect(new URL(page.url()).pathname).toBe(CHECKOUT);
  });

  test('400 tại buyer.phone → lỗi tại ô SĐT, ô đó được focus', async ({ page }) => {
    await mockOrders(page, {
      submit: () => apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'buyer.phone', code: 'invalid_format' }] }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:1`);
    await answerQuestions(page);
    await sendButton(page).click();
    const phone = page.getByLabel('Số điện thoại');
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    const describedBy = (await phone.getAttribute('aria-describedby'))!.split(' ');
    await expect(page.locator(`[id="${describedBy.at(-1)}"]`)).toHaveText('Kiểm tra lại câu trả lời này.');
  });

  test('429 → "Thử lại sau 2 phút." (retryAfterSeconds 61), không có nút "Thử lại"', async ({ page }) => {
    const orders = await mockOrders(page, {
      submit: () => apiError(429, 'ORDER_RATE_LIMITED', { retryAfterSeconds: 61 }),
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:1`);
    await answerQuestions(page);
    await sendButton(page).click();
    const error = page.locator('[data-slot="checkout-submit-error"]');
    await expect(error).toHaveText('Bạn gửi Đơn quá nhanh. Thử lại sau 2 phút.');
    await expect(error.getByRole('button')).toHaveCount(0);
    expect(orders.calls).toHaveLength(1);
  });

  test('"Mua" không kẹt khi Checkout redirect về lại trang Sự kiện', async ({ page }) => {
    const funnel = await mockFunnel(page);
    // Sự kiện Ẩn: số vé (giả) vẫn cho chọn, nhưng server Checkout từ chối lựa chọn và redirect về `/e/{slug}`.
    await page.goto(`/e/${SLUG_HIDDEN}`);
    await pick(page, VIP, 1);
    const buyButton = bar(page).getByRole('button', { name: 'Mua' });
    await buyButton.click();
    await expect.poll(() => funnel.length).toBe(1);
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_HIDDEN}` && !url.searchParams.has('items'));
    await expect(buyButton).not.toHaveAttribute('aria-busy', 'true');
    if ((await stepperValue(page, VIP).textContent()) === '0') await pick(page, VIP, 1);
    await expect(buyButton).toBeEnabled();
    await buyButton.click();
    await expect.poll(() => funnel.length).toBe(2);
  });
});

const FREE_CHECKOUT = `/e/${SLUG_FREE}/checkout`;
const registerButton = (page: Page) => bar(page).getByRole('button', { name: 'Đăng ký' });
const ticketCards = (page: Page) => page.locator('[data-slot="ticket-card"]');

/** Ghi lại các lần `navigator.vibrate` (WebKit không có API này: thêm vào để đếm). */
async function recordVibrations(page: Page): Promise<() => Promise<unknown[]>> {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { __vibrations: unknown[] }).__vibrations = calls;
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: unknown) => {
        calls.push(pattern);
        return true;
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
}

/** Chờ mọi animation trượt lên của thẻ Vé chạy xong (vị trí cuối). */
async function settleTickets(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-slot="ticket-card"]')].every((card) =>
          card.getAnimations().every((a) => a.playState === 'finished'),
        ),
      ),
    )
    .toBe(true);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Ảnh Mã QR vé thứ `i` mã hóa đúng `qrs[i]`, ≥ 200×200 (cỡ bố cục, không tính transform của chuyển cảnh), đen trên tấm
 * trắng. Gọi sau `settleTickets`.
 */
async function expectQrPlates(page: Page, qrs: readonly string[]): Promise<void> {
  const plates = page.locator('[data-slot="ticket-card"] [data-slot="qr-plate"]');
  await expect(plates).toHaveCount(qrs.length);
  for (let i = 0; i < qrs.length; i++) {
    const plate = plates.nth(i);
    await expect(plate).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const image = plate.getByRole('img');
    await expect(image).toBeVisible();
    const size = await image.evaluate((img: HTMLImageElement) => ({
      width: img.offsetWidth,
      height: img.offsetHeight,
      loaded: img.complete && img.naturalWidth >= 200,
    }));
    expect(size.width).toBeGreaterThanOrEqual(200);
    expect(size.height).toBeGreaterThanOrEqual(200);
    expect(size.loaded).toBe(true);
    await expectQrImageEncodes(image, qrs[i]!);
  }
}

test.describe('Đăng ký Sự kiện miễn phí (Story 3.3)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAccount(page, { signedIn: true });
    await mockFunnel(page);
    await mockAvailability(page, ok([tier(TIER_FREE_ONLY_ID)]));
  });

  test('tổng 0đ: nút "Đăng ký" → Thành công: stage, 2 thẻ "Vé k/N", nhãn QR, QR ≥ 200px trên tấm trắng, thẻ đầu chồng stage, rung nhẹ', async ({
    page,
  }) => {
    const vibrations = await recordVibrations(page);
    const orders = await mockOrders(page, {
      submit: () => ({ status: 201, body: freeOrder(2) }),
      orders: { [FREE_CODE]: { status: 200, body: freeOrder(2) } },
    });
    await page.goto(`${FREE_CHECKOUT}?items=${TIER_FREE_ONLY_ID}:2`);
    await expect(bar(page).locator('[data-slot="purchase-bar-total"]')).toHaveText('Miễn phí');
    await expect(bar(page).getByRole('button', { name: 'Gửi Đơn' })).toHaveCount(0);
    await answerQuestions(page);
    await registerButton(page).click();
    await page.waitForURL(`**/orders/${FREE_CODE}`);
    expect(orders.calls).toHaveLength(1);
    expect(orders.calls[0]!.body).toMatchObject({ items: [{ ticketTypeId: TIER_FREE_ONLY_ID, quantity: 2 }] });

    const success = page.locator('[data-slot="order-success"]');
    const stage = success.locator('[data-slot="stage-block"]');
    await expect(stage).toHaveAttribute('aria-live', 'polite');
    await expect(stage.locator('[data-slot="wordmark"]')).toHaveText('tickee');
    await expect(stage).toContainText(FREE_EVENT_NAME);
    // Focus chuyển vào tiêu đề để trình đọc màn hình đọc "Vé của bạn đã sẵn sàng!" ngay sau "Đăng ký".
    await expect(page.getByRole('heading', { level: 1, name: 'Vé của bạn đã sẵn sàng!' })).toBeFocused();
    // Story 3.8: email Vé + "Chia sẻ Vé" trên từng thẻ (chi tiết ở `shared-ticket.spec.ts`); Story 3.9: cuối màn một nút
    // chính "Xem Vé của tôi" → /tickets (chi tiết ở `my-tickets.spec.ts`).
    await expect(stage.locator('[data-slot="order-success-email"]')).toHaveText(`Đã gửi Vé tới ${EMAIL}`);
    await expect(page.getByRole('button', { name: 'Chia sẻ Vé' })).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Xem Vé của tôi' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Xem Vé của tôi' })).toHaveAttribute('href', '/tickets');

    await expect(ticketCards(page)).toHaveCount(2);
    await expect(page.locator('[data-slot="ticket-card-position"]')).toHaveText(['· Vé 1/2', '· Vé 2/2']);
    await expect(page.locator('[data-slot="ticket-card-qr-label"]')).toHaveText([
      'Mã QR vé · đưa cho CTV ở cổng',
      'Mã QR vé · đưa cho CTV ở cổng',
    ]);
    const first = ticketCards(page).first();
    await expect(first).toContainText(FREE_TIER);
    await expect(first.locator('[data-slot="ticket-card-holder"]')).toHaveText('Nguyễn Văn An');
    await expect(first).toContainText('Chủ nhật, 15/11/2099 · 07:00');
    await expect(page.getByRole('img', { name: `Mã QR vé 2 trên 2, ${FREE_TIER}` })).toBeVisible();
    await settleTickets(page);
    await expectQrPlates(page, [ticketQr(1), ticketQr(2)]);

    const stageBox = (await stage.boundingBox())!;
    const cardBox = (await first.boundingBox())!;
    const overlap = stageBox.y + stageBox.height - cardBox.y;
    expect(overlap).toBeGreaterThanOrEqual(24);
    expect(overlap).toBeLessThanOrEqual(36);
    await expect(first).toHaveCSS('animation-name', 'ticket-rise');
    await expectNoHorizontalScroll(page);
    expect(await vibrations()).toHaveLength(1);
  });

  test('reduced motion: đang là khoảnh khắc nhưng thẻ hiện ngay (animation-name none), không rung', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const vibrations = await recordVibrations(page);
    await mockOrders(page, { orders: { [FREE_CODE]: { status: 200, body: freeOrder(3) } } });
    // Cờ một lần như Checkout vừa đặt (Story 3.7): không có reduced motion thì đây là lần chạy trượt lên + rung.
    await page.addInitScript((code) => window.sessionStorage.setItem(`tickee:order-moment:${code}`, '1'), FREE_CODE);
    await page.goto(`/orders/${FREE_CODE}`);
    await expect(ticketCards(page)).toHaveCount(3);
    await expect(page.locator('[data-slot="order-success"]')).toHaveAttribute('data-celebrate', 'true');
    for (const card of await ticketCards(page).all()) {
      await expect(card).toHaveCSS('animation-name', 'none');
      await expect(card).toHaveCSS('opacity', '1');
    }
    expect(await vibrations()).toHaveLength(0);
  });

  test('320px, theme tối: không cuộn ngang; QR vẫn đen trên tấm trắng ≥ 200×200; thẻ nền card tối', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 320, height: 640 });
    await mockOrders(page, { orders: { [FREE_CODE]: { status: 200, body: freeOrder(2) } } });
    await page.goto(`/orders/${FREE_CODE}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(ticketCards(page)).toHaveCount(2);
    await expect(ticketCards(page).first()).toHaveCSS('background-color', 'rgb(28, 20, 22)');
    await settleTickets(page);
    await expectQrPlates(page, [ticketQr(1), ticketQr(2)]);
    await expectNoHorizontalScroll(page);
  });

  test('vượt trần Vé miễn phí → toast "Bạn đã nhận đủ số Vé tối đa cho Sự kiện này." + về trang Sự kiện giữ lựa chọn', async ({
    page,
  }) => {
    await mockOrders(page, { submit: () => apiError(409, 'FREE_TICKET_LIMIT_REACHED') });
    await page.goto(`${FREE_CHECKOUT}?items=${TIER_FREE_ONLY_ID}:2`);
    await answerQuestions(page);
    await registerButton(page).click();
    await page.waitForURL((url) => url.pathname === `/e/${SLUG_FREE}`);
    expect(new URL(page.url()).searchParams.get('items')).toBe(`${TIER_FREE_ONLY_ID}:2`);
    await expect(page.getByText('Bạn đã nhận đủ số Vé tối đa cho Sự kiện này.')).toBeVisible();
    await expect(stepperValue(page, FREE_TIER)).toHaveText('2');
  });

  test('Sự kiện có cả Hạng vé có phí: chỉ chọn Hạng vé 0đ → "Đăng ký"; có Hạng vé có phí → "Gửi Đơn"', async ({ page }) => {
    await mockAvailability(page, ON_SALE);
    await page.goto(`${CHECKOUT}?items=${TIER_FREE_ID}:1`);
    await expect(registerButton(page)).toBeVisible();
    await expect(sendButton(page)).toHaveCount(0);
    await page.goto(`${CHECKOUT}?items=${TIER_FREE_ID}:1,${TIER_PAID_ID}:1`);
    await expect(sendButton(page)).toBeVisible();
    await expect(registerButton(page)).toHaveCount(0);
  });
});

const paymentScreen = (page: Page) => page.locator('[data-slot="order-payment"]');
// Khi đang chờ, tên nút thêm "Đang xử lý" (spinner trong nút): khớp theo đầu tên.
const payButton = (page: Page) => page.getByRole('button', { name: /^Thanh toán/ });
const retryButton = (page: Page) => page.getByRole('button', { name: /^Thử lại/ });
const chip = (page: Page) => page.locator('[data-slot="countdown-chip"]');
const waitingLine = (page: Page) => page.locator('[data-slot="payment-waiting"]');
const WAITING = 'Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền.';
const HOLD_EXPIRED = 'Hết thời gian giữ chỗ. Chỗ đã được trả lại.';
const SALES_PAUSED = 'Sự kiện tạm ngừng bán. Bạn thử lại sau nhé.';
/** Banner trạng thái của Trang Đơn (chữ cũng có trong vùng `aria-live` ẩn nên không tìm bằng `getByText`). */
const orderBanner = (page: Page) => page.locator('[data-slot="order-view"] [data-slot="status-banner"]');
const announcement = (page: Page) => page.locator('[data-slot="order-status-announcement"]');
const REASSURANCE = 'Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại.';

/** Hộp của phần tử `name`; phải nằm trọn trong viewport hiện tại (không cần cuộn). */
async function boxInViewport(page: Page, name: string, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, name).not.toBeNull();
  expect(box!.y, name).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, name).toBeLessThanOrEqual(viewport.height);
  return box!;
}

/** Trang thanh toán của Tingee giả (giữ lại 300ms như mạng thật); trả về các URL đã mở. */
async function mockTingeeCheckout(page: Page): Promise<string[]> {
  const visits: string[] = [];
  await page.route('https://pay.tingee.test/**', async (route) => {
    visits.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><title>Tingee</title><h1>Trang Tingee giả</h1>',
    });
  });
  return visits;
}

/**
 * Ghi tên các nút chuyển sang `aria-busy="true"` (spinner trong nút) qua console: khi trang đang rời đi, Playwright không
 * đọc DOM được nữa nhưng vẫn nhận console.
 */
async function recordBusyButtons(page: Page): Promise<string[]> {
  const busy: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('[busy] ')) busy.push(text.slice('[busy] '.length));
  });
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as HTMLElement;
        if (el.getAttribute('aria-busy') === 'true') console.log(`[busy] ${el.textContent?.trim() ?? ''}`);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  });
  return busy;
}

test.describe('Màn thanh toán (Story 3.4)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAccount(page, { signedIn: true });
  });

  test('375×667: tên Sự kiện, stage, trust block, chính sách, dòng chờ, nút và chân đều thấy không cần cuộn; tóm tắt ở cuối', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await mockOrders(page);
    await page.goto(`/orders/${ORDER_CODE}`);
    const screen = paymentScreen(page);
    await expect(screen).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Giải chạy Hồ Gươm mùa thu 2026' })).toBeVisible();

    const stage = page.locator('[data-slot="payment-summary"]');
    await expect(stage).toContainText('Số tiền cần trả');
    await expect(page.locator('[data-slot="payment-amount"]')).toHaveText('600.000đ');
    await expect(chip(page)).toHaveText(/^Giữ chỗ còn (15:00|14:5\d)$/);
    // Chip coral viền coral 50% trên stage; không đổi đỏ.
    await expect(chip(page)).toHaveCSS('color', 'rgb(255, 77, 106)');
    await expect(chip(page)).toHaveCSS('border-top-color', 'rgba(255, 77, 106, 0.5)');
    await expect(chip(page)).toHaveAttribute('role', 'timer');
    await expect(stage.locator('[data-slot="order-code"]')).toHaveText(ORDER_CODE);

    const trust = page.locator('[data-slot="recipient-trust-block"]');
    await expect(trust.locator('[data-slot="recipient-headline"]')).toHaveText(`Tiền chuyển thẳng cho ${ORGANIZER}`);
    await expect(trust.locator('[data-slot="recipient-account-name"]')).toHaveText('NGUYEN VAN TUAN');
    await expect(trust.locator('[data-slot="recipient-bank-name"]')).toHaveText('Vietcombank');
    await expect(trust).toContainText('Chủ tài khoản');
    await expect(trust).toContainText('Ngân hàng');
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect(payButton(page)).toBeVisible();
    await expect(page.locator('[data-slot="payment-footer"]')).toHaveText('Tickee không giữ tiền của bạn');

    // Thứ tự trên xuống và mục 1–7 nằm trọn trong 375×667 khi chưa cuộn.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const order: [string, Locator][] = [
      ['tên Sự kiện', page.locator('[data-slot="order-event-name"]')],
      ['stage', stage],
      ['trust block', trust],
      ['link chính sách', page.locator('[data-slot="refund-policy-link"]')],
      ['dòng chờ', waitingLine(page)],
      ['nút Thanh toán', payButton(page)],
      ['chân', page.locator('[data-slot="payment-footer"]')],
    ];
    let previousBottom = 0;
    for (const [name, locator] of order) {
      const box = await boxInViewport(page, name, locator);
      expect(box.y, name).toBeGreaterThanOrEqual(previousBottom - 1);
      previousBottom = box.y + box.height;
    }
    const summary = (await page.locator('[data-slot="order-summary"]').boundingBox())!;
    expect(summary.y).toBeGreaterThanOrEqual(previousBottom);

    // Chính sách hoàn vé mở trong Sheet, không rời Trang Đơn.
    await page.locator('[data-slot="refund-policy-link"]').click();
    const sheet = page.getByRole('dialog', { name: 'Chính sách hoàn vé' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-slot="refund-policy-text"]')).toHaveText('Hoàn 100% nếu hủy trước 7 ngày.');
    await sheet.getByRole('button', { name: 'Đã hiểu' }).click();
    await expect(sheet).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/orders/${ORDER_CODE}`);
    await expectNoHorizontalScroll(page);
  });

  test('"Thanh toán" → spinner trong nút rồi điều hướng toàn trang tới checkoutUrl, không popup', async ({ page }) => {
    await mockOrders(page);
    const visits = await mockTingeeCheckout(page);
    const busy = await recordBusyButtons(page);
    await page.goto(`/orders/${ORDER_CODE}`);
    const pages = page.context().pages().length;
    await payButton(page).click();
    await page.waitForURL(CHECKOUT_URL);
    await expect(page.getByRole('heading', { name: 'Trang Tingee giả' })).toBeVisible();
    // Spinner hiện trong nút trước khi rời trang; cùng tab, không popup.
    expect(busy).toEqual(['Thanh toánĐang xử lý']);
    expect(visits).toEqual([CHECKOUT_URL]);
    expect(page.context().pages()).toHaveLength(pages);
  });

  test('chưa có link → "Chưa tạo được link thanh toán" + "Thử lại" (spinner, chặn bấm lặp) → hiện "Thanh toán"', async ({ page }) => {
    const missing = buyerOrder({
      expiresAt: '2026-11-10T01:01:00.000Z',
      payment: payment({ checkoutUrl: null, linkError: 'provider_error' }),
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const orders = await mockOrders(page, {
      orders: { [ORDER_CODE]: { status: 200, body: missing } },
      retryLink: async () => {
        await held;
        return { status: 200, body: buyerOrder({ serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }) };
      },
    });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(page.locator('[data-slot="payment-link-error"]')).toHaveText('Chưa tạo được link thanh toán');
    await expect(payButton(page)).toHaveCount(0);
    await expect(waitingLine(page)).toHaveCount(0);
    // Trust block và đếm ngược vẫn hiện.
    await expect(page.locator('[data-slot="recipient-trust-block"]')).toBeVisible();
    await expect(chip(page)).toHaveText(/^Giữ chỗ còn 0[01]:\d\d$/);

    await retryButton(page).click();
    await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
    await retryButton(page).click();
    release();
    await expect(payButton(page)).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="payment-link-error"]')).toHaveCount(0);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect(chip(page)).toHaveText(/^Giữ chỗ còn 1[45]:\d\d$/);
    expect(orders.retries).toEqual([ORDER_CODE]);
  });

  test('đồng hồ về 0 (page.clock) khi đã có link: chip "Đang xác nhận thanh toán", ẩn nút; báo mốc 5 và 1 phút', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(SERVER_NOW) });
    await mockOrders(page);
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(chip(page)).toHaveText(/^Giữ chỗ còn 1[45]:\d\d$/);
    const announcement = page.locator('[data-slot="countdown-announcement"]');
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await expect(announcement).toHaveText('');

    await page.clock.fastForward('10:00');
    await expect(chip(page)).toHaveText(/^Giữ chỗ còn 0[45]:\d\d$/);
    await expect(announcement).toHaveText('Giữ chỗ còn 5 phút.');
    await page.clock.fastForward('04:05');
    await expect(announcement).toHaveText('Giữ chỗ còn 1 phút.');
    // Không đổi sang đỏ khi sắp hết.
    await expect(chip(page)).toHaveCSS('color', 'rgb(255, 77, 106)');

    await page.clock.fastForward('01:30');
    await expect(chip(page)).toHaveText('Đang xác nhận thanh toán');
    // Đã chờ quá 2 phút trong lần mở trang (Story 3.7): dòng trấn an thay dòng chờ "Đang xác nhận…" (dòng đó kiểm ở
    // `order-live.spec.ts`, khi đồng hồ về 0 trước mốc chờ lâu).
    const status = page.locator('[data-slot="payment-status"]');
    await expect(status.locator('[data-slot="reassurance-line"]')).toHaveText(REASSURANCE);
    await expect(waitingLine(page)).toHaveCount(0);
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(payButton(page)).toHaveCount(0);
    // Máy chủ chưa báo hết hạn: không hiện màn Hết hạn.
    await expect(page.getByText(HOLD_EXPIRED)).toHaveCount(0);
  });

  test('đồng hồ về 0 khi chưa có link: ẩn "Thử lại", chờ máy chủ báo hết hạn', async ({ page }) => {
    await page.clock.install({ time: new Date(SERVER_NOW) });
    const missing = buyerOrder({
      expiresAt: '2026-11-10T01:01:00.000Z',
      payment: payment({ checkoutUrl: null, linkError: 'provider_error' }),
    });
    await mockOrders(page, { orders: { [ORDER_CODE]: { status: 200, body: missing } } });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(retryButton(page)).toBeVisible();
    await page.clock.fastForward('01:05');
    await expect(retryButton(page)).toHaveCount(0);
    await expect(chip(page)).toHaveText('Giữ chỗ còn 00:00');
    await expect(page.locator('[data-slot="payment-link-error"]')).toHaveText('Chưa tạo được link thanh toán');
  });

  test('tạm ngừng bán (sales_paused) → "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." + nút về trang Sự kiện', async ({ page }) => {
    const paused = buyerOrder({ buyerStatus: 'expired', payment: payment({ checkoutUrl: null, linkError: 'sales_paused' }) });
    await mockOrders(page, { orders: { [ORDER_CODE]: { status: 200, body: paused } } });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(orderBanner(page)).toHaveText(SALES_PAUSED);
    await expect(page.getByRole('link', { name: 'Về trang Sự kiện' })).toHaveAttribute('href', `/e/${SLUG_BUY}`);
    await expect(page.getByText(HOLD_EXPIRED)).toHaveCount(0);
    await expect(paymentScreen(page)).toHaveCount(0);
  });

  test('hết hạn vì kết quả tạo link mơ hồ (timeout) → màn Hết hạn thường, không phải câu tạm ngừng', async ({ page }) => {
    const timedOut = buyerOrder({ buyerStatus: 'expired', payment: payment({ checkoutUrl: null, linkError: 'timeout' }) });
    await mockOrders(page, { orders: { [ORDER_CODE]: { status: 200, body: timedOut } } });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(orderBanner(page)).toHaveText(HOLD_EXPIRED);
    await expect(page.getByRole('link', { name: 'Mua lại' })).toHaveAttribute('href', `/e/${SLUG_BUY}`);
    // Story 3.9: "Vé của tôi" trong dòng phụ là link tới /tickets.
    await expect(page.getByRole('link', { name: 'Vé của tôi' })).toHaveAttribute('href', '/tickets');
    await expect(page.getByText(SALES_PAUSED)).toHaveCount(0);
    await expect(paymentScreen(page)).toHaveCount(0);
  });

  test('Checkout nhận 201 Đơn expired (timeout) → sang Trang Đơn với màn Hết hạn', async ({ page }) => {
    await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    const timedOut = buyerOrder({ buyerStatus: 'expired', payment: payment({ checkoutUrl: null, linkError: 'timeout' }) });
    const orders = await mockOrders(page, {
      submit: () => ({ status: 201, body: timedOut }),
      orders: { [ORDER_CODE]: { status: 200, body: timedOut } },
    });
    await page.goto(`${CHECKOUT}?items=${TIER_PAID_ID}:2`);
    await answerQuestions(page);
    await sendButton(page).click();
    await page.waitForURL(`**/orders/${ORDER_CODE}`);
    expect(orders.calls).toHaveLength(1);
    await expect(orderBanner(page)).toHaveText(HOLD_EXPIRED);
    await expect(page.getByText(SALES_PAUSED)).toHaveCount(0);
    await expect(paymentScreen(page)).toHaveCount(0);
  });

  test('Đơn chuyển pending → expired khi hỏi lại: vùng aria-live vẫn gắn (cùng phần tử), chữ đổi sang câu Hết hạn', async ({
    page,
  }) => {
    const responses: Record<string, Reply> = { [ORDER_CODE]: { status: 200, body: buyerOrder() } };
    await mockOrders(page, { orders: responses });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(paymentScreen(page)).toBeVisible();
    const live = announcement(page);
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveText('');
    // Đánh dấu chính phần tử này: nếu vùng bị gắn lại khi đổi màn, dấu sẽ mất.
    await live.evaluate((el) => {
      el.dataset.marker = 'giu-nguyen';
    });

    responses[ORDER_CODE] = {
      status: 200,
      body: buyerOrder({ buyerStatus: 'expired', payment: payment({ checkoutUrl: null }) }),
    };
    // Không có SSE: hỏi lại định kỳ mỗi 2 giây khi Đơn còn chờ.
    await expect(orderBanner(page)).toHaveText(HOLD_EXPIRED, { timeout: 10_000 });
    await expect(paymentScreen(page)).toHaveCount(0);
    await expect(live).toHaveText(HOLD_EXPIRED);
    await expect(live).toHaveAttribute('data-marker', 'giu-nguyen');
    await expect(page.locator('[data-slot="order-status-announcement"]')).toHaveCount(1);
  });

  test('320px, theme tối: không cuộn ngang; nút chính coral; BTC không còn tài khoản → chỉ còn tên BTC', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 320, height: 640 });
    const noAccount = buyerOrder({
      event: { slug: SLUG_BUY, name: 'Giải chạy Hồ Gươm mùa thu 2026 — cự ly 42km dành cho vận động viên phong trào', startsAt: '2099-11-15T07:00:00+07:00' },
      payment: payment({ recipient: { organizationName: 'Câu lạc bộ Chạy Bộ Phố Cổ Hà Nội Mở Rộng', accountName: null, bankName: null } }),
    });
    await mockOrders(page, { orders: { [ORDER_CODE]: { status: 200, body: noAccount } } });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(payButton(page)).toHaveCSS('background-color', 'rgb(255, 77, 106)');
    const trust = page.locator('[data-slot="recipient-trust-block"]');
    await expect(trust).toContainText('Câu lạc bộ Chạy Bộ Phố Cổ Hà Nội Mở Rộng');
    await expect(trust).not.toContainText('Chủ tài khoản');
    await expect(trust).not.toContainText('Ngân hàng');
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Trang Đơn', () => {
  test('Hết hạn → câu báo + "Mua lại" về trang Sự kiện; mã lạ → "Không tìm thấy Đơn này."', async ({ page }) => {
    await mockAccount(page, { signedIn: true });
    await mockOrders(page, { orders: { [ORDER_CODE]: { status: 200, body: buyerOrder({ buyerStatus: 'expired' }) } } });
    await page.goto(`/orders/${ORDER_CODE}`);
    await expect(orderBanner(page)).toHaveText(HOLD_EXPIRED);
    await expect(page.getByRole('link', { name: 'Mua lại' })).toHaveAttribute('href', `/e/${SLUG_BUY}`);
    // Story 3.9: "Vé của tôi" trong dòng phụ là link tới /tickets.
    await expect(page.getByRole('link', { name: 'Vé của tôi' })).toHaveAttribute('href', '/tickets');
    await expect(page.locator('[data-slot="order-code"]')).toHaveText(ORDER_CODE);
    await expect(page.locator('[data-slot="order-summary-line"]')).toHaveText([`${VIP}2 × 300.000đ600.000đ`]);

    await page.goto('/orders/TKKHNGC0XX');
    await expect(page.getByText('Không tìm thấy Đơn này.')).toBeVisible();
  });

  test('chưa đăng nhập → màn đăng nhập, returnTo là Trang Đơn', async ({ page }) => {
    await mockAccount(page, { signedIn: false });
    await page.goto(`/orders/${ORDER_CODE}`);
    await page.waitForURL('**/dang-nhap?returnTo=*');
    expect(returnToOf(page).pathname).toBe(`/orders/${ORDER_CODE}`);
  });
});

test.describe('bố cục thanh mua', () => {
  test.beforeEach(async ({ page }) => {
    await mockAccount(page, { signedIn: false });
    await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
  });

  test('375×667: focus bàn phím vào stepper cuối không bị thanh che; thanh không che nội dung cuối trang', async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/e/${SLUG_BUY}`);
    const target = plus(page, VIP);
    await expect(target).toBeVisible();
    await expect(bar(page)).toHaveCSS('position', 'fixed');

    // Đặt stepper cuối danh sách nằm sau thanh (vẫn trong khung nhìn), focus nút "−" của nó mà không cuộn, rồi Tab sang
    // nút "+". Không có `scroll-padding-bottom` thì trình duyệt coi nút đã thấy được và để nguyên sau thanh. WebKit
    // chỉ Tab qua nút và link khi giữ Option (như Safari mặc định).
    await page.evaluate(() => {
      const last = document.querySelector('[aria-label="Tăng số vé Vé VIP"]')!;
      const top = last.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - (window.innerHeight - 45));
      document.querySelector<HTMLElement>('[aria-label="Giảm số vé Vé VIP"]')!.focus({ preventScroll: true });
    });
    const hidden = await page.evaluate(() => {
      const last = document.querySelector('[aria-label="Tăng số vé Vé VIP"]')!.getBoundingClientRect();
      const barRect = document.querySelector('[data-slot="purchase-bar"]')!.getBoundingClientRect();
      return last.bottom > barRect.top && last.bottom <= window.innerHeight;
    });
    expect(hidden).toBe(true);
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(target).toBeFocused();
    const covered = await page.evaluate(() => {
      const focused = document.activeElement!.getBoundingClientRect();
      const barRect = document.querySelector('[data-slot="purchase-bar"]')!.getBoundingClientRect();
      return { focusedTop: focused.top, focusedBottom: focused.bottom, barTop: barRect.top };
    });
    expect(covered.focusedTop).toBeGreaterThanOrEqual(0);
    expect(covered.focusedBottom).toBeLessThanOrEqual(covered.barTop);

    // Cuộn hết trang: dòng cuối (chính sách hoàn vé) nằm trên thanh.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastLine = await page.getByText('Hoàn 100% nếu hủy trước 7 ngày.').boundingBox();
    const barBox = await bar(page).boundingBox();
    expect(lastLine!.y + lastLine!.height).toBeLessThanOrEqual(barBox!.y);
  });

  test('320px: thanh vừa màn hình, không cuộn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 3);
    const box = await bar(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(10);
    expect(box!.x + box!.width).toBeLessThanOrEqual(310);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('≥ lg: thanh nằm dưới danh sách Hạng vé trong cột phải đang sticky', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/e/${SLUG_BUY}`);
    const aside = page.getByRole('complementary', { name: 'Hạng vé' });
    await expect(aside.locator('[data-slot="purchase-bar"]')).toBeVisible();
    await expect(bar(page)).toHaveCSS('position', 'static');
    const list = await aside.locator('section').first().boundingBox();
    const barBox = await bar(page).boundingBox();
    expect(barBox!.y).toBeGreaterThanOrEqual(list!.y + list!.height);
    expect(Math.abs(barBox!.x - list!.x)).toBeLessThan(2);
  });
});
