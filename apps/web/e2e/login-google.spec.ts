import { expect, test, type Page } from '@playwright/test';

import { apiError, me, mockIdentityApi, WEB_ORIGIN } from './identity-mock';

/*
 * Đăng nhập Google phía web (Story 1.4) với API giả: nút trên màn đăng nhập, banner theo `?error=` và trang trung
 * gian `/dang-nhap/google`. Google thật không được gọi: điều hướng tới `GET /v1/identity/google` bị chặn bằng route.
 */

const RETURN_TO = '/su-kien/a?x=1';
const ENCODED_RETURN_TO = encodeURIComponent(RETURN_TO);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `href` đúng của nút Google: gốc api (NEXT_PUBLIC_API_BASE_URL, bỏ `/` cuối) + `/v1/identity/google?returnTo=…`.
 * Tiến trình test không có biến này (chỉ bản build có) thì kiểm bằng regex neo hai đầu với host bất kỳ.
 */
function expectedGoogleHref(): string | RegExp {
  const path = `/v1/identity/google?returnTo=${ENCODED_RETURN_TO}`;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  return base ? `${base.replace(/\/+$/, '')}${path}` : new RegExp(`^https?://[^/]+${escapeRegExp(path)}$`);
}

const googleButton = (page: Page) => page.getByRole('link', { name: 'Tiếp tục với Google' });
const banner = (page: Page) => page.locator('[data-slot="status-banner"]');

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('bố cục: nút Google rộng toàn chiều ở trên, "hoặc", rồi ô email; href mang returnTo', async ({ page }) => {
  await mockIdentityApi(page);
  await page.goto(`/dang-nhap?returnTo=${ENCODED_RETURN_TO}`);

  const button = googleButton(page);
  await expect(button).toBeVisible();
  await expect(button.locator('[data-slot="google-logo"]')).toBeVisible();
  await expect(button).toHaveAttribute('href', expectedGoogleHref());

  const or = page.getByText('hoặc', { exact: true });
  const email = page.getByLabel('Email');
  const [b, o, e] = await Promise.all([button.boundingBox(), or.boundingBox(), email.boundingBox()]);
  expect(b && o && e).toBeTruthy();
  expect(b!.y + b!.height).toBeLessThanOrEqual(o!.y);
  expect(o!.y + o!.height).toBeLessThanOrEqual(e!.y);
  // Rộng bằng ô email (toàn chiều rộng cột), vùng chạm đủ lớn.
  expect(Math.abs(b!.width - e!.width)).toBeLessThanOrEqual(1);
  expect(b!.height).toBeGreaterThanOrEqual(44);
  await expect(banner(page)).toHaveCount(0);
});

test('bấm nút: spinner trong nút, bấm lặp bị chặn (không điều hướng lần hai)', async ({ page }) => {
  await mockIdentityApi(page);
  await page.goto(`/dang-nhap?returnTo=${ENCODED_RETURN_TO}`);
  // Chờ hydrate xong (onClick đã gắn); bấm trước đó chỉ là điều hướng thường, không có spinner.
  await expect
    .poll(() => googleButton(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
  // Listener ở `window` chạy sau handler của React: ghi lại React có chặn điều hướng không, rồi tự chặn để trang
  // ở lại (Playwright không đọc được DOM khi điều hướng cả trang còn treo). `href` đã kiểm ở test bố cục.
  await page.evaluate(() => {
    const seen: boolean[] = [];
    Object.assign(window, { googleClicks: seen });
    window.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-slot="google-signin-button"]')) return;
      seen.push(event.defaultPrevented);
      event.preventDefault();
    });
  });
  const clicks = () => page.evaluate(() => (window as unknown as { googleClicks: boolean[] }).googleClicks);

  const button = googleButton(page);
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button.locator('[data-slot="button-spinner"]')).toBeVisible();
  await expect(button).toHaveAccessibleName(/Đang xử lý/);
  await button.click({ force: true });
  // Lần đầu React để trình duyệt điều hướng; lần hai React tự chặn.
  expect(await clicks()).toEqual([false, true]);

  // Quay lại bằng Back (bfcache khôi phục trang): bỏ spinner, bấm lại được.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(button.locator('[data-slot="button-spinner"]')).toHaveCount(0);
  await button.click();
  expect(await clicks()).toEqual([false, true, false]);
});

test('hủy trên Google (error=access_denied): ở lại màn đăng nhập, không banner, giữ returnTo, xóa error', async ({ page }) => {
  await mockIdentityApi(page);
  await page.goto(`/dang-nhap?returnTo=${ENCODED_RETURN_TO}&error=access_denied&error_description=x`);
  await expect(page).toHaveURL(`${WEB_ORIGIN}/dang-nhap?returnTo=${ENCODED_RETURN_TO}`);
  await expect(googleButton(page)).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await expect(googleButton(page)).toHaveAttribute('href', expectedGoogleHref());
});

test('email_not_verified: banner cảnh báo, rồi xóa error khỏi URL mà banner vẫn còn', async ({ page }) => {
  await mockIdentityApi(page);
  await page.goto(`/dang-nhap?returnTo=${ENCODED_RETURN_TO}&error=email_not_verified`);
  await expect(banner(page)).toHaveText('Email Google chưa được xác minh. Hãy dùng mã qua email.');
  await expect(banner(page)).toHaveAttribute('data-tone', 'warning');
  await expect(page).toHaveURL(`${WEB_ORIGIN}/dang-nhap?returnTo=${ENCODED_RETURN_TO}`);
  await expect(banner(page)).toBeVisible();
  // Ô email vẫn dùng được ngay (cách đăng nhập thay thế).
  await expect(page.getByLabel('Email')).toBeEditable();
});

test('lỗi khác (state_mismatch): banner lỗi chung', async ({ page }) => {
  await mockIdentityApi(page);
  await page.goto('/dang-nhap?error=state_mismatch');
  await expect(banner(page)).toHaveText('Chưa đăng nhập được bằng Google. Thử lại hoặc dùng mã qua email.');
  await expect(banner(page)).toHaveAttribute('data-tone', 'danger');
  await expect(page).toHaveURL(`${WEB_ORIGIN}/dang-nhap`);
});

test('trang trung gian: chưa đồng ý → /dong-y kèm returnTo', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(null) });
  await page.goto(`/dang-nhap/google?returnTo=${ENCODED_RETURN_TO}`);
  await page.waitForURL(`${WEB_ORIGIN}/dong-y?returnTo=${ENCODED_RETURN_TO}`);
  await expect(page.getByRole('button', { name: 'Đồng ý', exact: true })).toBeVisible();
});

test('trang trung gian: đã đồng ý → về thẳng returnTo, Back không quay lại trang trung gian', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me('2026-10-29T01:02:03.000Z') });
  await page.goto('/');
  await page.goto(`/dang-nhap/google?returnTo=${ENCODED_RETURN_TO}`);
  await page.waitForURL(`${WEB_ORIGIN}${RETURN_TO}`);
  await page.goBack();
  await expect(page).toHaveURL(`${WEB_ORIGIN}/`);
});

test('trang trung gian: chưa có session (me 401) → màn đăng nhập giữ returnTo', async ({ page }) => {
  await mockIdentityApi(page);
  await page.goto(`/dang-nhap/google?returnTo=${ENCODED_RETURN_TO}`);
  await page.waitForURL(`${WEB_ORIGIN}/dang-nhap?returnTo=${ENCODED_RETURN_TO}`);
  await expect(googleButton(page)).toBeVisible();
});

test('trang trung gian: me lỗi khác 401 → banner lỗi và link về màn đăng nhập giữ returnTo', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => apiError(404, 'NOT_FOUND') });
  await page.goto(`/dang-nhap/google?returnTo=${ENCODED_RETURN_TO}`);
  await expect(banner(page)).toHaveText('Chưa đăng nhập được bằng Google. Thử lại hoặc dùng mã qua email.');
  await expect(banner(page)).toHaveAttribute('data-tone', 'danger');
  await expect(page.getByRole('link', { name: 'Về màn đăng nhập' })).toHaveAttribute(
    'href',
    `/dang-nhap?returnTo=${ENCODED_RETURN_TO}`,
  );
  await expect(page).toHaveURL(`${WEB_ORIGIN}/dang-nhap/google?returnTo=${ENCODED_RETURN_TO}`);
});

test('trang trung gian: returnTo độc hại → về trang chủ', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me('2026-10-29T01:02:03.000Z') });
  await page.goto(`/dang-nhap/google?returnTo=${encodeURIComponent('//evil.com')}`);
  await page.waitForURL(`${WEB_ORIGIN}/`);
});

test('trang trung gian có robots noindex và trạng thái đang đăng nhập', async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockIdentityApi(page, {
    'GET /identity/me': async () => {
      await held;
      return me(null);
    },
  });
  await page.goto('/dang-nhap/google');
  await expect(page.getByRole('status').filter({ hasText: 'Đang đăng nhập…' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  release();
  await page.waitForURL(`${WEB_ORIGIN}/dong-y`);
});

test('320px không cuộn ngang: màn đăng nhập có nút Google + banner, và trang trung gian', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await mockIdentityApi(page, {
    'GET /identity/me': async () => {
      await held;
      return me(null);
    },
  });

  await page.goto('/dang-nhap?error=email_not_verified');
  await expect(banner(page)).toBeVisible();
  await expect(googleButton(page)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.goto('/dang-nhap/google');
  await expect(page.getByText('Đang đăng nhập…')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  release();
});
