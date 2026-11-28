import type { Page, Route } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, WEB_ORIGIN, type Call, type Handler } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Mục "Google Sheets" ở tab Cài đặt của Sự kiện (Story 6.4, FR-32) với API giả có trạng thái: chưa kết nối → "Kết nối
 * Google Sheets" (`POST …/connect` rồi chuyển cả trang tới URL ủy quyền; Google bị chặn bằng route), bốn trạng thái của
 * kết nối, tải lại mỗi 3 giây khi đang đồng bộ, "Ngắt kết nối" qua `Dialog`, toast theo `?notice=` khi callback OAuth quay
 * về, và bố cục ở màn hẹp. Story 6.6: kết nối "Mất quyền" có nút chính "Kết nối lại" (cùng luồng `POST …/connect`), lý do
 * theo mã lỗi và câu giữ dòng bẩn; toast `sheets-reconnected`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const settings = `${base}?tab=cai-dat`;
const eventPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const sheetsPath = `${eventPath}/google-sheets`;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit';
const AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=sheets.apps.googleusercontent.com&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file&state=e2e-state';

type Connection = {
  status: 'active' | 'syncing' | 'retrying' | 'auth_revoked';
  spreadsheetUrl: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  connectedByName: string | null;
  createdAt: string;
};

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  status: 'active',
  spreadsheetUrl: SHEET_URL,
  // 10:04 27/11/2026 giờ Việt Nam.
  lastSyncedAt: '2026-11-27T03:04:05.000Z',
  lastErrorCode: null,
  connectedByName: 'Trần Thu Hà',
  createdAt: '2026-11-27T03:00:00.000Z',
  ...overrides,
});

type State = {
  connection: Connection | null;
  /** Chặn phản hồi `POST …/connect` tới khi promise xong. */
  holdConnect?: Promise<void>;
  /** `POST …/connect` trả lỗi này. */
  connectError?: { status: number; code: string };
  /** Chặn phản hồi `DELETE` tới khi promise xong. */
  holdDelete?: Promise<void>;
  /** `DELETE` trả 500. */
  failDelete?: boolean;
  /** Session hết hạn: `GET /identity/me` trả 401. */
  signedOut?: boolean;
};

const eventDetail = {
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: 'giai-boi-mua-dong-a1b2',
  name: 'Giải bơi mùa đông',
  status: 'published',
  startsAt: '2099-12-01T07:00:00+07:00',
  endsAt: '2099-12-01T17:00:00+07:00',
  effectiveEndAt: '2099-12-01T17:00:00+07:00',
  endedManuallyAt: null,
  venue: 'Hồ Tây',
  description: null,
  refundPolicy: 'Không hoàn vé.',
  imageKey: null,
  imageUrl: null,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
};

async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ calls: Call[]; state: State }> {
  const state: State = { connection: null, ...initial };
  await mockIdentityApi(page, { 'GET /identity/me': () => (state.signedOut ? unauthenticated() : me(CONSENTED)) });
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({
      status: 200,
      body: [{ organizationId: ORG_ID, name: 'CLB Bơi lội', role: 'admin' }],
    }),
    [`GET ${eventPath}`]: () => ({ status: 200, body: eventDetail }),
    [`GET ${sheetsPath}`]: () => ({ status: 200, body: { connection: state.connection } }),
    [`POST ${sheetsPath}/connect`]: async () => {
      if (state.holdConnect) await state.holdConnect;
      if (state.connectError) return apiError(state.connectError.status, state.connectError.code);
      return { status: 200, body: { authorizationUrl: AUTH_URL } };
    },
    [`DELETE ${sheetsPath}`]: async () => {
      if (state.holdDelete) await state.holdDelete;
      if (state.failDelete) return apiError(500, 'INTERNAL_ERROR');
      if (!state.connection) return apiError(404, 'SHEETS_NOT_CONNECTED');
      state.connection = null;
      return { status: 204 };
    },
  };
  const calls = await mockOrganizerApi(page, handlers);
  return { calls, state };
}

/** Google thật không bao giờ được gọi: điều hướng tới màn đồng ý trả một trang giả. */
async function blockGoogle(page: Page): Promise<string[]> {
  const visited: string[] = [];
  await page.route('https://accounts.google.com/**', (route: Route) => {
    visited.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Màn đồng ý Google giả</p>' });
  });
  return visited;
}

const section = (page: Page) => page.locator('[data-slot="google-sheets"]');
const connectButton = (page: Page) => section(page).getByRole('button', { name: 'Kết nối Google Sheets' });
const callsTo = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);

test('chưa kết nối: mô tả + nút viền "Kết nối Google Sheets"; bấm → spinner, chặn bấm lặp, chuyển tới URL ủy quyền', async ({
  page,
}) => {
  let release!: () => void;
  const { calls } = await openApi(page, { holdConnect: new Promise((resolve) => (release = resolve)) });
  const visited = await blockGoogle(page);
  await page.goto(settings);

  await expect(section(page).getByRole('heading', { name: 'Google Sheets', level: 2 })).toBeVisible();
  await expect(section(page).getByText('Đồng bộ danh sách Đơn sang một Google Sheet mới')).toBeVisible();
  const button = connectButton(page);
  // Không phải hành động chính: kiểu viền (secondary).
  await expect(button).toHaveAttribute('data-slot', 'button');
  await expect(button).toHaveClass(/bg-card/);

  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await button.click({ force: true });
  release();
  await page.waitForURL(AUTH_URL);
  expect(callsTo(calls, 'POST', `${sheetsPath}/connect`)).toHaveLength(1);
  expect(visited).toEqual([AUTH_URL]);
});

test('bấm kết nối khi Sự kiện vừa được kết nối ở nơi khác (409): toast, tải lại thấy trạng thái, không rời trang', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { connectError: { status: 409, code: 'SHEETS_ALREADY_CONNECTED' } });
  const visited = await blockGoogle(page);
  await page.goto(settings);
  await expect(connectButton(page)).toBeVisible();
  state.connection = connection();
  await connectButton(page).click();
  await expect(page.getByText('Sự kiện này đã kết nối Google Sheets.')).toBeVisible();
  await expect(section(page).getByText('Đã kết nối', { exact: true })).toBeVisible();
  expect(visited).toEqual([]);
  expect(callsTo(calls, 'GET', sheetsPath).length).toBeGreaterThanOrEqual(2);
});

test('bấm kết nối, api lỗi 500: toast lỗi, nút hết bận, không rời trang', async ({ page }) => {
  const { calls } = await openApi(page, { connectError: { status: 500, code: 'INTERNAL_ERROR' } });
  const visited = await blockGoogle(page);
  await page.goto(settings);
  const button = connectButton(page);
  await button.click();
  await expect(page.getByText(/^Chưa bắt đầu kết nối Google Sheets được\. /)).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(page).toHaveURL(`${WEB_ORIGIN}${settings}`);
  expect(visited).toEqual([]);
  expect(callsTo(calls, 'POST', `${sheetsPath}/connect`)).toHaveLength(1);
});

test('bấm kết nối khi session đã hết hạn (401): sang trang đăng nhập kèm returnTo, không tới Google', async ({ page }) => {
  const { state } = await openApi(page, { connectError: { status: 401, code: 'UNAUTHENTICATED' } });
  const visited = await blockGoogle(page);
  await page.goto(settings);
  await expect(connectButton(page)).toBeVisible();
  state.signedOut = true;
  await connectButton(page).click();
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);
  expect(visited).toEqual([]);
});

test('bốn trạng thái: Đã kết nối · Đang đồng bộ · Lỗi, đang thử lại · Mất quyền', async ({ page }) => {
  const { state } = await openApi(page, { connection: connection() });
  await page.goto(settings);
  const badge = section(page).locator('[data-slot="status-badge"]');

  // Đã kết nối: link mở Sheet trong tab mới, giờ đồng bộ (giờ Việt Nam), người kết nối, "Ngắt kết nối".
  await expect(badge).toHaveText('Đã kết nối');
  await expect(badge).toHaveAttribute('data-tone', 'success');
  const open = section(page).getByRole('link', { name: /Mở Google Sheet/ });
  await expect(open).toHaveAttribute('href', SHEET_URL);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(section(page).locator('[data-slot="google-sheets-last-synced"]')).toHaveText(
    'Đồng bộ lần cuối: 10:04 27/11/2026 (giờ Việt Nam)',
  );
  await expect(section(page).locator('[data-slot="google-sheets-connected-by"]')).toHaveText('Kết nối bởi Trần Thu Hà');
  await expect(section(page).locator('[data-slot="google-sheets-drive-note"]')).toHaveText(
    'Sheet nằm trong Google Drive của tài khoản Google mà Trần Thu Hà dùng khi kết nối. Thành viên khác cần được chia sẻ Sheet trên Google mới mở được.',
  );
  await expect(section(page).getByRole('button', { name: 'Ngắt kết nối' })).toBeVisible();
  await expect(connectButton(page)).toHaveCount(0);

  // Lỗi, đang thử lại: badge cảnh báo kèm lý do.
  state.connection = connection({ status: 'retrying', lastErrorCode: 'rate_limited' });
  await page.reload();
  await expect(badge).toHaveText('Lỗi, đang thử lại');
  await expect(badge).toHaveAttribute('data-tone', 'warning');
  await expect(section(page).locator('[data-slot="google-sheets-error"]')).toHaveText('Google đang giới hạn số lần ghi.');

  // Mất quyền.
  state.connection = connection({ status: 'auth_revoked', lastErrorCode: 'invalid_grant', connectedByName: null });
  await page.reload();
  await expect(badge).toHaveText('Mất quyền');
  await expect(badge).toHaveAttribute('data-tone', 'danger');
  await expect(section(page).locator('[data-slot="google-sheets-connected-by"]')).toHaveText(
    'Kết nối bởi một thành viên của BTC',
  );

  // Mất quyền trước khi kịp tạo Sheet: không có link, không quay "Đang tạo Sheet…".
  state.connection = connection({ status: 'auth_revoked', lastErrorCode: 'forbidden', spreadsheetUrl: null, lastSyncedAt: null });
  await page.reload();
  await expect(badge).toHaveText('Mất quyền');
  await expect(section(page).locator('[data-slot="google-sheets-creating"]')).toHaveCount(0);
  await expect(section(page).getByRole('link', { name: /Mở Google Sheet/ })).toHaveCount(0);

  // Đang đồng bộ, chưa có link: "Đang tạo Sheet…", không có link.
  state.connection = connection({ status: 'syncing', spreadsheetUrl: null, lastSyncedAt: null });
  await page.reload();
  await expect(badge).toHaveText('Đang đồng bộ');
  await expect(badge).toHaveAttribute('data-tone', 'neutral');
  await expect(section(page).locator('[data-slot="google-sheets-creating"]')).toHaveText('Đang tạo Sheet…');
  await expect(section(page).getByRole('link', { name: /Mở Google Sheet/ })).toHaveCount(0);
  await expect(section(page).locator('[data-slot="google-sheets-last-synced"]')).toHaveText(
    'Đang đẩy các Đơn hiện có lên Sheet.',
  );
});

const KEPT_CHANGES = 'Thay đổi trong lúc mất quyền được giữ lại và ghi lên Sheet khi kết nối lại.';
const reconnectButton = (page: Page) => section(page).getByRole('button', { name: 'Kết nối lại' });

test('mất quyền (Story 6.6): nút chính "Kết nối lại", lý do, câu giữ dòng bẩn; vẫn mở Sheet và ngắt kết nối được', async ({
  page,
}) => {
  const { state } = await openApi(page, { connection: connection({ status: 'auth_revoked', lastErrorCode: 'invalid_grant' }) });
  await page.goto(settings);
  await expect(section(page).locator('[data-slot="status-badge"]')).toHaveText('Mất quyền');
  await expect(section(page).locator('[data-slot="google-sheets-error"]')).toHaveText(
    'Quyền truy cập Google Drive đã bị thu hồi.',
  );
  await expect(section(page).locator('[data-slot="google-sheets-kept-changes"]')).toHaveText(KEPT_CHANGES);
  const reconnect = reconnectButton(page);
  await expect(reconnect).toBeVisible();
  // Hành động chính của mục: nút nền đậm (không phải kiểu viền), "Kết nối Google Sheets" không hiện.
  await expect(reconnect).not.toHaveClass(/bg-card/);
  await expect(connectButton(page)).toHaveCount(0);
  await expect(section(page).getByRole('link', { name: /Mở Google Sheet/ })).toHaveAttribute('href', SHEET_URL);
  const disconnect = section(page).getByRole('button', { name: 'Ngắt kết nối' });
  await expect(disconnect).toBeVisible();
  await expect(disconnect).toHaveClass(/bg-card/);

  // Người cấp rời BTC, chưa có Sheet: lý do riêng, vẫn kết nối lại được, không có link.
  state.connection = connection({
    status: 'auth_revoked',
    lastErrorCode: 'grantor_removed',
    connectedByName: null,
    spreadsheetUrl: null,
    lastSyncedAt: null,
  });
  await page.reload();
  await expect(section(page).locator('[data-slot="google-sheets-error"]')).toHaveText('Người kết nối đã rời BTC.');
  await expect(section(page).locator('[data-slot="google-sheets-kept-changes"]')).toHaveText(KEPT_CHANGES);
  await expect(reconnectButton(page)).toBeVisible();
  await expect(section(page).getByRole('link', { name: /Mở Google Sheet/ })).toHaveCount(0);
  await expect(section(page).locator('[data-slot="google-sheets-creating"]')).toHaveCount(0);

  // Trạng thái khác không có "Kết nối lại" hay câu giữ dòng bẩn.
  state.connection = connection();
  await page.reload();
  await expect(section(page).locator('[data-slot="status-badge"]')).toHaveText('Đã kết nối');
  await expect(reconnectButton(page)).toHaveCount(0);
  await expect(section(page).locator('[data-slot="google-sheets-kept-changes"]')).toHaveCount(0);
});

test('bấm "Kết nối lại": spinner, chặn bấm lặp, POST connect rồi chuyển tới URL ủy quyền', async ({ page }) => {
  let release!: () => void;
  const { calls } = await openApi(page, {
    connection: connection({ status: 'auth_revoked', lastErrorCode: 'invalid_grant' }),
    holdConnect: new Promise((resolve) => (release = resolve)),
  });
  const visited = await blockGoogle(page);
  await page.goto(settings);
  const button = reconnectButton(page);
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await button.click({ force: true });
  release();
  await page.waitForURL(AUTH_URL);
  expect(callsTo(calls, 'POST', `${sheetsPath}/connect`)).toHaveLength(1);
  expect(visited).toEqual([AUTH_URL]);
});

test('"Kết nối lại" khi người khác vừa kết nối lại (409): toast, tải lại thấy "Đã kết nối", không rời trang', async ({ page }) => {
  const { state } = await openApi(page, {
    connection: connection({ status: 'auth_revoked', lastErrorCode: 'invalid_grant' }),
    connectError: { status: 409, code: 'SHEETS_ALREADY_CONNECTED' },
  });
  const visited = await blockGoogle(page);
  await page.goto(settings);
  await expect(reconnectButton(page)).toBeVisible();
  state.connection = connection();
  await reconnectButton(page).click();
  await expect(page.getByText('Sự kiện này đã kết nối Google Sheets.')).toBeVisible();
  await expect(section(page).locator('[data-slot="status-badge"]')).toHaveText('Đã kết nối');
  await expect(reconnectButton(page)).toHaveCount(0);
  expect(visited).toEqual([]);
});

test('đang đồng bộ: tải lại mỗi 3 giây tới khi Sheet sẵn sàng, rồi thôi', async ({ page }) => {
  const { calls, state } = await openApi(page, {
    connection: connection({ status: 'syncing', spreadsheetUrl: null, lastSyncedAt: null }),
  });
  await page.goto(settings);
  await expect(section(page).locator('[data-slot="google-sheets-creating"]')).toBeVisible();
  const before = callsTo(calls, 'GET', sheetsPath).length;
  state.connection = connection();
  await expect(section(page).getByRole('link', { name: /Mở Google Sheet/ })).toBeVisible({ timeout: 8_000 });
  await expect(section(page).locator('[data-slot="status-badge"]')).toHaveText('Đã kết nối');
  expect(callsTo(calls, 'GET', sheetsPath).length).toBeGreaterThan(before);
  // Đã active: không tải lại theo nhịp nữa.
  const settled = callsTo(calls, 'GET', sheetsPath).length;
  await page.waitForTimeout(3_500);
  expect(callsTo(calls, 'GET', sheetsPath).length).toBe(settled);
});

test('ngắt kết nối: Dialog nêu hậu quả; "Giữ kết nối" không gọi api; xác nhận → DELETE, spinner, toast, về "chưa kết nối"', async ({
  page,
}) => {
  let release!: () => void;
  const { calls } = await openApi(page, {
    connection: connection(),
    holdDelete: new Promise((resolve) => (release = resolve)),
  });
  await page.goto(settings);

  await section(page).getByRole('button', { name: 'Ngắt kết nối' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Ngắt kết nối Google Sheets?' })).toBeVisible();
  await expect(dialog).toContainText('Tickee sẽ dừng đồng bộ Đơn sang Sheet.');
  await expect(dialog).toContainText('Sheet giữ nguyên trong Google Drive, không bị xóa');
  await expect(dialog).toContainText('Kết nối lại sau này sẽ tạo một Sheet mới.');
  await dialog.getByRole('button', { name: 'Giữ kết nối' }).click();
  await expect(dialog).toHaveCount(0);
  expect(callsTo(calls, 'DELETE', sheetsPath)).toEqual([]);

  await section(page).getByRole('button', { name: 'Ngắt kết nối' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Ngắt kết nối' });
  await confirm.click();
  await expect(confirm).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(page.getByText('Đã ngắt kết nối Google Sheets. Sheet vẫn còn trong Google Drive.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(connectButton(page)).toBeVisible();
  expect(callsTo(calls, 'DELETE', sheetsPath)).toHaveLength(1);
});

test('ngắt kết nối khi người khác vừa ngắt (404 SHEETS_NOT_CONNECTED): toast, Dialog đóng, mục về "chưa kết nối"', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { connection: connection() });
  await page.goto(settings);
  await expect(section(page).locator('[data-slot="status-badge"]')).toHaveText('Đã kết nối');
  state.connection = null;
  await section(page).getByRole('button', { name: 'Ngắt kết nối' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ngắt kết nối' }).click();
  await expect(page.getByText('Kết nối Google Sheets này đã được ngắt.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(connectButton(page)).toBeVisible();
  await expect(page.getByText('Chưa ngắt kết nối được')).toHaveCount(0);
  expect(callsTo(calls, 'DELETE', sheetsPath)).toHaveLength(1);
});

test('ngắt kết nối lỗi 500: Dialog giữ nguyên kèm banner lỗi, kết nối vẫn còn', async ({ page }) => {
  const { calls } = await openApi(page, { connection: connection(), failDelete: true });
  await page.goto(settings);
  await section(page).getByRole('button', { name: 'Ngắt kết nối' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ngắt kết nối' }).click();
  await expect(page.getByRole('dialog').getByText('Chưa ngắt kết nối được')).toBeVisible();
  expect(callsTo(calls, 'DELETE', sheetsPath)).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Giữ kết nối' }).click();
  await expect(section(page).locator('[data-slot="status-badge"]')).toHaveText('Đã kết nối');
});

for (const [notice, message] of [
  ['sheets-connected', 'Đã kết nối Google Sheets. Tickee đang tạo Sheet và đẩy các Đơn hiện có.'],
  ['sheets-denied', 'Bạn chưa cho phép Tickee truy cập Google Drive nên chưa kết nối Google Sheets.'],
  ['sheets-failed', 'Chưa kết nối được Google Sheets. Vui lòng thử lại.'],
  ['sheets-already-connected', 'Sự kiện này đã kết nối Google Sheets.'],
  ['sheets-reconnected', 'Đã kết nối lại Google Sheets.'],
] as const) {
  test(`quay về từ callback (?notice=${notice}): toast, ở tab Cài đặt, xóa notice khỏi URL`, async ({ page }) => {
    await openApi(page, {
      connection:
        notice === 'sheets-connected'
          ? connection({ status: 'syncing', spreadsheetUrl: null, lastSyncedAt: null })
          : notice === 'sheets-reconnected'
            ? connection({ status: 'syncing' })
            : null,
    });
    await page.goto(`${settings}&notice=${notice}`);
    await expect(page.getByText(message)).toBeVisible();
    await expect(page).toHaveURL(`${WEB_ORIGIN}${settings}`);
    await expect(page.getByRole('tab', { name: 'Cài đặt' })).toHaveAttribute('aria-selected', 'true');
    await expect(section(page)).toBeVisible();
  });
}

for (const width of [375, 320]) {
  test(`${width}px: mục Google Sheets đã kết nối không cuộn ngang`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openApi(page, {
      connection: connection({
        connectedByName: 'Nguyễn Thị Phương Thảo Hoàng Bảo Ngọc Khánh Linh',
        status: 'retrying',
        lastErrorCode: 'unexpected_response',
      }),
    });
    await page.goto(settings);
    await expect(section(page).getByRole('link', { name: /Mở Google Sheet/ })).toBeVisible();
    await section(page).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
