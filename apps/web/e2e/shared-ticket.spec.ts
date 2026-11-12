import type { Page, Route } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, corsHeaders, EMAIL, me, mockIdentityApi, WEB_ORIGIN, type Reply } from './identity-mock';
import { expectQrImageEncodes } from './qr-image';

/*
 * Story 3.8 (AD-29): link chia sẻ Vé. Trang công khai `/xem-ve#<token>` gọi `GET /v1/shared-tickets/:token` không kèm
 * cookie và hiện `ticket-card` không có dòng Người mua; 404/thiếu token/lỗi → `empty-state` không nút. Màn Thành công của
 * chủ Vé: "Đã gửi Vé tới {email}", "Chia sẻ Vé" (Web Share, không có thì sao chép + toast, hủy thì im lặng), "Tạo lại
 * link" qua Dialog. API giả bằng `page.route`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const CODE = 'TK8F3Q2AXM';
const EVENT_NAME = 'Giải chạy Hồ Gươm mùa thu 2026';
const HOLDER = 'Nguyễn Văn An';
const TIER = 'Vé VIP';

const ticketId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
const ticketQr = (n: number) => `t1.${ticketId(n)}.${String(n).padStart(43, 'q')}`;
/** Token giả 22 ký tự base64url, phiên bản `v` của link Vé `n`. */
const shareToken = (n: number, v = 1) => `share${v}${String(n).padStart(16, 'S')}`;
const sharedUrl = (token: string) => `${WEB_ORIGIN}/xem-ve#${token}`;

const VIEW = {
  eventName: EVENT_NAME,
  eventStartsAt: '2099-11-15T07:00:00+07:00',
  venue: 'Hồ Hoàn Kiếm, Hà Nội',
  ticketTypeName: TIER,
  seq: 1,
  count: 2,
  status: 'valid',
  qr: ticketQr(1),
};

const cors = corsHeaders(WEB_ORIGIN);
const reply = (route: Route, r: Reply) =>
  route.fulfill({
    status: r.status,
    headers: { ...cors, 'content-type': 'application/json' },
    body: r.body === undefined ? '' : JSON.stringify(r.body),
  });

type SharedCall = { token: string; cookie: string | undefined; referer: string | undefined; url: string };

/** Giả `GET /v1/shared-tickets/:token`; trả về các lần gọi (token, header cookie/referer). */
async function mockShared(page: Page, answer: (token: string) => Reply | 'abort'): Promise<SharedCall[]> {
  const calls: SharedCall[] = [];
  await page.route('**/v1/shared-tickets/*', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = await request.allHeaders();
    const token = decodeURIComponent(new URL(request.url()).pathname.split('/').pop()!);
    calls.push({ token, cookie: headers.cookie, referer: headers.referer, url: request.url() });
    const result = answer(token);
    return result === 'abort' ? route.abort('failed') : reply(route, result);
  });
  return calls;
}

const card = (page: Page) => page.locator('[data-slot="ticket-card"]');
const emptyState = (page: Page) => page.locator('[data-slot="empty-state"]');

async function expectNotFound(page: Page): Promise<void> {
  await expect(emptyState(page)).toBeVisible({ timeout: 10_000 });
  await expect(emptyState(page)).toContainText('Không tìm thấy Vé');
  await expect(emptyState(page)).toContainText('Link không đúng hoặc không còn hiệu lực.');
  await expect(page.locator('main').getByRole('button')).toHaveCount(0);
  await expect(page.locator('main').getByRole('link')).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
}

test.describe('trang Vé được chia sẻ /xem-ve', () => {
  test.beforeEach(async ({ page }) => {
    await mockIdentityApi(page);
  });

  test('link hợp lệ: thẻ Vé có Sự kiện, Hạng vé, "Vé k/N", giờ, địa điểm, "Hợp lệ", QR; không dòng Người mua; gọi API không cookie, không Referer', async ({
    page,
    context,
    browserName,
  }) => {
    // Có cookie phiên ở host của API: lời gọi công khai vẫn không được gửi kèm.
    await context.addCookies([{ name: 'tickee.session_token', value: 'phien-that', domain: 'localhost', path: '/' }]);
    // Đối chứng: lời gọi kèm cookie (`me` của menu tài khoản) có gửi cookie này. Chỉ Chromium cho đọc header cookie
    // của request cross-origin; WebKit không lộ nên ở đó phép kiểm "không cookie" bên dưới yếu hơn.
    const meCookies: (string | undefined)[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/v1/identity/me')) {
        void request.allHeaders().then((headers) => meCookies.push(headers.cookie));
      }
    });
    const calls = await mockShared(page, () => ({ status: 200, body: VIEW }));
    await page.goto(`/xem-ve#${shareToken(1)}`);

    await expect(card(page)).toHaveCount(1);
    const ticket = card(page);
    await expect(ticket).toContainText(EVENT_NAME);
    await expect(ticket.locator('[data-slot="ticket-card-tier"]')).toHaveText(TIER);
    await expect(ticket.locator('[data-slot="ticket-card-position"]')).toHaveText('· Vé 1/2');
    await expect(ticket).toContainText('Chủ nhật, 15/11/2099 · 07:00');
    await expect(ticket.locator('[data-slot="ticket-card-venue"]')).toHaveText('Hồ Hoàn Kiếm, Hà Nội');
    await expect(ticket.locator('[data-slot="status-badge"]')).toHaveText('Hợp lệ');
    await expect(ticket.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');
    await expect(ticket.locator('[data-slot="ticket-card-holder"]')).toHaveCount(0);
    await expect(ticket).not.toContainText('Người mua');
    await expect(page.locator('main')).not.toContainText(HOLDER);
    await expect(ticket.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Vé 1/2 · ${EVENT_NAME}`);

    const plate = ticket.locator('[data-slot="qr-plate"]');
    await expect(plate).toHaveCSS('opacity', '1');
    await expectQrImageEncodes(plate.getByRole('img'), VIEW.qr);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ token: shareToken(1), cookie: undefined, referer: undefined });
    if (browserName === 'chromium') {
      await expect.poll(() => meCookies.some((c) => c?.includes('tickee.session_token=phien-that'))).toBe(true);
    }
    expect(new URL(calls[0]!.url).search).toBe('');
    // Token chỉ nằm sau `#`: không có trong đường dẫn hay query của trang.
    expect(new URL(page.url()).search).toBe('');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });

  test('Vé đã check-in → QR mờ .25 + badge "Đã check-in"', async ({ page }) => {
    await mockShared(page, () => ({ status: 200, body: { ...VIEW, status: 'checked_in', venue: null } }));
    await page.goto(`/xem-ve#${shareToken(1)}`);
    const ticket = card(page);
    await expect(ticket.locator('[data-slot="status-badge"]')).toHaveText('Đã check-in');
    await expect(ticket.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
    await expect(ticket.locator('[data-slot="qr-plate"]')).toHaveCSS('opacity', '0.25');
    await expect(ticket.getByRole('img', { name: `Mã QR vé 1 trên 2, ${TIER}, đã check-in` })).toBeVisible();
    await expect(ticket.locator('[data-slot="ticket-card-venue"]')).toHaveCount(0);
  });

  test('404 SHARED_TICKET_NOT_FOUND → empty-state "Không tìm thấy Vé", không nút', async ({ page }) => {
    await mockShared(page, () => apiError(404, 'SHARED_TICKET_NOT_FOUND'));
    await page.goto(`/xem-ve#${shareToken(9)}`);
    await expectNotFound(page);
  });

  test('lỗi máy chủ hay mất mạng → cùng empty-state', async ({ page }) => {
    let n = 0;
    await mockShared(page, () => (n++ % 2 === 0 ? 'abort' : apiError(500, 'INTERNAL_ERROR')));
    await page.goto(`/xem-ve#${shareToken(1)}`);
    await expectNotFound(page);
  });

  for (const [label, hash] of [
    ['thiếu token', ''],
    ['# rỗng', '#'],
    ['token sai dạng', '#abc'],
  ] as const) {
    test(`${label} → empty-state, không gọi API`, async ({ page }) => {
      const calls = await mockShared(page, () => ({ status: 200, body: VIEW }));
      await page.goto(`/xem-ve${hash}`);
      await expectNotFound(page);
      expect(calls).toEqual([]);
    });
  }

  test('đổi `#token` trong cùng trang (hashchange, không tải lại) → đọc lại token và hiện đúng Vé mới', async ({ page }) => {
    const calls = await mockShared(page, (token) => ({
      status: 200,
      body: { ...VIEW, seq: token === shareToken(2) ? 2 : 1 },
    }));
    await page.goto(`/xem-ve#${shareToken(1)}`);
    await expect(card(page).locator('[data-slot="ticket-card-position"]')).toHaveText('· Vé 1/2');
    // Cùng tài liệu: Playwright chỉ đổi `#`, trang không tải lại.
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    await page.goto(`/xem-ve#${shareToken(2)}`);
    await expect(card(page).locator('[data-slot="ticket-card-position"]')).toHaveText('· Vé 2/2');
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    expect(calls.map((c) => c.token)).toEqual([shareToken(1), shareToken(2)]);
  });

  test('320px, theme tối: không cuộn ngang; QR đen trên tấm trắng', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 320, height: 640 });
    await mockShared(page, () => ({ status: 200, body: VIEW }));
    await page.goto(`/xem-ve#${shareToken(1)}`);
    await expect(card(page)).toHaveCount(1);
    await expect(card(page).locator('[data-slot="qr-plate"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/** Đơn 0đ đã `paid` 2 Vé; `version[n]` là phiên bản link hiện hành của Vé `n`. */
function paidOrder(version: Record<number, number> = {}) {
  return {
    code: CODE,
    buyerStatus: 'paid',
    event: { slug: 'giai-chay-ho-guom', name: EVENT_NAME, startsAt: '2099-11-15T07:00:00+07:00', ended: false },
    items: [{ ticketTypeId: '019a3b2c-0800-7abc-8def-000000000001', name: TIER, unitPrice: 0, quantity: 2, amount: 0 }],
    totalAmount: 0,
    buyer: { name: HOLDER, phone: '+84912345678', email: EMAIL },
    answers: [],
    refundPolicy: null,
    createdAt: '2026-11-10T01:00:00.000Z',
    expiresAt: '2026-11-10T01:00:00.000Z',
    serverNow: '2026-11-10T01:00:05.000Z',
    payment: null,
    tickets: [1, 2].map((n) => ({
      id: ticketId(n),
      seq: n,
      count: 2,
      ticketTypeName: TIER,
      holderName: HOLDER,
      qr: ticketQr(n),
      shareToken: shareToken(n, version[n] ?? 1),
    })),
    organizer: { name: 'CLB Chạy Bộ Phố Cổ', contactPhone: null, contactEmail: null },
  };
}

/**
 * Đã đăng nhập; `GET /me/orders/:code` trả Đơn theo `state.version`; SSE 503; `POST /me/tickets/:id/share-link` theo
 * `regenerate` (mặc định: tăng phiên bản link của Vé đó rồi trả token mới).
 */
async function mockOwner(page: Page, options: { regenerate?: (id: string) => Reply | null } = {}) {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  /** `failOrders`: mọi lần tải Đơn từ đây lỗi mạng (đếm ở `failedLoads`). */
  const state = {
    version: {} as Record<number, number>,
    orderLoads: 0,
    regenerated: [] as string[],
    failOrders: false,
    failedLoads: 0,
  };
  await page.route('**/v1/me/orders/*', (route) => {
    if (state.failOrders) {
      state.failedLoads += 1;
      return route.abort('failed');
    }
    state.orderLoads += 1;
    return reply(route, { status: 200, body: paidOrder(state.version) });
  });
  await page.route('**/v1/me/orders/*/live', (route) => reply(route, apiError(503, 'SERVICE_UNAVAILABLE')));
  await page.route('**/v1/me/tickets/*/share-link', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const id = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2)!);
    state.regenerated.push(id);
    const custom = options.regenerate?.(id);
    if (custom) return reply(route, custom);
    const n = Number(id.slice(-12));
    state.version[n] = (state.version[n] ?? 1) + 1;
    return reply(route, { status: 200, body: { shareToken: shareToken(n, state.version[n]) } });
  });
  return state;
}

/** Thay `navigator.share` (ghi lại nội dung) hoặc gỡ hẳn Web Share API. */
async function stubWebShare(page: Page, mode: 'record' | 'cancel' | 'none'): Promise<() => Promise<ShareData[]>> {
  await page.addInitScript((m) => {
    const calls: ShareData[] = [];
    (window as unknown as { __shared: ShareData[] }).__shared = calls;
    if (m === 'none') {
      delete (Navigator.prototype as { share?: unknown }).share;
      delete (navigator as { share?: unknown }).share;
      return;
    }
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: ShareData) => {
        calls.push(data);
        return m === 'cancel' ? Promise.reject(new DOMException('Người dùng hủy', 'AbortError')) : Promise.resolve();
      },
    });
  }, mode);
  return () => page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared);
}

const shareButtons = (page: Page) => page.getByRole('button', { name: /^Chia sẻ Vé/ });

test.describe('chia sẻ Vé trên màn Thành công', () => {
  test('stage có "Đã gửi Vé tới {email}"; mỗi thẻ một "Chia sẻ Vé" (button-secondary) và "Tạo lại link"', async ({ page }) => {
    await mockOwner(page);
    await page.goto(`/orders/${CODE}`);
    const stage = page.locator('[data-slot="order-success"] [data-slot="stage-block"]');
    await expect(stage.locator('[data-slot="order-success-email"]')).toHaveText(`Đã gửi Vé tới ${EMAIL}`);
    await expect(card(page)).toHaveCount(2);
    await expect(shareButtons(page)).toHaveCount(2);
    await expect(card(page).nth(1).getByRole('button', { name: 'Chia sẻ Vé 2/2' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Tạo lại link/ })).toHaveCount(2);
    // Chủ Vé vẫn thấy dòng Người mua trên thẻ của mình.
    await expect(card(page).first().locator('[data-slot="ticket-card-holder"]')).toHaveText(HOLDER);
  });

  test('Web Share API: chia sẻ "Vé k/N · Sự kiện" + link /xem-ve#token của đúng Vé; bấm lặp ra cùng link', async ({ page }) => {
    const shared = await stubWebShare(page, 'record');
    await mockOwner(page);
    await page.goto(`/orders/${CODE}`);
    await shareButtons(page).nth(1).click();
    await shareButtons(page).nth(1).click();
    await shareButtons(page).first().click();
    expect(await shared()).toEqual([
      { title: `Vé 2/2 · ${EVENT_NAME}`, url: sharedUrl(shareToken(2)) },
      { title: `Vé 2/2 · ${EVENT_NAME}`, url: sharedUrl(shareToken(2)) },
      { title: `Vé 1/2 · ${EVENT_NAME}`, url: sharedUrl(shareToken(1)) },
    ]);
    await expect(page.getByText('Đã sao chép')).toHaveCount(0);
  });

  test('hủy bảng chia sẻ → im lặng (không toast, không sao chép)', async ({ page }) => {
    const shared = await stubWebShare(page, 'cancel');
    await mockOwner(page);
    await page.goto(`/orders/${CODE}`);
    await shareButtons(page).first().click();
    await expect.poll(async () => (await shared()).length).toBe(1);
    await page.waitForTimeout(300);
    await expect(page.getByText('Đã sao chép')).toHaveCount(0);
    await expect(page.getByText(/Chưa sao chép được/)).toHaveCount(0);
  });

  test('không có Web Share API → sao chép link + toast "Đã sao chép"', async ({ page, browserName }) => {
    await stubWebShare(page, 'none');
    if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockOwner(page);
    await page.goto(`/orders/${CODE}`);
    expect(await page.evaluate(() => 'share' in navigator)).toBe(false);
    await shareButtons(page).first().click();
    await expect(page.getByText('Đã sao chép')).toBeVisible();
    if (browserName === 'chromium') {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sharedUrl(shareToken(1)));
    }
  });

  test('"Tạo lại link": Dialog ghi rõ QR vẫn dùng được; "Hủy" không gọi API; xác nhận → POST, toast, tải lại Đơn, chia sẻ ra link mới', async ({
    page,
  }) => {
    const shared = await stubWebShare(page, 'record');
    const state = await mockOwner(page);
    await page.goto(`/orders/${CODE}`);
    await expect(card(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Tạo lại link Vé 1/2' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Tạo lại link Vé 1/2?');
    await expect(dialog).toContainText('Ai đã thấy hoặc chụp mã QR vẫn có thể dùng mã để vào cổng.');
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.regenerated).toEqual([]);

    const loadsBefore = state.orderLoads;
    await page.getByRole('button', { name: 'Tạo lại link Vé 1/2' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo lại link' }).click();
    await expect(page.getByText('Đã tạo link mới cho Vé 1/2')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.regenerated).toEqual([ticketId(1)]);
    await expect.poll(() => state.orderLoads).toBeGreaterThan(loadsBefore);

    await shareButtons(page).first().click();
    await shareButtons(page).nth(1).click();
    await expect.poll(async () => (await shared()).map((d) => d.url)).toEqual([
      sharedUrl(shareToken(1, 2)),
      sharedUrl(shareToken(2)),
    ]);
  });

  test('tạo lại link xong mà tải lại Đơn lỗi → thẻ vẫn hiện, "Chia sẻ Vé" ra link mới (không bao giờ link đã chết)', async ({
    page,
  }) => {
    const shared = await stubWebShare(page, 'record');
    const state = await mockOwner(page);
    await page.goto(`/orders/${CODE}`);
    await expect(card(page)).toHaveCount(2);
    state.failOrders = true;

    await page.getByRole('button', { name: 'Tạo lại link Vé 1/2' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo lại link' }).click();
    await expect(page.getByText('Đã tạo link mới cho Vé 1/2')).toBeVisible();
    expect(state.regenerated).toEqual([ticketId(1)]);
    await expect.poll(() => state.failedLoads).toBeGreaterThan(0);
    await expect(card(page)).toHaveCount(2);

    await shareButtons(page).first().click();
    await shareButtons(page).nth(1).click();
    await expect.poll(async () => (await shared()).map((d) => d.url)).toEqual([
      sharedUrl(shareToken(1, 2)),
      sharedUrl(shareToken(2)),
    ]);
  });

  test('tạo lại link lỗi → banner trong Dialog, link cũ giữ nguyên', async ({ page }) => {
    const shared = await stubWebShare(page, 'record');
    await mockOwner(page, { regenerate: () => apiError(404, 'TICKET_NOT_FOUND') });
    await page.goto(`/orders/${CODE}`);
    await page.getByRole('button', { name: 'Tạo lại link Vé 2/2' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Tạo lại link' }).click();
    await expect(dialog).toContainText('Chưa tạo lại được link');
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await shareButtons(page).nth(1).click();
    await expect.poll(async () => (await shared()).map((d) => d.url)).toEqual([sharedUrl(shareToken(2))]);
  });
});
