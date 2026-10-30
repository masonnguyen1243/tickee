import { expect, test, type Locator, type Page } from '@playwright/test';

import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, type Handler } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, OTHER_ORG_ID } from './organizer-mock';

/*
 * Khung dashboard `/btc/[orgId]` (Story 2.1 phần B, UX-DR34) với API giả. Project Playwright là điện thoại 375px;
 * desktop và tablet đổi kích thước bằng `page.setViewportSize`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const OTHER_NAME = 'Giải Chạy Bộ Sáng';
const DESKTOP = { width: 1280, height: 800 };
const TABLET = { width: 900, height: 800 };

const base = `/btc/${ORG_ID}`;
const OWNER_SIDEBAR: [string, string][] = [
  ['Sự kiện', base],
  ['Cần xử lý', `${base}/can-xu-ly`],
  ['Token', `${base}/token`],
  ['Thành viên', `${base}/thanh-vien`],
  ['Tài khoản nhận tiền', `${base}/tai-khoan-nhan-tien`],
  ['Cài đặt', `${base}/cai-dat`],
];

type Role = 'owner' | 'admin';

async function openDashboard(page: Page, { role = 'owner' as Role, path = base, orgOverrides = {} } = {}) {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role, ...orgOverrides }),
    [`GET /orgs/${OTHER_ORG_ID}`]: () => organization({ id: OTHER_ORG_ID, name: OTHER_NAME, role: 'admin' }),
    'GET /me/memberships': () => ({
      status: 200,
      body: [
        { organizationId: ORG_ID, name: ORG_NAME, role },
        { organizationId: OTHER_ORG_ID, name: OTHER_NAME, role: 'admin' },
      ],
    }),
  });
  await page.goto(path);
  return calls;
}

const sidebar = (page: Page) => page.locator('[data-slot="dashboard-sidebar"]');
const sidebarLinks = (page: Page) => sidebar(page).getByRole('navigation', { name: 'Điều hướng BTC' }).getByRole('link');
const tabBar = (page: Page) => page.locator('[data-slot="bottom-tab-bar"]');
const switcher = (scope: Page | Locator) => scope.getByRole('button', { name: /Đổi BTC/ });
const moreSheet = (page: Page) => page.getByRole('dialog', { name: 'Thêm' });

async function names(links: Locator): Promise<[string | null, string | null][]> {
  return links.evaluateAll((els) => els.map((el) => [el.getAttribute('aria-label'), el.getAttribute('href')]));
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('desktop ≥ lg', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('Owner: sidebar đủ 6 mục theo thứ tự và đúng URL, mục đang chọn có aria-current, không có tab bar', async ({
    page,
  }) => {
    await openDashboard(page);
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebarLinks(page)).toHaveCount(6);
    expect(await names(sidebarLinks(page))).toEqual(OWNER_SIDEBAR);
    // Từ lg nhãn hiện cạnh icon.
    await expect(sidebar(page).getByText('Tài khoản nhận tiền', { exact: true })).toBeVisible();

    const events = sidebarLinks(page).first();
    await expect(events).toHaveAttribute('aria-current', 'page');
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabBar(page)).toBeHidden();

    await expect(switcher(sidebar(page))).toContainText(ORG_NAME);
    await expect(switcher(sidebar(page))).toContainText('Owner');
    await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
    // Header chung ở đầu vùng nội dung.
    await expect(page.getByRole('link', { name: 'Tickee — Trang chủ' })).toBeVisible();
    await expect(page.getByRole('button', { name: `Tài khoản: ${EMAIL}` })).toBeVisible();
  });

  test('Admin: ẩn Thành viên và Tài khoản nhận tiền (không render)', async ({ page }) => {
    await openDashboard(page, { role: 'admin' });
    await expect(sidebarLinks(page)).toHaveCount(4);
    expect((await names(sidebarLinks(page))).map(([name]) => name)).toEqual(['Sự kiện', 'Cần xử lý', 'Token', 'Cài đặt']);
    await expect(page.getByRole('link', { name: 'Thành viên' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Tài khoản nhận tiền' })).toHaveCount(0);
    await expect(switcher(sidebar(page))).toContainText('Admin');
  });

  test('đổi BTC: liệt kê memberships (tên, vai), đánh dấu BTC hiện tại; chọn BTC khác → /btc/{B}', async ({ page }) => {
    await openDashboard(page, { path: `${base}/token` });
    await switcher(sidebar(page)).click();
    const items = page.getByRole('menu').getByRole('menuitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(ORG_NAME);
    await expect(items.nth(0)).toContainText('Owner');
    await expect(items.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(items.nth(1)).toContainText(OTHER_NAME);
    await expect(items.nth(1)).toContainText('Admin');
    await expect(items.nth(1)).not.toHaveAttribute('aria-current', /.*/);
    await expect(items.nth(2)).toHaveText('Tạo BTC mới');

    await items.nth(1).click();
    await page.waitForURL(`**/btc/${OTHER_ORG_ID}`);
    await expect(sidebar(page).locator('[data-slot="organization-switcher-name"]')).toHaveText(OTHER_NAME);
    await expect(switcher(sidebar(page))).toContainText('Admin');
    await expect(page.getByRole('heading', { name: OTHER_NAME })).toBeVisible();
    await expect(sidebarLinks(page).first()).toHaveAttribute('aria-current', 'page');
  });

  test('"Tạo BTC mới" ở cuối switcher → /tao-btc', async ({ page }) => {
    await openDashboard(page);
    await switcher(sidebar(page)).click();
    await page.getByRole('menuitem', { name: 'Tạo BTC mới' }).click();
    await page.waitForURL('**/tao-btc');
    await expect(page.getByRole('heading', { name: 'Tạo BTC' })).toBeVisible();
  });

  const RECONCILE: [string, Handler][] = [
    [
      'memberships cũ (tên, vai khác)',
      () => ({
        status: 200,
        body: [
          { organizationId: ORG_ID, name: 'Tên cũ', role: 'owner' },
          { organizationId: OTHER_ORG_ID, name: OTHER_NAME, role: 'admin' },
        ],
      }),
    ],
    [
      'memberships thiếu BTC hiện tại',
      () => ({ status: 200, body: [{ organizationId: OTHER_ORG_ID, name: OTHER_NAME, role: 'admin' }] }),
    ],
    ['memberships lỗi 500', () => apiError(500, 'INTERNAL_ERROR')],
  ];
  for (const [label, membershipsHandler] of RECONCILE) {
    test(`switcher (${label}): BTC hiện tại lấy tên và vai từ GET /orgs/:orgId`, async ({ page }) => {
      await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
      await mockOrganizerApi(page, {
        [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin', name: 'Tên mới từ api' }),
        'GET /me/memberships': membershipsHandler,
      });
      await page.goto(base);
      await expect(switcher(sidebar(page))).toContainText('Tên mới từ api');
      await expect(switcher(sidebar(page))).toContainText('Admin');

      await switcher(sidebar(page)).click();
      const menu = page.getByRole('menu');
      const first = menu.getByRole('menuitem').first();
      await expect(first).toContainText('Tên mới từ api');
      await expect(first).toContainText('Admin');
      await expect(first).toHaveAttribute('aria-current', 'true');
      await expect(menu.locator('[aria-current]')).toHaveCount(1);
      await expect(menu).not.toContainText('Tên cũ');
      if (label === 'memberships lỗi 500') {
        // Hết 2 lần thử lại (1s + 2s) mới báo lỗi.
        await expect(menu.getByText('Chưa tải được danh sách BTC.')).toBeVisible({ timeout: 10_000 });
      } else {
        await expect(menu).toContainText(OTHER_NAME);
      }
    });
  }

  test('bàn phím: Tab qua switcher và các mục, Enter mở, Esc đóng menu', async ({ page, browserName }) => {
    // Safari/WebKit mặc định chỉ Tab qua ô nhập và nút; tới link cần Option+Tab (như người dùng Safari bật sẵn).
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await openDashboard(page);
    await expect(switcher(sidebar(page))).toBeVisible();

    await switcher(sidebar(page)).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(switcher(sidebar(page))).toBeFocused();

    for (const [name] of OWNER_SIDEBAR.slice(0, 3)) {
      await page.keyboard.press(tab);
      await expect(sidebar(page).getByRole('link', { name, exact: true })).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await page.waitForURL(`**${base}/token`);
    await expect(sidebar(page).getByRole('link', { name: 'Token' })).toHaveAttribute('aria-current', 'page');
  });

  test('bàn phím: Tab đầu tiên tới "Bỏ qua đến nội dung", Enter đưa focus vào nội dung', async ({ page, browserName }) => {
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await openDashboard(page);
    await expect(sidebar(page)).toBeVisible();

    await page.keyboard.press(tab);
    const skip = page.getByRole('link', { name: 'Bỏ qua đến nội dung' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });
});

test('tablet 900px: sidebar chỉ icon, mỗi mục có tên truy cập và tooltip là tên mục', async ({ page }) => {
  await page.setViewportSize(TABLET);
  await openDashboard(page);
  await expect(sidebar(page)).toBeVisible();
  expect((await sidebar(page).boundingBox())!.width).toBeLessThanOrEqual(64);
  await expect(tabBar(page)).toBeHidden();

  await expect(sidebarLinks(page)).toHaveCount(6);
  for (const [name] of OWNER_SIDEBAR) {
    const link = sidebar(page).getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link.getByText(name, { exact: true })).toBeHidden();
  }

  // Switcher chỉ còn avatar nhưng vẫn có tên truy cập.
  await expect(sidebar(page).locator('[data-slot="organization-switcher-name"]')).toBeHidden();
  await expect(switcher(sidebar(page))).toHaveAccessibleName(new RegExp(ORG_NAME));

  await sidebar(page).getByRole('link', { name: 'Token', exact: true }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Token');
});

test.describe('điện thoại < md', () => {
  test('tab bar 4 mục cố định ở đáy; "Thêm" mở Sheet có các mục còn lại và switcher; Esc đóng', async ({ page }) => {
    await openDashboard(page);
    await expect(tabBar(page)).toBeVisible();
    await expect(sidebar(page)).toBeHidden();

    const cells = tabBar(page).getByRole('listitem');
    await expect(cells).toHaveCount(4);
    expect((await cells.allInnerTexts()).map((t) => t.trim())).toEqual(['Sự kiện', 'Cần xử lý', 'Quét vé', 'Thêm']);
    expect(await names(tabBar(page).getByRole('link'))).toEqual([
      [null, base],
      [null, `${base}/can-xu-ly`],
      [null, `${base}/quet-ve`],
    ]);
    await expect(tabBar(page).getByRole('link', { name: 'Sự kiện' })).toHaveAttribute('aria-current', 'page');

    const box = (await tabBar(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
    expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height);

    await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
    const sheet = moreSheet(page);
    await expect(sheet).toBeVisible();
    expect(await names(sheet.getByRole('link'))).toEqual([
      [null, `${base}/token`],
      [null, `${base}/thanh-vien`],
      [null, `${base}/tai-khoan-nhan-tien`],
      [null, `${base}/cai-dat`],
    ]);
    await expect(sheet.getByRole('link')).toHaveText(['Token', 'Thành viên', 'Tài khoản nhận tiền', 'Cài đặt']);
    await expect(switcher(sheet)).toContainText(ORG_NAME);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Chạm nút "Đóng", rồi chạm nền mờ phía trên Sheet.
    await tabBar(page).getByRole('button', { name: 'Thêm' }).tap();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Đóng' }).tap();
    await expect(sheet).toBeHidden();
    await tabBar(page).getByRole('button', { name: 'Thêm' }).tap();
    await expect(sheet).toBeVisible();
    await page.locator('[data-slot="sheet-overlay"]').tap({ position: { x: 20, y: 20 } });
    await expect(sheet).toBeHidden();
  });

  test('Sheet đóng khi đổi trang không qua Sheet (Back); "Thêm" có aria-current khi trang nằm trong Sheet', async ({
    page,
  }) => {
    await openDashboard(page);
    const more = tabBar(page).getByRole('button', { name: 'Thêm' });
    await expect(more).not.toHaveAttribute('aria-current', /.*/);
    await more.click();
    await moreSheet(page).getByRole('link', { name: 'Token' }).click();
    await page.waitForURL(`**${base}/token`);
    await expect(more).toHaveAttribute('aria-current', 'page');

    await more.click();
    await expect(moreSheet(page)).toBeVisible();
    await page.goBack();
    await page.waitForURL(`**${base}`);
    await expect(moreSheet(page)).toBeHidden();
    await expect(more).not.toHaveAttribute('aria-current', /.*/);
  });

  test('Admin: Sheet "Thêm" ẩn Thành viên và Tài khoản nhận tiền', async ({ page }) => {
    await openDashboard(page, { role: 'admin' });
    await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
    await expect(moreSheet(page).getByRole('link')).toHaveText(['Token', 'Cài đặt']);
    await expect(switcher(moreSheet(page))).toContainText('Admin');
  });

  test('mục trong Sheet dẫn tới trang của mục, Sheet đóng, mục có aria-current', async ({ page }) => {
    await openDashboard(page);
    await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
    await moreSheet(page).getByRole('link', { name: 'Cài đặt' }).click();
    await page.waitForURL(`**${base}/cai-dat`);
    await expect(moreSheet(page)).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();

    await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
    await expect(moreSheet(page).getByRole('link', { name: 'Cài đặt' })).toHaveAttribute('aria-current', 'page');
  });

  test('đổi BTC từ Sheet: về /btc/{B}, Sheet đóng, switcher hiện tên B', async ({ page }) => {
    await openDashboard(page);
    await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
    await switcher(moreSheet(page)).click();
    await page.getByRole('menuitem', { name: new RegExp(OTHER_NAME) }).click();
    await page.waitForURL(`**/btc/${OTHER_ORG_ID}`);
    await expect(moreSheet(page)).toBeHidden();
    await expect(page.getByRole('heading', { name: OTHER_NAME })).toBeVisible();

    await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
    await expect(moreSheet(page).locator('[data-slot="organization-switcher-name"]')).toHaveText(OTHER_NAME);
  });

  test('bàn phím: Enter mở Sheet "Thêm", Esc đóng menu rồi đóng Sheet', async ({ page }) => {
    await openDashboard(page);
    const more = tabBar(page).getByRole('button', { name: 'Thêm' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(moreSheet(page)).toBeVisible();

    await switcher(moreSheet(page)).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(moreSheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(moreSheet(page)).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('375px nội dung dài: cuộn tới cuối, phần cuối trang không bị tab bar che', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 480 });
    await openDashboard(page, {
      orgOverrides: { name: 'Câu lạc bộ cờ vua và cờ tướng thiếu niên phường Võ Thị Sáu quận Ba thành phố HCM 2026' },
    });
    const last = page.getByRole('link', { name: 'Tạo Sự kiện' });
    await expect(last).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const button = (await last.boundingBox())!;
    const bar = (await tabBar(page).boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(bar.y);
    // Không phần tử nào (tab bar) nằm đè lên nút cuối trang.
    const hit = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom - 2));
    });
    expect(hit).toBe(true);
  });
});

test('danh sách Sự kiện trống: "Tạo Sự kiện" → trang tạm, "Sự kiện" vẫn đang chọn', async ({ page }) => {
  await openDashboard(page);
  await expect(page.getByText('Chưa có Sự kiện nào.')).toBeVisible();
  await page.getByRole('link', { name: 'Tạo Sự kiện' }).click();
  await page.waitForURL(`**${base}/su-kien/tao`);
  await expect(page.getByRole('heading', { name: 'Tạo Sự kiện' })).toBeVisible();
  await expect(page.getByText('Sắp có', { exact: true })).toBeVisible();
  await expect(tabBar(page).getByRole('link', { name: 'Sự kiện' })).toHaveAttribute('aria-current', 'page');
});

test('mục chưa có trang: trang tạm "Sắp có" trong khung, mục đang chọn có aria-current', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openDashboard(page, { path: `${base}/token` });
  await expect(page.getByRole('heading', { name: 'Token' })).toBeVisible();
  await expect(page.getByText('Sắp có', { exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: 'Token' })).toHaveAttribute('aria-current', 'page');

  const pages: [string, string][] = [
    ['Cần xử lý', `${base}/can-xu-ly`],
    ['Thành viên', `${base}/thanh-vien`],
    ['Tài khoản nhận tiền', `${base}/tai-khoan-nhan-tien`],
    ['Cài đặt', `${base}/cai-dat`],
  ];
  for (const [name, path] of pages) {
    await sidebar(page).getByRole('link', { name, exact: true }).click();
    await page.waitForURL(`**${path}`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('Sắp có', { exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  await page.setViewportSize({ width: 375, height: 667 });
  await tabBar(page).getByRole('link', { name: 'Quét vé' }).click();
  await page.waitForURL(`**${base}/quet-ve`);
  await expect(page.getByRole('heading', { name: 'Quét vé' })).toBeVisible();
  await expect(page.getByText('Sắp có', { exact: true })).toBeVisible();
  await expect(tabBar(page).getByRole('link', { name: 'Quét vé' })).toHaveAttribute('aria-current', 'page');
});

const OWNER_ONLY_PAGES: [string, string][] = [
  ['Thành viên', 'thanh-vien'],
  ['Tài khoản nhận tiền', 'tai-khoan-nhan-tien'],
];
for (const [name, segment] of OWNER_ONLY_PAGES) {
  test(`Admin mở thẳng URL chỉ Owner (${segment}): empty-state + "Về danh sách Sự kiện"`, async ({ page }) => {
    await openDashboard(page, { role: 'admin', path: `${base}/${segment}` });
    await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
    await expect(page.getByText('Sắp có', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.getByRole('link', { name: 'Về danh sách Sự kiện' }).click();
    await page.waitForURL(`**${base}`);
    await expect(page.getByText('Chưa có Sự kiện nào.')).toBeVisible();
  });
}

test('Owner mở URL chỉ Owner: trang tạm "Sắp có", không bị chặn', async ({ page }) => {
  await openDashboard(page, { path: `${base}/thanh-vien` });
  await expect(page.getByText('Sắp có', { exact: true })).toBeVisible();
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toHaveCount(0);
});

test('lỗi tải BTC (5xx): banner "Chưa tải được BTC", không có điều hướng; "Thử lại" thành công thì có khung', async ({
  page,
}) => {
  let orgOk = false;
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (orgOk ? organization() : apiError(500, 'INTERNAL_ERROR')),
  });
  await page.goto(base);
  // Hết 2 lần thử lại (1s + 2s) mới báo lỗi.
  await expect(page.getByText('Chưa tải được BTC')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('navigation', { name: 'Điều hướng BTC' })).toHaveCount(0);

  orgOk = true;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('navigation', { name: 'Điều hướng BTC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  await expect(page.getByText('Chưa tải được BTC')).toHaveCount(0);
});

test('tải lại BTC ở nền bị 5xx khi đã có dữ liệu: giữ khung và trang', async ({ page }) => {
  let orgOk = true;
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (orgOk ? organization() : apiError(500, 'INTERNAL_ERROR')),
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  const orgCalls = () => calls.filter((c) => c.path === `/orgs/${ORG_ID}`).length;
  expect(orgCalls()).toBe(1);

  // Dữ liệu quá `staleTime` (30s) rồi quay lại tab → TanStack Query tải lại, lần này lỗi (cả 2 lần thử lại).
  orgOk = false;
  await page.clock.setFixedTime(Date.now() + 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(orgCalls, { timeout: 10_000 }).toBe(4);
  await page.waitForTimeout(300);

  await expect(page.getByRole('navigation', { name: 'Điều hướng BTC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  await expect(page.getByText('Chưa tải được BTC')).toHaveCount(0);
});

test('tải lại BTC ở nền bị 401 → đăng nhập; đăng nhập OTP xong quay lại trang BTC, không bị đẩy về lần nữa', async ({
  page,
}) => {
  let signedIn = true;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me(CONSENTED) : unauthenticated()),
    'POST /identity/otp': () => ({ status: 200, body: { resendAfterSeconds: 60 } }),
    'POST /identity/otp/verify': () => {
      signedIn = true;
      return { status: 200, body: { consentRequired: false } };
    },
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (signedIn ? organization() : unauthenticated()),
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();

  // Session hết hạn; quá `staleTime` rồi quay lại tab → tải lại nền nhận 401.
  signedIn = false;
  await page.clock.setFixedTime(Date.now() + 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input').first().fill('123456');
  await page.waitForURL(`**${base}`);
  await expect(page.getByRole('navigation', { name: 'Điều hướng BTC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(base);
});

test('không phải thành viên (NOT_A_MEMBER): empty-state hiện có, không có điều hướng', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  await mockOrganizerApi(page, { [`GET /orgs/${OTHER_ORG_ID}`]: () => apiError(403, 'NOT_A_MEMBER') });
  for (const size of [DESKTOP, { width: 375, height: 667 }]) {
    await page.setViewportSize(size);
    await page.goto(`/btc/${OTHER_ORG_ID}/token`);
    await expect(page.getByText('Bạn không có quyền xem BTC này.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Điều hướng BTC' })).toHaveCount(0);
    await expect(sidebar(page)).toHaveCount(0);
    await expect(tabBar(page)).toHaveCount(0);
    await expect(page.getByText('Sắp có', { exact: true })).toHaveCount(0);
  }
});

test('401 ở trang con → đăng nhập kèm returnTo là trang đang mở (giữ query và hash)', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': unauthenticated });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: unauthenticated });
  await page.goto(`${base}/cai-dat?muc=lien-he#sdt`);
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(`${base}/cai-dat?muc=lien-he#sdt`)}`);
});

test('320px không cuộn ngang: trang Sự kiện, Sheet "Thêm" + switcher, trang tạm và trang chặn Admin', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDashboard(page, {
    role: 'admin',
    orgOverrides: { name: 'Một tên BTC rất dài để thử xuống dòng trên màn hình hẹp của điện thoại' },
  });
  await expect(page.getByText('Chưa có Sự kiện nào.')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await tabBar(page).getByRole('button', { name: 'Thêm' }).click();
  await switcher(moreSheet(page)).click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  const menu = (await page.getByRole('menu').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  for (const path of [`${base}/token`, `${base}/thanh-vien`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  }
});
