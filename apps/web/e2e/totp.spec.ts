import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { apiError, me, mockIdentityApi, type Call, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/* TOTP cho Owner (Story 2.2): màn đăng ký `/bao-mat/totp` và dialog step-up khi api trả TOTP_REQUIRED. */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const MANUAL_KEY = 'JBSWY3DPEHPK3PXP';
const TOTP_URI = `otpauth://totp/Tickee:an.nguyen%40vidu.vn?secret=${MANUAL_KEY}&issuer=Tickee&digits=6&period=30`;
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i + 2}-BBBB${(i % 8) + 2}`);
const DASHBOARD = `/btc/${ORG_ID}`;
const ENROLL_URL = `/bao-mat/totp?returnTo=${encodeURIComponent(DASHBOARD)}`;

const totpRequired = (reason: 'enroll' | 'step_up'): Reply => apiError(403, 'TOTP_REQUIRED', { reason });
const enrolled = (): Reply => ({ status: 200, body: { totpUri: TOTP_URI, manualKey: MANUAL_KEY } });
const verified = (): Reply => ({ status: 200, body: { recoveryCodes: RECOVERY_CODES } });
const steppedUp = (): Reply => ({ status: 200, body: { stepUpAt: '2026-10-30T03:00:00.000Z' } });

const enrollBoxes = (page: Page) => page.getByRole('group', { name: /Nhập mã 6 số/ }).locator('input');
const stepUpDialog = (page: Page) => page.getByRole('dialog', { name: 'Xác thực hai lớp' });
const dialogBoxes = (page: Page) => stepUpDialog(page).getByRole('group', { name: /Mã 6 số/ }).locator('input');
const callsTo = (calls: Call[], path: string) => calls.filter((c) => c.path === path);
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Owner chưa đăng ký: sang màn đăng ký kèm returnTo; mã sai báo tại ô; đúng → 10 mã khôi phục, lưu rồi về trang dở', async ({
  page,
  browserName,
}) => {
  // Chromium headless chặn clipboard nếu không cấp quyền; WebKit cho phép sau thao tác người dùng.
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let isEnrolled = false;
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, isEnrolled),
    'POST /identity/totp/enroll': enrolled,
    'POST /identity/totp/enroll/verify': (request) => {
      if ((request.postDataJSON() as { code: string }).code !== '123456') {
        return apiError(400, 'TOTP_INVALID', { remainingAttempts: 4 });
      }
      isEnrolled = true;
      return verified();
    },
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (isEnrolled ? organization() : totpRequired('enroll')),
  });

  await page.goto(DASHBOARD);
  await page.waitForURL(`**${ENROLL_URL}`);
  await expect(page.getByRole('heading', { name: 'Bật xác thực hai lớp' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Mã QR/ })).toBeVisible();
  await expect(page.getByTestId('manual-key')).toHaveText('JBSW Y3DP EHPK 3PXP');
  expect(callsTo(identityCalls, '/identity/totp/enroll')).toHaveLength(1);

  await enrollBoxes(page).first().fill('111111');
  await expect(page.getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/bao-mat/totp`));

  await enrollBoxes(page).first().fill('123456');
  const list = page.getByRole('list', { name: 'Mã khôi phục' });
  await expect(list.getByRole('listitem')).toHaveCount(10);
  await expect(list).toContainText(RECOVERY_CODES[0]!);
  const next = page.getByRole('button', { name: 'Tiếp tục' });
  await expect(next).toBeDisabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải xuống .txt' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('tickee-ma-khoi-phuc.txt');
  const text = await readFile((await download.path())!, 'utf8');
  for (const code of RECOVERY_CODES) expect(text).toContain(code);

  await page.getByRole('button', { name: 'Sao chép', exact: true }).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  // Đọc lại được (Chromium đã cấp quyền) thì phải đúng 10 mã; WebKit không cho đọc clipboard trong test.
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (copied !== null) expect(copied).toBe(RECOVERY_CODES.join('\n'));

  await page.getByLabel('Tôi đã lưu mã khôi phục').click();
  await expect(next).toBeEnabled();
  await next.click();
  await page.waitForURL(`**${DASHBOARD}`);
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
});

test('đã đăng ký mà chưa step-up: dialog tại chỗ; mã sai giữ dialog; đúng → tải lại trang dở', async ({ page }) => {
  let steppedUpOk = false;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': (request) => {
      if ((request.postDataJSON() as { code: string }).code !== '123456') {
        return apiError(400, 'TOTP_INVALID', { remainingAttempts: 3 });
      }
      steppedUpOk = true;
      return steppedUp();
    },
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (steppedUpOk ? organization() : totpRequired('step_up')),
  });

  await page.goto(DASHBOARD);
  await expect(stepUpDialog(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD}$`));

  await dialogBoxes(page).first().fill('000000');
  await expect(stepUpDialog(page).getByText('Mã chưa đúng, còn 3 lần.')).toBeVisible();
  await expect(stepUpDialog(page)).toBeVisible();

  await dialogBoxes(page).first().fill('123456');
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  expect(callsTo(calls, '/identity/totp/step-up').map((c) => c.body)).toEqual([{ code: '000000' }, { code: '123456' }]);
});

test('step-up giữa thao tác: dữ liệu form còn nguyên và thao tác được gửi lại sau khi xác thực', async ({ page }) => {
  let steppedUpOk = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => {
      steppedUpOk = true;
      return steppedUp();
    },
  });
  const calls = await mockOrganizerApi(page, {
    'POST /orgs': () =>
      steppedUpOk
        ? { status: 201, body: { id: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' } }
        : totpRequired('step_up'),
    [`GET /orgs/${ORG_ID}`]: () => organization(),
  });

  await page.goto('/tao-btc');
  await page.getByLabel('Tên BTC').fill('CLB Cờ Vua Quận 3');
  await page.getByRole('button', { name: 'Tạo BTC' }).click();
  await expect(stepUpDialog(page)).toBeVisible();

  // Hủy rồi thử lại: form vẫn giữ tên đã nhập.
  await stepUpDialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByLabel('Tên BTC')).toHaveValue('CLB Cờ Vua Quận 3');
  await page.getByRole('button', { name: 'Tạo BTC' }).click();
  await expect(stepUpDialog(page)).toBeVisible();

  await dialogBoxes(page).first().fill('123456');
  await page.waitForURL(`**${DASHBOARD}`);
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(3);
  expect(posts.at(-1)?.body).toMatchObject({ name: 'CLB Cờ Vua Quận 3' });
});

test('bị khóa: báo số phút còn lại tại ô, dialog vẫn mở', async ({ page }) => {
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => apiError(429, 'TOTP_LOCKED', { retryAfterSeconds: 14 * 60 - 5 }),
  });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => totpRequired('step_up') });

  await page.goto(DASHBOARD);
  await dialogBoxes(page).first().fill('123456');
  await expect(stepUpDialog(page).getByText('Bạn đã nhập sai quá nhiều lần. Thử lại sau 14 phút.')).toBeVisible();
  await expect(stepUpDialog(page)).toBeVisible();
});

test('dùng mã khôi phục: mã sai báo tại ô; đúng → sang màn đăng ký lại kèm returnTo', async ({ page }) => {
  let recovered = false;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, !recovered),
    'POST /identity/totp/recovery': (request) => {
      if ((request.postDataJSON() as { recoveryCode: string }).recoveryCode !== 'ABCDE-FGH23') {
        return apiError(400, 'TOTP_INVALID', { remainingAttempts: 4 });
      }
      recovered = true;
      return { status: 200, body: { stepUpAt: '2026-10-30T03:00:00.000Z', reenrollRequired: true } };
    },
    'POST /identity/totp/enroll': enrolled,
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => totpRequired(recovered ? 'enroll' : 'step_up'),
  });

  await page.goto(DASHBOARD);
  await stepUpDialog(page).getByRole('button', { name: 'Dùng mã khôi phục' }).click();
  const field = stepUpDialog(page).getByLabel('Mã khôi phục');
  await field.fill('ZZZZZ-ZZZZZ');
  await stepUpDialog(page).getByRole('button', { name: 'Xác nhận' }).click();
  await expect(stepUpDialog(page).getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();

  await field.fill('ABCDE-FGH23');
  await stepUpDialog(page).getByRole('button', { name: 'Xác nhận' }).click();
  await page.waitForURL(`**${ENROLL_URL}`);
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByTestId('manual-key')).toBeVisible();
  expect(callsTo(calls, '/identity/totp/recovery').map((c) => c.body)).toEqual([
    { recoveryCode: 'ZZZZZ-ZZZZZ' },
    { recoveryCode: 'ABCDE-FGH23' },
  ]);
});

test('đã đăng ký mà mở màn đăng ký → về thẳng returnTo, không bắt đầu đăng ký', async ({ page }) => {
  const calls = await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => organization() });
  await page.goto(ENROLL_URL);
  await page.waitForURL(`**${DASHBOARD}`);
  expect(callsTo(calls, '/identity/totp/enroll')).toHaveLength(0);
});

test('320px không cuộn ngang: màn đăng ký, màn mã khôi phục và dialog step-up', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let isEnrolled = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, isEnrolled),
    'POST /identity/totp/enroll': enrolled,
    'POST /identity/totp/enroll/verify': () => {
      isEnrolled = true;
      return verified();
    },
  });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => totpRequired('step_up') });

  await page.goto(ENROLL_URL);
  await expect(page.getByTestId('manual-key')).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await enrollBoxes(page).first().fill('123456');
  await expect(page.getByRole('list', { name: 'Mã khôi phục' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await page.goto(DASHBOARD);
  await expect(stepUpDialog(page)).toBeVisible();
  const box = (await stepUpDialog(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(await horizontalOverflow(page)).toBe(0);
});
