import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Reply } from './identity-mock';
import { setVisibility } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID, tokenOverview, tokenReading } from './organizer-mock';

/*
 * Trang Token (Story 4.5-a) với API giả: `GET /orgs/:id/token` trả lần lượt `readings` (mỗi lần đọc một phần tử, hết thì
 * lặp phần tử cuối; `API_FAILURE` → 500 của chính api), có thể chờ `delayMs` trước khi trả (kiểm skeleton, spinner, chặn
 * bấm lặp). Như api: link portal Tingee chỉ có với Owner. Giờ "Đọc lúc" theo giờ Việt Nam: trình duyệt chạy múi giờ New
 * York.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const PAGE_PATH = `/btc/${ORG_ID}/token`;
const PORTAL = 'https://baas.tingee.vn';
/** 16/11/2026 10:04:05 giờ Việt Nam. */
const READ_AT = '2026-11-16T03:04:05.000Z';
/** 16/11/2026 10:06:30 giờ Việt Nam. */
const READ_AGAIN_AT = '2026-11-16T03:06:30.000Z';
const UNAVAILABLE = { status: 'unavailable' };
const NO_PAYOUT_ACCOUNT = { status: 'no_payout_account' };
/** Phần tử của `readings`: lần đọc này api trả 500 (lỗi của chính api, không phải Tingee). */
const API_FAILURE = Symbol('API_FAILURE');
const DESKTOP = { width: 1280, height: 800 };

type Role = 'owner' | 'admin';

async function openToken(
  page: Page,
  {
    role = 'owner' as Role,
    readings = [tokenReading(1_200, 500, READ_AT)] as unknown[],
    delayMs = 0,
    path = PAGE_PATH,
  } = {},
): Promise<Call[]> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  let served = 0;
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role }),
    [`GET /orgs/${ORG_ID}/token`]: async (): Promise<Reply> => {
      const reading = readings[Math.min(served, readings.length - 1)];
      served += 1;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (reading === API_FAILURE) return apiError(500, 'INTERNAL_ERROR');
      return { status: 200, body: tokenOverview(reading, role === 'owner' ? PORTAL : undefined) };
    },
  });
  await page.goto(path);
  return calls;
}

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/token`);
const statCard = (page: Page) => page.locator('[data-slot="stat-card"]');
const balance = (page: Page) => page.locator('[data-slot="token-balance"]');
const creditLimit = (page: Page) => page.locator('[data-slot="token-credit-limit"]');
const purchaseLink = (page: Page) => page.getByRole('link', { name: /Mua thêm Token/ });
const reloadButton = (page: Page) => page.getByRole('button', { name: /^Tải lại/ });
const retryButton = (page: Page) => page.getByRole('button', { name: /^Thử lại/ });
const loadError = (page: Page) => page.locator('[data-slot="status-banner"][data-tone="danger"]');
const readAt = (page: Page) => page.locator('[data-slot="token-read-at"]');
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Owner đọc được: Token khả dụng 1.700, số dư 1.200, hạn mức 500, "Đọc lúc" giờ Việt Nam; "Mua thêm Token" mở portal Tingee ở tab mới', async ({
  page,
}) => {
  const calls = await openToken(page);
  await expect(page.getByRole('heading', { name: 'Token', exact: true, level: 1 })).toBeVisible();
  await expect(statCard(page)).toContainText('Token khả dụng');
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(balance(page)).toContainText('Số dư');
  await expect(balance(page).locator('[data-slot="token-figure-value"]')).toHaveText('1.200');
  await expect(creditLimit(page)).toContainText('Hạn mức trả sau');
  await expect(creditLimit(page).locator('[data-slot="token-figure-value"]')).toHaveText('500');
  await expect(page.locator('[data-slot="token-read-at"]')).toHaveText('Đọc lúc 10:04:05');

  const link = purchaseLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', PORTAL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByText('Token mua trên portal Tingee; Tickee không bán Token.')).toBeVisible();
  await expect(page.getByText('Chỉ Owner mua thêm Token.')).toHaveCount(0);
  expect(tokenCalls(calls)).toHaveLength(1);
});

test('số dư âm: khả dụng 300, số dư -200', async ({ page }) => {
  await openToken(page, { readings: [tokenReading(-200, 500, READ_AT)] });
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('300');
  await expect(balance(page).locator('[data-slot="token-figure-value"]')).toHaveText('-200');
  await expect(creditLimit(page).locator('[data-slot="token-figure-value"]')).toHaveText('500');
});

test('"Tải lại": spinner, chặn bấm lặp, số và giờ đọc mới', async ({ page }) => {
  const calls = await openToken(page, {
    readings: [tokenReading(1_200, 500, READ_AT), tokenReading(-200, 500, READ_AGAIN_AT)],
    delayMs: 600,
  });
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  expect(tokenCalls(calls)).toHaveLength(1);

  await reloadButton(page).click();
  await expect(reloadButton(page)).toHaveAttribute('aria-busy', 'true');
  // Bấm lặp khi đang đọc: không gọi thêm.
  await reloadButton(page).click();
  await reloadButton(page).click();
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('300');
  await expect(balance(page).locator('[data-slot="token-figure-value"]')).toHaveText('-200');
  await expect(page.locator('[data-slot="token-read-at"]')).toHaveText('Đọc lúc 10:06:30');
  await expect(reloadButton(page)).not.toHaveAttribute('aria-busy', 'true');
  expect(tokenCalls(calls)).toHaveLength(2);
});

test('không tự đọc lại: quá 30 giây (hết staleTime chung) rồi tab hiện lại hay có mạng lại vẫn không gọi', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(READ_AT) });
  const calls = await openToken(page);
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  expect(tokenCalls(calls)).toHaveLength(1);

  // Số đã cũ theo `staleTime` 30 giây của QueryClient: focus hay có mạng lại sẽ tải lại nếu trang không tắt.
  await page.clock.fastForward('01:00');
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await page.clock.fastForward('01:00');
  await page.waitForTimeout(800);
  expect(tokenCalls(calls)).toHaveLength(1);
  await expect(readAt(page)).toHaveText('Đọc lúc 10:04:05');
});

test('mỗi lần mở trang một lần đọc: sang mục khác rồi về Token (điều hướng trong app) → đọc lại, giờ đọc mới', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  const calls = await openToken(page, {
    readings: [tokenReading(1_200, 500, READ_AT), tokenReading(900, 500, READ_AGAIN_AT)],
  });
  await expect(readAt(page)).toHaveText('Đọc lúc 10:04:05');
  const sidebar = page.locator('[data-slot="dashboard-sidebar"]');
  await sidebar.getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await page.waitForURL(`**/btc/${ORG_ID}/cai-dat`);
  await sidebar.getByRole('link', { name: 'Token', exact: true }).click();
  await page.waitForURL(`**${PAGE_PATH}`);
  await expect(readAt(page)).toHaveText('Đọc lúc 10:06:30');
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.400');
  expect(tokenCalls(calls)).toHaveLength(2);
});

test('api lỗi khi mở trang: "Chưa tải được Token" + "Thử lại", không tự thử lại; "Thử lại" đọc được', async ({ page }) => {
  const calls = await openToken(page, { readings: [API_FAILURE, tokenReading(1_200, 500, READ_AT)] });
  await expect(loadError(page)).toContainText('Chưa tải được Token');
  await expect(page.locator('[data-slot="token-skeleton"]')).toHaveCount(0);
  await expect(statCard(page)).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(tokenCalls(calls)).toHaveLength(1);

  await loadError(page).getByRole('button', { name: /^Thử lại/ }).click();
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(loadError(page)).toHaveCount(0);
  expect(tokenCalls(calls)).toHaveLength(2);
});

test('"Tải lại" lỗi sau khi đã có số: banner lỗi hiện, số và giờ đọc cũ giữ nguyên; "Thử lại" đọc được thì ẩn banner', async ({
  page,
}) => {
  const calls = await openToken(page, {
    readings: [tokenReading(1_200, 500, READ_AT), API_FAILURE, tokenReading(-200, 500, READ_AGAIN_AT)],
  });
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');

  await reloadButton(page).click();
  await expect(loadError(page)).toContainText('Chưa tải được Token');
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(readAt(page)).toHaveText('Đọc lúc 10:04:05');
  await expect(purchaseLink(page)).toBeVisible();
  expect(tokenCalls(calls)).toHaveLength(2);

  await loadError(page).getByRole('button', { name: /^Thử lại/ }).click();
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('300');
  await expect(readAt(page)).toHaveText('Đọc lúc 10:06:30');
  await expect(loadError(page)).toHaveCount(0);
  expect(tokenCalls(calls)).toHaveLength(3);
});

test('đang tải: skeleton, rồi số', async ({ page }) => {
  await openToken(page, { delayMs: 1_000 });
  await expect(page.locator('[data-slot="token-skeleton"]')).toBeVisible();
  await expect(statCard(page)).toHaveCount(0);
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(page.locator('[data-slot="token-skeleton"]')).toHaveCount(0);
});

test('Admin xem: đủ số; không có "Mua thêm Token", thấy "Chỉ Owner mua thêm Token."', async ({ page }) => {
  await openToken(page, { role: 'admin' });
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(balance(page).locator('[data-slot="token-figure-value"]')).toHaveText('1.200');
  await expect(creditLimit(page).locator('[data-slot="token-figure-value"]')).toHaveText('500');
  await expect(page.getByText('Chỉ Owner mua thêm Token.')).toBeVisible();
  await expect(page.getByText('Token mua trên portal Tingee; Tickee không bán Token.')).toBeVisible();
  await expect(page.getByText('Mua thêm Token', { exact: true })).toHaveCount(0);
  await expect(purchaseLink(page)).toHaveCount(0);
  await expect(page.locator(`a[href^="${PORTAL}"]`)).toHaveCount(0);
});

test('chưa đọc được số dư: "Chưa đọc được số dư" + "Thử lại"; "Mua thêm Token" vẫn hiện; thử lại đọc được', async ({
  page,
}) => {
  const calls = await openToken(page, { readings: [UNAVAILABLE, tokenReading(1_200, 500, READ_AGAIN_AT)], delayMs: 400 });
  const unavailable = page.locator('[data-slot="token-unavailable"]');
  await expect(unavailable).toContainText('Chưa đọc được số dư');
  await expect(unavailable).toContainText('Tickee chưa đọc được số dư Token từ Tingee.');
  await expect(statCard(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="token-read-at"]')).toHaveCount(0);
  await expect(purchaseLink(page)).toBeVisible();

  await retryButton(page).click();
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  await retryButton(page).click();
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(page.locator('[data-slot="token-read-at"]')).toHaveText('Đọc lúc 10:06:30');
  await expect(unavailable).toHaveCount(0);
  expect(tokenCalls(calls)).toHaveLength(2);
});

test('chưa có tài khoản nhận tiền mặc định: Owner có nút tới Tài khoản nhận tiền, vẫn có "Mua thêm Token"', async ({
  page,
}) => {
  await openToken(page, { readings: [NO_PAYOUT_ACCOUNT] });
  const empty = page.locator('[data-slot="empty-state"]');
  await expect(empty).toContainText('Chưa có tài khoản nhận tiền mặc định');
  const link = empty.getByRole('link', { name: 'Tới Tài khoản nhận tiền' });
  await expect(link).toHaveAttribute('href', `/btc/${ORG_ID}/tai-khoan-nhan-tien`);
  await expect(page.getByText('Nhờ Owner liên kết tài khoản nhận tiền.')).toHaveCount(0);
  await expect(statCard(page)).toHaveCount(0);
  await expect(purchaseLink(page)).toBeVisible();
});

test('chưa có tài khoản nhận tiền mặc định: Admin thấy "Nhờ Owner liên kết tài khoản nhận tiền.", không có nút', async ({
  page,
}) => {
  await openToken(page, { role: 'admin', readings: [NO_PAYOUT_ACCOUNT] });
  const empty = page.locator('[data-slot="empty-state"]');
  await expect(empty).toContainText('Chưa có tài khoản nhận tiền mặc định');
  await expect(empty).toContainText('Nhờ Owner liên kết tài khoản nhận tiền.');
  await expect(empty.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Chỉ Owner mua thêm Token.')).toBeVisible();
  await expect(purchaseLink(page)).toHaveCount(0);
});

test('320px không cuộn ngang: đọc được (số lớn, âm), chưa đọc được, chưa có tài khoản', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const readings = [tokenReading(-1_234_567_890, 9_876_543_210, READ_AT), UNAVAILABLE, NO_PAYOUT_ACCOUNT];
  await openToken(page, { readings });
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('8.641.975.320');
  await expect(balance(page).locator('[data-slot="token-figure-value"]')).toHaveText('-1.234.567.890');
  await expect(purchaseLink(page)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await reloadButton(page).click();
  await expect(page.locator('[data-slot="token-unavailable"]')).toContainText('Chưa đọc được số dư');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await retryButton(page).click();
  await expect(page.locator('[data-slot="empty-state"]')).toContainText('Chưa có tài khoản nhận tiền mặc định');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
