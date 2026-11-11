import type { Page, Route } from '@playwright/test';

import { PORT_PUBLIC_EVENT } from '../playwright.config';
import { expect, test } from './fixtures';
import { apiError, corsHeaders, EMAIL, me, mockIdentityApi, type Reply } from './identity-mock';
import { SLUG_BUY, TIER_PAID_ID } from './public-event-api';

/*
 * Story 3.7: Trang Đơn tự chuyển theo `buyerStatus` (REST là sự thật, SSE chỉ là tín hiệu). API và luồng SSE
 * `GET /v1/me/orders/:code/live` đều giả bằng `page.route`: một lần fulfill là một kết nối SSE (gửi các khung rồi đóng),
 * giữ request lại là kết nối chưa mở. Ca full-stack với api thật và Tingee fake nằm ở test tích hợp của api
 * (`apps/api/test/ordering/order-live.test.ts`); Playwright full-stack để AI-6.
 */

// Server web có API giả cho SSR (link "Mua lại"/"Về trang Sự kiện" được prefetch), như `purchase.spec.ts`.
const ORIGIN = `http://localhost:${PORT_PUBLIC_EVENT}`;
test.use({ baseURL: ORIGIN });

const CODE = 'TK8F3Q2AXM';
const ORDER_PATH = `/orders/${CODE}`;
const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORGANIZER = { name: 'CLB Chạy Bộ Phố Cổ', contactPhone: '0901234567', contactEmail: 'lienhe@clbchaybo.vn' };
const CHECKOUT_URL = `https://pay.tingee.test/checkout/${CODE}?r=1`;

const WAITING = 'Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền.';
const CONFIRMING = 'Đang xác nhận thanh toán. Nếu bạn đã trả, vé sẽ tự hiện — đừng trả lại.';
const REASSURANCE = 'Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại.';
const OFFLINE = 'Mất kết nối — vé sẽ tự hiện khi có mạng lại.';
const SUCCESS = 'Vé của bạn đã sẵn sàng!';

const ticketId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
const ticket = (n: number, count: number) => ({
  id: ticketId(n),
  seq: n,
  count,
  ticketTypeName: 'Vé VIP',
  holderName: 'Nguyễn Văn An',
  qr: `t1.${ticketId(n)}.${String(n).padStart(43, 'q')}`,
});

/** `BuyerOrderView` giả: 2 Vé VIP, đang chờ thanh toán, link 15 phút tính theo giờ máy lúc gọi. */
function order(patch: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    code: CODE,
    buyerStatus: 'awaiting_payment',
    event: { slug: SLUG_BUY, name: 'Giải chạy Hồ Gươm mùa thu 2026', startsAt: '2099-11-15T07:00:00+07:00' },
    items: [{ ticketTypeId: TIER_PAID_ID, name: 'Vé VIP', unitPrice: 300_000, quantity: 2, amount: 600_000 }],
    totalAmount: 600_000,
    buyer: { name: 'Nguyễn Văn An', phone: '+84912345678', email: EMAIL },
    answers: [],
    refundPolicy: null,
    createdAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 15 * 60_000).toISOString(),
    serverNow: new Date(now).toISOString(),
    payment: {
      checkoutUrl: CHECKOUT_URL,
      linkError: null,
      recipient: { organizationName: ORGANIZER.name, accountName: 'NGUYEN VAN TUAN', bankName: 'Vietcombank' },
    },
    tickets: [],
    organizer: ORGANIZER,
    ...patch,
  };
}
const paidOrder = () => order({ buyerStatus: 'paid', payment: { ...order().payment, checkoutUrl: null }, tickets: [ticket(1, 2), ticket(2, 2)] });

const cors = corsHeaders(ORIGIN);

/** Một kết nối SSE giả: các khung `data:` (mỗi phần tử một tin `{ type }`) rồi đóng; `retry` dài để trình duyệt không tự nối lại ngay. */
const sseBody = (types: string[], retryMs = 600_000) =>
  [`retry: ${retryMs}\n\n`, ': connected\n\n', ...types.map((type) => `data: ${JSON.stringify({ type })}\n\n`)].join('');

type LiveReply = { kind: 'error'; reply: Reply } | { kind: 'stream'; types: string[] } | { kind: 'hold'; until: Promise<LiveReply> };

/**
 * `/identity/me` (đã đăng nhập, đã đồng ý), `GET /me/orders/:code` (trả `state.order`, ghi giờ từng lần gọi) và SSE
 * `/me/orders/:code/live` (kết nối thứ `n` → `live(n)`; mặc định 503 = không có realtime).
 */
async function mockOrderApi(page: Page, options: { live?: (n: number) => LiveReply } = {}) {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) }, { origin: ORIGIN });
  const state = { order: order() as Record<string, unknown>, fail: false };
  const gets: number[] = [];
  const lives: number[] = [];
  await page.route('**/v1/me/orders/*', (route) => {
    gets.push(Date.now());
    if (state.fail) return route.abort('failed');
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(state.order) });
  });
  const answer = async (route: Route, reply: LiveReply): Promise<void> => {
    if (reply.kind === 'hold') return answer(route, await reply.until);
    if (reply.kind === 'error') {
      return route.fulfill({
        status: reply.reply.status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(reply.reply.body),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
      body: sseBody(reply.types),
    });
  };
  await page.route('**/v1/me/orders/*/live', async (route) => {
    lives.push(Date.now());
    const reply = options.live?.(lives.length - 1) ?? { kind: 'error', reply: apiError(503, 'SERVICE_UNAVAILABLE') };
    await answer(route, reply).catch(() => undefined);
  });
  return { state, gets, lives };
}

/** Một promise mở bằng tay (giữ kết nối SSE tới khi test cho phép). */
function gate<T>() {
  let open: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Ghi lại các lần `navigator.vibrate` (WebKit không có API này: thêm vào để đếm). */
async function recordVibrations(page: Page): Promise<() => Promise<unknown[]>> {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { __vibrations: unknown[] }).__vibrations = calls;
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: unknown) => {
        calls.push(pattern);
        return true;
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
}

/**
 * `EventSource` giả điều khiển được (`page.route` không giữ được một stream mở rồi đẩy tin sau): mỗi lần trang mở stream
 * là một phần tử của `window.__sse`; test gọi `open()` (kết nối xong), `message(data)` (một tin `data:` trên chính kết
 * nối đó), `drop()` (mất kết nối tạm thời: trình duyệt sẽ tự nối lại, `readyState` CONNECTING).
 */
async function fakeEventSource(page: Page) {
  await page.addInitScript(() => {
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      url: string;
      withCredentials: boolean;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string, init?: { withCredentials?: boolean }) {
        super();
        this.url = url;
        this.withCredentials = Boolean(init?.withCredentials);
        (window as unknown as { __sse: FakeEventSource[] }).__sse.push(this);
      }
      close() {
        this.readyState = 2;
      }
      open() {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
      }
      message(data: string) {
        this.onmessage?.(new MessageEvent('message', { data }));
      }
      drop() {
        this.readyState = 0;
        this.onerror?.(new Event('error'));
      }
    }
    (window as unknown as { __sse: unknown[] }).__sse = [];
    Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: FakeEventSource });
  });
  const last = 'window.__sse[window.__sse.length - 1]';
  return {
    count: () => page.evaluate<number>('window.__sse.length'),
    info: () =>
      page.evaluate<{ url: string; withCredentials: boolean; readyState: number }>(
        `({ url: ${last}.url, withCredentials: ${last}.withCredentials, readyState: ${last}.readyState })`,
      ),
    open: () => page.evaluate(`${last}.open()`),
    message: (type: string) => page.evaluate(`${last}.message(${JSON.stringify(JSON.stringify({ type }))})`),
    drop: () => page.evaluate(`${last}.drop()`),
  };
}

/** Giả lập tab ẩn / hiện lại (Safari cắt kết nối khi tab ở nền; polling của TanStack cũng dừng khi tab ẩn). */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { value: next, configurable: true });
    Object.defineProperty(document, 'hidden', { value: next === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, state);

const success = (page: Page) => page.locator('[data-slot="order-success"]');
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: SUCCESS });
const waitingLine = (page: Page) => page.locator('[data-slot="payment-waiting"]');
const banner = (page: Page) => page.locator('[data-slot="order-view"] [data-slot="status-banner"]');
const contact = (page: Page) => page.locator('[data-slot="organizer-contact"]');
const qrImages = (page: Page) => page.getByRole('img', { name: /^Mã QR vé/ });

async function expectCelebrated(page: Page, vibrations: () => Promise<unknown[]>, celebrated: boolean): Promise<void> {
  await expect(success(page)).toHaveAttribute('data-celebrate', celebrated ? 'true' : 'false');
  await expect(page.locator('[data-slot="ticket-card"]').first()).toHaveCSS('animation-name', celebrated ? 'ticket-rise' : 'none');
  await expect.poll(async () => (await vibrations()).length).toBe(celebrated ? 1 : 0);
}

async function expectContact(page: Page): Promise<void> {
  await expect(contact(page).locator('[data-slot="organizer-contact-name"]')).toHaveText(ORGANIZER.name);
  await expect(contact(page).locator('[data-slot="organizer-contact-phone"]')).toHaveAttribute('href', `tel:${ORGANIZER.contactPhone}`);
  await expect(contact(page).locator('[data-slot="organizer-contact-email"]')).toHaveAttribute(
    'href',
    `mailto:${ORGANIZER.contactEmail}`,
  );
}

test.describe('Trang Đơn tự cập nhật (Story 3.7)', () => {
  test('tín hiệu SSE khi đang mở → tải lại ngay (không chờ polling) → Thành công + khoảnh khắc (trượt lên, rung)', async ({
    page,
  }) => {
    const vibrations = await recordVibrations(page);
    const connection = gate<LiveReply>();
    const api = await mockOrderApi(page, {
      live: (n) => (n === 0 ? { kind: 'hold', until: connection.promise } : { kind: 'error', reply: apiError(503, 'SERVICE_UNAVAILABLE') }),
    });
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    // SSE chưa mở → polling 2 giây. Ngay sau một lần polling, Đơn thành `paid` và tín hiệu tới.
    const polled = api.gets.length;
    await expect.poll(() => api.gets.length, { timeout: 5_000 }).toBeGreaterThan(polled);
    api.state.order = paidOrder();
    const released = Date.now();
    connection.open({ kind: 'stream', types: ['order_changed'] });

    await expect(heading(page)).toBeVisible({ timeout: 3_000 });
    const reload = api.gets.find((at) => at >= released)!;
    // Lần polling kế tiếp còn ~2 giây nữa: lần tải này do SSE mở/tín hiệu.
    expect(reload - released).toBeLessThan(1_000);
    await expectCelebrated(page, vibrations, true);
    await expect(qrImages(page)).toHaveCount(2);
  });

  test('tin data: trên stream đã mở (Đơn vẫn chờ lúc mở) → tải lại trong ~1 giây, trước nhịp polling → Thành công', async ({
    page,
  }) => {
    const sse = await fakeEventSource(page);
    const vibrations = await recordVibrations(page);
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect.poll(sse.count).toBe(1);
    const info = await sse.info();
    expect(info).toMatchObject({ withCredentials: true, readyState: 0 });
    expect(info.url).toMatch(new RegExp(`/v1/me/orders/${CODE}/live$`));

    // Mở stream: tải lại REST một lần, Đơn vẫn chờ.
    const beforeOpen = api.gets.length;
    await sse.open();
    await expect.poll(() => api.gets.length).toBe(beforeOpen + 1);
    await expect(waitingLine(page)).toHaveText(WAITING);
    // Qua cửa sổ gom 1 giây của lần mở; đã kết nối nên không polling.
    await page.waitForTimeout(1_200);
    expect(api.gets.length).toBe(beforeOpen + 1);

    api.state.order = paidOrder();
    const sent = Date.now();
    await sse.message('order_changed');
    await expect.poll(() => api.gets.length, { timeout: 1_500 }).toBe(beforeOpen + 2);
    expect(api.gets.at(-1)! - sent).toBeLessThan(1_200);
    await expect(heading(page)).toBeVisible();
    await expectCelebrated(page, vibrations, true);
  });

  test('SSE đang kết nối → không polling dù Đơn chờ; mất kết nối → polling 2 giây trở lại', async ({ page }) => {
    const sse = await fakeEventSource(page);
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect.poll(sse.count).toBe(1);
    const connected = api.gets.length + 1;
    await sse.open();
    await expect.poll(() => api.gets.length).toBe(connected);
    await page.waitForTimeout(5_000);
    expect(api.gets.length).toBe(connected);

    await sse.drop();
    const dropped = Date.now();
    await expect.poll(() => api.gets.length, { timeout: 6_000 }).toBeGreaterThanOrEqual(connected + 2);
    const resumed = api.gets.slice(connected);
    expect(resumed[0]! - dropped).toBeLessThan(2_700);
    expect(resumed[1]! - resumed[0]!).toBeGreaterThan(1_500);
    expect(resumed[1]! - resumed[0]!).toBeLessThan(2_700);
  });

  test('tab ở nền (không SSE, không polling) khi Đơn thành paid → visible lại → Thành công < 3 giây', async ({ page }) => {
    const vibrations = await recordVibrations(page);
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await setVisibility(page, 'hidden');
    api.state.order = paidOrder();
    const hiddenGets = api.gets.length;
    await page.waitForTimeout(2_500);
    // Tab ẩn: polling dừng, trang chưa biết.
    expect(api.gets.length).toBe(hiddenGets);
    await expect(heading(page)).toHaveCount(0);

    const visibleAt = Date.now();
    await setVisibility(page, 'visible');
    await expect(heading(page)).toBeVisible({ timeout: 3_000 });
    expect(Date.now() - visibleAt).toBeLessThan(3_000);
    await expectCelebrated(page, vibrations, true);
  });

  test('không có SSE → polling 2 giây khi chờ tiền, mở lại SSE có backoff; trạng thái không chờ → không polling', async ({
    page,
  }) => {
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    const start = api.gets.length;
    await expect.poll(() => api.gets.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(start + 2);
    const gaps = api.gets.slice(start).map((at, i, all) => (i === 0 ? null : at - all[i - 1]!)).filter((g) => g !== null);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(1_500);
      expect(gap).toBeLessThan(2_700);
    }
    // SSE bị từ chối (503) → mở lại sau 1, 2… giây.
    expect(api.lives.length).toBeGreaterThanOrEqual(2);

    api.state.order = order({ buyerStatus: 'expired', payment: { ...order().payment, checkoutUrl: null } });
    await expect(banner(page)).toHaveText('Hết thời gian giữ chỗ. Chỗ đã được trả lại.', { timeout: 5_000 });
    const settled = api.gets.length;
    await page.waitForTimeout(3_000);
    expect(api.gets.length).toBe(settled);
  });

  test('không đọc tham số trên URL quay về: ?status=success khi Đơn còn chờ vẫn là màn thanh toán', async ({ page }) => {
    await mockOrderApi(page);
    await page.goto(`${ORDER_PATH}?status=success&code=00&paid=1`);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect(heading(page)).toHaveCount(0);
  });

  test('"Thanh toán" đặt cờ một lần: quay về đã paid → khoảnh khắc; tải lại → hiện ngay, không trượt, không rung', async ({
    page,
  }) => {
    await page.route('https://pay.tingee.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Tingee</title><h1>Tingee</h1>' }),
    );
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await page.getByRole('button', { name: /^Thanh toán/ }).click();
    await page.waitForURL(CHECKOUT_URL);

    api.state.order = paidOrder();
    let vibrations = await recordVibrations(page);
    await page.goto(`${ORDER_PATH}?status=success`);
    await expect(heading(page)).toBeVisible();
    await expectCelebrated(page, vibrations, true);

    await page.reload();
    vibrations = () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
    await expect(heading(page)).toBeVisible();
    await expectCelebrated(page, vibrations, false);
  });

  test('mở thẳng Đơn đã paid (không cờ) → Thành công hiện ngay, không khoảnh khắc', async ({ page }) => {
    const vibrations = await recordVibrations(page);
    const api = await mockOrderApi(page);
    api.state.order = paidOrder();
    await page.goto(ORDER_PATH);
    await expect(heading(page)).toBeVisible();
    await expectCelebrated(page, vibrations, false);
    await expect(qrImages(page)).toHaveCount(2);
  });
});

test.describe('Màn theo buyerStatus', () => {
  test('confirming từ máy chủ (đồng hồ máy còn giờ) → "Đang xác nhận thanh toán", ẩn nút', async ({ page }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({ buyerStatus: 'confirming' });
    await page.goto(ORDER_PATH);
    await expect(page.locator('[data-slot="countdown-chip"]')).toHaveText('Đang xác nhận thanh toán');
    await expect(waitingLine(page)).toHaveText(CONFIRMING);
    await expect(page.getByRole('button', { name: /^Thanh toán/ })).toHaveCount(0);
    await expect(page.getByText('Hết thời gian giữ chỗ.')).toHaveCount(0);
  });

  test('under_review → "BTC đang kiểm tra thanh toán" + liên hệ BTC; không QR, không số tiền lệch', async ({ page }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({ buyerStatus: 'under_review', payment: { ...order().payment, checkoutUrl: null } });
    await page.goto(ORDER_PATH);
    await expect(banner(page)).toHaveText('BTC đang kiểm tra thanh toán');
    await expect(page.locator('[data-slot="order-status-announcement"]')).toHaveText('BTC đang kiểm tra thanh toán');
    await expectContact(page);
    await expect(qrImages(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="order-payment"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('lệch');
  });

  test('cancelled_by_organizer → badge "Đã hủy" + câu hoàn tiền + liên hệ BTC', async ({ page }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({ buyerStatus: 'cancelled_by_organizer', payment: { ...order().payment, checkoutUrl: null } });
    await page.goto(ORDER_PATH);
    await expect(page.locator('[data-slot="status-badge"]')).toHaveText('Đã hủy');
    await expect(banner(page)).toHaveText('BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển.');
    await expectContact(page);
    await expect(qrImages(page)).toHaveCount(0);
  });

  test('event_cancelled → "Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền." + liên hệ BTC, không Mã QR vé', async ({ page }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({ buyerStatus: 'event_cancelled', payment: { ...order().payment, checkoutUrl: null } });
    await page.goto(ORDER_PATH);
    await expect(banner(page)).toHaveText('Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền.');
    await expectContact(page);
    await expect(qrImages(page)).toHaveCount(0);
    await expect(heading(page)).toHaveCount(0);
  });

  test('buyerStatus lạ (kể cả kèm Vé) → "Chúng tôi đang cập nhật trạng thái Đơn." + liên hệ BTC, không QR, không lỗi', async ({
    page,
  }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({ buyerStatus: 'refund_pending', tickets: [ticket(1, 2), ticket(2, 2)] });
    await page.goto(ORDER_PATH);
    await expect(banner(page)).toHaveText('Chúng tôi đang cập nhật trạng thái Đơn.');
    await expectContact(page);
    await expect(qrImages(page)).toHaveCount(0);
    await expect(page.getByText('Chưa tải được Đơn')).toHaveCount(0);
  });

  test('BTC không nhập kênh liên hệ → chỉ còn tên BTC', async ({ page }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({
      buyerStatus: 'under_review',
      organizer: { name: ORGANIZER.name, contactPhone: null, contactEmail: null },
    });
    await page.goto(ORDER_PATH);
    await expect(contact(page).locator('[data-slot="organizer-contact-name"]')).toHaveText(ORGANIZER.name);
    await expect(contact(page).locator('a')).toHaveCount(0);
  });
});

test.describe('Chờ lâu và mất mạng', () => {
  test('đồng hồ về 0 trước mốc chờ lâu → "Đang xác nhận thanh toán"; quá 2 phút → dòng trấn an thay dòng chờ đó', async ({
    page,
  }) => {
    await page.clock.install();
    const api = await mockOrderApi(page);
    api.state.order = order({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await page.clock.fastForward('01:05');
    await expect(page.locator('[data-slot="countdown-chip"]')).toHaveText('Đang xác nhận thanh toán');
    await expect(waitingLine(page)).toHaveText(CONFIRMING);
    await page.clock.fastForward('01:00');
    await expect(page.locator('[data-slot="reassurance-line"]')).toHaveText(REASSURANCE);
    await expect(waitingLine(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="countdown-chip"]')).toHaveText('Đang xác nhận thanh toán');
  });

  test('sau 2 phút ở màn chờ (page.clock) → reassurance-line thay dòng chờ, trong vùng aria-live polite', async ({ page }) => {
    await page.clock.install();
    await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await page.clock.fastForward('01:50');
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect(page.locator('[data-slot="reassurance-line"]')).toHaveCount(0);

    await page.clock.fastForward('00:15');
    const line = page.locator('[data-slot="payment-status"] [data-slot="reassurance-line"]');
    await expect(line).toHaveText(REASSURANCE);
    await expect(page.locator('[data-slot="payment-status"]')).toHaveAttribute('aria-live', 'polite');
    await expect(waitingLine(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Thanh toán/ })).toBeVisible();
  });

  test('trình duyệt báo offline → dòng mất mạng; có mạng lại → tải ngay → Thành công', async ({ page }) => {
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await page.context().setOffline(true);
    await expect(page.locator('[data-slot="offline-line"]')).toHaveText(OFFLINE);

    api.state.order = paidOrder();
    const before = api.gets.length;
    await page.context().setOffline(false);
    await expect(heading(page)).toBeVisible({ timeout: 3_000 });
    expect(api.gets.length).toBeGreaterThan(before);
  });

  test('màn chờ chưa có link ("Chưa tạo được link thanh toán") cũng hiện dòng mất mạng', async ({ page }) => {
    const api = await mockOrderApi(page);
    api.state.order = order({ payment: { ...order().payment, checkoutUrl: null, linkError: 'provider_error' } });
    await page.goto(ORDER_PATH);
    await expect(page.locator('[data-slot="payment-link-error"]')).toHaveText('Chưa tạo được link thanh toán');
    await page.context().setOffline(true);
    await expect(page.locator('[data-slot="payment-status"] [data-slot="offline-line"]')).toHaveText(OFFLINE);
    await page.context().setOffline(false);
    await expect(page.locator('[data-slot="offline-line"]')).toHaveCount(0);
  });

  test('lần tải lại gần nhất lỗi mạng → dòng mất mạng; tải lại được → dòng biến mất', async ({ page }) => {
    const api = await mockOrderApi(page);
    await page.goto(ORDER_PATH);
    await expect(waitingLine(page)).toHaveText(WAITING);
    await expect(page.locator('[data-slot="offline-line"]')).toHaveCount(0);
    api.state.fail = true;
    await expect(page.locator('[data-slot="offline-line"]')).toHaveText(OFFLINE, { timeout: 5_000 });
    // Màn chờ giữ nguyên dữ liệu cũ, không báo lỗi tải Đơn.
    await expect(waitingLine(page)).toHaveText(WAITING);
    api.state.fail = false;
    await expect(page.locator('[data-slot="offline-line"]')).toHaveCount(0, { timeout: 8_000 });
  });
});
