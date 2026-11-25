import type { Page } from '@playwright/test';

import { CHECKIN_LIVE_URL, checkinEvent, mockCheckinApi, type TicketTypeProgress } from './checkin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, type Call, type Handler, type Reply } from './identity-mock';
import { fakeEventSource, setVisibility } from './live-mock';
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
 *
 * Story 5.7: khối `checkin-progress` đầu tab: `GET /checkin/events/:eventId` trả `state.checkin`, tự cập nhật qua SSE
 * `…/live` (giả bằng `EventSource` điều khiển được, hoặc 503 mặc định → polling 10 giây). Ca full-stack (stream thật,
 * quét → tín hiệu, lọc theo Sự kiện) ở test tích hợp api `test/checkin/checkin-live.test.ts`.
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
  /** `CheckinEvent` của khối `checkin-progress` (Story 5.7). */
  checkin: ReturnType<typeof progressBody>;
  /** Số lần `GET /checkin/events/:id` kế tiếp trả 500 (đếm lùi). */
  failCheckin: number;
  /** Phiên hết hạn ở lần tải số liệu check-in kế tiếp: lần đó và mọi `GET /identity/me` sau đó trả 401. */
  expireOnCheckin?: boolean;
  signedOut?: boolean;
};

const ticketTypeId = (n: number) => `019a3b2c-0e00-7abc-8def-${String(n).padStart(12, '0')}`;
/** Số check-in của Hạng vé thứ `n`. */
const tier = (n: number, name: string, checkedInCount: number, validTicketCount: number): TicketTypeProgress => ({
  ticketTypeId: ticketTypeId(n),
  name,
  checkedInCount,
  validTicketCount,
});
/** `CheckinEvent` như api: tổng là tổng các Hạng vé. */
function progressBody(ticketTypes: TicketTypeProgress[]) {
  const sum = (key: 'checkedInCount' | 'validTicketCount') => ticketTypes.reduce((total, t) => total + t[key], 0);
  return {
    eventId: EVENT_ID,
    eventName: EVENT_NAME,
    checkedInCount: sum('checkedInCount'),
    validTicketCount: sum('validTicketCount'),
    ticketTypes,
  };
}

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
/** Số liệu check-in của tab (Story 5.7): đường REST dùng chung với Màn quét. */
const checkinApi = `/checkin/events/${EVENT_ID}`;
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
    checkin: progressBody([]),
    failCheckin: 0,
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
  await mockIdentityApi(page, { 'GET /identity/me': () => (state.signedOut ? unauthenticated() : me(CONSENTED)) });
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
    [`GET ${checkinApi}`]: () => {
      if (state.expireOnCheckin || state.signedOut) {
        state.signedOut = true;
        return unauthenticated();
      }
      if (state.failCheckin > 0) {
        state.failCheckin -= 1;
        return apiError(500, 'INTERNAL_ERROR');
      }
      return { status: 200, body: state.checkin };
    },
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

test('khối checkin-progress đầu tab, rồi thẻ "Màn quét", khối link mời, khối "CTV soát vé" sau cùng; "Mở Màn quét" mở Màn quét của Sự kiện (Owner/Admin không cần lời mời)', async ({
  page,
}) => {
  await openApi(page);
  const calls = await mockCheckinApi(page, { [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME) });
  await page.goto(checkinTab);
  await expect(scanCard(page).getByRole('heading', { name: 'Màn quét' })).toBeVisible();
  const order = await page
    .locator('[data-slot="checkin-tab"] > section')
    .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-slot')));
  expect(order).toEqual(['checkin-progress', 'scan-screen-card', 'checker-invite', 'checker-list']);
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

// ---------------------------------------------------------------------------------------------------------------
// Khối `checkin-progress` (Story 5.7)
// ---------------------------------------------------------------------------------------------------------------

const progress = (page: Page) => page.locator('[data-slot="checkin-progress"]');
const progressValue = (page: Page) => progress(page).locator('[data-slot="stat-card-value"]');
const progressCaption = (page: Page) => progress(page).locator('[data-slot="checkin-progress-caption"]');
const totalBar = (page: Page) => progress(page).locator('[data-slot="stat-card"]').getByRole('progressbar');
const progressRows = (page: Page) => progress(page).locator('[data-slot="checkin-progress-row"]');
const checkinGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === checkinApi);
const checkinLiveGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === `${checkinApi}/live`);
/** Bề rộng phần đầy so với cả thanh (0–1). */
const fillRatio = (bar: ReturnType<Page['locator']>) =>
  bar.evaluate((el) => {
    const fill = el.querySelector('[data-slot="progress-bar-fill"]')!;
    return fill.getBoundingClientRect().width / el.getBoundingClientRect().width;
  });
const colorsOf = (bar: ReturnType<Page['locator']>) =>
  bar.evaluate((el) => ({
    track: getComputedStyle(el).backgroundColor,
    fill: getComputedStyle(el.querySelector('[data-slot="progress-bar-fill"]')!).backgroundColor,
  }));

/** Ba Hạng vé theo thứ tự api; "Vé mời" chưa có Vé hợp lệ nào. */
const TIERS = [tier(1, 'Vé thường', 30, 50), tier(2, 'Vé VIP', 11, 16), tier(3, 'Vé mời', 0, 0)];
/** "Bây giờ" của các ca cần nhãn giờ cố định: 25/11/2026 10:04 giờ Việt Nam. */
const NOW = new Date('2026-11-25T10:04:00+07:00');
const STALE_LABEL = /^Cập nhật lúc 10:04:\d{2}$/;

test('checkin-progress: stat-card "Check-in" k/N + thanh (stage-line/brand) + "Cập nhật liên tục"; mỗi Hạng vé một hàng theo thứ tự api trên card sáng (thanh text, dark: brand); Hạng vé chưa có Vé → 0/0, thanh rỗng; ARIA đọc được tên và k trên N', async ({
  page,
}) => {
  await openApi(page, { checkin: progressBody(TIERS) });
  await page.goto(checkinTab);
  await expect(progress(page).locator('[data-slot="stat-card-label"]')).toHaveText('Check-in');
  await expect(progressValue(page)).toHaveText('41/66');
  await expect(progressCaption(page)).toHaveText('Cập nhật liên tục');
  await expect(totalBar(page)).toHaveAttribute('aria-valuemin', '0');
  await expect(totalBar(page)).toHaveAttribute('aria-valuemax', '66');
  await expect(totalBar(page)).toHaveAttribute('aria-valuenow', '41');
  await expect(totalBar(page)).toHaveAccessibleName('Tổng đã check-in');
  await expect(totalBar(page)).toHaveAttribute('aria-valuetext', '41 trên 66 Vé đã check-in');
  expect(await fillRatio(totalBar(page))).toBeCloseTo(41 / 66, 1);
  expect(await colorsOf(totalBar(page))).toEqual({ track: 'rgb(42, 32, 35)', fill: 'rgb(255, 77, 106)' });

  await expect(progressRows(page).locator('[data-slot="checkin-progress-name"]')).toHaveText(['Vé thường', 'Vé VIP', 'Vé mời']);
  await expect(progressRows(page).locator('[data-slot="checkin-progress-count"]')).toHaveText(['30/50', '11/16', '0/0']);
  const vip = progress(page).getByRole('progressbar', { name: 'Vé VIP' });
  await expect(vip).toHaveAttribute('aria-valuemin', '0');
  await expect(vip).toHaveAttribute('aria-valuemax', '16');
  await expect(vip).toHaveAttribute('aria-valuenow', '11');
  await expect(vip).toHaveAttribute('aria-valuetext', '11 trên 16 Vé đã check-in');
  expect(await fillRatio(vip)).toBeCloseTo(11 / 16, 1);
  // Light: nền surface-sunken, phần đầy text.
  expect(await colorsOf(vip)).toEqual({ track: 'rgb(240, 235, 234)', fill: 'rgb(28, 25, 23)' });
  // Hạng vé chưa có Vé hợp lệ: "0/0", thanh rỗng (không chia cho 0).
  const empty = progress(page).getByRole('progressbar', { name: 'Vé mời' });
  await expect(empty).toHaveAttribute('aria-valuemax', '0');
  await expect(empty).toHaveAttribute('aria-valuenow', '0');
  expect(await fillRatio(empty)).toBe(0);
  // Số ở tab không đọc liên tục: không aria-live trên số.
  await expect(progressValue(page)).not.toHaveAttribute('aria-live');

  // Dark: phần đầy của thanh Hạng vé là brand.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(progressValue(page)).toHaveText('41/66');
  expect((await colorsOf(progress(page).getByRole('progressbar', { name: 'Vé VIP' }))).fill).toBe('rgb(255, 77, 106)');
});

test('checkin-progress: Sự kiện chưa có Vé nào → "0/0", thanh rỗng', async ({ page }) => {
  await openApi(page, { checkin: progressBody([tier(1, 'Vé thường', 0, 0)]) });
  await page.goto(checkinTab);
  await expect(progressValue(page)).toHaveText('0/0');
  await expect(totalBar(page)).toHaveAttribute('aria-valuemax', '0');
  expect(await fillRatio(totalBar(page))).toBe(0);
  await expect(progressRows(page).locator('[data-slot="checkin-progress-count"]')).toHaveText(['0/0']);
});

test('checkin-progress tự cập nhật: tín hiệu SSE → tải lại, tổng và hàng của đúng Hạng vé tăng, không tải lại trang', async ({
  page,
}) => {
  const sse = await fakeEventSource(page, { url: CHECKIN_LIVE_URL });
  const { state, calls } = await openApi(page, { checkin: progressBody(TIERS) });
  await page.goto(checkinTab);
  await expect(progressValue(page)).toHaveText('41/66');
  await expect.poll(sse.count).toBe(1);
  const info = await sse.info();
  expect(info.withCredentials).toBe(true);
  expect(info.url).toMatch(new RegExp(`/v1/checkin/events/${EVENT_ID}/live$`));

  const beforeOpen = checkinGets(calls).length;
  await sse.open();
  await expect.poll(() => checkinGets(calls).length).toBe(beforeOpen + 1);

  // CTV quét một Vé VIP ở cổng.
  state.checkin = progressBody([TIERS[0]!, tier(2, 'Vé VIP', 12, 16), TIERS[2]!]);
  await sse.message('event_checkins_changed');
  await expect(progressValue(page)).toHaveText('42/66', { timeout: 2_500 });
  await expect(progressRows(page).locator('[data-slot="checkin-progress-count"]')).toHaveText(['30/50', '12/16', '0/0']);
  await expect(progress(page).getByRole('progressbar', { name: 'Vé VIP' })).toHaveAttribute('aria-valuenow', '12');
  await expect(totalBar(page)).toHaveAttribute('aria-valuenow', '42');
  await expect(progressCaption(page)).toHaveText('Cập nhật liên tục');
  expect(await sse.count()).toBe(1);
});

test('checkin-progress không có SSE (503) → polling 10 giây; tab hiện lại → tải ngay', async ({ page }) => {
  test.setTimeout(45_000);
  const { state, calls } = await openApi(page, { checkin: progressBody(TIERS) });
  await page.goto(checkinTab);
  await expect(progressValue(page)).toHaveText('41/66');
  await expect.poll(() => checkinLiveGets(calls).length).toBeGreaterThanOrEqual(1);
  const start = checkinGets(calls).length;
  const startedAt = Date.now();

  state.checkin = progressBody([tier(1, 'Vé thường', 31, 50), TIERS[1]!, TIERS[2]!]);
  await page.waitForTimeout(7_000);
  expect(checkinGets(calls).length).toBe(start);
  await expect(progressValue(page)).toHaveText('42/66', { timeout: 8_000 });
  expect(checkinGets(calls).length).toBe(start + 1);
  expect(Date.now() - startedAt).toBeLessThan(13_000);

  // Tab hiện lại: tải ngay, không chờ nhịp polling kế tiếp.
  state.checkin = progressBody([tier(1, 'Vé thường', 32, 50), TIERS[1]!, TIERS[2]!]);
  const beforeVisible = checkinGets(calls).length;
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(progressValue(page)).toHaveText('43/66', { timeout: 2_000 });
  expect(checkinGets(calls).length).toBe(beforeVisible + 1);
});

test('checkin-progress: lần tải lại lỗi mà vẫn còn số cũ → giữ số + "Cập nhật lúc HH:MM:SS" (giờ Việt Nam); tải lại được → "Cập nhật liên tục"', async ({
  page,
}) => {
  await page.clock.install({ time: NOW });
  const sse = await fakeEventSource(page, { url: CHECKIN_LIVE_URL });
  const { state } = await openApi(page, { checkin: progressBody(TIERS) });
  await page.goto(checkinTab);
  await expect(progressValue(page)).toHaveText('41/66');
  await expect.poll(sse.count).toBe(1);
  await sse.open();

  // Mọi lần tải lại kế tiếp trả 500 (kể cả 2 lần thử lại).
  state.failCheckin = 10;
  state.checkin = progressBody([TIERS[0]!, tier(2, 'Vé VIP', 12, 16), TIERS[2]!]);
  await sse.message('event_checkins_changed');
  await expect(progressCaption(page)).toHaveText(STALE_LABEL, { timeout: 10_000 });
  await expect(progressValue(page)).toHaveText('41/66');
  await expect(progressRows(page)).toHaveCount(3);
  await expect(progress(page).locator('[data-slot="checkin-progress-error"]')).toHaveCount(0);

  state.failCheckin = 0;
  await sse.message('event_checkins_changed');
  await expect(progressValue(page)).toHaveText('42/66', { timeout: 5_000 });
  await expect(progressCaption(page)).toHaveText('Cập nhật liên tục');
});

test('checkin-progress mất mạng: giữ số + "Cập nhật lúc HH:MM:SS"; có mạng lại → tải lại, "Cập nhật liên tục"', async ({
  page,
}) => {
  await page.clock.install({ time: NOW });
  const { state, calls } = await openApi(page, { checkin: progressBody(TIERS) });
  await page.goto(checkinTab);
  await expect(progressValue(page)).toHaveText('41/66');
  await expect(progressCaption(page)).toHaveText('Cập nhật liên tục');

  await page.context().setOffline(true);
  await expect(progressCaption(page)).toHaveText(STALE_LABEL);
  await expect(progressValue(page)).toHaveText('41/66');
  const beforeOnline = checkinGets(calls).length;

  state.checkin = progressBody([tier(1, 'Vé thường', 31, 50), TIERS[1]!, TIERS[2]!]);
  await page.context().setOffline(false);
  await expect(progressValue(page)).toHaveText('42/66', { timeout: 5_000 });
  await expect(progressCaption(page)).toHaveText('Cập nhật liên tục');
  expect(checkinGets(calls).length).toBeGreaterThan(beforeOnline);
});

test('checkin-progress tải lần đầu: skeleton; lỗi → StatusBanner "Chưa tải được số liệu check-in" kèm "Thử lại" → số liệu', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // Lỗi 5xx được thử lại 2 lần trước khi báo; lần đầu giữ lại để thấy skeleton.
  const { state } = await openApi(page, { checkin: progressBody(TIERS), failCheckin: 3 });
  await page.route(
    (url) => url.pathname.endsWith(checkinApi),
    async (route) => {
      await held;
      await route.fallback();
    },
  );
  await page.goto(checkinTab);
  await expect(progress(page).locator('[data-slot="checkin-progress-skeleton"]')).toBeVisible();
  release();
  const error = progress(page).locator('[data-slot="checkin-progress-error"]');
  await expect(error).toContainText('Chưa tải được số liệu check-in', { timeout: 15_000 });
  await expect(progress(page).locator('[data-slot="stat-card"]')).toHaveCount(0);
  expect(state.failCheckin).toBe(0);

  await error.getByRole('button', { name: 'Thử lại' }).click();
  await expect(progressValue(page)).toHaveText('41/66');
  await expect(error).toHaveCount(0);
});

test('checkin-progress 401 → sang đăng nhập, quay lại đúng trang này', async ({ page }) => {
  await openApi(page, { expireOnCheckin: true });
  await page.goto(checkinTab);
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);
});

test('320px: tên Hạng vé dài xuống dòng, không cuộn ngang, "k/N" nằm trọn trong màn', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  const long = 'Vé VIP hạng kim cương có chỗ ngồi hàng đầu, quà lưu niệm và gặp gỡ vận động viên sau giải';
  await openApi(page, { checkin: progressBody([tier(1, long, 1234, 5678), TIERS[2]!]) });
  await page.goto(checkinTab);
  const row = progressRows(page).first();
  await expect(row.locator('[data-slot="checkin-progress-name"]')).toHaveText(long);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  const count = (await row.locator('[data-slot="checkin-progress-count"]').boundingBox())!;
  const name = (await row.locator('[data-slot="checkin-progress-name"]').boundingBox())!;
  expect(count.x + count.width).toBeLessThanOrEqual(320);
  // Tên xuống nhiều dòng, "k/N" một dòng bên phải tên.
  expect(name.height).toBeGreaterThan(count.height * 1.5);
  expect(count.x).toBeGreaterThanOrEqual(name.x + name.width);
  await expect(row.locator('[data-slot="checkin-progress-count"]')).toHaveText('1234/5678');
});
