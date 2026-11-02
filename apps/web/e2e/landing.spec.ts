import { test as baseTest, type Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, WEB_ORIGIN, type Call } from './identity-mock';
import { mockOrganizerApi, ORG_ID, OTHER_ORG_ID } from './organizer-mock';

/* Landing BTC `/`: nội dung tĩnh và luật CTA (hero + cuối trang) theo `me` và memberships, với API giả. */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const LOGIN_HREF = '/dang-nhap?returnTo=%2Ftao-btc';

const joinCtas = (page: Page) => page.getByRole('link', { name: 'Đăng ký Closed Beta' });
const dashboardCtas = (page: Page) => page.getByRole('link', { name: 'Vào dashboard' });
/** Link "Đăng nhập" ở header: `AccountMenu` chỉ hiện khi `me` đã xong (401 hoặc lỗi), không hiện lúc đang tải. */
const headerLogin = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'Đăng nhập', exact: true });
const membershipCalls = (calls: Call[]) => calls.filter((c) => c.path === '/me/memberships');
const meCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/identity/me');

/** 5xx được thử lại 2 lần (`shouldRetryQuery`, chờ ~1 s rồi ~2 s): 3 lời gọi, cần timeout dài hơn cửa sổ đó. */
const RETRY_ATTEMPTS = 3;
const RETRY_TIMEOUT = 10_000;

async function expectHrefs(page: Page, cta: (page: Page) => ReturnType<Page['getByRole']>, href: string) {
  await expect(cta(page)).toHaveCount(2);
  for (const link of await cta(page).all()) await expect(link).toHaveAttribute('href', href);
}

/**
 * Giữ `check` đúng trong ~1,5 s. Lúc memberships đang tải CTA đã trỏ `/tao-btc` nên một assertion đơn lẻ qua ngay
 * ở trạng thái pending; giữ một khoảng thì bắt được thay đổi hay lời gọi đến trễ. `check` dùng assertion không tự chờ.
 */
async function holdSteady(page: Page, check: () => Promise<void> | void) {
  for (let i = 0; i < 6; i += 1) {
    await check();
    await page.waitForTimeout(250);
  }
}

/** Không có "Vào dashboard", hai CTA "Đăng ký Closed Beta" đều trỏ `href` (đọc một lần, không tự chờ). */
async function expectJoinOnly(page: Page, href: string) {
  expect(await dashboardCtas(page).count()).toBe(0);
  const links = await joinCtas(page).all();
  expect(links).toHaveLength(2);
  for (const link of links) expect(await link.getAttribute('href')).toBe(href);
}

/** Đếm response đã về của một đường dẫn api (route giả cũng phát sự kiện `response`). */
function countResponses(page: Page, path: string): () => number {
  let count = 0;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith(path)) count += 1;
  });
  return () => count;
}

test('khách: hero có 4 value-tile, đúng một h1, 2 CTA "Đăng ký Closed Beta" → đăng nhập kèm returnTo=/tao-btc', async ({
  page,
}) => {
  await mockIdentityApi(page, { 'GET /identity/me': unauthenticated });
  const calls = await mockOrganizerApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('tiền về thẳng tài khoản');
  const tiles = page.locator('[data-slot="value-tile"]');
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(0)).toContainText('Tiền về thẳng tài khoản');
  await expect(tiles.nth(1)).toContainText('Phí thấp');
  await expect(tiles.nth(2)).toContainText('vài phút');
  await expect(tiles.nth(3)).toContainText('Tự khớp giao dịch');
  await expect(page.getByRole('heading', { level: 2, name: /Closed Beta/ })).toBeVisible();
  await expect(headerLogin(page)).toBeVisible();
  await expectHrefs(page, joinCtas, LOGIN_HREF);
  await expect(page).toHaveTitle(/Bán vé sự kiện/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
  expect(membershipCalls(calls)).toHaveLength(0);
});

test('khách bấm CTA, đăng nhập OTP xong thì vào /tao-btc', async ({ page }) => {
  let signedIn = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me(CONSENTED) : unauthenticated()),
    'POST /identity/otp': () => ({ status: 200, body: { resendAfterSeconds: 60 } }),
    'POST /identity/otp/verify': () => {
      signedIn = true;
      return { status: 200, body: { consentRequired: false } };
    },
  });
  await mockOrganizerApi(page);
  await page.goto('/');
  await joinCtas(page).first().click();
  await page.waitForURL(`**${LOGIN_HREF}`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByText(`Mã đã gửi tới ${EMAIL}`)).toBeVisible();
  await page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input').first().fill('123456');
  await page.waitForURL(`${WEB_ORIGIN}/tao-btc`);
  await expect(page.getByRole('heading', { name: 'Tạo BTC' })).toBeVisible();
});

test('đã đăng nhập, chưa có BTC (memberships rỗng): CTA → /tao-btc', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  await mockOrganizerApi(page);
  const memberships = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/me/memberships'));
  await page.goto('/');
  await memberships;
  await expectHrefs(page, joinCtas, '/tao-btc');
  await holdSteady(page, () => expectJoinOnly(page, '/tao-btc'));
});

test('chưa đồng ý NĐ 13: không hỏi memberships, CTA → /tao-btc rồi sang /dong-y', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(null) });
  const calls = await mockOrganizerApi(page);
  await page.goto('/');
  await expectHrefs(page, joinCtas, '/tao-btc');
  // Giữ ở 0 trong một khoảng ngắn: bắt cả lời gọi đến trễ sau khi `me` đã về.
  await holdSteady(page, () => expect(membershipCalls(calls)).toHaveLength(0));
  await joinCtas(page).last().click();
  await page.waitForURL('**/dong-y?returnTo=%2Ftao-btc');
});

test('đã thuộc BTC: 2 CTA "Vào dashboard" → BTC đầu tiên; dùng chung cache với menu tài khoản', async ({ page }) => {
  const identityCalls = await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    'GET /me/memberships': () => ({
      status: 200,
      body: [
        { organizationId: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' },
        { organizationId: OTHER_ORG_ID, name: 'BTC khác', role: 'admin' },
      ],
    }),
  });
  await page.goto('/');
  await expectHrefs(page, dashboardCtas, `/btc/${ORG_ID}`);
  await expect(joinCtas(page)).toHaveCount(0);
  // Hai CTA và `AccountMenu` cùng khóa query: mỗi API chỉ gọi một lần, kể cả lời gọi trùng đến trễ.
  await holdSteady(page, () => {
    expect(membershipCalls(calls)).toHaveLength(1);
    expect(meCalls(identityCalls)).toHaveLength(1);
  });
});

test('me lỗi 5xx: giữ CTA mặc định (đăng nhập), không hiện lỗi trên landing', async ({ page }) => {
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => apiError(503, 'SERVICE_UNAVAILABLE'),
  });
  await mockOrganizerApi(page);
  await page.goto('/');
  await expect.poll(() => meCalls(identityCalls).length, { timeout: RETRY_TIMEOUT }).toBe(RETRY_ATTEMPTS);
  await expect(headerLogin(page)).toBeVisible({ timeout: RETRY_TIMEOUT });
  await expectHrefs(page, joinCtas, LOGIN_HREF);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('memberships lỗi 5xx: CTA → /tao-btc, không hiện lỗi trên landing', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, { 'GET /me/memberships': () => apiError(503, 'SERVICE_UNAVAILABLE') });
  const membershipResponses = countResponses(page, '/me/memberships');
  await page.goto('/');
  await expect.poll(() => membershipCalls(calls).length, { timeout: RETRY_TIMEOUT }).toBe(RETRY_ATTEMPTS);
  await expect.poll(membershipResponses, { timeout: RETRY_TIMEOUT }).toBe(RETRY_ATTEMPTS);
  await expectHrefs(page, joinCtas, '/tao-btc');
  await holdSteady(page, () => expectJoinOnly(page, '/tao-btc'));
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('"Xem cách hoạt động" cuộn tới section hành trình', async ({ page }) => {
  await mockIdentityApi(page);
  await mockOrganizerApi(page);
  await page.goto('/');
  const journey = page.getByRole('heading', { level: 2, name: /Từ tạo Sự kiện tới soát vé/ });
  await expect(journey).not.toBeInViewport();
  await page.getByRole('link', { name: 'Xem cách hoạt động' }).click();
  await expect(journey).toBeInViewport();
  expect(new URL(page.url()).hash).toBe('#hanh-trinh');
});

test('320px không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await mockIdentityApi(page);
  await mockOrganizerApi(page);
  await page.goto('/');
  await expect(page.locator('[data-slot="value-tile"]')).toHaveCount(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

baseTest.describe('JS tắt', () => {
  baseTest.use({ javaScriptEnabled: false });

  // `test` của fixtures chờ hydrate (không bao giờ xảy ra khi tắt JS) nên dùng `test` gốc.
  baseTest('HTML từ server có đủ hero, 4 value-tile, các section và CTA dẫn tới đăng nhập', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-slot="value-tile"]')).toHaveCount(4);
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Xem cách hoạt động' })).toBeVisible();
    await expectHrefs(page, joinCtas, LOGIN_HREF);
  });
});
