import type { Page } from '@playwright/test';

import { checkinEvent, mockCheckinApi } from './checkin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Tab Check-in của Sự kiện (Story 5.1): khối "Link mời CTV"; thẻ "Màn quét" với "Mở Màn quét" (Story 5.2). API giả có trạng thái, luật như server: `GET …/checker-invite`
 * trả link mới nhất (không token), `POST` thu hồi link cũ rồi tạo link mới kèm token (nháp → 409 EVENT_STATUS_CONFLICT,
 * đã hủy → 409 EVENT_CANCELLED, đã kết thúc → 409 EVENT_ALREADY_ENDED). Link đầy đủ chỉ có ngay sau khi tạo (token trong
 * bộ nhớ): chuyển tab vẫn sao chép được, tải lại thì "Sao chép link" tắt kèm lý do.
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

async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ calls: Call[]; state: State }> {
  const state: State = { status: 'published', endedManuallyAt: null, invites: [], created: 0, ...initial };
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

test('thẻ "Màn quét" đứng trước khối link mời; "Mở Màn quét" mở Màn quét của Sự kiện (Owner/Admin không cần lời mời)', async ({
  page,
}) => {
  await openApi(page);
  const calls = await mockCheckinApi(page, { [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME) });
  await page.goto(checkinTab);
  await expect(scanCard(page).getByRole('heading', { name: 'Màn quét' })).toBeVisible();
  const order = await page
    .locator('[data-slot="checkin-tab"] > section')
    .evaluateAll((sections) => sections.map((s) => s.getAttribute('data-slot')));
  expect(order).toEqual(['scan-screen-card', 'checker-invite']);
  await expect(scanLink(page)).toHaveAttribute('href', SCAN_PATH);

  await scanLink(page).click();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  await expect(page.getByText('Màn quét đang được hoàn thiện.')).toBeVisible();
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
