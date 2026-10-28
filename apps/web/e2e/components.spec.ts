import { expect, test } from '@playwright/test';

import { PORT_UI_KIT_OFF } from '../playwright.config';

test('nút loading: spinner, aria-busy, giữ độ rộng, bỏ qua bấm lặp', async ({ page }) => {
  await page.goto('/ui-kit');
  const button = page.getByTestId('kit-loading-button');
  const clicks = page.getByTestId('kit-loading-clicks');

  const before = await button.boundingBox();
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeEnabled();
  // Nhãn vẫn trong cây a11y khi loading.
  await expect(button).toHaveAccessibleName(/Thanh toán.*Đang xử lý/);
  await expect(button.locator('[data-slot="button-spinner"] svg')).toBeVisible();
  await expect(clicks).toHaveText('1');

  const during = await button.boundingBox();
  expect(before).not.toBeNull();
  expect(during).not.toBeNull();
  expect(during!.width).toBe(before!.width);

  await button.click();
  await button.click();
  await expect(clicks).toHaveText('1');
});

test('badge và banner luôn có chữ; icon banner khác hình theo tone', async ({ page }) => {
  await page.goto('/ui-kit');

  const badges = page.locator('[data-slot="status-badge"]');
  await expect(badges).toHaveCount(4);
  for (const text of await badges.allInnerTexts()) expect(text.trim()).not.toBe('');

  const banners = page.locator('[data-slot="status-banner"]');
  await expect(banners).toHaveCount(4);
  for (const text of await banners.allInnerTexts()) expect(text.trim()).not.toBe('');

  const iconClasses = await page
    .locator('[data-slot="status-banner-icon"]')
    .evaluateAll((icons) =>
      icons.map((icon) => [...icon.classList].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon') ?? ''),
    );
  expect(iconClasses).toHaveLength(4);
  expect(iconClasses.every(Boolean)).toBe(true);
  expect(new Set(iconClasses).size).toBe(4);

  // Không nút hành động nào quá một mỗi banner.
  for (const banner of await banners.all()) {
    expect(await banner.locator('[data-slot="button"]').count()).toBeLessThanOrEqual(1);
  }
});

test.describe('prefers-reduced-motion', () => {
  test('tắt animation khi reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/ui-kit');
    await page.getByTestId('kit-loading-button').click();
    const spinner = page.locator('[data-slot="button-spinner"] svg');
    await expect(spinner).toHaveCSS('animation-name', 'none');
  });

  test('giữ animation khi không reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/ui-kit');
    await page.getByTestId('kit-loading-button').click();
    const spinner = page.locator('[data-slot="button-spinner"] svg');
    await expect(spinner).toHaveCSS('animation-name', 'spin');
  });
});

test('/ui-kit trả 404 khi TICKEE_UI_KIT khác 1', async ({ page }) => {
  const res = await page.goto(`http://localhost:${PORT_UI_KIT_OFF}/ui-kit`);
  expect(res?.status()).toBe(404);
  await expect(page.getByText('Không tìm thấy trang')).toBeVisible();
});
