import { expect, test, type Page } from '@playwright/test';

// Bản build có thể viết thường mã hex; so sánh không phân biệt hoa thường.
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(), name);

test.describe('theme sáng (prefers-color-scheme: light)', () => {
  test.use({ colorScheme: 'light' });

  test('biến màu đúng DESIGN.md', async ({ page }) => {
    await page.goto('/ui-kit');
    expect(await cssVar(page, '--background')).toBe('#F7F3F2');
    expect(await cssVar(page, '--foreground')).toBe('#1C1917');
    expect(await cssVar(page, '--primary')).toBe('#FF4D6A');
    expect(await cssVar(page, '--ring')).toBe('#CF2147');
    expect(await cssVar(page, '--brand-text')).toBe('#CF2147');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 243, 242)');
    // button-primary-on-light: nền stage, chữ stage-foreground.
    await expect(page.getByTestId('kit-button-primary-on-light')).toHaveCSS('background-color', 'rgb(28, 20, 22)');
    await expect(page.getByTestId('kit-button-primary-on-light')).toHaveCSS('color', 'rgb(255, 247, 248)');
  });

  test('chữ trong ô nhập (components/ui/input) dùng --foreground', async ({ page }) => {
    await page.goto('/dang-nhap');
    await expect(page.getByLabel('Email')).toHaveCSS('color', 'rgb(28, 25, 23)');
  });
});

test.describe('theme tối (prefers-color-scheme: dark)', () => {
  test.use({ colorScheme: 'dark' });

  test('biến màu đúng DESIGN.md', async ({ page }) => {
    await page.goto('/ui-kit');
    expect(await cssVar(page, '--background')).toBe('#0B0809');
    expect(await cssVar(page, '--foreground')).toBe('#F5F2F2');
    expect(await cssVar(page, '--primary')).toBe('#FF4D6A');
    expect(await cssVar(page, '--ring')).toBe('#FF4D6A');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 8, 9)');
    // Dark mode: button-primary-on-light thành button-primary (coral, chữ mực).
    await expect(page.getByTestId('kit-button-primary-on-light')).toHaveCSS('background-color', 'rgb(255, 77, 106)');
    await expect(page.getByTestId('kit-button-primary-on-light')).toHaveCSS('color', 'rgb(31, 10, 16)');
  });

  // `text-input` từng sinh thêm `color: var(--input)` (trùng nền `bg-muted`) và đè `text-foreground`: chữ vô hình.
  test('chữ trong ô nhập (components/ui/input) dùng --foreground', async ({ page }) => {
    await page.goto('/dang-nhap');
    await expect(page.getByLabel('Email')).toHaveCSS('color', 'rgb(245, 242, 242)');
  });
});

test('lang="vi" và font Be Vietnam Pro', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(fontFamily).toMatch(/Be[ _]Vietnam[ _]Pro/);
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => /Be[ _]Vietnam[ _]Pro/.test(f.family) && f.status === 'loaded');
  });
  expect(loaded).toBe(true);
});

test('ô nhập 16px', async ({ page }) => {
  await page.goto('/ui-kit');
  await expect(page.getByLabel('Email')).toHaveCSS('font-size', '16px');
});

test('focus ring chỉ hiện khi focus bằng bàn phím', async ({ page }) => {
  await page.goto('/ui-kit');
  const button = page.getByTestId('kit-button-primary-on-light');

  // Bấm chuột: không có vòng focus (Safari vốn không focus nút khi bấm; Chromium focus nhưng không :focus-visible).
  await button.click();
  await expect(button).toHaveCSS('outline-style', 'none');

  // Bàn phím: vòng 2px màu --ring, cách 2px. WebKit trên macOS chỉ Tab qua nút khi giữ Option (Alt).
  const previous = page.getByTestId('kit-button-primary');
  await previous.focus();
  await page.keyboard.press('Tab');
  if (!(await button.evaluate((el) => el === document.activeElement))) {
    await previous.focus();
    await page.keyboard.press('Alt+Tab');
  }
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-style', 'solid');
  await expect(button).toHaveCSS('outline-width', '2px');
  await expect(button).toHaveCSS('outline-offset', '2px');
  await expect(button).toHaveCSS('outline-color', 'rgb(207, 33, 71)');
});

for (const path of ['/', '/ui-kit']) {
  test(`320px không cuộn ngang: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 667 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
