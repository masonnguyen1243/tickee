import { expect, test, type Page } from '@playwright/test';

import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, WEB_ORIGIN } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, OTHER_ORG_ID } from './organizer-mock';

/* Màn tạo BTC `/tao-btc` và trang đích dashboard `/btc/[orgId]` với API giả. */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const signedIn = () => me(CONSENTED);
const created = () => ({ status: 201, body: { id: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' } });

const nameInput = (page: Page) => page.getByLabel('Tên BTC');
const submit = (page: Page) => page.getByRole('button', { name: 'Tạo BTC' }).click();

test('tạo thành công: gửi tên + liên hệ đã chuẩn hóa, chuyển sang trang đích có tên BTC và empty-state', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  const calls = await mockOrganizerApi(page, {
    'POST /orgs': created,
    [`GET /orgs/${ORG_ID}`]: () => organization(),
  });
  await page.goto('/tao-btc');
  await expect(page.getByRole('link', { name: 'Tickee — Trang chủ' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Tài khoản: ${EMAIL}` })).toBeVisible();
  await nameInput(page).fill('  CLB Cờ Vua Quận 3 ');
  await page.getByLabel('Số điện thoại').fill('0901 234 567');
  await submit(page);

  await page.waitForURL(`**/btc/${ORG_ID}`);
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
  await expect(page.getByText('Chưa có Sự kiện nào.')).toBeVisible();
  expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
    name: 'CLB Cờ Vua Quận 3',
    contactPhone: '0901234567',
    contactEmail: null,
  });
});

test('tên trống hoặc quá dài: lỗi tại ô, không gọi api, giữ dữ liệu', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  const calls = await mockOrganizerApi(page);
  await page.goto('/tao-btc');
  await page.getByLabel('Email liên hệ').fill('lienhe@vidu.vn');
  await submit(page);
  await expect(page.getByText('Nhập tên BTC.')).toBeVisible();
  await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');

  await nameInput(page).fill('a'.repeat(101));
  await submit(page);
  await expect(page.getByText('Tên BTC tối đa 100 ký tự.')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('a'.repeat(101));
  await expect(page.getByLabel('Email liên hệ')).toHaveValue('lienhe@vidu.vn');
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

test('liên hệ sai định dạng: lỗi tại ô; lỗi VALIDATION_FAILED từ api cũng hiện tại đúng ô', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  await mockOrganizerApi(page, {
    'POST /orgs': () => apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'contactEmail', code: 'invalid_format' }] }),
  });
  await page.goto('/tao-btc');
  await nameInput(page).fill('BTC');
  await page.getByLabel('Số điện thoại').fill('123');
  await submit(page);
  await expect(page.getByText(/Số điện thoại chưa đúng/)).toBeVisible();

  await page.getByLabel('Số điện thoại').fill('');
  await page.getByLabel('Email liên hệ').fill('a@b.vn');
  await submit(page);
  await expect(page.getByText('Email chưa đúng định dạng.')).toBeVisible();
  await expect(page.getByLabel('Email liên hệ')).toHaveAttribute('aria-invalid', 'true');
});

test('api 5xx: lỗi tại chỗ + "Thử lại" giữ tên đã nhập, thử lại thành công', async ({ page }) => {
  let attempts = 0;
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  const calls = await mockOrganizerApi(page, {
    'POST /orgs': () => (++attempts === 1 ? apiError(503, 'SERVICE_UNAVAILABLE') : created()),
    [`GET /orgs/${ORG_ID}`]: () => organization(),
  });
  await page.goto('/tao-btc');
  await nameInput(page).fill('CLB Cờ Vua Quận 3');
  await submit(page);
  await expect(page.getByText('Chưa tạo được BTC')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('CLB Cờ Vua Quận 3');

  await page.getByRole('button', { name: 'Thử lại' }).click();
  await page.waitForURL(`**/btc/${ORG_ID}`);
  const posts = calls.filter((c) => c.method === 'POST').map((c) => c.body);
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
});

test('chưa đăng nhập: /tao-btc → đăng nhập kèm returnTo=/tao-btc', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': unauthenticated });
  await mockOrganizerApi(page);
  await page.goto('/tao-btc');
  await page.waitForURL('**/dang-nhap?returnTo=%2Ftao-btc');
});

test('401 lúc gửi form → đăng nhập kèm returnTo=/tao-btc', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  await mockOrganizerApi(page, { 'POST /orgs': unauthenticated });
  await page.goto('/tao-btc');
  await nameInput(page).fill('CLB Cờ Vua Quận 3');
  await submit(page);
  await page.waitForURL('**/dang-nhap?returnTo=%2Ftao-btc');
});

test('menu tài khoản: chưa đồng ý NĐ 13 thì không hỏi memberships, không bị chuyển sang /dong-y', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(null) });
  const calls = await mockOrganizerApi(page);
  await page.goto('/chinh-sach-du-lieu');
  await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Đăng xuất' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Tạo BTC' })).toHaveCount(0);
  expect(calls.filter((c) => c.path === '/me/memberships')).toHaveLength(0);
  expect(new URL(page.url()).pathname).toBe('/chinh-sach-du-lieu');
});

test('không phải thành viên (NOT_A_MEMBER): empty-state "Bạn không có quyền xem BTC này."', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  await mockOrganizerApi(page, { [`GET /orgs/${OTHER_ORG_ID}`]: () => apiError(403, 'NOT_A_MEMBER') });
  await page.goto(`/btc/${OTHER_ORG_ID}`);
  await expect(page.getByText('Bạn không có quyền xem BTC này.')).toBeVisible();
});

test('trang đích khi chưa đăng nhập → đăng nhập kèm returnTo', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': unauthenticated });
  await mockOrganizerApi(page, { [`GET /orgs/${ORG_ID}`]: unauthenticated });
  await page.goto(`/btc/${ORG_ID}`);
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(`/btc/${ORG_ID}`)}`);
});

test('menu tài khoản: "Tạo BTC" khi chưa có BTC; "Dashboard BTC" mở BTC đầu tiên', async ({ page }) => {
  let memberships: unknown[] = [];
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  await mockOrganizerApi(page, {
    'GET /me/memberships': () => ({ status: 200, body: memberships }),
    [`GET /orgs/${ORG_ID}`]: () => organization(),
  });
  await page.goto('/chinh-sach-du-lieu');
  await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Tạo BTC' })).toHaveAttribute('href', '/tao-btc');

  memberships = [
    { organizationId: ORG_ID, name: 'CLB Cờ Vua Quận 3', role: 'owner' },
    { organizationId: OTHER_ORG_ID, name: 'BTC khác', role: 'admin' },
  ];
  await page.reload();
  await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
  await page.getByRole('menuitem', { name: 'Dashboard BTC' }).click();
  await page.waitForURL(`${WEB_ORIGIN}/btc/${ORG_ID}`);
  await expect(page.getByRole('heading', { name: 'CLB Cờ Vua Quận 3' })).toBeVisible();
});

test('320px không cuộn ngang: tạo BTC (cả khi có lỗi) và trang đích', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await mockIdentityApi(page, { 'GET /identity/me': signedIn });
  await mockOrganizerApi(page, {
    'POST /orgs': () => apiError(500, 'INTERNAL_ERROR'),
    [`GET /orgs/${ORG_ID}`]: () => organization({ name: 'Một tên BTC rất dài để thử xuống dòng trên màn hình hẹp' }),
  });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto('/tao-btc');
  await expect(nameInput(page)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByLabel('Số điện thoại').fill('12');
  await submit(page);
  await expect(page.getByText('Nhập tên BTC.')).toBeVisible();
  await nameInput(page).fill('BTC');
  await page.getByLabel('Số điện thoại').fill('');
  await submit(page);
  await expect(page.getByText('Chưa tạo được BTC')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.goto(`/btc/${ORG_ID}`);
  await expect(page.getByText('Chưa có Sự kiện nào.')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
