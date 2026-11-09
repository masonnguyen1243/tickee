import type { Page } from '@playwright/test';

import { PORT_PUBLIC_EVENT } from '../playwright.config';
import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, type Handler, type Reply } from './identity-mock';
import {
  SLUG_BUY,
  SLUG_DRAFT,
  SLUG_FREE,
  SLUG_HIDDEN,
  TIER_FREE_ID,
  TIER_FREE_ONLY_ID,
  TIER_PAID_ID,
} from './public-event-api';

/*
 * Story 3.1: chọn Vé trên trang Sự kiện (`quantity-stepper`, `purchase-bar`), bấm "Mua" → đăng nhập → Checkout đúng
 * lựa chọn, phễu `buy_clicked`/`login_completed`. Phần tĩnh (trang Sự kiện và Checkout) SSR từ API giả
 * `e2e/public-event-api.ts`; `/availability`, `/funnel-events` và `/identity/*` gọi từ trình duyệt nên giả bằng
 * `page.route`. Sự kiện `SLUG_BUY`: "Vé phổ thông" 0đ rồi "Vé VIP" 300.000đ, giới hạn 4 Vé/Đơn.
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

/** `/identity/*` giả với `me` đổi theo trạng thái đăng nhập; OTP gửi/nhận luôn thành công. */
async function mockAccount(page: Page, initial: { signedIn: boolean; consentRequired?: boolean }) {
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

  test('đã đăng nhập → thẳng Checkout, không có f, buy_clicked loginRequired false, không login_completed', async ({
    page,
  }) => {
    await mockAccount(page, { signedIn: true });
    const funnel = await mockFunnel(page);
    await mockAvailability(page, ON_SALE);
    await page.goto(`/e/${SLUG_BUY}`);
    await pick(page, VIP, 1);
    await pick(page, BASIC, 2);
    await bar(page).getByRole('button', { name: 'Mua' }).click();

    await page.waitForURL((url) => url.pathname === CHECKOUT);
    expect(new URL(page.url()).search).toBe(`?items=${TIER_FREE_ID}:2,${TIER_PAID_ID}:1`);
    await expectSummary(page, [`${BASIC}2 × Miễn phíMiễn phí`, `${VIP}1 × 300.000đ300.000đ`], 3, '300.000đ');
    await expect.poll(() => funnel.length).toBe(1);
    expect(funnel[0]!.body).toEqual({ type: 'buy_clicked', funnelId: expect.stringMatching(UUID), loginRequired: false });
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
    expect(new URL(page.url()).search).toBe(`?items=${TIER_PAID_ID}:1`);
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
