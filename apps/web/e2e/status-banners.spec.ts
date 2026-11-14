import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { me, mockIdentityApi, type Call } from './identity-mock';
import { fakeEventSource } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID, ORG_LIVE_URL, statusNotice } from './organizer-mock';

/*
 * Dải `status-banner` đầu vùng nội dung dashboard (Story 2.5, UX-DR8, AD-34) với API giả: web chỉ ánh xạ `code` sang
 * nội dung, hiện tối đa 2 banner, còn lại "+N thông báo" mở `Sheet`; banner `dismissible` ẩn theo `code` + `version`.
 * Story 4.2-b: bốn banner dịch vụ thanh toán theo vai (liên kết ngoài mở tab mới), tự cập nhật qua stream cấp BTC
 * `…/live` (giả bằng `EventSource` điều khiển được) hoặc polling 10 giây khi không có SSE.
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

// ---------------------------------------------------------------------------------------------------------------
// Dịch vụ thanh toán bị ngắt (Story 4.2-b)
// ---------------------------------------------------------------------------------------------------------------

const PORTAL = 'https://baas.tingee.vn';
const PAUSED = 'Mọi Sự kiện có phí đang Tạm ngừng bán.';
const TOKEN = 'PAYMENT_SERVICE_SUSPENDED_TOKEN';
const TOKEN_TITLE = 'Mọi Sự kiện có phí đang Tạm ngừng bán';
const tokenNotice = () => statusNotice(TOKEN, { data: { tingeePortalUrl: PORTAL } });

/** Câu Mason chốt 13/11: tiêu đề, mô tả + hành động của Owner, câu của Admin. */
const SERVICE_BANNERS = [
  {
    code: TOKEN,
    title: TOKEN_TITLE,
    owner: 'Tingee báo đã hết Token (gói dịch vụ hết hạn).',
    action: 'Mua thêm Token',
    admin: 'Tingee báo đã hết Token. Nhờ Owner mua thêm Token.',
  },
  {
    code: 'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
    title: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC',
    owner: PAUSED,
    action: 'Xem chi tiết',
    admin: `${PAUSED} Nhờ Owner liên hệ Tingee.`,
  },
  {
    code: 'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
    title: 'Key Tingee không còn dùng được',
    owner: PAUSED,
    action: 'Nhập lại key',
    admin: `${PAUSED} Nhờ Owner cập nhật key Tingee.`,
  },
  {
    code: 'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
    title: 'Key Tingee chưa được cấp quyền Cổng thanh toán',
    owner: PAUSED,
    action: 'Xem cách xử lý',
    admin: `${PAUSED} Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee.`,
  },
];

const noticeOf = (code: string) => (code === TOKEN ? tokenNotice() : statusNotice(code));
const noticeGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/notices`);
const heading = (page: Page) => page.getByRole('heading', { name: ORG_NAME, level: 1 });

test('dịch vụ thanh toán bị ngắt, Owner: mỗi mã một banner danger không đóng được, mô tả + một hành động đúng câu', async ({
  page,
}) => {
  let notices: Notice[] = [];
  await openDashboard(page, () => notices);
  for (const copy of SERVICE_BANNERS) {
    notices = [noticeOf(copy.code)];
    await page.reload();
    await expect(heading(page)).toBeVisible();
    await expect(banners(page)).toHaveCount(1);
    const banner = banners(page).first();
    await expect(banner, copy.code).toHaveAttribute('data-tone', 'danger');
    await expect(banner, copy.code).toContainText(copy.title);
    await expect(banner, copy.code).toContainText(copy.owner);
    await expect(closeButtons(page)).toHaveCount(0);
    await expect(banner.getByRole('link'), copy.code).toHaveCount(1);
    const action = banner.getByRole('link', { name: copy.action });
    if (copy.code === TOKEN) {
      // Liên kết ngoài: portal Tingee từ `data.tingeePortalUrl`, tab mới, không lộ `window.opener`.
      await expect(action).toHaveAttribute('href', PORTAL);
      await expect(action).toHaveAttribute('target', '_blank');
      await expect(action).toHaveAttribute('rel', 'noopener noreferrer');
    } else {
      await expect(action, copy.code).toHaveAttribute('href', `${base}/tai-khoan-nhan-tien`);
      await expect(action, copy.code).not.toHaveAttribute('target', '_blank');
    }
  }
});

test('dịch vụ thanh toán bị ngắt, Admin: tiêu đề + câu nhờ Owner, không có hành động', async ({ page }) => {
  let notices: Notice[] = [];
  await openDashboard(page, () => notices, { role: 'admin' });
  for (const copy of SERVICE_BANNERS) {
    notices = [noticeOf(copy.code)];
    await page.reload();
    await expect(heading(page)).toBeVisible();
    const banner = banners(page).first();
    await expect(banner, copy.code).toContainText(copy.title);
    await expect(banner, copy.code).toContainText(copy.admin);
    await expect(banner.getByRole('link'), copy.code).toHaveCount(0);
    await expect(banner.getByRole('button'), copy.code).toHaveCount(0);
  }
});

test('"Mua thêm Token" mở portal Tingee ở tab mới, dashboard giữ nguyên; thiếu URL portal → banner không có hành động', async ({
  page,
}) => {
  await page.context().route(
    (url) => url.hostname === 'baas.tingee.vn',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Tingee</title>' }),
  );
  let notices: Notice[] = [tokenNotice()];
  await openDashboard(page, () => notices);
  const popupPromise = page.waitForEvent('popup');
  await banners(page).first().getByRole('link', { name: 'Mua thêm Token' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(new URL(popup.url()).origin).toBe(PORTAL);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  expect(new URL(page.url()).pathname).toBe(base);

  // Api không gửi URL portal (hoặc URL không phải http/https): không có nút hỏng.
  notices = [statusNotice(TOKEN, { data: { tingeePortalUrl: 'javascript:alert(1)' } })];
  await page.reload();
  await expect(banners(page).first()).toContainText(TOKEN_TITLE);
  await expect(banners(page).first().getByRole('link')).toHaveCount(0);
});

test('stream cấp BTC: org_status_changed → banner hiện rồi biến mất, không tải lại trang; mã lạ vẫn bị bỏ', async ({ page }) => {
  const sse = await fakeEventSource(page, { url: ORG_LIVE_URL });
  let notices: Notice[] = [];
  const calls = await openDashboard(page, () => notices);
  await expect.poll(sse.count).toBe(1);
  const info = await sse.info();
  expect(info.withCredentials).toBe(true);
  expect(info.url).toMatch(new RegExp(`/v1/orgs/${ORG_ID}/live$`));
  await sse.open();
  await expect(banners(page)).toHaveCount(0);

  // Đánh dấu trang: tải lại trang thì dấu mất.
  await page.evaluate(() => ((window as unknown as { __mark: boolean }).__mark = true));
  notices = [statusNotice('MA_MOI_CHUA_BIET', { severity: 'danger' }), noticeOf('PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID')];
  const before = noticeGets(calls).length;
  await sse.message('org_status_changed');
  await expect(banners(page)).toHaveCount(1, { timeout: 3_000 });
  await expect(banners(page).first()).toContainText('Key Tingee không còn dùng được');
  expect(noticeGets(calls).length).toBeGreaterThan(before);

  notices = [];
  await sse.message('org_status_changed');
  await expect(banners(page)).toHaveCount(0, { timeout: 3_000 });
  expect(await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark)).toBe(true);
  expect(await sse.count()).toBe(1);
});

test('không có SSE (503) → dải banner polling 10 giây', async ({ page }) => {
  test.setTimeout(45_000);
  let notices: Notice[] = [];
  const calls = await openDashboard(page, () => notices);
  await expect
    .poll(() => calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/live`).length)
    .toBeGreaterThanOrEqual(1);
  await expect(banners(page)).toHaveCount(0);
  const startedAt = Date.now();
  notices = [tokenNotice()];
  await expect(banners(page).first()).toContainText(TOKEN_TITLE, { timeout: 12_000 });
  expect(Date.now() - startedAt).toBeLessThan(12_000);
});
