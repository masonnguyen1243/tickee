import type { Page } from '@playwright/test';

import {
  adminOrganization,
  mockAdminApi,
  queueKey,
  resumeKey,
  SUSPENDED_KEY,
  type AdminOrganization,
  type Gate,
  type SuspendedOrganization,
} from './admin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Reply } from './identity-mock';

/*
 * Màn "Duyệt Closed Beta" `/admin` của Quản trị Tingee (Story 2.5) với API giả. Bề mặt desktop: mọi test dùng
 * viewport 1280×800 (project vẫn chạy cả WebKit lẫn Chromium). Story 4.2-b: tab "Tạm ngừng bán" (BTC bị ngắt dịch vụ
 * thanh toán, "Mở lại" qua `Dialog`), cùng cổng quyền với các tab Closed Beta.
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
  {
    organizations = seed(),
    gate,
    twoFactorEnabled = true,
    suspended = [],
  }: {
    organizations?: AdminOrganization[];
    gate?: Gate;
    twoFactorEnabled?: boolean;
    suspended?: SuspendedOrganization[];
  } = {},
) {
  await page.setViewportSize(DESKTOP);
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, twoFactorEnabled),
    'POST /identity/totp/step-up': () => ({ status: 200, body: { stepUpAt: '2026-11-02T03:00:00.000Z' } }),
  });
  const calls = await mockAdminApi(page, organizations, { gate, suspended });
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

test.describe('tab "Tạm ngừng bán" (Story 4.2-b)', () => {
  // Giờ luôn theo giờ Việt Nam, kể cả khi trình duyệt ở múi giờ khác.
  test.use({ timezoneId: 'America/New_York' });

  const TOKEN_ID = '019a3b2c-0201-7abc-8def-0123456789ab';
  const KEY_ID = '019a3b2c-0202-7abc-8def-0123456789ab';
  const suspendedSeed = (): SuspendedOrganization[] => [
    {
      id: TOKEN_ID,
      name: 'CLB Bơi Lội Phú Nhuận',
      reason: 'token',
      since: '2026-11-12T01:30:00.000Z',
      checkedAt: '2026-11-13T02:15:00.000Z',
    },
    {
      id: KEY_ID,
      name: 'Giải Cầu Lông Ba Đình',
      reason: 'gateway_permission_missing',
      since: '2026-11-13T03:04:00.000Z',
      checkedAt: null,
    },
  ];
  const suspendedRows = (page: Page) => page.locator('[data-slot="suspended-payment-service-row"]');
  const suspendedRow = (page: Page, name: string) => suspendedRows(page).filter({ hasText: name });
  const resumeDialog = (page: Page, name: string) =>
    page.getByRole('dialog', { name: `Mở lại dịch vụ thanh toán cho ${name}?` });
  const suspendedGets = (calls: Call[]) => calls.filter((c) => `${c.method} ${c.path}` === SUSPENDED_KEY);

  test('bảng BTC đang ngắt theo thứ tự api (ngắt lâu nhất trước): tên, nhãn lý do, từ lúc, lần kiểm tra gần nhất', async ({
    page,
  }) => {
    // Story 4.2-d: BTC bị ngắt vì Tingee từ chối VA của tài khoản nhận tiền mặc định.
    const vaRejected: SuspendedOrganization = {
      id: '019a3b2c-0203-7abc-8def-0123456789ab',
      name: 'Hội Chạy Bộ Thủ Đức',
      reason: 'payout_account_not_allowed',
      since: '2026-11-14T02:00:00.000Z',
      checkedAt: null,
    };
    const { calls } = await openAdmin(page, { suspended: [...suspendedSeed(), vaRejected] });
    await tab(page, 'Tạm ngừng bán').click();
    await expect(tab(page, 'Tạm ngừng bán')).toHaveAttribute('aria-selected', 'true');
    await expect(suspendedRows(page)).toHaveCount(3);
    await expect(suspendedRows(page).nth(0)).toContainText('CLB Bơi Lội Phú Nhuận');
    await expect(suspendedRows(page).nth(0)).toContainText('Hết Token');
    await expect(suspendedRows(page).nth(0)).toContainText('08:30 12/11/2026');
    await expect(suspendedRows(page).nth(0)).toContainText('09:15 13/11/2026');
    await expect(suspendedRows(page).nth(1)).toContainText('Giải Cầu Lông Ba Đình');
    await expect(suspendedRows(page).nth(1)).toContainText('Key thiếu quyền Cổng thanh toán');
    await expect(suspendedRows(page).nth(1)).toContainText('10:04 13/11/2026');
    await expect(suspendedRows(page).nth(1)).toContainText('Chưa kiểm tra');
    await expect(suspendedRows(page).nth(2)).toContainText('Hội Chạy Bộ Thủ Đức');
    await expect(suspendedRows(page).nth(2)).toContainText('Tài khoản chưa dùng được Cổng thanh toán');
    await expect(suspendedRows(page).nth(2)).toContainText('09:00 14/11/2026');
    await expect(suspendedRow(page, 'CLB Bơi Lội Phú Nhuận').getByRole('button', { name: 'Mở lại CLB Bơi Lội Phú Nhuận' })).toBeVisible();
    // Tab Closed Beta không tải danh sách Tạm ngừng bán cho tới khi được mở.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([queueKey('pending'), SUSPENDED_KEY]);
  });

  test('Mở lại: Dialog nêu hậu quả; Hủy không gọi api; xác nhận → POST resume, toast, hàng rời bảng; hết hàng → câu bảng trống', async ({
    page,
  }) => {
    const { calls } = await openAdmin(page, { suspended: suspendedSeed().slice(0, 1) });
    await tab(page, 'Tạm ngừng bán').click();
    const name = 'CLB Bơi Lội Phú Nhuận';
    const button = suspendedRow(page, name).getByRole('button', { name: `Mở lại ${name}` });
    const dialog = resumeDialog(page, name);

    await button.click();
    await expect(dialog).toContainText(
      'Mọi Hạng vé có phí của BTC bán lại ngay và Tickee đối soát các Đơn đang mở. Nếu Tingee vẫn ngắt, lần tạo link kế tiếp sẽ tạm ngừng bán lại.',
    );
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toBeHidden();
    expect(posts(calls)).toEqual([]);

    await button.click();
    await dialog.getByRole('button', { name: 'Mở lại' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Đã mở lại dịch vụ thanh toán cho ${name}.`)).toBeVisible();
    await expect(page.getByText('Không có BTC nào đang Tạm ngừng bán.')).toBeVisible();
    await expect(suspendedRows(page)).toHaveCount(0);
    expect(posts(calls)).toEqual([`/admin/organizations/${TOKEN_ID}/payment-service/resume`]);
    expect(suspendedGets(calls)).toHaveLength(2);
  });

  test('bảng trống: "Không có BTC nào đang Tạm ngừng bán."', async ({ page }) => {
    await openAdmin(page);
    await tab(page, 'Tạm ngừng bán').click();
    await expect(page.getByText('Không có BTC nào đang Tạm ngừng bán.')).toBeVisible();
    await expect(suspendedRows(page)).toHaveCount(0);
  });

  test('409 PAYMENT_SERVICE_NOT_SUSPENDED (đã mở lại ở nơi khác): đóng Dialog, toast "đã đổi" và tải lại danh sách', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
    const suspended = suspendedSeed();
    const calls = await mockAdminApi(page, seed(), {
      suspended,
      handlers: {
        // Job dò vừa mở lại BTC này trước khi Quản trị bấm.
        [resumeKey(TOKEN_ID)]: () => {
          suspended.splice(0, 1);
          return apiError(409, 'PAYMENT_SERVICE_NOT_SUSPENDED');
        },
      },
    });
    await page.goto('/admin');
    await tab(page, 'Tạm ngừng bán').click();
    const name = 'CLB Bơi Lội Phú Nhuận';
    await suspendedRow(page, name).getByRole('button', { name: `Mở lại ${name}` }).click();
    const dialog = resumeDialog(page, name);
    await dialog.getByRole('button', { name: 'Mở lại' }).click();
    await expect(page.getByText('Trạng thái của BTC đã đổi. Đã tải lại danh sách.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect.poll(() => suspendedGets(calls).length).toBe(2);
    await expect(suspendedRows(page)).toHaveCount(1);
    await expect(page.getByText(`Đã mở lại dịch vụ thanh toán cho ${name}.`)).toHaveCount(0);
  });

  test('Mở lại lỗi máy chủ (500): Dialog vẫn mở, báo "Chưa mở lại được"', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
    await mockAdminApi(page, seed(), {
      suspended: suspendedSeed(),
      handlers: { [resumeKey(KEY_ID)]: () => apiError(500, 'INTERNAL_ERROR') },
    });
    await page.goto('/admin');
    await tab(page, 'Tạm ngừng bán').click();
    const name = 'Giải Cầu Lông Ba Đình';
    await suspendedRow(page, name).getByRole('button', { name: `Mở lại ${name}` }).click();
    const dialog = resumeDialog(page, name);
    await dialog.getByRole('button', { name: 'Mở lại' }).click();
    await expect(dialog.getByText('Chưa mở lại được')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(suspendedRows(page)).toHaveCount(2);
  });

  test('chưa qua lớp hai khi Mở lại → dialog "Xác thực hai lớp"; nhập mã xong lần Mở lại tự chạy tiếp', async ({ page }) => {
    let steppedUp = false;
    const { calls, identityCalls } = await openAdmin(page, {
      suspended: suspendedSeed(),
      gate: (request) => (!steppedUp && request.method() === 'POST' ? totpRequired() : undefined),
    });
    await tab(page, 'Tạm ngừng bán').click();
    const name = 'Giải Cầu Lông Ba Đình';
    await suspendedRow(page, name).getByRole('button', { name: `Mở lại ${name}` }).click();
    await resumeDialog(page, name).getByRole('button', { name: 'Mở lại' }).click();
    const stepUp = page.getByRole('dialog', { name: 'Xác thực hai lớp' });
    await expect(stepUp).toBeVisible();
    steppedUp = true;
    await stepUp.getByRole('group', { name: /Mã 6 số/ }).locator('input').first().fill('123456');
    await expect(stepUp).toBeHidden();
    await expect(page.getByText(`Đã mở lại dịch vụ thanh toán cho ${name}.`)).toBeVisible();
    await expect(resumeDialog(page, name)).toBeHidden();
    await expect(suspendedRows(page)).toHaveCount(1);
    expect(posts(calls)).toEqual([
      `/admin/organizations/${KEY_ID}/payment-service/resume`,
      `/admin/organizations/${KEY_ID}/payment-service/resume`,
    ]);
    expect(identityCalls.filter((c) => c.path === '/identity/totp/step-up')).toHaveLength(1);
  });

  test('bị thu cờ giữa phiên ở tab này: Mở lại nhận FORBIDDEN_ROLE → trang chuyển sang empty-state không quyền', async ({
    page,
  }) => {
    let flag = true;
    await openAdmin(page, {
      suspended: suspendedSeed(),
      gate: () => (flag ? undefined : apiError(403, 'FORBIDDEN_ROLE')),
    });
    await tab(page, 'Tạm ngừng bán').click();
    await expect(suspendedRows(page)).toHaveCount(2);
    flag = false;
    const name = 'Giải Cầu Lông Ba Đình';
    await suspendedRow(page, name).getByRole('button', { name: `Mở lại ${name}` }).click();
    await resumeDialog(page, name).getByRole('button', { name: 'Mở lại' }).click();
    await expect(page.getByText('Bạn không có quyền vào trang này.')).toBeVisible();
    await expect(suspendedRows(page)).toHaveCount(0);
  });
});
