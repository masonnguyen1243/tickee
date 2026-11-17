import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Reply } from './identity-mock';
import { setVisibility } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID, tokenAlert, tokenOverview, tokenReading } from './organizer-mock';

/*
 * Trang Token (Story 4.5-a) với API giả: `GET /orgs/:id/token` trả lần lượt `readings` (mỗi lần đọc một phần tử, hết thì
 * lặp phần tử cuối; `API_FAILURE` → 500 của chính api), có thể chờ `delayMs` trước khi trả (kiểm skeleton, spinner, chặn
 * bấm lặp). Như api: link portal Tingee chỉ có với Owner. Giờ "Đọc lúc" theo giờ Việt Nam: trình duyệt chạy múi giờ New
 * York.
 *
 * Cảnh báo Token (Story 4.5-b): API giả giữ trạng thái cảnh báo (`alert`, mặc định chưa đặt ngưỡng) và đánh giá như api
 * ở mỗi lần đọc `ok` (khả dụng < ngưỡng → mốc `SINCE` nếu chưa có; không thì xóa mốc). `PUT …/token/alert-threshold`
 * lưu ngưỡng (tắt thì xóa mốc), hoặc trả lần lượt `putReplies` cài trước.
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
/** Mốc vượt ngưỡng của API giả (Story 4.5-b). */
const SINCE = '2026-11-16T03:04:05.123Z';
const NO_PAYOUT_ACCOUNT = { status: 'no_payout_account' };
/** Phần tử của `readings`: lần đọc này api trả 500 (lỗi của chính api, không phải Tingee). */
const API_FAILURE = Symbol('API_FAILURE');
const DESKTOP = { width: 1280, height: 800 };

type Role = 'owner' | 'admin';

type Alert = ReturnType<typeof tokenAlert>;

async function openToken(
  page: Page,
  {
    role = 'owner' as Role,
    readings = [tokenReading(1_200, 500, READ_AT)] as unknown[],
    delayMs = 0,
    path = PAGE_PATH,
    alert = tokenAlert() as Alert,
    putReplies = [] as Reply[],
    putDelayMs = 0,
  } = {},
): Promise<Call[]> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  let served = 0;
  let state = alert;
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role }),
    [`GET /orgs/${ORG_ID}/token`]: async (): Promise<Reply> => {
      const reading = readings[Math.min(served, readings.length - 1)];
      served += 1;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (reading === API_FAILURE) return apiError(500, 'INTERNAL_ERROR');
      const available = (reading as { status: string; available?: number }).available;
      if (available !== undefined && state.threshold !== null) {
        state = available < state.threshold ? tokenAlert(state.threshold, state.belowThresholdSince ?? SINCE) : tokenAlert(state.threshold);
      }
      return { status: 200, body: tokenOverview(reading, role === 'owner' ? PORTAL : undefined, state) };
    },
    [`PUT /orgs/${ORG_ID}/token/alert-threshold`]: async (request): Promise<Reply> => {
      if (putDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, putDelayMs));
      const scripted = putReplies.shift();
      if (scripted) return scripted;
      const { threshold } = request.postDataJSON() as { threshold: number | null };
      state = threshold === null ? tokenAlert() : tokenAlert(threshold, state.belowThresholdSince);
      return { status: 200, body: state };
    },
  });
  await page.goto(path);
  return calls;
}

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/token`);
const thresholdPuts = (calls: Call[]) =>
  calls.filter((c) => c.method === 'PUT' && c.path === `/orgs/${ORG_ID}/token/alert-threshold`);
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

// ---------------------------------------------------------------------------------------------------------------
// Ngưỡng cảnh báo (Story 4.5-b)
// ---------------------------------------------------------------------------------------------------------------

const alertBlock = (page: Page) => page.locator('[data-slot="token-alert"]');
const thresholdInput = (page: Page) => alertBlock(page).getByLabel('Báo khi Token khả dụng dưới');
const saveButton = (page: Page) => alertBlock(page).getByRole('button', { name: /^Lưu/ });
const disableButton = (page: Page) => alertBlock(page).getByRole('button', { name: /^Tắt cảnh báo/ });
const belowWarning = (page: Page) => page.locator('[data-slot="token-below-threshold"] [data-slot="status-banner"]');
const INVALID = 'Nhập số Token nguyên từ 1 đến 1.000.000.000.000.';

test('Owner chưa đặt ngưỡng: ô trống + "Lưu", không có "Tắt cảnh báo"; sai thì lỗi tại ô, không gọi api; "1.000" lưu rồi đọc lại Token', async ({
  page,
}) => {
  const calls = await openToken(page);
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await expect(alertBlock(page).getByRole('heading', { name: 'Ngưỡng cảnh báo' })).toBeVisible();
  await expect(thresholdInput(page)).toHaveValue('');
  await expect(thresholdInput(page)).toHaveAttribute('inputmode', 'numeric');
  await expect(disableButton(page)).toHaveCount(0);
  await expect(belowWarning(page)).toHaveCount(0);

  for (const text of ['', 'abc', '0', '1,5', '1000000000001']) {
    await thresholdInput(page).fill(text);
    await saveButton(page).click();
    await expect(alertBlock(page).getByRole('alert'), text).toHaveText(INVALID);
    await expect(thresholdInput(page)).toHaveAttribute('aria-invalid', 'true');
  }
  expect(thresholdPuts(calls)).toHaveLength(0);

  // Gõ lại thì lỗi biến mất; Enter trong ô gửi form.
  await thresholdInput(page).fill('1.000');
  await expect(alertBlock(page).getByText(INVALID)).toHaveCount(0);
  await expect(thresholdInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  await thresholdInput(page).press('Enter');
  await expect(page.getByText('Đã lưu ngưỡng cảnh báo.')).toBeVisible();
  expect(thresholdPuts(calls).map((c) => c.body)).toEqual([{ threshold: 1_000 }]);
  await expect.poll(() => tokenCalls(calls).length).toBe(2);
  await expect(thresholdInput(page)).toHaveValue('1.000');
  await expect(disableButton(page)).toBeVisible();
  await expect(belowWarning(page)).toHaveCount(0);
});

test('Owner lưu ngưỡng trên Token khả dụng: đọc lại thấy dưới ngưỡng → warning trên số; "Tắt cảnh báo" tắt và warning biến mất', async ({
  page,
}) => {
  const calls = await openToken(page, { putDelayMs: 400 });
  await expect(statCard(page).locator('[data-slot="stat-card-value"]')).toHaveText('1.700');
  await thresholdInput(page).fill('2000');
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveAttribute('aria-busy', 'true');
  // Bấm lặp khi đang lưu: không gửi thêm.
  await saveButton(page).click();
  await expect(page.getByText('Đã lưu ngưỡng cảnh báo.')).toBeVisible();
  await expect(belowWarning(page)).toHaveAttribute('data-tone', 'warning');
  await expect(belowWarning(page)).toHaveText('Token khả dụng dưới ngưỡng cảnh báo.');
  expect(thresholdPuts(calls)).toHaveLength(1);
  await expect(thresholdInput(page)).toHaveValue('2.000');

  // Warning nằm ngay trên số.
  const warningBox = await belowWarning(page).boundingBox();
  const statBox = await statCard(page).boundingBox();
  expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(statBox!.y);

  await disableButton(page).click();
  await expect(page.getByText('Đã tắt cảnh báo Token.')).toBeVisible();
  expect(thresholdPuts(calls).map((c) => c.body)).toEqual([{ threshold: 2_000 }, { threshold: null }]);
  await expect(belowWarning(page)).toHaveCount(0);
  await expect(thresholdInput(page)).toHaveValue('');
  await expect(disableButton(page)).toHaveCount(0);
  await expect.poll(() => tokenCalls(calls).length).toBe(3);
});

test('Owner: api từ chối ngưỡng (400) → lỗi tại ô; lỗi khác → "Chưa lưu được", ngưỡng cũ giữ nguyên', async ({ page }) => {
  await openToken(page, {
    alert: tokenAlert(1_000),
    putReplies: [apiError(400, 'VALIDATION_FAILED'), apiError(500, 'INTERNAL_ERROR')],
  });
  await expect(thresholdInput(page)).toHaveValue('1.000');
  await thresholdInput(page).fill('500');
  await saveButton(page).click();
  await expect(alertBlock(page).getByRole('alert')).toHaveText(INVALID);

  await saveButton(page).click();
  await expect(alertBlock(page).locator('[data-slot="status-banner"][data-tone="danger"]')).toContainText(
    'Chưa lưu được',
  );
  await expect(page.getByText('Đã lưu ngưỡng cảnh báo.')).toHaveCount(0);
  await expect(disableButton(page)).toBeVisible();
});

test('Admin: thấy ngưỡng và warning, không có ô hay nút; chưa đặt → "Chưa đặt ngưỡng cảnh báo."', async ({ page }) => {
  await openToken(page, { role: 'admin', alert: tokenAlert(2_000), readings: [tokenReading(1_200, 500, READ_AT)] });
  await expect(alertBlock(page)).toContainText('Ngưỡng cảnh báo: 2.000 Token');
  await expect(alertBlock(page)).toContainText('Chỉ Owner đặt ngưỡng cảnh báo.');
  await expect(alertBlock(page).getByRole('textbox')).toHaveCount(0);
  await expect(alertBlock(page).getByRole('button')).toHaveCount(0);
  await expect(belowWarning(page)).toHaveText('Token khả dụng dưới ngưỡng cảnh báo.');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openToken(page, { role: 'admin' });
  await expect(alertBlock(page)).toContainText('Chưa đặt ngưỡng cảnh báo.');
  await expect(alertBlock(page)).toContainText('Chỉ Owner đặt ngưỡng cảnh báo.');
  await expect(belowWarning(page)).toHaveCount(0);
});

test('khối "Ngưỡng cảnh báo" hiện ở mọi trạng thái đã tải: chưa đọc được (giữ warning đã lưu), chưa có tài khoản nhận tiền', async ({
  page,
}) => {
  await openToken(page, { readings: [UNAVAILABLE, NO_PAYOUT_ACCOUNT], alert: tokenAlert(1_000, SINCE) });
  await expect(page.locator('[data-slot="token-unavailable"]')).toContainText('Chưa đọc được số dư');
  await expect(thresholdInput(page)).toHaveValue('1.000');
  await expect(belowWarning(page)).toBeVisible();

  await retryButton(page).click();
  await expect(page.locator('[data-slot="empty-state"]')).toContainText('Chưa có tài khoản nhận tiền mặc định');
  await expect(thresholdInput(page)).toHaveValue('1.000');
  await expect(disableButton(page)).toBeVisible();
});

test('320px không cuộn ngang: warning, ô ngưỡng lớn, "Lưu" và "Tắt cảnh báo"; Admin', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openToken(page, {
    readings: [tokenReading(-1_234_567_890, 9_876_543_210, READ_AT)],
    alert: tokenAlert(1_000_000_000_000, SINCE),
  });
  await expect(thresholdInput(page)).toHaveValue('1.000.000.000.000');
  await expect(belowWarning(page)).toBeVisible();
  await expect(disableButton(page)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await thresholdInput(page).fill('abc');
  await saveButton(page).click();
  await expect(alertBlock(page).getByRole('alert')).toHaveText(INVALID);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openToken(page, { role: 'admin', alert: tokenAlert(1_000_000_000_000, SINCE) });
  await expect(alertBlock(page)).toContainText('Ngưỡng cảnh báo: 1.000.000.000.000 Token');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
