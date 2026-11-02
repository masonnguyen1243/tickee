import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, type Call, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Màn nhận lời mời làm Admin `/loi-moi-btc#token` (Story 2.4) với API giả: xem trước công khai, đăng nhập rồi quay lại
 * nhận, sai email, link hết hạn/đã dùng/không hợp lệ.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const TOKEN = 'Qx7n2VbL9pTzR4mK8sWd1A';
const INVITE_URL = `/loi-moi-btc#${TOKEN}`;
const INVITED_TITLE = `Bạn được mời làm Admin của ${ORG_NAME}.`;
const CONTACT_OWNER = 'Liên hệ Owner để nhận link mới.';

const accepted = (): Reply => ({ status: 200, body: { organizationId: ORG_ID, organizationName: ORG_NAME, role: 'admin' } });
const previewOk = (): Reply => ({ status: 200, body: { organizationName: ORG_NAME } });

/** Ghi lại URL mọi request trình duyệt gửi đi (kiểm token không bao giờ nằm trong URL). */
function recordUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

const callsTo = (calls: Call[], path: string) => calls.filter((c) => c.path === path);

test('chưa đăng nhập: tên BTC + "Đăng nhập để nhận" → đăng nhập (returnTo không chứa token) → quay lại nhận → dashboard', async ({
  page,
}) => {
  const urls = recordUrls(page);
  let signedIn = false;
  let isMember = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me(CONSENTED) : unauthenticated()),
    'POST /identity/otp': () => ({ status: 200, body: { resendAfterSeconds: 60 } }),
    'POST /identity/otp/verify': () => {
      signedIn = true;
      return { status: 200, body: { consentRequired: false } };
    },
  });
  const calls = await mockOrganizerApi(page, {
    'POST /org-invitations/preview': previewOk,
    'POST /org-invitations/accept': () => {
      isMember = true;
      return accepted();
    },
    [`GET /orgs/${ORG_ID}`]: () => (isMember ? organization({ role: 'admin' }) : apiError(403, 'NOT_A_MEMBER')),
    'GET /me/memberships': () => ({
      status: 200,
      body: isMember ? [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] : [],
    }),
  });

  await page.goto(INVITE_URL);
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  // Đã giữ token trong tab: `#token` bị bỏ khỏi URL (thanh địa chỉ, lịch sử, `returnTo` dựng từ URL hiện tại).
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).pathname).toBe('/loi-moi-btc');
  await page.getByRole('link', { name: 'Đăng nhập để nhận' }).click();
  await page.waitForURL((url) => url.pathname === '/dang-nhap');
  expect(new URL(page.url()).search).toBe(`?returnTo=${encodeURIComponent('/loi-moi-btc')}`);

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input').first().fill('123456');
  await page.waitForURL((url) => url.pathname === '/loi-moi-btc');
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  await expect(page.getByText(`Bạn đang đăng nhập bằng ${EMAIL}.`)).toBeVisible();

  await page.getByRole('button', { name: 'Nhận lời mời' }).click();
  await page.waitForURL(`**/btc/${ORG_ID}`);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();

  const accepts = callsTo(calls, '/org-invitations/accept');
  expect(accepts.map((c) => c.body)).toEqual([{ token: TOKEN }]);
  expect(callsTo(calls, '/org-invitations/preview').every((c) => (c.body as { token: string }).token === TOKEN)).toBe(
    true,
  );
  // Token chỉ đi trong body: không request nào (trang web, RSC, api) mang token trong đường dẫn hay query. Phần `#`
  // không bao giờ rời trình duyệt.
  expect(
    urls.filter((u) => {
      const url = new URL(u);
      return `${url.pathname}${url.search}`.includes(TOKEN);
    }),
  ).toEqual([]);
  // Đã nhận xong thì token không còn được giữ trong tab.
  expect(await page.evaluate(() => Object.values({ ...window.sessionStorage }))).not.toContain(TOKEN);
});

test('đã đăng nhập: "Nhận lời mời" → dashboard BTC với vai Admin, danh sách BTC được tải lại', async ({ page }) => {
  let isMember = false;
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    'POST /org-invitations/preview': previewOk,
    'POST /org-invitations/accept': () => {
      isMember = true;
      return accepted();
    },
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({
      status: 200,
      body: isMember ? [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] : [],
    }),
  });
  await page.goto(INVITE_URL);
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  const membershipsBefore = callsTo(calls, '/me/memberships').length;

  await page.getByRole('button', { name: 'Nhận lời mời' }).click();
  await page.waitForURL(`**/btc/${ORG_ID}`);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  // Admin không thấy mục chỉ Owner.
  await expect(page.getByRole('link', { name: 'Thành viên' })).toHaveCount(0);
  await expect.poll(() => callsTo(calls, '/me/memberships').length).toBeGreaterThan(membershipsBefore);
});

test('nhận khi session chưa qua lớp hai: dialog "Xác thực hai lớp" → nhập mã → tự gửi lại → dashboard', async ({
  page,
}) => {
  let steppedUp = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => {
      steppedUp = true;
      return { status: 200, body: { stepUpAt: '2026-11-02T03:00:00.000Z' } };
    },
  });
  const calls = await mockOrganizerApi(page, {
    'POST /org-invitations/preview': previewOk,
    'POST /org-invitations/accept': () => (steppedUp ? accepted() : apiError(403, 'TOTP_REQUIRED', { reason: 'step_up' })),
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
  });
  await page.goto(INVITE_URL);
  await page.getByRole('button', { name: 'Nhận lời mời' }).click();
  const dialog = page.getByRole('dialog', { name: 'Xác thực hai lớp' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('group', { name: /Mã 6 số/ }).locator('input').first().fill('123456');
  await page.waitForURL(`**/btc/${ORG_ID}`);
  expect(callsTo(calls, '/org-invitations/accept')).toHaveLength(2);
});

test('sai email: email lời mời đã che + "Đăng xuất" → màn đăng nhập (quay lại link), không vào BTC', async ({ page }) => {
  let signedIn = true;
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => (signedIn ? me(CONSENTED) : unauthenticated()),
    'POST /identity/sign-out': () => {
      signedIn = false;
      return { status: 204 };
    },
  });
  await mockOrganizerApi(page, {
    'POST /org-invitations/preview': previewOk,
    'POST /org-invitations/accept': () => apiError(403, 'INVITATION_EMAIL_MISMATCH', { maskedEmail: 'b***@vidu.vn' }),
  });
  await page.goto(INVITE_URL);
  await page.getByRole('button', { name: 'Nhận lời mời' }).click();
  await expect(page.getByRole('heading', { name: 'Lời mời này gửi tới b***@vidu.vn.' })).toBeVisible();
  await expect(page.getByText(`Bạn đang đăng nhập bằng ${EMAIL}.`, { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.waitForURL((url) => url.pathname === '/dang-nhap');
  expect(new URL(page.url()).search).toBe(`?returnTo=${encodeURIComponent('/loi-moi-btc')}`);
  expect(identityCalls.filter((c) => c.path === '/identity/sign-out')).toHaveLength(1);
  expect(await page.evaluate(() => Object.values({ ...window.sessionStorage }))).toContain(TOKEN);
});

const UNUSABLE: [string, Reply, string][] = [
  ['hết hạn', apiError(410, 'INVITATION_EXPIRED'), 'Link mời đã hết hạn.'],
  ['đã dùng', apiError(409, 'INVITATION_USED'), 'Link mời đã được dùng.'],
  ['sai hoặc đã thu hồi', apiError(404, 'INVITATION_INVALID'), 'Link mời không hợp lệ.'],
];
for (const [label, reply, title] of UNUSABLE) {
  test(`link ${label}: "${title}" + "${CONTACT_OWNER}", không có nút nhận`, async ({ page }) => {
    await mockIdentityApi(page);
    await mockOrganizerApi(page, { 'POST /org-invitations/preview': () => reply });
    await page.goto(INVITE_URL);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(CONTACT_OWNER)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhận lời mời' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Đăng nhập để nhận' })).toHaveCount(0);
  });
}

test('link thiếu token: "Link mời không hợp lệ." mà không gọi api xem trước', async ({ page }) => {
  await mockIdentityApi(page);
  const calls = await mockOrganizerApi(page);
  await page.goto('/loi-moi-btc');
  await expect(page.getByRole('heading', { name: 'Link mời không hợp lệ.' })).toBeVisible();
  await expect(page.getByText(CONTACT_OWNER)).toBeVisible();
  expect(callsTo(calls, '/org-invitations/preview')).toHaveLength(0);
});

test('đã đăng nhập nhưng chưa đồng ý NĐ 13 → màn đồng ý, quay lại link sau khi đồng ý', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(null) });
  await mockOrganizerApi(page, { 'POST /org-invitations/preview': previewOk });
  await page.goto(INVITE_URL);
  await page.waitForURL((url) => url.pathname === '/dong-y');
  expect(new URL(page.url()).search).toBe(`?returnTo=${encodeURIComponent('/loi-moi-btc')}`);
});
