import { request } from '@playwright/test';

import { expect, test } from '../e2e/fixtures';
import { API_ORIGIN, WEB_ORIGIN } from './env';
import { buyerEmail, returnToOf, signInWithOtp } from './sign-in';

/*
 * AI-6 (retro Epic 1): đăng nhập OTP với api thật. Cookie phiên do api (cổng 3001) đặt, web (cổng 3000) gọi `/me` kèm
 * cookie cross-origin; mã đọc từ Mailpit. Không `page.route` nào.
 */

const TICKETS = '/tickets';

test('Vé của tôi → OTP → "Đồng ý" → về returnTo; tải lại vẫn đăng nhập; đăng xuất, tải lại vẫn đăng xuất', async ({
  page,
}, testInfo) => {
  const email = buyerEmail(testInfo, 'login');
  const heading = page.getByRole('heading', { level: 1, name: 'Vé của tôi' });
  const account = page.getByRole('button', { name: `Tài khoản: ${email}` });
  const login = page.getByRole('link', { name: 'Đăng nhập' });

  await page.goto(TICKETS);
  await page.waitForURL('**/dang-nhap?returnTo=*');
  expect(returnToOf(page)).toBe(TICKETS);

  await signInWithOtp(page, email);
  await page.waitForURL('**/dong-y?returnTo=*');
  expect(returnToOf(page)).toBe(TICKETS);
  await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await page.waitForURL(`${WEB_ORIGIN}${TICKETS}`);
  await expect(heading).toBeVisible();
  await expect(account).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(`${WEB_ORIGIN}${TICKETS}`);
  await expect(heading).toBeVisible();
  await expect(account).toBeVisible();

  // Cookie phiên của api, chụp trước khi đăng xuất (đăng xuất xóa nó khỏi trình duyệt), để hỏi lại api sau đó.
  const sessionCookies = await page.context().cookies(API_ORIGIN);
  expect(sessionCookies.length).toBeGreaterThan(0);
  const meWithCapturedCookie = async (): Promise<number> => {
    const client = await request.newContext({
      extraHTTPHeaders: { cookie: sessionCookies.map((c) => `${c.name}=${c.value}`).join('; ') },
    });
    try {
      return (await client.get(`${API_ORIGIN}/v1/identity/me`)).status();
    } finally {
      await client.dispose();
    }
  };
  expect(await meWithCapturedCookie()).toBe(200);

  await account.click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await page.waitForURL(`${WEB_ORIGIN}/`);
  await expect(login).toBeVisible();

  await page.reload();
  await expect(login).toBeVisible();
  await expect(account).toHaveCount(0);
  // Api đã hủy phiên ở server: chính cookie trước lúc đăng xuất giờ nhận 401.
  expect(await meWithCapturedCookie()).toBe(401);
});
