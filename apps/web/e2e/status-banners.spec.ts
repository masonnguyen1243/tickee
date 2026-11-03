import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { me, mockIdentityApi } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, statusNotice } from './organizer-mock';

/*
 * Dải `status-banner` đầu vùng nội dung dashboard (Story 2.5, UX-DR8, AD-34) với API giả: web chỉ ánh xạ `code` sang
 * nội dung, hiện tối đa 2 banner, còn lại "+N thông báo" mở `Sheet`; banner `dismissible` ẩn theo `code` + `version`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const base = `/btc/${ORG_ID}`;
const PENDING_TITLE = 'Chờ duyệt Closed Beta';
const PENDING_TEXT = 'Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.';
const REVOKED_TITLE = 'Closed Beta đã bị thu hồi';

type Notice = ReturnType<typeof statusNotice>;

/** Mở dashboard; `notices` đọc lại ở mỗi lần gọi để test đổi được giữa hai lần tải trang. */
async function openDashboard(page: Page, notices: () => Notice[], { role = 'owner' } = {}) {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role }] }),
    [`GET /orgs/${ORG_ID}/notices`]: () => ({ status: 200, body: notices() }),
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: ORG_NAME, level: 1 })).toBeVisible();
  return calls;
}

const stack = (page: Page) => page.locator('[data-slot="status-banner-stack"]');
const banners = (page: Page) => stack(page).locator('[data-slot="status-banner"]');
const closeButtons = (page: Page) => page.getByRole('button', { name: 'Đóng thông báo' });
const moreButton = (page: Page) => page.getByRole('button', { name: /^\+\d+ thông báo$/ });

test('BTC chờ duyệt: banner warning đầu <main>, có câu hướng dẫn, không nút đóng, không nút hành động', async ({ page }) => {
  const calls = await openDashboard(page, () => [statusNotice('CLOSED_BETA_PENDING')]);
  await expect(banners(page)).toHaveCount(1);
  const banner = banners(page).first();
  await expect(banner).toHaveAttribute('data-tone', 'warning');
  await expect(banner).toContainText(PENDING_TITLE);
  await expect(banner).toContainText(PENDING_TEXT);
  await expect(banner.getByRole('button')).toHaveCount(0);
  await expect(banner.getByRole('link')).toHaveCount(0);

  // Vùng aria-live là phần tử đầu của <main>, trên tiêu đề trang.
  await expect(stack(page)).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('main > :first-child')).toHaveAttribute('data-slot', 'status-banner-stack');
  expect(calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/notices`).length).toBeGreaterThan(0);
});

test('Admin cũng thấy banner (api đã lọc theo vai); đã duyệt → không có banner, vùng aria-live vẫn có', async ({
  page,
}) => {
  let notices: Notice[] = [statusNotice('CLOSED_BETA_PENDING')];
  await openDashboard(page, () => notices, { role: 'admin' });
  await expect(banners(page)).toHaveCount(1);

  notices = [];
  await page.reload();
  await expect(page.getByRole('heading', { name: ORG_NAME, level: 1 })).toBeVisible();
  await expect(banners(page)).toHaveCount(0);
  await expect(stack(page)).toHaveCount(1);
  await expect(moreButton(page)).toHaveCount(0);
});

test('bị thu hồi: banner danger, không đóng được', async ({ page }) => {
  await openDashboard(page, () => [statusNotice('CLOSED_BETA_REVOKED')]);
  await expect(banners(page)).toHaveCount(1);
  await expect(banners(page).first()).toHaveAttribute('data-tone', 'danger');
  await expect(banners(page).first()).toContainText(REVOKED_TITLE);
  await expect(closeButtons(page)).toHaveCount(0);
});

test('3 thông báo: hiện 2 theo thứ tự api, "+1 thông báo" mở Sheet chứa thông báo còn lại', async ({ page }) => {
  await openDashboard(page, () => [
    statusNotice('CLOSED_BETA_REVOKED'),
    statusNotice('CLOSED_BETA_PENDING'),
    statusNotice('CLOSED_BETA_PENDING', { scope: 'event', version: 'su-kien-1' }),
  ]);
  await expect(banners(page)).toHaveCount(2);
  await expect(banners(page).nth(0)).toContainText(REVOKED_TITLE);
  await expect(banners(page).nth(1)).toContainText(PENDING_TITLE);
  await expect(moreButton(page)).toHaveText('+1 thông báo');

  await moreButton(page).click();
  const sheet = page.getByRole('dialog', { name: 'Thông báo khác' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-slot="status-banner"]')).toHaveCount(1);
  await expect(sheet.locator('[data-slot="status-banner"]')).toContainText(PENDING_TITLE);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('banner đóng được: ẩn theo code + version tới hết phiên; version mới → hiện lại; đóng thì thông báo dưới "+N" lên thay', async ({
  page,
}) => {
  let version = 'v1';
  await openDashboard(page, () => [
    statusNotice('CLOSED_BETA_REVOKED'),
    statusNotice('CLOSED_BETA_PENDING', { dismissible: true, version }),
    statusNotice('CLOSED_BETA_PENDING', { scope: 'event', version: 'su-kien-1' }),
  ]);
  await expect(banners(page)).toHaveCount(2);
  // Chỉ banner `dismissible` có nút đóng (banner danger thì không).
  await expect(closeButtons(page)).toHaveCount(1);
  await expect(banners(page).nth(0).getByRole('button', { name: 'Đóng thông báo' })).toHaveCount(0);

  await closeButtons(page).click();
  // Thông báo thứ ba lên thay, hết "+N".
  await expect(banners(page)).toHaveCount(2);
  await expect(moreButton(page)).toHaveCount(0);
  await expect(closeButtons(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: ORG_NAME, level: 1 })).toBeVisible();
  await expect(banners(page)).toHaveCount(2);
  await expect(closeButtons(page)).toHaveCount(0);
  await expect(moreButton(page)).toHaveCount(0);

  version = 'v2';
  await page.reload();
  await expect(page.getByRole('heading', { name: ORG_NAME, level: 1 })).toBeVisible();
  await expect(closeButtons(page)).toHaveCount(1);
  await expect(moreButton(page)).toHaveText('+1 thông báo');
});

test('desktop: dải banner nằm trên tiêu đề trong vùng nội dung, cạnh sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page, () => [statusNotice('CLOSED_BETA_PENDING')]);
  const banner = banners(page).first();
  await expect(banner).toBeVisible();
  const bannerBox = await banner.boundingBox();
  const headingBox = await page.getByRole('heading', { name: ORG_NAME, level: 1 }).boundingBox();
  const sidebarBox = await page.locator('[data-slot="dashboard-sidebar"]').boundingBox();
  expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(headingBox!.y);
  expect(bannerBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
});

const NOT_LINKED_TITLE = 'Chưa liên kết tài khoản nhận tiền';

test('chưa liên kết tài khoản nhận tiền: Owner thấy câu kêu gọi + "Liên kết ngay" mở trang Tài khoản nhận tiền', async ({
  page,
}) => {
  await openDashboard(page, () => [statusNotice('PAYOUT_ACCOUNT_NOT_LINKED'), statusNotice('CLOSED_BETA_PENDING')]);
  await expect(banners(page)).toHaveCount(2);
  const banner = banners(page).first();
  await expect(banner).toHaveAttribute('data-tone', 'danger');
  await expect(banner).toContainText(NOT_LINKED_TITLE);
  await expect(banner).toContainText('Liên kết tài khoản nhận tiền để bán Vé có phí.');
  await expect(closeButtons(page)).toHaveCount(0);
  const action = banner.getByRole('link', { name: 'Liên kết ngay' });
  await expect(action).toHaveAttribute('href', `${base}/tai-khoan-nhan-tien`);
});

test('chưa liên kết tài khoản nhận tiền: Admin chỉ thấy lời nhắc nhờ Owner, không có nút', async ({ page }) => {
  await openDashboard(page, () => [statusNotice('PAYOUT_ACCOUNT_NOT_LINKED')], { role: 'admin' });
  const banner = banners(page).first();
  await expect(banner).toContainText(NOT_LINKED_TITLE);
  await expect(banner).toContainText('Nhờ Owner liên kết tài khoản nhận tiền.');
  await expect(banner.getByRole('link')).toHaveCount(0);
  await expect(banner.getByRole('button')).toHaveCount(0);
});
