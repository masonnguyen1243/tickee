import { expect, test, type Page } from '@playwright/test';

import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, WEB_ORIGIN, type Call, type Reply } from './identity-mock';

/* Màn đăng nhập OTP và đồng ý NĐ 13 với API giả bằng `page.route` (xem `identity-mock.ts`). */

const otpSent = (): Reply => ({ status: 200, body: { resendAfterSeconds: 60 } });

const otpBoxes = (page: Page) => page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input');

async function requestCode(page: Page, returnTo = '/su-kien/a?x=1'): Promise<void> {
  await page.goto(`/dang-nhap?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByText(`Mã đã gửi tới ${EMAIL}`)).toBeVisible();
}

/** Dán như người dùng bấm Dán: sự kiện `paste` có clipboardData vào ô đầu. */
async function pasteCode(page: Page, code: string): Promise<void> {
  await otpBoxes(page).first().evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, code);
}

const verifyCalls = (calls: Call[]) => calls.filter((c) => c.path === '/identity/otp/verify');

test('ô mã: one-time-code, numeric; dán mã điền đủ 6 ô và tự gửi; xong về đúng returnTo', async ({ page }) => {
  const calls = await mockIdentityApi(page, {
    'POST /identity/otp': otpSent,
    'POST /identity/otp/verify': () => ({ status: 200, body: { consentRequired: false } }),
  });
  await requestCode(page);
  expect(calls.find((c) => c.path === '/identity/otp')?.body).toEqual({ email: EMAIL });

  const boxes = otpBoxes(page);
  await expect(boxes).toHaveCount(6);
  await expect(boxes.first()).toHaveAttribute('autocomplete', 'one-time-code');
  for (const box of await boxes.all()) await expect(box).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByText(/Gửi lại mã sau \d+ giây/)).toBeVisible();

  await pasteCode(page, '12 34 56');
  await expect(boxes.nth(5)).toHaveValue('6');
  await page.waitForURL('**/su-kien/a?x=1');
  expect(verifyCalls(calls).map((c) => c.body)).toEqual([{ email: EMAIL, otp: '123456' }]);
});

test('trình duyệt tự điền mã vào ô đầu → điền đủ 6 ô và tự gửi', async ({ page }) => {
  const calls = await mockIdentityApi(page, {
    'POST /identity/otp': otpSent,
    'POST /identity/otp/verify': () => ({ status: 200, body: { consentRequired: false } }),
  });
  await requestCode(page, '/');
  await otpBoxes(page).first().fill('654321');
  await expect.poll(() => verifyCalls(calls).map((c) => c.body)).toEqual([{ email: EMAIL, otp: '654321' }]);
  await page.waitForURL(`${WEB_ORIGIN}/`);
});

test('Backspace ở ô trống lùi về ô trước và xóa số ở đó', async ({ page }) => {
  const calls = await mockIdentityApi(page, { 'POST /identity/otp': otpSent });
  await requestCode(page);
  const boxes = otpBoxes(page);
  await boxes.first().click();
  await page.keyboard.type('123');
  await expect(boxes.nth(3)).toBeFocused();

  await page.keyboard.press('Backspace');
  await expect(boxes.nth(2)).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(boxes.nth(1)).toBeFocused();

  const values = await boxes.evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));
  expect(values).toEqual(['1', '', '', '', '', '']);
  expect(verifyCalls(calls)).toHaveLength(0);
});

test('gõ đè lên ô đã có số: chỉ giữ số mới, các ô khác không đổi', async ({ page }) => {
  await mockIdentityApi(page, { 'POST /identity/otp': otpSent });
  await requestCode(page);
  const boxes = otpBoxes(page);
  await boxes.first().click();
  await page.keyboard.type('123');
  await boxes.first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('9');
  const values = await boxes.evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));
  expect(values).toEqual(['9', '2', '3', '', '', '']);
});

test('mã sai: "Mã chưa đúng, còn N lần", lỗi gắn vào ô bằng aria-describedby', async ({ page }) => {
  await mockIdentityApi(page, {
    'POST /identity/otp': otpSent,
    'POST /identity/otp/verify': () => apiError(400, 'OTP_INVALID', { remainingAttempts: 4 }),
  });
  await requestCode(page);
  const boxes = otpBoxes(page);
  for (const [i, d] of [...'111111'].entries()) await boxes.nth(i).fill(d);

  const error = page.getByText('Mã chưa đúng, còn 4 lần');
  await expect(error).toBeVisible();
  const describedBy = await boxes.first().getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText('Mã chưa đúng, còn 4 lần');
  await expect(boxes.first()).toHaveAttribute('aria-invalid', 'true');
  // Ô được xóa trắng để nhập lại, focus về ô đầu.
  await expect(boxes.first()).toHaveValue('');
  await expect(boxes.first()).toBeFocused();
});

test('gửi mã quá giới hạn: "Thử lại sau {n} phút." (làm tròn lên)', async ({ page }) => {
  await mockIdentityApi(page, {
    'POST /identity/otp': () => apiError(429, 'OTP_RATE_LIMITED', { retryAfterSeconds: 125 }),
  });
  await page.goto('/dang-nhap');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByText('Bạn đã yêu cầu quá nhiều mã. Thử lại sau 3 phút.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
});

test('mã hết hạn: "Mã đã hết hạn" + "Gửi mã mới" gửi lại mã', async ({ page }) => {
  const calls = await mockIdentityApi(page, {
    'POST /identity/otp': otpSent,
    'POST /identity/otp/verify': () => apiError(400, 'OTP_EXPIRED'),
  });
  await requestCode(page);
  await pasteCode(page, '123456');
  await expect(page.getByText('Mã đã hết hạn')).toBeVisible();

  await page.getByRole('button', { name: 'Gửi mã mới' }).click();
  await expect.poll(() => calls.filter((c) => c.path === '/identity/otp').length).toBe(2);
  await expect(page.getByText('Mã đã hết hạn')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Xác nhận' })).toBeVisible();
});

test('gửi lại ở bước mã bị giới hạn: "Bạn đã yêu cầu quá nhiều mã. Thử lại sau n phút."', async ({ page }) => {
  let sends = 0;
  await mockIdentityApi(page, {
    'POST /identity/otp': () => (++sends === 1 ? otpSent() : apiError(429, 'OTP_RATE_LIMITED', { retryAfterSeconds: 90 })),
    'POST /identity/otp/verify': () => apiError(400, 'OTP_EXPIRED'),
  });
  await requestCode(page);
  await pasteCode(page, '123456');
  await page.getByRole('button', { name: 'Gửi mã mới' }).click();
  await expect(page.getByText('Bạn đã yêu cầu quá nhiều mã. Thử lại sau 2 phút.')).toBeVisible();
  expect(sends).toBe(2);
});

test('nhập sai quá nhiều lần trong ngày (OTP_LOCKED): thông báo theo giờ, không có "Gửi mã mới"', async ({ page }) => {
  let sends = 0;
  await mockIdentityApi(page, {
    'POST /identity/otp': () => (++sends === 1 ? otpSent() : apiError(429, 'OTP_LOCKED', { retryAfterSeconds: 120 })),
    'POST /identity/otp/verify': () => apiError(429, 'OTP_LOCKED', { retryAfterSeconds: 5000 }),
  });
  await requestCode(page);
  await pasteCode(page, '123456');
  await expect(page.getByText('Bạn đã nhập sai quá nhiều lần. Thử lại sau 2 giờ.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi mã mới' })).toHaveCount(0);

  // Bước email: gửi mã cũng bị khóa.
  await page.getByRole('button', { name: 'Đổi email' }).click();
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByText('Bạn đã nhập sai quá nhiều lần. Thử lại sau 1 giờ.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi mã mới' })).toHaveCount(0);
});

test('hết lượt nhập: "Mã đã hết hiệu lực" + "Gửi mã mới"; "Đổi email" về bước email', async ({ page }) => {
  await mockIdentityApi(page, {
    'POST /identity/otp': otpSent,
    'POST /identity/otp/verify': () => apiError(400, 'OTP_ATTEMPTS_EXCEEDED'),
  });
  await requestCode(page);
  await pasteCode(page, '123456');
  await expect(page.getByText('Mã đã hết hiệu lực')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi mã mới' })).toBeVisible();

  await page.getByRole('button', { name: 'Đổi email' }).click();
  await expect(page.getByLabel('Email')).toHaveValue(EMAIL);
});

test('tài khoản mới: sang màn đồng ý, "Đồng ý" ghi nhận rồi về returnTo', async ({ page }) => {
  let consentedAt: string | null = null;
  const calls = await mockIdentityApi(page, {
    'POST /identity/otp': otpSent,
    'POST /identity/otp/verify': () => ({ status: 200, body: { consentRequired: true } }),
    'GET /identity/me': () => me(consentedAt),
    'POST /identity/consent': () => {
      consentedAt = '2026-10-29T01:02:03.000Z';
      return me(consentedAt);
    },
  });
  await requestCode(page);
  await pasteCode(page, '123456');

  await page.waitForURL('**/dong-y?returnTo=*');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/su-kien/a?x=1');
  await expect(page.getByRole('heading', { name: 'Đồng ý xử lý dữ liệu cá nhân' })).toBeVisible();
  await expect(page.getByRole('link', { name: /chính sách xử lý dữ liệu/i })).toHaveAttribute('href', '/chinh-sach-du-lieu');

  await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await page.waitForURL('**/su-kien/a?x=1');
  expect(calls.filter((c) => c.path === '/identity/consent')).toHaveLength(1);
});

test('"Không đồng ý": đăng xuất, về trang trước kèm thông báo rồi xóa tham số', async ({ page }) => {
  let signedIn = true;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me(null) : unauthenticated()),
    'POST /identity/sign-out': () => {
      signedIn = false;
      return { status: 204 };
    },
  });
  await page.goto(`/dong-y?returnTo=${encodeURIComponent('/?tu=dong-y')}`);
  await page.getByRole('button', { name: 'Không đồng ý' }).click();

  await expect(page.getByText('Bạn cần đồng ý để dùng Tickee.')).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('?tu=dong-y');
  expect(calls.filter((c) => c.path === '/identity/sign-out')).toHaveLength(1);
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
});

test('"Không đồng ý" khi session đã hết (sign-out 401) vẫn về returnTo kèm thông báo', async ({ page }) => {
  let signedIn = true;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me(null) : unauthenticated()),
    'POST /identity/sign-out': () => {
      signedIn = false;
      return unauthenticated();
    },
  });
  await page.goto(`/dong-y?returnTo=${encodeURIComponent('/chinh-sach-du-lieu')}`);
  await page.getByRole('button', { name: 'Không đồng ý' }).click();
  await expect(page.getByText('Bạn cần đồng ý để dùng Tickee.')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/chinh-sach-du-lieu');
});

test('màn đồng ý: ẩn danh → sang đăng nhập kèm returnTo; đã đồng ý → đi thẳng returnTo', async ({ page }) => {
  let state: 'anonymous' | 'consented' = 'anonymous';
  await mockIdentityApi(page, {
    'GET /identity/me': () => (state === 'anonymous' ? unauthenticated() : me('2026-10-29T01:02:03.000Z')),
  });
  await page.goto('/dong-y?returnTo=/x');
  await page.waitForURL('**/dang-nhap?returnTo=%2Fx');

  state = 'consented';
  await page.goto('/dong-y?returnTo=/x');
  await page.waitForURL(`${WEB_ORIGIN}/x`);
});

test('CONSENT_REQUIRED từ một query → chuyển sang màn đồng ý kèm returnTo', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => apiError(403, 'CONSENT_REQUIRED') });
  await page.goto('/?xem=1');
  await page.waitForURL('**/dong-y?returnTo=*');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/?xem=1');
});

test('menu tài khoản: chưa đăng nhập có "Đăng nhập"; đã đăng nhập có email và "Đăng xuất"', async ({ page }) => {
  let signedIn = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me('2026-10-29T01:02:03.000Z') : unauthenticated()),
    'POST /identity/sign-out': () => {
      signedIn = false;
      return { status: 204 };
    },
  });
  await page.goto('/chinh-sach-du-lieu');
  const login = page.getByRole('link', { name: 'Đăng nhập' });
  await expect(login).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/chinh-sach-du-lieu')}`);

  signedIn = true;
  await page.reload();
  await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await page.waitForURL(`${WEB_ORIGIN}/`);
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
});

test('menu tài khoản: "Đăng xuất" khi session đã hết (sign-out 401) vẫn về trang chủ', async ({ page }) => {
  let signedIn = true;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me('2026-10-29T01:02:03.000Z') : unauthenticated()),
    'POST /identity/sign-out': () => {
      signedIn = false;
      return unauthenticated();
    },
  });
  await page.goto('/chinh-sach-du-lieu');
  await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await page.waitForURL(`${WEB_ORIGIN}/`);
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
});

test('320px không cuộn ngang: đăng nhập (cả bước mã) và đồng ý', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await mockIdentityApi(page, { 'POST /identity/otp': otpSent, 'GET /identity/me': () => me(null) });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto('/dang-nhap');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(otpBoxes(page)).toHaveCount(6);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.goto('/dong-y');
  await expect(page.getByRole('button', { name: 'Không đồng ý' })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
