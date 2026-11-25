import type { Page } from '@playwright/test';

import {
  CHECKER_REVOKED_MESSAGE,
  checkerRevoked,
  checkinEvent,
  inviteInvalid,
  invitePreview,
  mockCheckinApi,
  NOT_A_MEMBER_MESSAGE,
  notAMember,
} from './checkin-mock';
import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, unauthenticated, type Call, type Reply } from './identity-mock';
import { mockOrganizerApi } from './organizer-mock';

/*
 * Màn nhận lời mời CTV `/loi-moi-ctv#token` (Story 5.2) và phần tải Sự kiện của Màn quét `/events/:eventId` với API giả:
 * xem trước công khai, đăng nhập OTP rồi quay lại nhận, đã có quyền thì vào thẳng, link hỏng, CTV đã bị thu hồi, phiên hết
 * giữa chừng. Token chỉ đi trong body `POST`: không bao giờ trong URL request hay `returnTo`. Camera và kết quả quét ở
 * `checkin-scan.spec.ts`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const EVENT_NAME = 'Giải chạy Hà Nội 2026';
const ORG_NAME = 'CLB Chạy Bộ Hồ Gươm';
const TOKEN = 'Zx9_aB3-kLm0Qr7Tu1Vw2y';
const INVITE_PATH = '/loi-moi-ctv';
const INVITE_URL = `${INVITE_PATH}#${TOKEN}`;
const SCAN_PATH = `/events/${EVENT_ID}`;
const INVITED_TITLE = `Bạn được mời soát vé cho ${EVENT_NAME}.`;
const LOGIN_RETURN = `?returnTo=${encodeURIComponent(INVITE_PATH)}`;
const INVALID_TITLE = 'Link mời đã hết hạn.';
const INVALID_DESCRIPTION = 'Liên hệ BTC để nhận link mới.';
/** Màn "Bật camera" của Màn quét (Story 5.3): hiện ở mọi lần vào, sau khi tải xong Sự kiện. */
const enableCamera = (page: Page) => page.getByRole('button', { name: 'Bật camera' });

const accepted = (): Reply => ({ status: 200, body: { eventId: EVENT_ID } });
const preview = (scanEventId: string | null = null) => invitePreview(EVENT_NAME, ORG_NAME, scanEventId);

/** Ghi lại URL mọi request trình duyệt gửi đi (kiểm token không bao giờ nằm trong URL). */
function recordUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

/** URL (đường dẫn + query) có chứa token. Phần `#` không bao giờ rời trình duyệt. */
const urlsWithToken = (urls: string[]) =>
  urls.filter((u) => {
    const url = new URL(u);
    return `${url.pathname}${url.search}`.includes(TOKEN);
  });

const callsTo = (calls: Call[], path: string) => calls.filter((c) => c.path === path);
const storedValues = (page: Page) => page.evaluate(() => Object.values({ ...window.sessionStorage }));

const inviteButton = (page: Page) => page.getByRole('button', { name: 'Nhận soát vé' });
const inviteLink = (page: Page) => page.getByRole('link', { name: 'Nhận soát vé' });

/** Đã đăng nhập, đã đồng ý; header tải danh sách BTC (trống). */
async function signedIn(page: Page): Promise<void> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  await mockOrganizerApi(page);
}

test('chưa đăng nhập: tên Sự kiện + tên BTC + "Nhận soát vé" → đăng nhập OTP (returnTo không chứa token) → quay lại, bấm "Nhận soát vé" → Màn quét', async ({
  page,
}) => {
  const urls = recordUrls(page);
  let loggedIn = false;
  let isChecker = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => (loggedIn ? me(CONSENTED) : unauthenticated()),
    'POST /identity/otp': () => ({ status: 200, body: { resendAfterSeconds: 60 } }),
    'POST /identity/otp/verify': () => {
      loggedIn = true;
      return { status: 200, body: { consentRequired: false } };
    },
  });
  await mockOrganizerApi(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(isChecker ? EVENT_ID : null),
    'POST /checkin/invites/accept': () => {
      isChecker = true;
      return accepted();
    },
    [`GET /checkin/events/${EVENT_ID}`]: () => (isChecker ? checkinEvent(EVENT_ID, EVENT_NAME) : notAMember()),
  });

  await page.goto(INVITE_URL);
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  await expect(page.getByText(`BTC: ${ORG_NAME}`)).toBeVisible();
  await expect(page.getByText('Bạn đang đăng nhập bằng')).toHaveCount(0);
  // Đã giữ token trong tab: `#token` bị bỏ khỏi URL (thanh địa chỉ, lịch sử, `returnTo` dựng từ URL hiện tại).
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).pathname).toBe(INVITE_PATH);
  expect(await storedValues(page)).toContain(TOKEN);
  await expect(inviteLink(page)).toHaveAttribute('href', `/dang-nhap${LOGIN_RETURN}`);

  await inviteLink(page).click();
  await page.waitForURL((url) => url.pathname === '/dang-nhap');
  expect(new URL(page.url()).search).toBe(LOGIN_RETURN);
  const previewsBeforeLogin = callsTo(calls, '/checkin/invites/preview').length;

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input').first().fill('123456');
  await page.waitForURL((url) => url.pathname === INVITE_PATH);
  // Quay lại: thấy lại màn xem trước (tải lại với phiên mới), phải bấm "Nhận soát vé" lần nữa (không tự nhận).
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  await expect(page.getByText(`Bạn đang đăng nhập bằng ${EMAIL}.`)).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/preview').length).toBeGreaterThan(previewsBeforeLogin);
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(0);

  await inviteButton(page).click();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  await expect(enableCamera(page)).toBeVisible();

  expect(callsTo(calls, '/checkin/invites/accept').map((c) => c.body)).toEqual([{ token: TOKEN }]);
  expect(callsTo(calls, '/checkin/invites/preview').every((c) => (c.body as { token: string }).token === TOKEN)).toBe(
    true,
  );
  // Token chỉ đi trong body: không request nào (trang web, RSC, api) mang token trong đường dẫn hay query.
  expect(urlsWithToken(urls)).toEqual([]);
  // Đã nhận xong thì token không còn được giữ trong tab.
  expect(await storedValues(page)).not.toContain(TOKEN);
});

test('đã đăng nhập: "Nhận soát vé" có spinner, chặn bấm lặp; nhận xong thay (replace) trang bằng Màn quét', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await signedIn(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': async () => {
      await held;
      return accepted();
    },
    [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME),
  });
  await page.goto('/chinh-sach-du-lieu');
  await page.goto(INVITE_URL);
  await expect(page.getByText(`Bạn đang đăng nhập bằng ${EMAIL}.`)).toBeVisible();

  await inviteButton(page).click();
  await expect(inviteButton(page)).toHaveAttribute('aria-busy', 'true');
  await inviteButton(page).click({ force: true });
  release();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(1);
  expect(await storedValues(page)).not.toContain(TOKEN);

  // `replace`: Back không quay lại màn nhận lời mời.
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/chinh-sach-du-lieu');
});

test('đã có quyền (xem trước trả scanEventId): vào thẳng Màn quét, không gọi accept; token bị bỏ khỏi tab', async ({
  page,
}) => {
  await signedIn(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(EVENT_ID),
    [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME),
  });
  await page.goto(INVITE_URL);
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(0);
  expect(await storedValues(page)).not.toContain(TOKEN);
});

test('link hỏng khi xem trước (404 CHECKER_INVITE_INVALID): "Link mời đã hết hạn…", không tên Sự kiện, không nút; token bị bỏ', async ({
  page,
}) => {
  await mockIdentityApi(page);
  await mockCheckinApi(page, { 'POST /checkin/invites/preview': inviteInvalid });
  await page.goto(INVITE_URL);
  await expect(page.getByRole('heading', { name: INVALID_TITLE })).toBeVisible();
  await expect(page.getByText(INVALID_DESCRIPTION)).toBeVisible();
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
  await expect(inviteLink(page)).toHaveCount(0);
  await expect(inviteButton(page)).toHaveCount(0);
  expect(await storedValues(page)).not.toContain(TOKEN);
});

test('link hỏng khi nhận (404 CHECKER_INVITE_INVALID): "Link mời đã hết hạn…", không tên Sự kiện; token bị bỏ', async ({
  page,
}) => {
  await signedIn(page);
  await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': inviteInvalid,
  });
  await page.goto(INVITE_URL);
  await inviteButton(page).click();
  await expect(page.getByRole('heading', { name: INVALID_TITLE })).toBeVisible();
  await expect(page.getByText(INVALID_DESCRIPTION)).toBeVisible();
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
  await expect(inviteButton(page)).toHaveCount(0);
  expect(await storedValues(page)).not.toContain(TOKEN);
});

test('link thiếu token: "Link mời đã hết hạn…" mà không gọi api xem trước', async ({ page }) => {
  await mockIdentityApi(page);
  const calls = await mockCheckinApi(page);
  await page.goto(INVITE_PATH);
  await expect(page.getByRole('heading', { name: INVALID_TITLE })).toBeVisible();
  await expect(page.getByText(INVALID_DESCRIPTION)).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/preview')).toHaveLength(0);
});

test('CTV đã bị thu hồi (accept 403 CHECKER_REVOKED): "Bạn không còn quyền soát vé…", không nút; token bị bỏ', async ({
  page,
}) => {
  await signedIn(page);
  await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': checkerRevoked,
  });
  await page.goto(INVITE_URL);
  await inviteButton(page).click();
  await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
  await expect(inviteButton(page)).toHaveCount(0);
  expect(await storedValues(page)).not.toContain(TOKEN);
});

test('phiên hết giữa chừng (accept 401): sang đăng nhập với returnTo=/loi-moi-ctv, token vẫn giữ trong tab', async ({
  page,
}) => {
  const urls = recordUrls(page);
  await signedIn(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': unauthenticated,
  });
  await page.goto(INVITE_URL);
  await inviteButton(page).click();
  await page.waitForURL((url) => url.pathname === '/dang-nhap');
  expect(new URL(page.url()).search).toBe(LOGIN_RETURN);
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(1);
  expect(await storedValues(page)).toContain(TOKEN);
  expect(urlsWithToken(urls)).toEqual([]);
});

test('xem trước lỗi tải (5xx): banner "Chưa tải được lời mời" + "Thử lại" → tải lại được', async ({ page }) => {
  let failing = true;
  await mockIdentityApi(page);
  await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => (failing ? apiError(500, 'INTERNAL_ERROR') : preview()),
  });
  await page.goto(INVITE_URL);
  const banner = page.locator('[data-slot="status-banner"]');
  // Lỗi 5xx được thử lại 2 lần trước khi báo.
  await expect(banner).toContainText('Chưa tải được lời mời', { timeout: 15_000 });
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);

  failing = false;
  await banner.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  await expect(inviteLink(page)).toBeVisible();
});

test('nhận lỗi 5xx: banner "Chưa nhận được lời mời", ở lại trang, token vẫn giữ; bấm lại được', async ({ page }) => {
  let failing = true;
  await signedIn(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': () => (failing ? apiError(500, 'INTERNAL_ERROR') : accepted()),
    [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME),
  });
  await page.goto(INVITE_URL);
  await inviteButton(page).click();
  const banner = page.locator('[data-slot="status-banner"]');
  await expect(banner).toContainText('Chưa nhận được lời mời');
  await expect(banner).toContainText('Lỗi giả lập');
  expect(new URL(page.url()).pathname).toBe(INVITE_PATH);
  expect(await storedValues(page)).toContain(TOKEN);
  await expect(inviteButton(page)).toBeEnabled();
  await expect(inviteButton(page)).not.toHaveAttribute('aria-busy', 'true');

  failing = false;
  await inviteButton(page).click();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(2);
});

test('tải tài khoản lỗi 5xx: banner "Chưa tải được lời mời" + "Thử lại" → xem trước hiện', async ({ page }) => {
  let failing = true;
  await mockIdentityApi(page, { 'GET /identity/me': () => (failing ? apiError(500, 'INTERNAL_ERROR') : me(CONSENTED)) });
  await mockOrganizerApi(page);
  await mockCheckinApi(page, { 'POST /checkin/invites/preview': () => preview() });
  await page.goto(INVITE_URL);
  const banner = page.locator('[data-slot="status-banner"]');
  // Lỗi 5xx được thử lại 2 lần trước khi báo.
  await expect(banner).toContainText('Chưa tải được lời mời', { timeout: 15_000 });
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);

  failing = false;
  await banner.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  await expect(page.getByText(`Bạn đang đăng nhập bằng ${EMAIL}.`)).toBeVisible();
  await expect(inviteButton(page)).toBeVisible();
});

test('nhận khi session chưa qua lớp hai: dialog "Xác thực hai lớp" (không banner lỗi) → nhập mã → tự gửi lại → Màn quét', async ({
  page,
}) => {
  let steppedUp = false;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => {
      steppedUp = true;
      return { status: 200, body: { stepUpAt: '2026-11-23T03:00:00.000Z' } };
    },
  });
  await mockOrganizerApi(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': () =>
      steppedUp ? accepted() : apiError(403, 'TOTP_REQUIRED', { reason: 'step_up' }),
    [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME),
  });
  await page.goto(INVITE_URL);
  await inviteButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Xác thực hai lớp' });
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Chưa nhận được lời mời')).toHaveCount(0);

  await dialog.getByRole('group', { name: /Mã 6 số/ }).locator('input').first().fill('123456');
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(2);
  expect(await storedValues(page)).not.toContain(TOKEN);
});

test('đã đăng nhập nhưng chưa đồng ý NĐ 13 → màn đồng ý (returnTo=/loi-moi-ctv) → "Đồng ý" → quay lại, token vẫn giữ → "Nhận soát vé" → Màn quét', async ({
  page,
}) => {
  let consentedAt: string | null = null;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(consentedAt),
    'POST /identity/consent': () => {
      consentedAt = CONSENTED;
      return me(consentedAt);
    },
  });
  await mockOrganizerApi(page);
  const calls = await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': accepted,
    [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME),
  });
  await page.goto(INVITE_URL);
  await page.waitForURL((url) => url.pathname === '/dong-y');
  expect(new URL(page.url()).search).toBe(LOGIN_RETURN);
  expect(callsTo(calls, '/checkin/invites/accept')).toHaveLength(0);

  await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await page.waitForURL((url) => url.pathname === INVITE_PATH);
  expect(await storedValues(page)).toContain(TOKEN);
  await expect(page.getByRole('heading', { name: INVITED_TITLE })).toBeVisible();
  await expect(page.getByText(`Bạn đang đăng nhập bằng ${EMAIL}.`)).toBeVisible();

  await inviteButton(page).click();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  expect(callsTo(calls, '/checkin/invites/accept').map((c) => c.body)).toEqual([{ token: TOKEN }]);
});

test.describe('Màn quét /events/:eventId: tải Sự kiện', () => {
  test('200: tên Sự kiện + "Bật camera"', async ({ page }) => {
    await signedIn(page);
    await mockCheckinApi(page, { [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME) });
    await page.goto(SCAN_PATH);
    await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
    await expect(enableCamera(page)).toBeVisible();
  });

  test('401: sang đăng nhập với returnTo là chính trang này', async ({ page }) => {
    await mockIdentityApi(page);
    await mockCheckinApi(page, { [`GET /checkin/events/${EVENT_ID}`]: unauthenticated });
    await page.goto(SCAN_PATH);
    await page.waitForURL((url) => url.pathname === '/dang-nhap');
    expect(new URL(page.url()).search).toBe(`?returnTo=${encodeURIComponent(SCAN_PATH)}`);
  });

  const FORBIDDEN: [string, () => Reply, string][] = [
    ['NOT_A_MEMBER', notAMember, NOT_A_MEMBER_MESSAGE],
    ['CHECKER_REVOKED', checkerRevoked, CHECKER_REVOKED_MESSAGE],
  ];
  for (const [code, reply, message] of FORBIDDEN) {
    test(`403 ${code}: câu của api, không tên Sự kiện`, async ({ page }) => {
      await signedIn(page);
      await mockCheckinApi(page, { [`GET /checkin/events/${EVENT_ID}`]: reply });
      await page.goto(SCAN_PATH);
      await expect(page.getByRole('heading', { name: message })).toBeVisible();
      await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
      await expect(enableCamera(page)).toHaveCount(0);
    });
  }

  test('tải lại sau khi đã hiện (quay lại tab quá staleTime) trả 403 CHECKER_REVOKED: câu của api thay tên Sự kiện', async ({
    page,
  }) => {
    let revoked = false;
    await signedIn(page);
    const calls = await mockCheckinApi(page, {
      [`GET /checkin/events/${EVENT_ID}`]: () => (revoked ? checkerRevoked() : checkinEvent(EVENT_ID, EVENT_NAME)),
    });
    await page.goto(SCAN_PATH);
    await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();

    revoked = true;
    const gets = () => callsTo(calls, `/checkin/events/${EVENT_ID}`).length;
    const before = gets();
    // Quá `staleTime` (30s) rồi quay lại tab → TanStack Query tải lại.
    await page.clock.setFixedTime(Date.now() + 60_000);
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(gets).toBeGreaterThan(before);

    await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
    await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
    await expect(enableCamera(page)).toHaveCount(0);
  });

  test('lỗi tải (5xx): banner "Chưa tải được Màn quét", không tên Sự kiện; "Thử lại" → tên Sự kiện', async ({ page }) => {
    let failing = true;
    await signedIn(page);
    await mockCheckinApi(page, {
      [`GET /checkin/events/${EVENT_ID}`]: () =>
        failing ? apiError(500, 'INTERNAL_ERROR') : checkinEvent(EVENT_ID, EVENT_NAME),
    });
    await page.goto(SCAN_PATH);
    const banner = page.locator('[data-slot="status-banner"]');
    // Lỗi 5xx được thử lại 2 lần trước khi báo.
    await expect(banner).toContainText('Chưa tải được Màn quét', { timeout: 15_000 });
    await expect(page.getByText(EVENT_NAME)).toHaveCount(0);

    failing = false;
    await banner.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
    await expect(enableCamera(page)).toBeVisible();
  });
});

/** Mọi nút và link trong `main` có vùng chạm ≥ 24px mỗi chiều (WCAG 2.2 AA). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('main a, main button')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24);
      })
      .map((el) => el.textContent ?? el.tagName),
  );
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('320px: không cuộn ngang, vùng chạm ≥ 24px ở màn xem trước (chưa đăng nhập, đã đăng nhập), link hỏng và Màn quét (Bật camera)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 667 });
  let loggedIn = false;
  await mockIdentityApi(page, { 'GET /identity/me': () => (loggedIn ? me(CONSENTED) : unauthenticated()) });
  await mockOrganizerApi(page);
  await mockCheckinApi(page, {
    'POST /checkin/invites/preview': () => preview(),
    'POST /checkin/invites/accept': checkerRevoked,
    [`GET /checkin/events/${EVENT_ID}`]: () => checkinEvent(EVENT_ID, EVENT_NAME),
  });

  await page.goto(INVITE_URL);
  await expect(inviteLink(page)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await smallTargets(page)).toEqual([]);

  loggedIn = true;
  await page.reload();
  await expect(inviteButton(page)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await smallTargets(page)).toEqual([]);

  await inviteButton(page).click();
  await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.goto(INVITE_PATH);
  await expect(page.getByRole('heading', { name: INVALID_TITLE })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.goto(SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await smallTargets(page)).toEqual([]);
});
