import type { Locator, Page } from '@playwright/test';

import { expect, test, waitForHydration } from './fixtures';
import { me, mockIdentityApi, USER_ID } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Nút chuyển giao diện sáng/tối ở header (spec-theme-toggle, quyết định 02/11/2026). Hệ thống giả lập bằng
 * `page.emulateMedia({ colorScheme })`. Chưa chọn gì thì theo hệ thống; bấm nút thì lưu `localStorage['tickee:theme']`
 * và từ đó không theo hệ thống nữa. Theme đang dùng là `data-theme` trên <html>.
 */

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tickee:theme';
const BACKGROUND: Record<Theme, string> = { light: '#F7F3F2', dark: '#0B0809' };
const LABEL: Record<Theme, string> = {
  // Nhãn nói hành động: đang sáng thì "chuyển sang tối" và ngược lại.
  light: 'Chuyển sang giao diện tối',
  dark: 'Chuyển sang giao diện sáng',
};

const toggle = (page: Page) => page.getByRole('button', { name: /^Chuyển sang giao diện (sáng|tối)$/ });

// Bản build có thể viết thường mã hex; so sánh không phân biệt hoa thường.
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(), name);

const stored = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);

/**
 * Theme đang dùng: `data-theme`, `color-scheme`, biến `--background`, `<meta name="theme-color">`, tên truy cập và icon
 * của nút.
 */
async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  expect(await cssVar(page, '--background')).toBe(BACKGROUND[theme]);
  const meta = page.locator('meta[name="theme-color"]');
  await expect(meta).toHaveCount(1);
  expect((await meta.getAttribute('content'))?.toUpperCase()).toBe(BACKGROUND[theme]);
  await expect(toggle(page)).toHaveAccessibleName(LABEL[theme]);
  // Icon chỉ đích đến: đang sáng hiện mặt trăng, đang tối hiện mặt trời.
  await expect(toggle(page).locator('svg.lucide-moon')).toBeVisible({ visible: theme === 'light' });
  await expect(toggle(page).locator('svg.lucide-sun')).toBeVisible({ visible: theme === 'dark' });
}

/**
 * Đổi theme hệ thống và chờ sự kiện `change` của `matchMedia` tới trang. Listener của app (đăng ký lúc hydrate) chạy
 * trong cùng task đó, nên kiểm tra sau hàm này không thể chạy trước listener, kể cả khi kỳ vọng là "giữ nguyên".
 */
async function changeSystemTheme(page: Page, colorScheme: Theme): Promise<void> {
  await page.evaluate(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const changed = new Promise<void>((resolve) => query.addEventListener('change', () => resolve(), { once: true }));
    Object.assign(window, { __systemQuery: query, __systemChanged: changed });
  });
  await page.emulateMedia({ colorScheme });
  await page.evaluate(() => (window as unknown as { __systemChanged: Promise<void> }).__systemChanged);
}

/** Lỗi JS và lỗi console (bỏ qua lỗi tải tài nguyên, vd. 401 của `GET /identity/me` khi chưa đăng nhập). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await mockIdentityApi(page);
});

test('lần đầu, hệ thống tối: trang tối, nút nói "Chuyển sang giao diện sáng"', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expectTheme(page, 'dark');
  expect(await stored(page)).toBeNull();
});

test('bấm nút khi đang sáng: tối ngay tại chỗ, lưu lựa chọn, từ đó không theo hệ thống', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expectTheme(page, 'light');
  // Đánh dấu trang: còn sau khi bấm nghĩa là không tải lại.
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }));

  await toggle(page).click();
  await expectTheme(page, 'dark');
  expect(await stored(page)).toBe('dark');
  expect(await page.evaluate(() => '__sameDocument' in window)).toBe(true);

  await toggle(page).click();
  await expectTheme(page, 'light');
  expect(await stored(page)).toBe('light');

  // Đã chọn "sáng": hệ thống đổi sang tối cũng giữ nguyên.
  await changeSystemTheme(page, 'dark');
  await expectTheme(page, 'light');
});

test('tải lại khi đã lưu "tối", hệ thống sáng: tối ngay từ HTML đầu, không chớp sáng', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  // Ghi lại mọi lần `data-theme` trên <html> đổi, kèm việc <body> đã có chưa và React đã hydrate chưa.
  await page.addInitScript(() => {
    const log: { value: string | null; oldValue: string | null; body: boolean; hydrated: boolean }[] = [];
    Object.assign(window, { __themeLog: log });
    new MutationObserver((records) => {
      for (const record of records) {
        const html = record.target as HTMLElement;
        log.push({
          value: html.getAttribute('data-theme'),
          oldValue: record.oldValue,
          body: document.body !== null,
          hydrated: html.hasAttribute('data-hydrated'),
        });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'], attributeOldValue: true });
  });
  await page.goto('/');
  await toggle(page).click();
  await expectTheme(page, 'dark');

  await page.reload();
  await expectTheme(page, 'dark');
  const log = await page.evaluate(
    () => (window as unknown as { __themeLog: { value: string | null; oldValue: string | null }[] }).__themeLog,
  );
  // Lần đặt đầu tiên: từ chưa có thành "dark", trước khi có <body> và trước khi React hydrate.
  expect(log[0]).toEqual({ value: 'dark', oldValue: null, body: false, hydrated: false });
  // Mọi lần đổi sau đó vẫn là "dark" (không lúc nào "light" hay bị xóa).
  expect(log.filter((entry) => entry.value !== 'dark')).toEqual([]);
});

test('chưa chọn gì: hệ thống đổi sáng → tối → sáng thì trang đổi theo, không tải lại', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expectTheme(page, 'light');

  await changeSystemTheme(page, 'dark');
  await expectTheme(page, 'dark');

  await changeSystemTheme(page, 'light');
  await expectTheme(page, 'light');
  expect(await stored(page)).toBeNull();
});

test('localStorage ném lỗi: theo hệ thống, nút vẫn đổi được trong phiên, không lỗi console', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage bị chặn', 'SecurityError');
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expectTheme(page, 'dark');

  await toggle(page).click();
  await expectTheme(page, 'light');
  await toggle(page).click();
  await expectTheme(page, 'dark');
  // Lựa chọn "tối" giữ trong phiên: hệ thống đổi sang sáng cũng không kéo về.
  await changeSystemTheme(page, 'light');
  await expectTheme(page, 'dark');
  expect(errors).toEqual([]);
});

test('giá trị lưu lạ: theo hệ thống, bấm nút ghi lại lựa chọn hợp lệ, không lỗi console', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript((key) => window.localStorage.setItem(key, 'tim'), STORAGE_KEY);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expectTheme(page, 'dark');

  await toggle(page).click();
  await expectTheme(page, 'light');
  expect(await stored(page)).toBe('light');
  expect(errors).toEqual([]);
});

test('toast theo theme đang dùng, không theo hệ thống', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/ui-kit');
  await toggle(page).click();
  await expectTheme(page, 'light');

  await page.getByRole('button', { name: 'Hiện thông báo' }).click();
  await expect(page.getByText('Đã lưu thay đổi')).toBeVisible();
  await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'light');

  await toggle(page).click();
  await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark');
});

test('tab khác đổi lựa chọn thì tab này đổi theo; xóa lựa chọn thì về theo hệ thống', async ({ page, context }) => {
  const other = await context.newPage();
  await mockIdentityApi(other);
  await page.emulateMedia({ colorScheme: 'light' });
  await other.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await other.goto('/');
  await waitForHydration(other);
  await expectTheme(other, 'light');

  await toggle(page).click();
  await expectTheme(page, 'dark');
  await expectTheme(other, 'dark');

  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await expectTheme(other, 'light');
});

test('trước khi hydrate: icon và tên truy cập của nút đã đúng theme', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  // Chặn bundle JS (giữ CSS, cũng nằm trong `chunks/`): React không bao giờ hydrate, chỉ còn script theme inline.
  await page.route('**/_next/static/chunks/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveAttribute('data-hydrated');
  await expect(toggle(page)).toHaveAccessibleName(LABEL.dark);
  await expect(toggle(page).locator('svg.lucide-sun')).toBeVisible();
  await expect(toggle(page).locator('svg.lucide-moon')).toBeHidden();
  await context.close();
});

test('không có JS: giao diện sáng kể cả khi hệ thống tối, ẩn nút', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(247, 243, 242)');
  // Bấm không có tác dụng khi không có JS: nút có trong HTML nhưng ẩn.
  const button = page.getByRole('button', { name: /Chuyển sang giao diện/, includeHidden: true });
  await expect(button).toHaveCount(1);
  await expect(button).toBeHidden();
  await context.close();
});

test('320px, đã đăng nhập với email dài: header không cuộn ngang, nút vẫn 40×40', async ({ page }) => {
  const email = 'nguyen.thi.thanh.huong.ban.to.chuc@vidu-rat-dai.vn';
  await page.setViewportSize({ width: 320, height: 640 });
  await mockIdentityApi(page, {
    'GET /identity/me': () => ({
      status: 200,
      body: { id: USER_ID, email, consentedAt: '2026-10-29T01:02:03.000Z', twoFactorEnabled: false },
    }),
  });
  await mockOrganizerApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: `Tài khoản: ${email}` })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await toggle(page).boundingBox())!;
  expect({ width: box.width, height: box.height }).toEqual({ width: 40, height: 40 });
  expect(box.x + box.width).toBeLessThanOrEqual(320);
});

const wordmark = (page: Page) => page.getByRole('link', { name: 'Tickee — Trang chủ' });
const accountButton = (page: Page) => page.getByRole('button', { name: /^Tài khoản: / });

/** `before`: phần tử ngay trước nút trong thứ tự Tab (nút nằm cuối header, sau menu tài khoản). */
const PAGES_WITH_HEADER: { name: string; path: string; signedIn: boolean; before: (page: Page) => Locator }[] = [
  {
    name: 'trang chủ (khách)',
    path: '/',
    signedIn: false,
    before: (page) => page.getByRole('link', { name: 'Đăng nhập' }),
  },
  { name: 'đăng nhập', path: '/dang-nhap', signedIn: false, before: wordmark },
  { name: 'tạo BTC', path: '/tao-btc', signedIn: true, before: accountButton },
  { name: 'dashboard BTC', path: `/btc/${ORG_ID}`, signedIn: true, before: accountButton },
  { name: 'trang 404', path: '/khong-co-trang-nay', signedIn: false, before: wordmark },
];

for (const { name, path, signedIn, before } of PAGES_WITH_HEADER) {
  test(`bàn phím (${name}): Tab tới nút, Enter đổi theme và nhãn`, async ({ page, browserName }) => {
    // Safari/WebKit chỉ Tab qua link và nút khi giữ Option (như người dùng Safari bật sẵn).
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    if (signedIn) {
      await mockIdentityApi(page, { 'GET /identity/me': () => me('2026-10-29T01:02:03.000Z') });
      await mockOrganizerApi(page, {
        [`GET /orgs/${ORG_ID}`]: () => organization(),
        'GET /me/memberships': () => ({
          status: 200,
          body: [{ organizationId: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' }],
        }),
      });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(path);
    await expectTheme(page, 'light');

    await expect(before(page)).toBeVisible();
    await before(page).focus();
    await page.keyboard.press(tab);
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toBeFocused();

    await page.keyboard.press('Enter');
    await expectTheme(page, 'light');
  });
}
