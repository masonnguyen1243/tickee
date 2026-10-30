import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, USER_ID, type Call, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Xác thực hai lớp tự bật (Story 2.2 làm lại): trang Bảo mật tài khoản (bật/tắt), màn đăng ký `/bao-mat/totp`, dialog
 * "Xác thực hai lớp" khi api trả TOTP_REQUIRED, mã khôi phục, thẻ gợi ý cho Owner chưa bật.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const MANUAL_KEY = 'JBSWY3DPEHPK3PXP';
const TOTP_URI = `otpauth://totp/Tickee:an.nguyen%40vidu.vn?secret=${MANUAL_KEY}&issuer=Tickee&digits=6&period=30`;
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i + 2}-BBBB${(i % 8) + 2}`);
const DASHBOARD = `/btc/${ORG_ID}`;
const SECURITY = '/tai-khoan/bao-mat';
const ENROLL = '/bao-mat/totp';
const RECOVERY_BANNER = 'Xác thực hai lớp cũ đã được gỡ. Bật lại với thiết bị mới.';
const HINT = 'Bật xác thực hai lớp để bảo vệ tài khoản nhận tiền.';

const totpRequired = (): Reply => apiError(403, 'TOTP_REQUIRED', { reason: 'step_up' });
const enrolled = (): Reply => ({ status: 200, body: { totpUri: TOTP_URI, manualKey: MANUAL_KEY } });
const verified = (): Reply => ({ status: 200, body: { recoveryCodes: RECOVERY_CODES } });
const steppedUp = (): Reply => ({ status: 200, body: { stepUpAt: '2026-10-30T03:00:00.000Z' } });
const disabled = (): Reply => ({ status: 200, body: { twoFactorEnabled: false } });

const enrollBoxes = (page: Page) => page.getByRole('group', { name: /Nhập mã 6 số/ }).locator('input');
const stepUpDialog = (page: Page) => page.getByRole('dialog', { name: 'Xác thực hai lớp' });
const dialogBoxes = (page: Page) => stepUpDialog(page).getByRole('group', { name: /Mã 6 số/ }).locator('input');
const disableDialog = (page: Page) => page.getByRole('dialog', { name: 'Tắt xác thực hai lớp?' });
const twoFactorSection = (page: Page) => page.getByRole('region', { name: 'Xác thực hai lớp' });
const hint = (page: Page) => page.getByRole('region', { name: 'Gợi ý bảo mật' });
const callsTo = (calls: Call[], path: string) => calls.filter((c) => c.path === path);
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('bật từ trang Bảo mật: QR + khóa nhập tay; mã sai báo tại ô; đúng → 10 mã khôi phục; lưu xong về trang Bảo mật đã bật', async ({
  page,
  browserName,
}) => {
  // Chromium headless chặn clipboard nếu không cấp quyền; WebKit cho phép sau thao tác người dùng.
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let isEnabled = false;
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, isEnabled),
    'POST /identity/totp/enroll': enrolled,
    'POST /identity/totp/enroll/verify': (request) => {
      if ((request.postDataJSON() as { code: string }).code !== '123456') {
        return apiError(400, 'TOTP_INVALID', { remainingAttempts: 4 });
      }
      isEnabled = true;
      return verified();
    },
  });
  await mockOrganizerApi(page);

  await page.goto(SECURITY);
  await expect(page.getByRole('heading', { name: 'Bảo mật tài khoản', level: 1 })).toBeVisible();
  await expect(twoFactorSection(page)).toContainText('Chưa bật');
  await twoFactorSection(page).getByRole('link', { name: 'Bật xác thực hai lớp' }).click();

  await page.waitForURL(`**${ENROLL}`);
  await expect(page.getByRole('heading', { name: 'Bật xác thực hai lớp' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Mã QR/ })).toBeVisible();
  await expect(page.getByTestId('manual-key')).toHaveText('JBSW Y3DP EHPK 3PXP');
  expect(callsTo(identityCalls, '/identity/totp/enroll')).toHaveLength(1);

  await enrollBoxes(page).first().fill('111111');
  await expect(page.getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(ENROLL));

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
  // Ở 375px toast "Đã sao chép" đè lên nút; chuột rê lên toast làm sonner dừng đếm giờ nên phải chờ toast tắt trước.
  await expect(page.getByText('Đã sao chép')).toBeHidden({ timeout: 10_000 });
  await next.click();
  await page.waitForURL(`**${SECURITY}`);
  await expect(twoFactorSection(page)).toContainText('Đang bật');
  await expect(twoFactorSection(page).getByRole('button', { name: 'Tắt' })).toBeVisible();
});

test('đã bật mà session chưa qua lớp hai: dialog tại chỗ có "Dùng mã khôi phục" và "Đăng xuất", không đóng bằng Esc; mã sai giữ dialog; đúng → tải lại trang dở', async ({
  page,
}) => {
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
    [`GET /orgs/${ORG_ID}`]: () => (steppedUpOk ? organization() : totpRequired()),
    'GET /me/memberships': () => (steppedUpOk ? { status: 200, body: [] } : totpRequired()),
  });

  await page.goto(DASHBOARD);
  await expect(stepUpDialog(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD}$`));
  await expect(stepUpDialog(page).getByRole('button', { name: 'Dùng mã khôi phục' })).toBeVisible();
  await expect(stepUpDialog(page).getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
  await expect(stepUpDialog(page).getByRole('button', { name: /Hủy|Đóng/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(stepUpDialog(page)).toBeVisible();

  await dialogBoxes(page).first().fill('000000');
  await expect(stepUpDialog(page).getByText('Mã chưa đúng, còn 3 lần.')).toBeVisible();
  await expect(stepUpDialog(page)).toBeVisible();

  await dialogBoxes(page).first().fill('123456');
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  expect(callsTo(calls, '/identity/totp/step-up').map((c) => c.body)).toEqual([{ code: '000000' }, { code: '123456' }]);
});

test('dialog ở trang công khai; "Đăng xuất" hủy session rồi về màn đăng nhập', async ({ page }) => {
  let signedOut = false;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => (signedOut ? unauthenticated() : me(CONSENTED, true)),
    'POST /identity/sign-out': () => {
      signedOut = true;
      return { status: 204 };
    },
  });
  // Menu tài khoản hỏi memberships: route không miễn → TOTP_REQUIRED ngay sau đăng nhập.
  await mockOrganizerApi(page, { 'GET /me/memberships': () => (signedOut ? unauthenticated() : totpRequired()) });

  await page.goto('/');
  await expect(stepUpDialog(page)).toBeVisible();
  await stepUpDialog(page).getByRole('button', { name: 'Đăng xuất' }).click();
  await page.waitForURL('**/dang-nhap');
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  expect(callsTo(calls, '/identity/sign-out')).toHaveLength(1);
});

test('"Đăng xuất" từ dialog ở trang BTC → màn đăng nhập kèm returnTo về đúng trang đó', async ({ page }) => {
  let signedOut = false;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => (signedOut ? unauthenticated() : me(CONSENTED, true)),
    'POST /identity/sign-out': () => {
      signedOut = true;
      return { status: 204 };
    },
  });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => (signedOut ? unauthenticated() : totpRequired()) });

  await page.goto(DASHBOARD);
  await expect(stepUpDialog(page)).toBeVisible();
  await stepUpDialog(page).getByRole('button', { name: 'Đăng xuất' }).click();
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(DASHBOARD)}`);
  const url = new URL(page.url());
  expect(`${url.pathname}${url.search}`).toBe(`/dang-nhap?returnTo=${encodeURIComponent(DASHBOARD)}`);
  await expect(stepUpDialog(page)).toBeHidden();
  expect(callsTo(calls, '/identity/sign-out')).toHaveLength(1);
});

test('step-up trả 409 (2FA đã tắt ở nơi khác) → coi như đã qua: dialog đóng, trang dở tải lại', async ({ page }) => {
  let disabledElsewhere = false;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => {
      disabledElsewhere = true;
      return apiError(409, 'VALIDATION_FAILED');
    },
  });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => (disabledElsewhere ? organization() : totpRequired()) });

  await page.goto(DASHBOARD);
  await expect(stepUpDialog(page)).toBeVisible();
  await dialogBoxes(page).first().fill('123456');
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  expect(callsTo(calls, '/identity/totp/step-up')).toHaveLength(1);
});

test('qua lớp hai giữa thao tác: dữ liệu form còn nguyên và thao tác được gửi lại sau khi xác thực', async ({ page }) => {
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
      steppedUpOk ? { status: 201, body: { id: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' } } : totpRequired(),
    [`GET /orgs/${ORG_ID}`]: () => organization(),
  });

  await page.goto('/tao-btc');
  await page.getByLabel('Tên BTC').fill('CLB Cờ Vua Quận 3');
  await page.getByRole('button', { name: 'Tạo BTC' }).click();
  await expect(stepUpDialog(page)).toBeVisible();
  await expect(page.getByLabel('Tên BTC')).toHaveValue('CLB Cờ Vua Quận 3');

  await dialogBoxes(page).first().fill('123456');
  await page.waitForURL(`**${DASHBOARD}`);
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts.at(-1)?.body).toMatchObject({ name: 'CLB Cờ Vua Quận 3' });
});

test('bị khóa: báo số phút còn lại tại ô, dialog vẫn mở', async ({ page }) => {
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => apiError(429, 'TOTP_LOCKED', { retryAfterSeconds: 14 * 60 - 5 }),
  });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => totpRequired() });

  await page.goto(DASHBOARD);
  await dialogBoxes(page).first().fill('123456');
  await expect(stepUpDialog(page).getByText('Bạn đã nhập sai quá nhiều lần. Thử lại sau 14 phút.')).toBeVisible();
  await expect(stepUpDialog(page)).toBeVisible();
});

test('dùng mã khôi phục: mã sai báo tại ô; đúng → trang Bảo mật tài khoản kèm banner bật lại', async ({ page }) => {
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
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (recovered ? organization() : totpRequired()),
  });

  await page.goto(DASHBOARD);
  await stepUpDialog(page).getByRole('button', { name: 'Dùng mã khôi phục' }).click();
  const field = stepUpDialog(page).getByLabel('Mã khôi phục');
  await field.fill('ZZZZZ-ZZZZZ');
  await stepUpDialog(page).getByRole('button', { name: 'Xác nhận' }).click();
  await expect(stepUpDialog(page).getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();

  await field.fill('ABCDE-FGH23');
  await stepUpDialog(page).getByRole('button', { name: 'Xác nhận' }).click();
  await page.waitForURL(new RegExp(`${SECURITY}\\?da-dung-ma-khoi-phuc=1$`));
  await expect(stepUpDialog(page)).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: RECOVERY_BANNER })).toBeVisible();
  await expect(twoFactorSection(page)).toContainText('Chưa bật');
  await expect(twoFactorSection(page).getByRole('link', { name: 'Bật xác thực hai lớp' })).toHaveAttribute('href', ENROLL);
  expect(callsTo(calls, '/identity/totp/recovery').map((c) => c.body)).toEqual([
    { recoveryCode: 'ZZZZZ-ZZZZZ' },
    { recoveryCode: 'ABCDE-FGH23' },
  ]);
  // Không còn đưa sang màn đăng ký.
  expect(callsTo(calls, '/identity/totp/enroll')).toHaveLength(0);
});

test('tắt từ trang Bảo mật: dialog nêu hậu quả; Hủy không gọi api; mã sai báo tại ô; mã khôi phục đúng → toast, Chưa bật', async ({
  page,
}) => {
  let isEnabled = true;
  const calls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, isEnabled),
    'POST /identity/totp/disable': (request) => {
      const body = request.postDataJSON() as { code?: string; recoveryCode?: string };
      if (body.recoveryCode?.toUpperCase() !== 'ABCDE-FGH23') return apiError(400, 'TOTP_INVALID', { remainingAttempts: 4 });
      isEnabled = false;
      return disabled();
    },
  });
  await mockOrganizerApi(page);

  await page.goto(SECURITY);
  await expect(twoFactorSection(page)).toContainText('Đang bật');
  await twoFactorSection(page).getByRole('button', { name: 'Tắt' }).click();
  await expect(disableDialog(page)).toContainText('Tài khoản chỉ còn được bảo vệ bằng email.');
  await disableDialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(disableDialog(page)).toBeHidden();
  expect(callsTo(calls, '/identity/totp/disable')).toHaveLength(0);

  await twoFactorSection(page).getByRole('button', { name: 'Tắt' }).click();
  const field = disableDialog(page).getByLabel('Mã xác thực hoặc mã khôi phục');
  const confirm = disableDialog(page).getByRole('button', { name: 'Tắt xác thực hai lớp' });
  await confirm.click();
  await expect(disableDialog(page).getByText('Nhập mã trong ứng dụng xác thực hoặc một mã khôi phục.')).toBeVisible();
  await field.fill('000000');
  await confirm.click();
  await expect(disableDialog(page).getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('abcde-fgh23');
  await confirm.click();
  await expect(disableDialog(page)).toBeHidden();
  await expect(page.getByText('Đã tắt xác thực hai lớp')).toBeVisible();
  await expect(twoFactorSection(page)).toContainText('Chưa bật');
  await expect(twoFactorSection(page).getByRole('link', { name: 'Bật xác thực hai lớp' })).toBeVisible();
  expect(callsTo(calls, '/identity/totp/disable').map((c) => c.body)).toEqual([
    { code: '000000' },
    { recoveryCode: 'abcde-fgh23' },
  ]);
});

test('Owner chưa bật tạo BTC rồi vào thẳng danh sách Sự kiện; thẻ gợi ý "Bật ngay" → trang Bảo mật; đóng thì không hiện lại', async ({
  page,
}) => {
  const identityCalls = await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, false) });
  await mockOrganizerApi(page, {
    'POST /orgs': () => ({ status: 201, body: { id: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' } }),
    [`GET /orgs/${ORG_ID}`]: () => organization(),
  });

  await page.goto('/tao-btc');
  await page.getByLabel('Tên BTC').fill('CLB Cờ Vua Quận 3');
  await page.getByRole('button', { name: 'Tạo BTC' }).click();
  await page.waitForURL(`**${DASHBOARD}`);
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sự kiện', exact: true })).toBeVisible();
  await expect(stepUpDialog(page)).toBeHidden();
  expect(callsTo(identityCalls, '/identity/totp/enroll')).toHaveLength(0);

  await expect(hint(page)).toContainText(HINT);
  await hint(page).getByRole('link', { name: 'Bật ngay' }).click();
  await page.waitForURL(`**${SECURITY}`);
  await expect(twoFactorSection(page)).toContainText('Chưa bật');

  await page.goBack();
  await expect(hint(page)).toBeVisible();
  await hint(page).getByRole('button', { name: 'Đóng gợi ý' }).click();
  await expect(hint(page)).toHaveCount(0);
  expect(await page.evaluate((id) => localStorage.getItem(`tickee:goi-y-2fa:da-dong:${id}`), USER_ID)).toBe('1');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});

test('thẻ gợi ý chỉ cho Owner chưa bật: Admin và Owner đã bật không thấy', async ({ page }) => {
  let twoFactorEnabled = false;
  let role = 'admin';
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, twoFactorEnabled) });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: () => organization({ role }) });

  await page.goto(DASHBOARD);
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  await expect(hint(page)).toHaveCount(0);

  role = 'owner';
  twoFactorEnabled = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});

test('menu tài khoản có "Bảo mật tài khoản" cho mọi tài khoản đã đăng nhập', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, false) });
  await mockOrganizerApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
  await page.getByRole('menuitem', { name: 'Bảo mật tài khoản' }).click();
  await page.waitForURL(`**${SECURITY}`);
  await expect(page.getByRole('heading', { name: 'Bảo mật tài khoản', level: 1 })).toBeVisible();
});

test('đã bật mà mở màn đăng ký → về thẳng trang Bảo mật, không bắt đầu đăng ký', async ({ page }) => {
  const calls = await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
  await mockOrganizerApi(page);
  await page.goto(ENROLL);
  await page.waitForURL(`**${SECURITY}`);
  expect(callsTo(calls, '/identity/totp/enroll')).toHaveLength(0);
});

test('chưa đăng nhập mở trang Bảo mật → màn đăng nhập kèm returnTo', async ({ page }) => {
  await mockIdentityApi(page);
  await mockOrganizerApi(page);
  await page.goto(SECURITY);
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(SECURITY)}`);
});

test('320px không cuộn ngang: trang Bảo mật, màn đăng ký, mã khôi phục, dialog tắt, thẻ gợi ý, dialog xác thực', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let isEnabled = false;
  let requireStepUp = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, isEnabled),
    'POST /identity/totp/enroll': enrolled,
    'POST /identity/totp/enroll/verify': () => {
      isEnabled = true;
      return verified();
    },
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (requireStepUp ? totpRequired() : organization()),
  });

  await page.goto(`${SECURITY}?da-dung-ma-khoi-phuc=1`);
  await expect(page.getByText(RECOVERY_BANNER)).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await page.goto(DASHBOARD);
  await expect(hint(page)).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await page.goto(ENROLL);
  await expect(page.getByTestId('manual-key')).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await enrollBoxes(page).first().fill('123456');
  await expect(page.getByRole('list', { name: 'Mã khôi phục' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);

  await page.goto(SECURITY);
  await twoFactorSection(page).getByRole('button', { name: 'Tắt' }).click();
  await expect(disableDialog(page)).toBeVisible();
  const disableBox = (await disableDialog(page).boundingBox())!;
  expect(disableBox.x).toBeGreaterThanOrEqual(0);
  expect(disableBox.x + disableBox.width).toBeLessThanOrEqual(320);
  expect(await horizontalOverflow(page)).toBe(0);

  requireStepUp = true;
  await page.goto(DASHBOARD);
  await expect(stepUpDialog(page)).toBeVisible();
  const box = (await stepUpDialog(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(await horizontalOverflow(page)).toBe(0);
});
