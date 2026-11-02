import type { Page } from '@playwright/test';

import { adminOrganization, mockAdminApi, queueKey, type AdminOrganization, type Gate } from './admin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Reply } from './identity-mock';

/*
 * Màn "Duyệt Closed Beta" `/admin` của Quản trị Tingee (Story 2.5) với API giả. Bề mặt desktop: mọi test dùng
 * viewport 1280×800 (project vẫn chạy cả WebKit lẫn Chromium).
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const DESKTOP = { width: 1280, height: 800 };

const PENDING_ID = '019a3b2c-0101-7abc-8def-0123456789ab';
const REVOKED_ID = '019a3b2c-0102-7abc-8def-0123456789ab';
const APPROVED_ID = '019a3b2c-0103-7abc-8def-0123456789ab';

function seed(): AdminOrganization[] {
  return [
    adminOrganization({
      id: PENDING_ID,
      name: 'CLB Cờ Vua Quận 3',
      ownerEmail: 'an.nguyen@vidu.vn',
      contactPhone: '0901234567',
      contactEmail: 'lienhe@covua.vn',
      createdAt: '2026-11-01T03:00:00.000Z',
    }),
    adminOrganization({
      id: REVOKED_ID,
      name: 'Giải Chạy Bộ Sáng',
      ownerEmail: 'binh.tran@vidu.vn',
      closedBetaStatus: 'revoked',
      createdAt: '2026-10-20T03:00:00.000Z',
    }),
    adminOrganization({
      id: APPROVED_ID,
      name: 'Nhà hát Tuổi Trẻ',
      ownerEmail: 'cuong.le@vidu.vn',
      closedBetaStatus: 'approved',
      createdAt: '2026-10-15T03:00:00.000Z',
    }),
  ];
}

const totpRequired = (): Reply => apiError(403, 'TOTP_REQUIRED', { reason: 'step_up' });

async function openAdmin(
  page: Page,
  { organizations = seed(), gate, twoFactorEnabled = true }: { organizations?: AdminOrganization[]; gate?: Gate; twoFactorEnabled?: boolean } = {},
) {
  await page.setViewportSize(DESKTOP);
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, twoFactorEnabled),
    'POST /identity/totp/step-up': () => ({ status: 200, body: { stepUpAt: '2026-11-02T03:00:00.000Z' } }),
  });
  const calls = await mockAdminApi(page, organizations, { gate });
  await page.goto('/admin');
  return { calls, identityCalls, organizations };
}

const row = (page: Page, name: string) => page.locator('[data-slot="closed-beta-row"]').filter({ hasText: name });
const rows = (page: Page) => page.locator('[data-slot="closed-beta-row"]');
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST').map((c) => c.path);

test('tab Chờ duyệt: tên BTC, email Owner, SĐT/email liên hệ, ngày tạo và nút Duyệt', async ({ page }) => {
  const { calls } = await openAdmin(page);
  await expect(page.getByRole('heading', { name: 'Duyệt Closed Beta', level: 1 })).toBeVisible();
  await expect(tab(page, 'Chờ duyệt')).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(1);
  const pending = row(page, 'CLB Cờ Vua Quận 3');
  await expect(pending).toContainText('an.nguyen@vidu.vn');
  await expect(pending).toContainText('0901234567');
  await expect(pending).toContainText('lienhe@covua.vn');
  await expect(pending).toContainText('01/11/2026');
  await expect(pending.getByRole('button', { name: 'Duyệt CLB Cờ Vua Quận 3' })).toBeVisible();
  await expect(pending.getByRole('button', { name: /Thu hồi/ })).toHaveCount(0);
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([queueKey('pending')]);
});

test('Duyệt: POST approve, toast, hàng rời Chờ duyệt và hiện ở Đã duyệt', async ({ page }) => {
  const { calls } = await openAdmin(page);
  await row(page, 'CLB Cờ Vua Quận 3').getByRole('button', { name: 'Duyệt CLB Cờ Vua Quận 3' }).click();
  await expect(page.getByText('Đã duyệt CLB Cờ Vua Quận 3 vào Closed Beta.')).toBeVisible();
  await expect(page.getByText('Không có BTC chờ duyệt.')).toBeVisible();
  expect(posts(calls)).toEqual([`/admin/organizations/${PENDING_ID}/closed-beta/approve`]);

  await tab(page, 'Đã duyệt').click();
  await expect(row(page, 'CLB Cờ Vua Quận 3')).toBeVisible();
  await expect(row(page, 'Nhà hát Tuổi Trẻ')).toBeVisible();
});

test('Thu hồi: Dialog nêu hậu quả; Hủy không gọi api; xác nhận → POST revoke, hàng sang Đã thu hồi', async ({ page }) => {
  const { calls } = await openAdmin(page);
  await tab(page, 'Đã duyệt').click();
  const approved = row(page, 'Nhà hát Tuổi Trẻ');
  const revokeButton = approved.getByRole('button', { name: 'Thu hồi Nhà hát Tuổi Trẻ' });
  await expect(approved.getByRole('button', { name: /^Duyệt/ })).toHaveCount(0);

  const dialog = page.getByRole('dialog', { name: 'Thu hồi Closed Beta?' });
  await revokeButton.click();
  await expect(dialog).toContainText('Sự kiện có phí của Nhà hát Tuổi Trẻ sẽ Tạm ngừng bán.');
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
  expect(posts(calls)).toEqual([]);

  await revokeButton.click();
  await dialog.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Đã thu hồi Closed Beta của Nhà hát Tuổi Trẻ.')).toBeVisible();
  await expect(page.getByText('Không có BTC đã duyệt.')).toBeVisible();
  expect(posts(calls)).toEqual([`/admin/organizations/${APPROVED_ID}/closed-beta/revoke`]);

  await tab(page, 'Đã thu hồi').click();
  await expect(row(page, 'Nhà hát Tuổi Trẻ')).toBeVisible();
});

test('Đã thu hồi: có nút Duyệt (duyệt lại)', async ({ page }) => {
  const { calls } = await openAdmin(page);
  await tab(page, 'Đã thu hồi').click();
  const revoked = row(page, 'Giải Chạy Bộ Sáng');
  await revoked.getByRole('button', { name: 'Duyệt Giải Chạy Bộ Sáng' }).click();
  await expect(page.getByText('Đã duyệt Giải Chạy Bộ Sáng vào Closed Beta.')).toBeVisible();
  await expect(page.getByText('Không có BTC bị thu hồi.')).toBeVisible();
  expect(posts(calls)).toEqual([`/admin/organizations/${REVOKED_ID}/closed-beta/approve`]);
});

test('tab rỗng: đúng câu của từng tab', async ({ page }) => {
  await openAdmin(page, { organizations: [] });
  await expect(page.getByText('Không có BTC chờ duyệt.')).toBeVisible();
  await tab(page, 'Đã duyệt').click();
  await expect(page.getByText('Không có BTC đã duyệt.')).toBeVisible();
  await tab(page, 'Đã thu hồi').click();
  await expect(page.getByText('Không có BTC bị thu hồi.')).toBeVisible();
});

test('BTC đã đổi trạng thái ở nơi khác (409): đóng Dialog, toast và tải lại danh sách', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
  const calls = await mockAdminApi(page, seed(), {
    handlers: {
      [`POST /admin/organizations/${APPROVED_ID}/closed-beta/revoke`]: () =>
        apiError(409, 'CLOSED_BETA_TRANSITION_INVALID', { closedBetaStatus: 'pending' }),
    },
  });
  await page.goto('/admin');
  await tab(page, 'Đã duyệt').click();
  await row(page, 'Nhà hát Tuổi Trẻ').getByRole('button', { name: 'Thu hồi Nhà hát Tuổi Trẻ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thu hồi Closed Beta?' });
  await dialog.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(page.getByText('Trạng thái của BTC đã đổi. Đã tải lại danh sách.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect.poll(() => calls.filter((c) => `${c.method} ${c.path}` === queueKey('approved')).length).toBe(2);
});

test('Thu hồi lỗi máy chủ (500): Dialog vẫn mở, báo "Chưa thu hồi được", không có toast thành công', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
  const calls = await mockAdminApi(page, seed(), {
    handlers: {
      [`POST /admin/organizations/${APPROVED_ID}/closed-beta/revoke`]: () => apiError(500, 'INTERNAL_ERROR'),
    },
  });
  await page.goto('/admin');
  await tab(page, 'Đã duyệt').click();
  await row(page, 'Nhà hát Tuổi Trẻ').getByRole('button', { name: 'Thu hồi Nhà hát Tuổi Trẻ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thu hồi Closed Beta?' });
  await dialog.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(dialog.getByText('Chưa thu hồi được')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Đã thu hồi Closed Beta của Nhà hát Tuổi Trẻ.')).toHaveCount(0);
  expect(posts(calls)).toEqual([`/admin/organizations/${APPROVED_ID}/closed-beta/revoke`]);
});

test('Duyệt BTC không còn tồn tại (404): toast và tải lại hàng Chờ duyệt', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
  const calls = await mockAdminApi(page, seed(), {
    handlers: {
      [`POST /admin/organizations/${PENDING_ID}/closed-beta/approve`]: () => apiError(404, 'NOT_FOUND'),
    },
  });
  await page.goto('/admin');
  await row(page, 'CLB Cờ Vua Quận 3').getByRole('button', { name: 'Duyệt CLB Cờ Vua Quận 3' }).click();
  await expect(page.getByText('BTC này không còn tồn tại. Đã tải lại danh sách.')).toBeVisible();
  await expect.poll(() => calls.filter((c) => `${c.method} ${c.path}` === queueKey('pending')).length).toBe(2);
  await expect(page.getByText('Đã duyệt CLB Cờ Vua Quận 3 vào Closed Beta.')).toHaveCount(0);
});

test('chưa đăng nhập → màn đăng nhập với returnTo=/admin', async ({ page }) => {
  await openAdmin(page, { gate: () => apiError(401, 'UNAUTHENTICATED') });
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent('/admin')}`);
});

test('không có cờ (FORBIDDEN_ROLE) → empty-state không quyền, không có bảng hay tab', async ({ page }) => {
  await openAdmin(page, { gate: () => apiError(403, 'FORBIDDEN_ROLE') });
  await expect(page.getByText('Bạn không có quyền vào trang này.')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
});

test('có cờ, chưa bật 2FA → empty-state + "Bật xác thực hai lớp" tới /bao-mat/totp?returnTo=/admin', async ({ page }) => {
  await openAdmin(page, { gate: () => apiError(403, 'TWO_FACTOR_NOT_ENABLED'), twoFactorEnabled: false });
  await expect(page.getByText('Bật xác thực hai lớp để vào trang quản trị.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bật xác thực hai lớp' })).toHaveAttribute(
    'href',
    `/bao-mat/totp?returnTo=${encodeURIComponent('/admin')}`,
  );
});

test('chưa qua lớp hai → dialog "Xác thực hai lớp"; nhập mã xong danh sách tự tải lại', async ({ page }) => {
  let steppedUp = false;
  const { identityCalls } = await openAdmin(page, { gate: () => (steppedUp ? undefined : totpRequired()) });
  const dialog = page.getByRole('dialog', { name: 'Xác thực hai lớp' });
  await expect(dialog).toBeVisible();
  steppedUp = true;
  await dialog.getByRole('group', { name: /Mã 6 số/ }).locator('input').first().fill('123456');
  await expect(dialog).toBeHidden();
  await expect(row(page, 'CLB Cờ Vua Quận 3')).toBeVisible();
  expect(identityCalls.filter((c) => c.path === '/identity/totp/step-up')).toHaveLength(1);
});

test('bị thu cờ giữa phiên: thao tác kế tiếp nhận FORBIDDEN_ROLE → trang chuyển sang empty-state không quyền', async ({
  page,
}) => {
  let flag = true;
  await openAdmin(page, { gate: () => (flag ? undefined : apiError(403, 'FORBIDDEN_ROLE')) });
  await expect(row(page, 'CLB Cờ Vua Quận 3')).toBeVisible();
  flag = false;
  await row(page, 'CLB Cờ Vua Quận 3').getByRole('button', { name: 'Duyệt CLB Cờ Vua Quận 3' }).click();
  await expect(page.getByText('Bạn không có quyền vào trang này.')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});
