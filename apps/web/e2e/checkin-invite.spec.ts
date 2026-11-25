import type { Page } from '@playwright/test';

import { checkinEvent, mockCheckinApi } from './checkin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Tab Check-in của Sự kiện (Story 5.1): khối "Link mời CTV"; thẻ "Màn quét" với "Mở Màn quét" (Story 5.2). API giả có trạng thái, luật như server: `GET …/checker-invite`
 * trả link mới nhất (không token), `POST` thu hồi link cũ rồi tạo link mới kèm token (nháp → 409 EVENT_STATUS_CONFLICT,
 * đã hủy → 409 EVENT_CANCELLED, đã kết thúc → 409 EVENT_ALREADY_ENDED). Link đầy đủ chỉ có ngay sau khi tạo (token trong
 * bộ nhớ): chuyển tab vẫn sao chép được, tải lại thì "Sao chép link" tắt kèm lý do.
 *
 * Story 5.6: khối "CTV soát vé". `GET …/checkers` trả CTV theo lúc nhận; `POST …/checkers/:id/{revoke,restore}` đổi
 * trạng thái (đã ở trạng thái đích → 204 như thường; CTV lạ → 404 NOT_FOUND; khôi phục khi đã kết thúc → 409
 * EVENT_ALREADY_ENDED).
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const EVENT_NAME = 'Giải chạy Hà Nội 2026';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const SCAN_PATH = `/events/${EVENT_ID}`;
const checkinTab = `${base}?tab=check-in`;
const eventPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const invitePath = `${eventPath}/checker-invite`;

/** Hạn mọi link API giả tạo (Sự kiện còn xa mới kết thúc). */
const EXPIRES_AT = '2099-11-09T10:04:00+07:00';
const EXPIRY_TEXT = 'Hết hạn lúc 10:04 09/11/2099 (giờ Việt Nam)';
const FAR_END = '2099-11-16T23:59:59+07:00';

const NO_TOKEN_REASON = 'Link đầy đủ chỉ hiện ngay sau khi tạo. Tạo link mới để có link gửi đi.';
const CONSEQUENCES = 'Link cũ hết hiệu lực ngay. CTV đã nhận lời mời vẫn giữ quyền.';

const inviteId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
/** Token base64url 22 ký tự thứ `n`. */
const token = (n: number) => `AbCdEfGhIjKlMnOpQrSt-${String.fromCharCode(64 + n)}`;

type Status = 'draft' | 'published' | 'hidden' | 'cancelled';
type Invite = { id: string; createdAt: string; expiresAt: string; active: boolean };
type Checker = {
  id: string;
  name: string | null;
  email: string | null;
  acceptedAt: string;
  status: 'active' | 'revoked';
  revokedAt: string | null;
};
type State = {
  status: Status;
  /** Đã bấm "Kết thúc": cũng là `effectiveEndAt`. */
  endedManuallyAt: string | null;
  /** Link mới nhất trước (đã có sẵn trước khi mở trang, hoặc API giả vừa tạo). */
  invites: Invite[];
  created: number;
  /** Chặn phản hồi `POST` tới khi promise xong. */
  holdCreate?: Promise<void>;
  /** `POST` trả 500. */
  failCreate?: boolean;
  /** CTV của Sự kiện, theo lúc nhận (Story 5.6). */
  checkers: Checker[];
  /** `GET …/checkers` trả 500. */
  failList?: boolean;
  /** Thu hồi / khôi phục trả 500. */
  failAction?: boolean;
};

const eventOf = (state: State) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: 'giai-chay-ha-noi-2026-c4d5',
  name: EVENT_NAME,
  status: state.status,
  startsAt: '2020-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  effectiveEndAt: state.endedManuallyAt ?? FAR_END,
  endedManuallyAt: state.endedManuallyAt,
  venue: 'Hồ Gươm',
  description: null,
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
  imageKey: null,
  imageUrl: null,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

const checkerId = (n: number) => `019a3b2c-0c00-7abc-8def-${String(n).padStart(12, '0')}`;
const checkersPath = `${eventPath}/checkers`;
const actionPath = (id: string, action: 'revoke' | 'restore') => `${checkersPath}/${id}/${action}`;

/** CTV có tên, đang hoạt động. */
const BINH: Checker = {
  id: checkerId(1),
  name: 'Trần Thị Bình',
  email: 'binh@vidu.vn',
  acceptedAt: '2026-11-22T10:04:00+07:00',
  status: 'active',
  revokedAt: null,
};
/** CTV đăng nhập OTP (không tên), đã bị thu hồi. */
const CUONG: Checker = {
  id: checkerId(2),
  name: null,
  email: 'cuong.le@vidu.vn',
  acceptedAt: '2026-11-22T11:30:00+07:00',
  status: 'revoked',
  revokedAt: '2026-11-23T08:00:00+07:00',
};
/** Tài khoản không còn. */
const GHOST: Checker = {
  id: checkerId(3),
  name: null,
  email: null,
  acceptedAt: '2026-11-23T09:15:00+07:00',
  status: 'active',
  revokedAt: null,
};

/** Luật thu hồi / khôi phục như server, trên `state.checkers`. */
function checkerAction(state: State, id: string, action: 'revoke' | 'restore'): Reply {
  if (state.failAction) return apiError(500, 'INTERNAL_ERROR');
  const checker = state.checkers.find((c) => c.id === id);
  if (!checker) return apiError(404, 'NOT_FOUND');
  if (action === 'restore' && state.endedManuallyAt) return apiError(409, 'EVENT_ALREADY_ENDED');
  if (action === 'revoke' && checker.status === 'active') {
    checker.status = 'revoked';
    checker.revokedAt = '2026-11-24T09:00:00+07:00';
  }
  if (action === 'restore' && checker.status === 'revoked') {
    checker.status = 'active';
    checker.revokedAt = null;
  }
  return { status: 204 };
}

async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ calls: Call[]; state: State }> {
  const state: State = {
    status: 'published',
    endedManuallyAt: null,
    invites: [],
    created: 0,
    ...initial,
    // Bản sao: API giả đổi trạng thái CTV tại chỗ, không được chạm hằng dùng chung giữa các test.
    checkers: (initial.checkers ?? []).map((checker) => ({ ...checker })),
  };
  // Mỗi CTV có lúc mở trang (kể cả CTV đã bị xóa khỏi danh sách giữa chừng) có route thu hồi / khôi phục.
  const actionHandlers: Record<string, Handler> = {};
  for (const { id } of state.checkers) {
    for (const action of ['revoke', 'restore'] as const) {
      actionHandlers[`POST ${actionPath(id, action)}`] = () => checkerAction(state, id, action);
    }
  }
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] }),
    [`GET ${eventPath}`]: () => ({ status: 200, body: eventOf(state) }),
    [`GET ${invitePath}`]: () => ({ status: 200, body: { invite: state.invites[0] ?? null } }),
    [`POST ${invitePath}`]: async () => {
      if (state.holdCreate) await state.holdCreate;
      if (state.failCreate) return apiError(500, 'INTERNAL_ERROR');
      if (state.status === 'cancelled') return apiError(409, 'EVENT_CANCELLED');
      if (state.status === 'draft') return apiError(409, 'EVENT_STATUS_CONFLICT', { status: state.status });
      if (state.endedManuallyAt) return apiError(409, 'EVENT_ALREADY_ENDED');
      state.created += 1;
      state.invites = state.invites.map((i) => ({ ...i, active: false }));
      const invite = { id: inviteId(state.created), createdAt: '2026-11-22T10:04:00+07:00', expiresAt: EXPIRES_AT, active: true };
      state.invites.unshift(invite);
      return { status: 201, body: { invite, token: token(state.created) } };
    },
    [`GET ${checkersPath}`]: () =>
      state.failList ? apiError(500, 'INTERNAL_ERROR') : { status: 200, body: { checkers: state.checkers } },
    ...actionHandlers,
  };
  const calls = await mockOrganizerApi(page, handlers);
  return { calls, state };
}

const block = (page: Page) => page.locator('[data-slot="checker-invite"]');
const scanCard = (page: Page) => page.locator('[data-slot="scan-screen-card"]');
const scanLink = (page: Page) => scanCard(page).getByRole('link', { name: 'Mở Màn quét' });
const copyButton = (page: Page) => block(page).getByRole('button', { name: 'Sao chép link' });
const createButton = (page: Page) => block(page).getByRole('button', { name: 'Tạo link mới' });
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === invitePath);
const linkOf = (page: Page, n: number) => `${new URL(page.url()).origin}/loi-moi-ctv#${token(n)}`;

test('tạo lần đầu không hỏi (spinner, không gửi lặp) → link đầy đủ, "Sao chép link" (toast "Đã sao chép"); chuyển tab vẫn sao chép được; tải lại thì tắt kèm lý do', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let release = () => {};
  const { calls, state } = await openApi(page, { holdCreate: new Promise<void>((resolve) => (release = resolve)) });
  await page.goto(checkinTab);
  await expect(page.getByRole('tab', { name: 'Check-in' })).toHaveAttribute('aria-selected', 'true');
  await expect(block(page).getByRole('heading', { name: 'Link mời CTV' })).toBeVisible();
  await expect(block(page).locator('[data-slot="checker-invite-empty"]')).toHaveText('Chưa có link mời');
  await expect(copyButton(page)).toHaveCount(0);
  await expect(page.getByText('Sắp có', { exact: true })).toHaveCount(0);

  await createButton(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(createButton(page)).toHaveAttribute('aria-busy', 'true');
  await createButton(page).click({ force: true });
  release();
  await expect(page.getByText('Đã tạo link mời CTV mới.')).toBeVisible();
  expect(posts(calls)).toHaveLength(1);
  state.holdCreate = undefined;

  await expect(block(page).locator('[data-slot="status-badge"]')).toHaveText('Còn hạn');
  await expect(block(page).locator('[data-slot="checker-invite-expiry"]')).toHaveText(EXPIRY_TEXT);
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveText(linkOf(page, 1));
  await copyButton(page).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(linkOf(page, 1));

  // Chuyển tab trong app: token vẫn trong bộ nhớ.
  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await page.waitForURL((url) => url.pathname === base && url.search === '');
  await page.getByRole('tab', { name: 'Check-in' }).click();
  await page.waitForURL((url) => url.search === '?tab=check-in');
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveText(linkOf(page, 1));
  await expect(copyButton(page)).toBeEnabled();

  // Tải lại: link vẫn còn hạn nhưng không còn link đầy đủ.
  await page.reload();
  await expect(block(page).locator('[data-slot="status-badge"]')).toHaveText('Còn hạn');
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveCount(0);
  await expect(copyButton(page)).toBeDisabled();
  await expect(block(page).getByText(NO_TOKEN_REASON)).toBeVisible();
  await expect(copyButton(page)).toHaveAccessibleDescription(NO_TOKEN_REASON);
  expect(posts(calls)).toHaveLength(1);
});

test('đã có link còn hạn: "Tạo link mới" mở Dialog nêu hậu quả; "Hủy" không gọi api; xác nhận → link mới sao chép được', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const existing = { id: inviteId(90), createdAt: '2026-11-21T09:00:00+07:00', expiresAt: EXPIRES_AT, active: true };
  const { calls } = await openApi(page, { invites: [existing] });
  await page.goto(checkinTab);
  await expect(block(page).locator('[data-slot="status-badge"]')).toHaveText('Còn hạn');
  await expect(block(page).locator('[data-slot="checker-invite-expiry"]')).toHaveText(EXPIRY_TEXT);
  await expect(copyButton(page)).toBeDisabled();
  await expect(block(page).getByText(NO_TOKEN_REASON)).toBeVisible();

  await createButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Tạo link mới?' })).toBeVisible();
  await expect(dialog.getByText(CONSEQUENCES, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts(calls)).toEqual([]);

  await createButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tạo link mới' }).click();
  await expect(page.getByText('Đã tạo link mời CTV mới.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(posts(calls)).toHaveLength(1);
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveText(linkOf(page, 1));
  await expect(block(page).getByText(NO_TOKEN_REASON)).toHaveCount(0);
  await copyButton(page).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(linkOf(page, 1));
});

test('tạo lại qua Dialog lỗi 500: Dialog giữ mở kèm banner lỗi, không có banner trong khối; xác nhận lại thì tạo được', async ({
  page,
}) => {
  const existing = { id: inviteId(90), createdAt: '2026-11-21T09:00:00+07:00', expiresAt: EXPIRES_AT, active: true };
  const { calls, state } = await openApi(page, { invites: [existing], failCreate: true });
  await page.goto(checkinTab);
  await createButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Tạo link mới' }).click();
  const banner = dialog.locator('[data-slot="status-banner"]');
  await expect(banner).toContainText('Chưa tạo được link mời');
  await expect(banner).toContainText('Lỗi giả lập');
  await expect(dialog.getByRole('heading', { name: 'Tạo link mới?' })).toBeVisible();
  await expect(block(page).locator('[data-slot="status-banner"]')).toHaveCount(0);
  expect(posts(calls)).toHaveLength(1);

  state.failCreate = false;
  await dialog.getByRole('button', { name: 'Tạo link mới' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveText(linkOf(page, 1));
  await expect(block(page).locator('[data-slot="status-banner"]')).toHaveCount(0);
  expect(posts(calls)).toHaveLength(2);
});

test('Admin khác vừa tạo link mới (GET trả link khác id): không còn link đầy đủ, "Sao chép link" tắt kèm lý do', async ({
  page,
}) => {
  const { calls, state } = await openApi(page);
  await page.goto(checkinTab);
  await createButton(page).click();
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveText(linkOf(page, 1));

  // Link của trang này bị thu hồi; link mới nhất là của người khác (token không có ở trình duyệt này).
  const newer = { id: inviteId(99), createdAt: '2026-11-22T11:00:00+07:00', expiresAt: EXPIRES_AT, active: true };
  state.invites = [newer, ...state.invites.map((i) => ({ ...i, active: false }))];
  const gets = () => calls.filter((c) => c.method === 'GET' && c.path === invitePath).length;
  const before = gets();
  // Quá `staleTime` (30s) rồi quay lại tab → TanStack Query tải lại link.
  await page.clock.setFixedTime(Date.now() + 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(gets).toBeGreaterThan(before);

  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveCount(0);
  await expect(block(page).locator('[data-slot="status-badge"]')).toHaveText('Còn hạn');
  await expect(copyButton(page)).toBeDisabled();
  await expect(copyButton(page)).toHaveAccessibleDescription(NO_TOKEN_REASON);
});

test('Sự kiện đã kết thúc: link cũ "Đã hết hạn" kèm thời điểm (mốc kết thúc), hai nút tắt kèm lý do, không gọi api', async ({
  page,
}) => {
  const ended = '2026-11-20T08:30:00+07:00';
  const old = { id: inviteId(91), createdAt: '2026-11-19T09:00:00+07:00', expiresAt: ended, active: false };
  const { calls } = await openApi(page, { endedManuallyAt: ended, invites: [old] });
  await page.goto(checkinTab);
  await expect(block(page).locator('[data-slot="status-badge"]')).toHaveText('Đã hết hạn');
  await expect(block(page).locator('[data-slot="checker-invite-expiry"]')).toHaveText(
    'Hết hạn lúc 08:30 20/11/2026 (giờ Việt Nam)',
  );
  const createReason = 'Sự kiện đã kết thúc, không tạo được link mời mới.';
  await expect(createButton(page)).toBeDisabled();
  await expect(block(page).getByText(createReason)).toBeVisible();
  await expect(createButton(page)).toHaveAccessibleDescription(createReason);
  await expect(copyButton(page)).toBeDisabled();
  await expect(block(page).getByText('Link đã hết hạn.', { exact: true })).toBeVisible();
  expect(posts(calls)).toEqual([]);
});

test('Sự kiện nháp: "Tạo link mới" tắt kèm lý do "Đăng Sự kiện trước khi mời CTV."', async ({ page }) => {
  const { calls } = await openApi(page, { status: 'draft' });
  await page.goto(checkinTab);
  await expect(block(page).locator('[data-slot="checker-invite-empty"]')).toHaveText('Chưa có link mời');
  await expect(createButton(page)).toBeDisabled();
  await expect(block(page).getByText('Đăng Sự kiện trước khi mời CTV.', { exact: true })).toBeVisible();
  expect(posts(calls)).toEqual([]);
});

test('tạo link lỗi 500: banner "Chưa tạo được link mời"; bấm lại tạo được', async ({ page }) => {
  const { calls, state } = await openApi(page, { failCreate: true });
  await page.goto(checkinTab);
  await createButton(page).click();
  const banner = block(page).locator('[data-slot="status-banner"]');
  await expect(banner).toContainText('Chưa tạo được link mời');
  await expect(banner).toContainText('Lỗi giả lập');
  await expect(block(page).locator('[data-slot="checker-invite-empty"]')).toBeVisible();

  state.failCreate = false;
  await createButton(page).click();
  await expect(block(page).locator('[data-slot="checker-invite-url"]')).toHaveText(linkOf(page, 1));
  await expect(banner).toHaveCount(0);
  expect(posts(calls)).toHaveLength(2);
});

test('Sự kiện vừa kết thúc ở server (409 EVENT_ALREADY_ENDED): toast, tải lại Sự kiện → nút tắt kèm lý do', async ({ page }) => {
  const { state } = await openApi(page);
  await page.goto(checkinTab);
  await expect(createButton(page)).toBeEnabled();
  state.endedManuallyAt = '2026-11-20T08:30:00+07:00';
  await createButton(page).click();
  await expect(page.getByText('Trạng thái Sự kiện vừa đổi. Đã tải lại.')).toBeVisible();
  await expect(createButton(page)).toBeDisabled();
  await expect(block(page).getByText('Sự kiện đã kết thúc, không tạo được link mời mới.')).toBeVisible();
  await expect(block(page).locator('[data-slot="status-banner"]')).toHaveCount(0);
});

test('thẻ "Màn quét" đứng trước khối link mời, khối "CTV soát vé" sau cùng; "Mở Màn quét" mở Màn quét của Sự kiện (Owner/Admin không cần lời mời)', async ({
  page,
}) => {
  await openApi(page);
  const calls = await mockCheckinApi(page, { [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME) });
  await page.goto(checkinTab);
  await expect(scanCard(page).getByRole('heading', { name: 'Màn quét' })).toBeVisible();
  const order = await page
    .locator('[data-slot="checkin-tab"] > section')
    .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-slot')));
  expect(order).toEqual(['scan-screen-card', 'checker-invite', 'checker-list']);
  await expect(scanLink(page)).toHaveAttribute('href', SCAN_PATH);

  await scanLink(page).click();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  // Màn quét (Story 5.3) mở bằng màn "Bật camera".
  await expect(page.getByRole('button', { name: 'Bật camera' })).toBeVisible();
  expect(calls.filter((c) => c.path === `/checkin/events/${EVENT_ID}`).length).toBeGreaterThan(0);
});

const ANY_STATE: [string, Partial<State>][] = [
  ['nháp', { status: 'draft' }],
  ['đang ẩn', { status: 'hidden' }],
  ['đã kết thúc', { endedManuallyAt: '2026-11-20T08:30:00+07:00' }],
  ['đã hủy', { status: 'cancelled' }],
];
for (const [label, initial] of ANY_STATE) {
  test(`Sự kiện ${label}: vẫn có "Mở Màn quét" tới Màn quét của Sự kiện`, async ({ page }) => {
    await openApi(page, initial);
    await page.goto(checkinTab);
    await expect(scanLink(page)).toHaveAttribute('href', SCAN_PATH);
  });
}

test('320px: thẻ "Màn quét" không làm cuộn ngang, "Mở Màn quét" có vùng chạm ≥ 24px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await openApi(page);
  await page.goto(checkinTab);
  await expect(scanLink(page)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  const box = await scanLink(page).boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(24);
  expect(box?.height).toBeGreaterThanOrEqual(24);
});

// ---------------------------------------------------------------------------------------------------------------
// Khối "CTV soát vé" (Story 5.6)
// ---------------------------------------------------------------------------------------------------------------

const checkerList = (page: Page) => page.locator('[data-slot="checker-list"]');
const checkerRows = (page: Page) => checkerList(page).locator('[data-slot="checker-row"]');
const rowOf = (page: Page, name: string) => checkerRows(page).filter({ hasText: name });
const actionsTo = (calls: Call[], id: string, action: 'revoke' | 'restore') =>
  calls.filter((c) => c.method === 'POST' && c.path === actionPath(id, action));

const REVOKE_TITLE = 'Thu hồi quyền soát vé của Trần Thị Bình?';
const REVOKE_CONSEQUENCES =
  'Trần Thị Bình không quét hay tra tay được nữa, có hiệu lực từ lượt quét kế tiếp. Link mời không cho người này nhận lại; bạn có thể khôi phục sau.';
const RESTORE_TITLE = 'Khôi phục quyền soát vé cho cuong.le@vidu.vn?';
const RESTORE_CONSEQUENCES = 'cuong.le@vidu.vn quét và tra tay lại được cho Sự kiện này tới khi Sự kiện kết thúc.';

test('danh sách CTV: theo lúc nhận; tên + email, "Nhận lúc" giờ Việt Nam, trạng thái, "Thu hồi"/"Khôi phục"; không tên → email; tài khoản không còn → "Tài khoản đã xóa"', async ({
  page,
}) => {
  await openApi(page, { checkers: [BINH, CUONG, GHOST] });
  await page.goto(checkinTab);
  await expect(checkerList(page).getByRole('heading', { name: 'CTV soát vé' })).toBeVisible();
  await expect(checkerRows(page)).toHaveCount(3);
  await expect(checkerRows(page).locator('[data-slot="checker-name"]')).toHaveText([
    'Trần Thị Bình',
    'cuong.le@vidu.vn',
    'Tài khoản đã xóa',
  ]);

  const binh = checkerRows(page).nth(0);
  await expect(binh.locator('[data-slot="checker-email"]')).toHaveText('binh@vidu.vn');
  await expect(binh.locator('[data-slot="checker-accepted"]')).toHaveText('Nhận lúc 10:04 22/11/2026');
  await expect(binh.locator('[data-slot="status-badge"]')).toHaveText('Đang hoạt động');
  await expect(binh.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');
  await expect(binh.getByRole('button', { name: 'Thu hồi' })).toHaveClass(/bg-destructive/);

  const cuong = checkerRows(page).nth(1);
  await expect(cuong.locator('[data-slot="checker-email"]')).toHaveCount(0);
  await expect(cuong.locator('[data-slot="checker-accepted"]')).toHaveText('Nhận lúc 11:30 22/11/2026');
  await expect(cuong.locator('[data-slot="status-badge"]')).toHaveText('Đã thu hồi');
  await expect(cuong.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
  await expect(cuong.getByRole('button', { name: 'Khôi phục' })).toBeEnabled();
  await expect(cuong.getByRole('button', { name: 'Khôi phục' })).toHaveClass(/bg-card/);

  const ghost = checkerRows(page).nth(2);
  await expect(ghost.locator('[data-slot="checker-email"]')).toHaveCount(0);
  await expect(ghost.getByRole('button', { name: 'Thu hồi' })).toBeEnabled();
});

test('chưa có CTV: "Chưa có CTV nào nhận lời mời."', async ({ page }) => {
  await openApi(page);
  await page.goto(checkinTab);
  await expect(checkerList(page).locator('[data-slot="checker-list-empty"]')).toHaveText('Chưa có CTV nào nhận lời mời.');
  await expect(checkerRows(page)).toHaveCount(0);
});

test('lỗi tải danh sách: dải lỗi kèm "Thử lại" → danh sách', async ({ page }) => {
  const { state } = await openApi(page, { checkers: [BINH], failList: true });
  await page.goto(checkinTab);
  const banner = checkerList(page).locator('[data-slot="status-banner"]');
  // Lỗi 5xx được thử lại 2 lần trước khi báo.
  await expect(banner).toContainText('Chưa tải được danh sách CTV', { timeout: 15_000 });
  state.failList = false;
  await banner.getByRole('button', { name: 'Thử lại' }).click();
  await expect(checkerRows(page)).toHaveCount(1);
  await expect(banner).toHaveCount(0);
});

test('"Thu hồi": Dialog nêu hậu quả, nút destructive; "Hủy" không gọi api; xác nhận → toast, hàng giữ chỗ thành "Đã thu hồi" + "Khôi phục"', async ({
  page,
}) => {
  const { calls } = await openApi(page, { checkers: [BINH, CUONG] });
  await page.goto(checkinTab);
  await rowOf(page, 'Trần Thị Bình').getByRole('button', { name: 'Thu hồi' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: REVOKE_TITLE })).toBeVisible();
  await expect(dialog.getByText(REVOKE_CONSEQUENCES, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Thu hồi', exact: true })).toHaveClass(/bg-destructive/);
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toHaveCount(0);
  expect(actionsTo(calls, BINH.id, 'revoke')).toEqual([]);

  await rowOf(page, 'Trần Thị Bình').getByRole('button', { name: 'Thu hồi' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Thu hồi', exact: true }).click();
  await expect(page.getByText('Đã thu hồi quyền soát vé của Trần Thị Bình.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(actionsTo(calls, BINH.id, 'revoke')).toHaveLength(1);
  await expect(checkerRows(page).nth(0).locator('[data-slot="status-badge"]')).toHaveText('Đã thu hồi');
  await expect(checkerRows(page).nth(0).getByRole('button', { name: 'Khôi phục' })).toBeVisible();
  await expect(checkerRows(page).locator('[data-slot="checker-name"]')).toHaveText(['Trần Thị Bình', 'cuong.le@vidu.vn']);
});

test('"Khôi phục": Dialog xác nhận thường (primary-on-light); xác nhận → toast, hàng "Đang hoạt động" + "Thu hồi"', async ({
  page,
}) => {
  const { calls } = await openApi(page, { checkers: [BINH, CUONG] });
  await page.goto(checkinTab);
  await rowOf(page, 'cuong.le@vidu.vn').getByRole('button', { name: 'Khôi phục' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: RESTORE_TITLE })).toBeVisible();
  await expect(dialog.getByText(RESTORE_CONSEQUENCES, { exact: true })).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Khôi phục', exact: true });
  await expect(confirm).toHaveClass(/bg-btn-on-light/);
  await confirm.click();
  await expect(page.getByText('Đã khôi phục quyền soát vé cho cuong.le@vidu.vn.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(actionsTo(calls, CUONG.id, 'restore')).toHaveLength(1);
  const row = checkerRows(page).nth(1);
  await expect(row.locator('[data-slot="status-badge"]')).toHaveText('Đang hoạt động');
  await expect(row.getByRole('button', { name: 'Thu hồi' })).toBeVisible();
});

test('Sự kiện đã kết thúc: "Khôi phục" tắt kèm lý do "Sự kiện đã kết thúc" (không gọi api); "Thu hồi" vẫn bấm được', async ({
  page,
}) => {
  const { calls } = await openApi(page, { endedManuallyAt: '2026-11-20T08:30:00+07:00', checkers: [BINH, CUONG] });
  await page.goto(checkinTab);
  const restore = rowOf(page, 'cuong.le@vidu.vn').getByRole('button', { name: 'Khôi phục' });
  await expect(restore).toBeDisabled();
  await expect(rowOf(page, 'cuong.le@vidu.vn').getByText('Sự kiện đã kết thúc', { exact: true })).toBeVisible();
  await expect(restore).toHaveAccessibleDescription('Sự kiện đã kết thúc');
  expect(actionsTo(calls, CUONG.id, 'restore')).toEqual([]);

  await rowOf(page, 'Trần Thị Bình').getByRole('button', { name: 'Thu hồi' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Thu hồi', exact: true }).click();
  await expect(page.getByText('Đã thu hồi quyền soát vé của Trần Thị Bình.')).toBeVisible();
  // Vừa thu hồi khi đã kết thúc: "Khôi phục" của hàng này cũng tắt.
  await expect(rowOf(page, 'Trần Thị Bình').getByRole('button', { name: 'Khôi phục' })).toBeDisabled();
});

test('Sự kiện vừa kết thúc ở server (409 EVENT_ALREADY_ENDED khi khôi phục): đóng Dialog, toast, tải lại Sự kiện → "Khôi phục" tắt kèm lý do', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { checkers: [CUONG] });
  await page.goto(checkinTab);
  const restore = rowOf(page, 'cuong.le@vidu.vn').getByRole('button', { name: 'Khôi phục' });
  await expect(restore).toBeEnabled();
  state.endedManuallyAt = '2026-11-20T08:30:00+07:00';
  await restore.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Khôi phục', exact: true }).click();
  await expect(page.getByText('Sự kiện đã kết thúc, không khôi phục được CTV. Đã tải lại.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expect(restore).toHaveAccessibleDescription('Sự kiện đã kết thúc');
  // Khối link mời đọc cùng Sự kiện vừa tải lại.
  await expect(createButton(page)).toBeDisabled();
  expect(actionsTo(calls, CUONG.id, 'restore')).toHaveLength(1);
});

test('CTV không còn ở server (404 khi thu hồi): đóng Dialog, toast, tải lại danh sách', async ({ page }) => {
  const { state } = await openApi(page, { checkers: [BINH, CUONG] });
  await page.goto(checkinTab);
  await expect(checkerRows(page)).toHaveCount(2);
  state.checkers = [CUONG];
  await rowOf(page, 'Trần Thị Bình').getByRole('button', { name: 'Thu hồi' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Thu hồi', exact: true }).click();
  await expect(page.getByText('CTV này không còn trong Sự kiện. Đã tải lại danh sách.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(checkerRows(page)).toHaveCount(1);
  await expect(checkerRows(page).locator('[data-slot="checker-name"]')).toHaveText(['cuong.le@vidu.vn']);
});

test('thu hồi lỗi 500: Dialog giữ mở kèm banner lỗi; xác nhận lại thì xong', async ({ page }) => {
  const { calls, state } = await openApi(page, { checkers: [BINH], failAction: true });
  await page.goto(checkinTab);
  await rowOf(page, 'Trần Thị Bình').getByRole('button', { name: 'Thu hồi' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Thu hồi', exact: true }).click();
  const banner = dialog.locator('[data-slot="status-banner"]');
  await expect(banner).toContainText('Chưa thu hồi được');
  await expect(banner).toContainText('Lỗi giả lập');
  await expect(dialog.getByRole('heading', { name: REVOKE_TITLE })).toBeVisible();

  state.failAction = false;
  await dialog.getByRole('button', { name: 'Thu hồi', exact: true }).click();
  await expect(page.getByText('Đã thu hồi quyền soát vé của Trần Thị Bình.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(actionsTo(calls, BINH.id, 'revoke')).toHaveLength(2);
});

test('320px: hàng CTV email dài không làm cuộn ngang, nút "Thu hồi" nằm trọn trong màn và có vùng chạm ≥ 24px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 667 });
  const long: Checker = {
    ...BINH,
    name: 'Nguyễn Thị Phương Thảo Hoàng Lê Minh Châu',
    email: 'nguyen.thi.phuong.thao.hoang.le.minh.chau.2026@congty-to-chuc-su-kien-rat-dai.vn',
  };
  await openApi(page, { checkers: [long, CUONG] });
  await page.goto(checkinTab);
  const row = checkerRows(page).first();
  await expect(row.locator('[data-slot="checker-email"]')).toHaveText(long.email!);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  const button = row.getByRole('button', { name: 'Thu hồi' });
  const box = (await button.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});
