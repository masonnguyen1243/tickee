import type { Locator, Page, Route } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, corsHeaders, EMAIL, me, mockIdentityApi, WEB_ORIGIN, type Reply } from './identity-mock';
import { fakeEventSource, setVisibility } from './live-mock';
import { expectQrImageEncodes } from './qr-image';

/*
 * Story 3.9: "Vé của tôi" (`/tickets`) và Chi tiết Vé (`/tickets/:ticketId`). API (`/v1/me/tickets`, `/:ticketId`,
 * `/live`, tạo lại link) giả bằng `page.route`; luồng SSE giả bằng `EventSource` điều khiển được (`live-mock.ts`). Ca
 * full-stack (stream thật, cách ly hai Người mua, IPN → tín hiệu) ở test tích hợp api `test/ordering/my-tickets.test.ts`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORGANIZER = { name: 'CLB Chạy Bộ Phố Cổ', contactPhone: '0901234567', contactEmail: 'lienhe@clbchaybo.vn' };
const EVENT = { name: 'Giải chạy Hồ Gươm mùa thu 2026', startsAt: '2099-11-15T07:00:00+07:00', venue: 'Hồ Hoàn Kiếm, Hà Nội' };
const CODE = 'TK8F3Q2AXM';
const PENDING_CODE = 'TK7M2P9XAB';
const OTHER_CODE = 'TK5NQ8RZ2C';
const HOLDER = 'Nguyễn Văn An';

const ticketId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
const ticketQr = (n: number) => `t1.${ticketId(n)}.${String(n).padStart(43, 'q')}`;
/** Token giả 22 ký tự base64url, phiên bản `v` của link Vé `n`. */
const shareToken = (n: number, v = 1) => `share${v}${String(n).padStart(16, 'S')}`;

function activeTicket(n: number, patch: Record<string, unknown> = {}) {
  return {
    id: ticketId(n),
    event: EVENT,
    ticketTypeName: 'Vé VIP',
    seq: n,
    count: 2,
    orderCode: CODE,
    status: 'valid',
    ...patch,
  };
}

function pendingOrder(code: string, patch: Record<string, unknown> = {}) {
  return {
    code,
    buyerStatus: 'awaiting_payment',
    event: { name: 'Workshop Pha chế Cà phê Mộc', startsAt: '2099-11-30T09:00:00+07:00', venue: null },
    items: [{ name: 'Vé thường', quantity: 2 }],
    totalAmount: 400_000,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    organizer: ORGANIZER,
    ...patch,
  };
}

function historyTicket(n: number, patch: Record<string, unknown> = {}) {
  return {
    id: ticketId(n),
    eventName: 'Giải Pickleball Mùa hè',
    eventStartsAt: '2026-06-15T07:00:00+07:00',
    ticketTypeName: 'Đơn nam',
    seq: 1,
    count: 1,
    attended: true,
    ...patch,
  };
}

type View = { active: unknown[]; pending: unknown[]; history: unknown[] };
const emptyView = (): View => ({ active: [], pending: [], history: [] });

function ticketDetail(patch: Record<string, unknown> = {}) {
  return {
    id: ticketId(1),
    event: EVENT,
    ticketTypeName: 'Vé VIP',
    seq: 1,
    count: 2,
    holderName: HOLDER,
    status: 'valid',
    attended: false,
    eventCancelled: false,
    ended: false,
    qr: ticketQr(1),
    shareToken: shareToken(1),
    organizer: ORGANIZER,
    receipt: {
      orderCode: CODE,
      items: [{ name: 'Vé VIP', unitPrice: 300_000, quantity: 2, amount: 600_000 }],
      totalAmount: 600_000,
      paidAt: '2026-11-10T03:04:00.000Z',
    },
    ...patch,
  };
}

const cors = corsHeaders(WEB_ORIGIN);
const reply = (route: Route, r: Reply) =>
  route.fulfill({
    status: r.status,
    headers: { ...cors, 'content-type': 'application/json' },
    body: r.body === undefined ? '' : JSON.stringify(r.body),
  });

type Held = { until: Promise<void> };

/**
 * Đã đăng nhập; `GET /me/tickets` trả `state.view` kèm `serverNow` = giờ thật + `state.serverOffsetMs` (ghi giờ từng lần
 * gọi; `state.hold` giữ lần gọi lại); `GET /me/tickets/:id` trả `state.detail`; SSE `/me/tickets/live` 503 (không
 * realtime) trừ khi dùng `fakeEventSource`; `POST /me/tickets/:id/share-link` tăng phiên bản link.
 */
async function mockMyTickets(page: Page) {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const state = {
    view: emptyView(),
    serverOffsetMs: 0,
    hold: null as Held | null,
    detail: ticketDetail() as Record<string, unknown> | Reply,
    version: 1,
    lists: [] as number[],
    details: 0,
    lives: [] as string[],
    /** Số lần tải danh sách / Chi tiết Vé kế tiếp trả `500` (đếm lùi); `failedDetails`: số lần Chi tiết Vé đã trả `500`. */
    failLists: 0,
    failDetails: 0,
    failedDetails: 0,
  };
  await page.route(
    (url) => /\/v1\/me\/tickets(\/|$)/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(request.url());
      const rest = url.pathname.replace(/^.*\/v1\/me\/tickets/, '');
      if (rest === '' || rest === '/') {
        state.lists.push(Date.now());
        if (state.failLists > 0) {
          state.failLists -= 1;
          return reply(route, apiError(500, 'INTERNAL_ERROR'));
        }
        const held = state.hold;
        if (held) await held.until;
        const serverNow = new Date(Date.now() + state.serverOffsetMs).toISOString();
        return reply(route, { status: 200, body: { serverNow, ...state.view } }).catch(() => undefined);
      }
      if (rest === '/live') {
        state.lives.push(url.search);
        return reply(route, apiError(503, 'SERVICE_UNAVAILABLE'));
      }
      if (rest.endsWith('/share-link')) {
        state.version += 1;
        return reply(route, { status: 200, body: { shareToken: shareToken(1, state.version) } });
      }
      state.details += 1;
      if (state.failDetails > 0) {
        state.failDetails -= 1;
        state.failedDetails += 1;
        return reply(route, apiError(500, 'INTERNAL_ERROR'));
      }
      const detail = state.detail;
      if (typeof detail.status === 'number') return reply(route, detail as Reply);
      const body = detail as Record<string, unknown>;
      return reply(route, { status: 200, body: { ...body, shareToken: body.shareToken === null ? null : shareToken(1, state.version) } });
    },
  );
  return state;
}

/** Ghi lại `navigator.wakeLock.request` (thay API thật): số lần xin, số lần nhả. `deny`: luôn từ chối. */
async function recordWakeLock(page: Page, mode: 'grant' | 'deny' = 'grant') {
  await page.addInitScript((m) => {
    const calls = { requests: 0, released: 0 };
    (window as unknown as { __wakeLock: typeof calls }).__wakeLock = calls;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: (type: string) => {
          calls.requests += 1;
          if (m === 'deny') return Promise.reject(new DOMException('Không cho phép', 'NotAllowedError'));
          const sentinel = Object.assign(new EventTarget(), {
            type,
            released: false,
            release() {
              if (sentinel.released) return Promise.resolve();
              sentinel.released = true;
              calls.released += 1;
              sentinel.dispatchEvent(new Event('release'));
              return Promise.resolve();
            },
          });
          return Promise.resolve(sentinel);
        },
      },
    });
  }, mode);
  return () => page.evaluate(() => (window as unknown as { __wakeLock: { requests: number; released: number } }).__wakeLock);
}

/** Thay `navigator.share` để ghi lại nội dung chia sẻ. */
async function recordWebShare(page: Page): Promise<() => Promise<ShareData[]>> {
  await page.addInitScript(() => {
    const calls: ShareData[] = [];
    (window as unknown as { __shared: ShareData[] }).__shared = calls;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: ShareData) => {
        calls.push(data);
        return Promise.resolve();
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared);
}

const main = (page: Page) => page.locator('main');
const rows = (page: Page) => page.locator('[data-slot="ticket-row"]');
const cards = (page: Page) => page.locator('[data-slot="order-card"]');
const groupHeadings = (page: Page) => main(page).getByRole('heading', { level: 2 });
const qrImages = (page: Page) => page.getByRole('img', { name: /^Mã QR vé/ });

test.describe('Vé của tôi /tickets', () => {
  test('tải lần đầu: Skeleton 2 thẻ; rồi ba nhóm đúng thứ tự, dòng Vé mở Chi tiết, badge theo trạng thái, không QR', async ({
    page,
  }) => {
    const api = await mockMyTickets(page);
    let release: () => void = () => undefined;
    api.hold = { until: new Promise<void>((resolve) => (release = resolve)) };
    api.view = {
      active: [
        activeTicket(1),
        activeTicket(2, { status: 'checked_in' }),
        activeTicket(3, { orderCode: OTHER_CODE, seq: 1, count: 1, status: 'cancelled', event: { ...EVENT, venue: null } }),
      ],
      pending: [pendingOrder(PENDING_CODE)],
      history: [historyTicket(4), historyTicket(5, { attended: false, eventName: 'Workshop Làm nến thơm' })],
    };
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vé của tôi');
    const skeleton = page.locator('[data-slot="my-tickets-skeleton"]');
    await expect(skeleton.locator('[data-slot="skeleton"]')).toHaveCount(2);
    await expect(skeleton).toHaveAttribute('aria-busy', 'true');
    api.hold = null;
    release();

    await expect(groupHeadings(page)).toHaveText(['Vé còn hiệu lực', 'Đơn đang chờ', 'Lịch sử']);
    await expect(skeleton).toHaveCount(0);
    const active = page.locator('[data-slot="my-tickets-active"]');
    await expect(active.locator('[data-slot="ticket-row"]')).toHaveCount(3);
    const first = active.locator('[data-slot="ticket-row"]').first();
    await expect(first).toHaveAttribute('href', `/tickets/${ticketId(1)}`);
    await expect(first).toContainText(EVENT.name);
    await expect(first).toContainText('Chủ nhật, 15/11/2099 · 07:00');
    await expect(first).toContainText(EVENT.venue);
    await expect(first.locator('[data-slot="ticket-row-tier"]')).toHaveText('Vé VIP · Vé 1/2');
    await expect(active.locator('[data-slot="status-badge"]')).toHaveText(['Hợp lệ', 'Đã check-in', 'Đã hủy']);
    const tones = await active.locator('[data-slot="status-badge"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')));
    expect(tones).toEqual(['success', 'neutral', 'danger']);

    await expect(cards(page)).toHaveCount(1);
    const history = page.locator('[data-slot="my-tickets-history"] [data-slot="ticket-row"]');
    await expect(history.locator('[data-slot="ticket-row-when"]')).toHaveText([
      '15/06/2026 · Đã tham dự',
      '15/06/2026 · Chưa check-in',
    ]);
    await expect(history.locator('[data-slot="status-badge"]')).toHaveCount(0);
    await expect(history.first()).toHaveAttribute('href', `/tickets/${ticketId(4)}`);
    // Danh sách không bao giờ có Mã QR vé.
    await expect(qrImages(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="qr-plate"]')).toHaveCount(0);

    // Chạm dòng Vé → Chi tiết Vé.
    await first.click();
    await page.waitForURL(`**/tickets/${ticketId(1)}`);
    await expect(page.locator('[data-slot="ticket-card"]')).toBeVisible();
  });

  test('nhóm rỗng thì ẩn: chỉ có Vé còn hiệu lực → một nhóm', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.view = { ...emptyView(), active: [activeTicket(1)] };
    await page.goto('/tickets');
    await expect(groupHeadings(page)).toHaveText(['Vé còn hiệu lực']);
    await expect(page.locator('[data-slot="my-tickets-pending"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="my-tickets-history"]')).toHaveCount(0);
  });

  test('không có gì → empty-state "Bạn chưa có vé nào. Vé bạn mua sẽ hiện ở đây.", không nút', async ({ page }) => {
    await mockMyTickets(page);
    await page.goto('/tickets');
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toBeVisible();
    await expect(empty.getByText('Bạn chưa có vé nào.', { exact: true })).toBeVisible();
    await expect(empty.getByText('Vé bạn mua sẽ hiện ở đây.', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('button')).toHaveCount(0);
    await expect(main(page).getByRole('link')).toHaveCount(0);
    await expect(groupHeadings(page)).toHaveCount(0);
  });

  test('order-card chờ thanh toán: đếm theo serverNow (không theo đồng hồ máy), "Tiếp tục thanh toán" → Trang Đơn; về 0 → "Đang xác nhận thanh toán", vẫn ở nhóm', async ({
    page,
  }) => {
    await page.clock.install();
    const api = await mockMyTickets(page);
    // Đồng hồ máy chậm 1 giờ so với máy chủ: còn 5 phút theo máy chủ (đếm theo máy sẽ ra 65 phút).
    api.serverOffsetMs = 60 * 60_000;
    api.view = {
      ...emptyView(),
      pending: [pendingOrder(PENDING_CODE, { expiresAt: new Date(Date.now() + 60 * 60_000 + 5 * 60_000).toISOString() })],
    };
    await page.goto('/tickets');
    const card = cards(page).first();
    await expect(card).toHaveAttribute('data-status', 'awaiting_payment');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Chờ thanh toán');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'warning');
    await expect(card.locator('[data-slot="countdown-chip"]')).toHaveText(/^Giữ chỗ còn 0[45]:\d\d$/);
    await expect(card.locator('[data-slot="countdown-chip"]')).toHaveAttribute('data-surface', 'light');
    // Nhiều thẻ trong danh sách: chip trên nền sáng không có vùng đọc mốc.
    await expect(card.locator('[data-slot="countdown-announcement"]')).toHaveCount(0);
    await expect(card.locator('[data-slot="order-card-items"]')).toHaveText('Vé thường × 2');
    await expect(card.locator('[data-slot="order-card-total"]')).toHaveText('400.000đ');
    await expect(card.locator('[data-slot="order-code"]')).toHaveText(PENDING_CODE);
    await expect(card.locator('[data-slot="organizer-contact"]')).toHaveCount(0);
    const resume = card.getByRole('link', { name: 'Tiếp tục thanh toán' });
    await expect(resume).toHaveAttribute('href', `/orders/${PENDING_CODE}`);

    await page.clock.fastForward('05:05');
    await expect(card.locator('[data-slot="countdown-chip"]')).toHaveText('Đang xác nhận thanh toán');
    await expect(resume).toHaveCount(0);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByText('Hết hạn')).toHaveCount(0);
  });

  test('"Tiếp tục thanh toán" mở lại đúng Trang Đơn', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.view = { ...emptyView(), pending: [pendingOrder(PENDING_CODE)] };
    await page.goto('/tickets');
    await cards(page).first().getByRole('link', { name: 'Tiếp tục thanh toán' }).click();
    await page.waitForURL(`**/orders/${PENDING_CODE}`);
  });

  test('order-card theo buyerStatus: under_review, Đã hủy (mờ, liên hệ BTC), Hết hạn (máy chủ báo, chỉ badge), lạ; không QR, không nút chính', async ({
    page,
  }) => {
    const api = await mockMyTickets(page);
    api.view = {
      ...emptyView(),
      pending: [
        pendingOrder('TK4HJK6MNP', { buyerStatus: 'under_review' }),
        pendingOrder('TK3RST9VWX', { buyerStatus: 'cancelled_by_organizer' }),
        pendingOrder('TK2YZ7ABCD', { buyerStatus: 'event_cancelled' }),
        pendingOrder('TK9ABCDEFG', { buyerStatus: 'expired', expiresAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
        pendingOrder('TK6HJKMNPQ', { buyerStatus: 'refund_pending' }),
      ],
    };
    await page.goto('/tickets');
    await expect(cards(page)).toHaveCount(5);
    const [review, rejected, cancelled, expired, unknown] = [0, 1, 2, 3, 4].map((i) => cards(page).nth(i)) as [
      Locator,
      Locator,
      Locator,
      Locator,
      Locator,
    ];

    await expect(review.locator('[data-slot="status-badge"]')).toHaveText('BTC đang kiểm tra thanh toán');
    await expect(review.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'warning');
    await expect(review.locator('[data-slot="organizer-contact-name"]')).toHaveText(ORGANIZER.name);
    await expect(review.locator('[data-slot="organizer-contact-phone"]')).toHaveAttribute('href', `tel:${ORGANIZER.contactPhone}`);
    await expect(review.locator('[data-slot="organizer-contact"] h4')).toHaveText('Liên hệ BTC');
    await expect(review.locator('[data-slot="countdown-chip"]')).toHaveCount(0);
    await expect(review).not.toHaveAttribute('data-dimmed', /.*/);

    for (const [card, note] of [
      [rejected, 'BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển.'],
      [cancelled, 'Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền.'],
    ] as const) {
      await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Đã hủy');
      await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
      await expect(card).toHaveAttribute('data-dimmed', 'true');
      await expect(card.locator('[data-slot="order-card-note"]')).toHaveText(note);
      await expect(card.locator('[data-slot="organizer-contact-email"]')).toHaveAttribute('href', `mailto:${ORGANIZER.contactEmail}`);
    }

    await expect(expired.locator('[data-slot="status-badge"]')).toHaveText('Hết hạn');
    await expect(expired.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
    // Chỉ badge: danh sách không biết Đơn hết hạn vì hết giờ hay vì BTC tạm ngừng bán (Trang Đơn ghi đúng câu).
    await expect(expired.locator('[data-slot="order-card-note"]')).toHaveCount(0);
    await expect(expired.locator('[data-slot="organizer-contact"]')).toHaveCount(0);
    await expect(expired.locator('[data-slot="countdown-chip"]')).toHaveCount(0);

    await expect(unknown.locator('[data-slot="order-card-note"]')).toHaveText('Chúng tôi đang cập nhật trạng thái Đơn.');
    await expect(unknown.locator('[data-slot="organizer-contact"]')).toHaveCount(1);

    // Không nút chính (link duy nhất là kênh liên hệ BTC: gọi điện, email).
    await expect(cards(page).getByRole('link', { name: 'Tiếp tục thanh toán' })).toHaveCount(0);
    await expect(cards(page).locator('a:not([href^="tel:"]):not([href^="mailto:"])')).toHaveCount(0);
    await expect(cards(page).getByRole('button')).toHaveCount(0);
    await expect(qrImages(page)).toHaveCount(0);
  });

  test('máy chủ báo confirming (hạn đã qua) → badge "Chờ thanh toán", chip "Đang xác nhận thanh toán", không "Tiếp tục thanh toán"', async ({
    page,
  }) => {
    const api = await mockMyTickets(page);
    api.view = {
      ...emptyView(),
      pending: [pendingOrder(PENDING_CODE, { buyerStatus: 'confirming', expiresAt: new Date(Date.now() - 60_000).toISOString() })],
    };
    await page.goto('/tickets');
    const card = cards(page).first();
    await expect(card).toHaveAttribute('data-status', 'confirming');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Chờ thanh toán');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'warning');
    await expect(card.locator('[data-slot="countdown-chip"]')).toHaveText('Đang xác nhận thanh toán');
    await expect(card.getByRole('link', { name: 'Tiếp tục thanh toán' })).toHaveCount(0);
    await expect(card.locator('[data-slot="order-card-note"]')).toHaveCount(0);
    await expect(page.getByText('Chúng tôi đang cập nhật trạng thái Đơn.')).toHaveCount(0);
  });

  test('tải lỗi 5xx → "Chưa tải được Vé của bạn" (không phải danh sách rỗng); "Thử lại" tải được', async ({ page }) => {
    const api = await mockMyTickets(page);
    // Query tự thử lại 2 lần với lỗi 5xx: 3 lần 500 thì mới hiện banner.
    api.failLists = 3;
    api.view = { ...emptyView(), active: [activeTicket(1)] };
    await page.goto('/tickets');
    await expect(page.getByText('Chưa tải được Vé của bạn')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="empty-state"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('Chưa tải được Vé của bạn')).toHaveCount(0);
  });

  test('tín hiệu SSE → tải lại: thẻ Đơn rời nhóm, Vé hiện mà không tải lại trang; tập mã Đơn đổi → mở lại stream', async ({
    page,
  }) => {
    const sse = await fakeEventSource(page);
    const api = await mockMyTickets(page);
    api.view = { ...emptyView(), active: [activeTicket(1, { orderCode: OTHER_CODE, seq: 1, count: 1 })], pending: [pendingOrder(PENDING_CODE)] };
    await page.goto('/tickets');
    await expect(cards(page)).toHaveCount(1);
    await expect.poll(sse.count).toBe(1);
    const info = await sse.info();
    expect(info.withCredentials).toBe(true);
    expect(info.url).toMatch(/\/v1\/me\/tickets\/live\?orders=[0-9a-f]{8}$/);

    const beforeOpen = api.lists.length;
    await sse.open();
    await expect.poll(() => api.lists.length).toBe(beforeOpen + 1);
    // Qua cửa sổ gom 1 giây; đã kết nối nên không polling dù có Đơn chờ tiền.
    await page.waitForTimeout(1_200);
    expect(api.lists.length).toBe(beforeOpen + 1);

    // IPN: Đơn chờ thành Vé.
    api.view = {
      ...emptyView(),
      active: [
        activeTicket(1, { orderCode: OTHER_CODE, seq: 1, count: 1 }),
        activeTicket(7, { orderCode: PENDING_CODE, seq: 1, count: 2 }),
        activeTicket(8, { orderCode: PENDING_CODE, seq: 2, count: 2 }),
      ],
    };
    const sent = Date.now();
    await sse.message('order_changed');
    await expect(cards(page)).toHaveCount(0, { timeout: 1_500 });
    expect(Date.now() - sent).toBeLessThan(1_500);
    await expect(page.locator('[data-slot="my-tickets-pending"]')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);
    // Mã Đơn chờ chuyển sang nhóm Vé: tập mã Đơn không đổi, không mở lại stream.
    await page.waitForTimeout(300);
    expect(await sse.count()).toBe(1);

    // Đơn mới (vd. từ tab khác) hiện ra lần tải sau → tập đổi → đóng stream cũ, mở stream mới.
    api.view = { ...api.view, pending: [pendingOrder('TK4HJK6MNP')] };
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await expect(cards(page)).toHaveCount(1);
    await expect.poll(sse.count).toBe(2);
    const all = await sse.all();
    expect(all[0]!.readyState).toBe(2);
    expect(all[1]!.url).not.toBe(all[0]!.url);
  });

  test('không có SSE (503) → polling 2 giây khi có Đơn chờ tiền; không có Đơn chờ → không polling', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.view = { ...emptyView(), pending: [pendingOrder(PENDING_CODE)] };
    await page.goto('/tickets');
    await expect(cards(page)).toHaveCount(1);
    const start = api.lists.length;
    await expect.poll(() => api.lists.length, { timeout: 6_000 }).toBeGreaterThanOrEqual(start + 2);
    expect(api.lives.length).toBeGreaterThanOrEqual(1);

    api.view = { ...emptyView(), active: [activeTicket(1)] };
    await expect(rows(page)).toHaveCount(1, { timeout: 4_000 });
    const settled = api.lists.length;
    await page.waitForTimeout(3_000);
    expect(api.lists.length).toBe(settled);
  });
});

test.describe('Chi tiết Vé /tickets/:ticketId', () => {
  test('Vé hợp lệ: ticket-card + QR đầy đủ, Chia sẻ Vé / Tạo lại link, biên nhận; giữ màn hình sáng khi hiện QR, nhả khi rời trang', async ({
    page,
  }) => {
    const wakeLock = await recordWakeLock(page);
    const api = await mockMyTickets(page);
    api.view = { ...emptyView(), active: [activeTicket(1)] };
    await page.goto(`/tickets/${ticketId(1)}`);
    const card = page.locator('[data-slot="ticket-card"]');
    await expect(card).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Vé 1/2 · ${EVENT.name}`);
    await expect(card.locator('[data-slot="ticket-card-tier"]')).toHaveText('Vé VIP');
    await expect(card.locator('[data-slot="ticket-card-position"]')).toHaveText('· Vé 1/2');
    await expect(card.locator('[data-slot="ticket-card-holder"]')).toHaveText(HOLDER);
    await expect(card.locator('[data-slot="ticket-card-venue"]')).toHaveText(EVENT.venue);
    await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Hợp lệ');
    await expect(card.locator('[data-slot="ticket-card-qr-label"]')).toHaveText('Mã QR vé · đưa cho CTV ở cổng');
    const plate = card.locator('[data-slot="qr-plate"]');
    await expect(plate).toHaveCSS('opacity', '1');
    await expectQrImageEncodes(plate.getByRole('img'), ticketQr(1));
    await expect(card.getByRole('button', { name: 'Chia sẻ Vé 1/2' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Tạo lại link Vé 1/2' })).toBeVisible();

    const receipt = page.locator('[data-slot="ticket-receipt"]');
    await expect(receipt.getByRole('heading', { level: 2 })).toHaveText('Biên nhận');
    await expect(receipt.locator('[data-slot="receipt-order-code"]')).toHaveText(CODE);
    await expect(receipt.locator('[data-slot="receipt-line"]')).toHaveText(['Vé VIP × 2600.000đ']);
    await expect(receipt.locator('[data-slot="receipt-total"]')).toHaveText('600.000đ');
    await expect(receipt.locator('[data-slot="receipt-paid-at"]')).toHaveText('Thanh toán lúc 10:04 10/11/2026 (giờ Việt Nam)');
    await expect(receipt.locator('[data-slot="receipt-recipient"]')).toHaveText(`Tiền đã chuyển thẳng cho ${ORGANIZER.name}`);
    await expect(page.locator('[data-slot="organizer-contact"]')).toHaveCount(0);

    await expect.poll(async () => (await wakeLock()).requests).toBe(1);
    // Tab ẩn → nhả; hiện lại → xin lại.
    await setVisibility(page, 'hidden');
    await expect.poll(async () => (await wakeLock()).released).toBe(1);
    await setVisibility(page, 'visible');
    await expect.poll(async () => (await wakeLock()).requests).toBe(2);
    // Rời trang (về Vé của tôi) → nhả.
    await page.getByRole('link', { name: 'Vé của tôi', exact: true }).first().click();
    await page.waitForURL('**/tickets');
    await expect.poll(async () => (await wakeLock()).released).toBe(2);
  });

  test('Wake Lock bị từ chối → bỏ qua, trang vẫn hiện QR, không báo lỗi', async ({ page }) => {
    const wakeLock = await recordWakeLock(page, 'deny');
    await mockMyTickets(page);
    await page.goto(`/tickets/${ticketId(1)}`);
    await expect(qrImages(page)).toHaveCount(1);
    await expect.poll(async () => (await wakeLock()).requests).toBe(1);
    await expect(page.locator('[data-slot="status-banner"]')).toHaveCount(0);
  });

  test('"Tạo lại link" ở Chi tiết Vé → token mới vào Vé, "Chia sẻ Vé" ra link mới', async ({ page }) => {
    const shared = await recordWebShare(page);
    const api = await mockMyTickets(page);
    await page.goto(`/tickets/${ticketId(1)}`);
    await page.getByRole('button', { name: 'Tạo lại link Vé 1/2' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo lại link' }).click();
    await expect(page.getByText('Đã tạo link mới cho Vé 1/2')).toBeVisible();
    await expect.poll(() => api.details).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Chia sẻ Vé 1/2' }).click();
    await expect.poll(async () => (await shared()).map((d) => d.url)).toEqual([`${WEB_ORIGIN}/xem-ve#${shareToken(1, 2)}`]);
  });

  test('tạo lại link xong mà tải lại Vé lỗi (5xx) → thẻ vẫn hiện, "Chia sẻ Vé" ra link mới (không bao giờ link đã chết)', async ({
    page,
  }) => {
    const shared = await recordWebShare(page);
    const api = await mockMyTickets(page);
    await page.goto(`/tickets/${ticketId(1)}`);
    await expect(qrImages(page)).toHaveCount(1);
    api.failDetails = 100;

    await page.getByRole('button', { name: 'Tạo lại link Vé 1/2' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo lại link' }).click();
    await expect(page.getByText('Đã tạo link mới cho Vé 1/2')).toBeVisible();
    await expect.poll(() => api.failedDetails).toBeGreaterThan(0);
    await expect(page.locator('[data-slot="ticket-card"]')).toBeVisible();

    await page.getByRole('button', { name: 'Chia sẻ Vé 1/2' }).click();
    await expect.poll(async () => (await shared()).map((d) => d.url)).toEqual([`${WEB_ORIGIN}/xem-ve#${shareToken(1, 2)}`]);
  });

  test('tải lỗi 5xx → "Chưa tải được Vé" (không phải "Không tìm thấy Vé"); "Thử lại" tải được', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.failDetails = 3;
    await page.goto(`/tickets/${ticketId(1)}`);
    await expect(page.getByText('Chưa tải được Vé', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Không tìm thấy Vé')).toHaveCount(0);
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.locator('[data-slot="ticket-card"]')).toBeVisible();
    await expect(page.getByText('Chưa tải được Vé', { exact: true })).toHaveCount(0);
  });

  test('đã check-in → QR mờ .25 + badge "Đã check-in"', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.detail = ticketDetail({ status: 'checked_in', attended: true });
    await page.goto(`/tickets/${ticketId(1)}`);
    const card = page.locator('[data-slot="ticket-card"]');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Đã check-in');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
    await expect(card.locator('[data-slot="qr-plate"]')).toHaveCSS('opacity', '0.25');
    await expect(card.getByRole('img', { name: 'Mã QR vé 1 trên 2, Vé VIP, đã check-in' })).toBeVisible();
  });

  test('đã hủy: Sự kiện hủy → "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền."; Vé hủy → liên hệ BTC; không QR, không chia sẻ, không giữ màn hình', async ({
    page,
  }) => {
    const wakeLock = await recordWakeLock(page);
    const api = await mockMyTickets(page);
    api.detail = ticketDetail({ status: 'cancelled', eventCancelled: true, qr: null, shareToken: null });
    await page.goto(`/tickets/${ticketId(1)}`);
    const card = page.locator('[data-slot="ticket-card"]');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Đã hủy');
    await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger');
    await expect(page.locator('[data-slot="status-banner"]')).toHaveText('Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền.');
    await expect(page.locator('[data-slot="organizer-contact"]')).toHaveCount(0);
    await expect(card.locator('[data-slot="qr-plate"]')).toHaveCount(0);
    await expect(card.locator('[data-slot="ticket-card-tear"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Chia sẻ Vé|Tạo lại link/ })).toHaveCount(0);
    await expect(page.locator('[data-slot="ticket-receipt"]')).toBeVisible();

    api.detail = ticketDetail({ status: 'cancelled', eventCancelled: false, qr: null, shareToken: null });
    await page.reload();
    await expect(page.locator('[data-slot="ticket-card"] [data-slot="status-badge"]')).toHaveText('Đã hủy');
    await expect(page.locator('[data-slot="organizer-contact-name"]')).toHaveText(ORGANIZER.name);
    await expect(page.locator('[data-slot="status-banner"]')).toHaveCount(0);
    expect((await wakeLock()).requests).toBe(0);
  });

  test('sau mốc kết thúc: hàng lịch sử ("Đã tham dự"), không QR, không chia sẻ; biên nhận Đơn 0đ "Miễn phí", không "Tiền đã chuyển thẳng"', async ({
    page,
  }) => {
    const wakeLock = await recordWakeLock(page);
    const api = await mockMyTickets(page);
    api.detail = ticketDetail({
      status: 'checked_in',
      attended: true,
      ended: true,
      qr: null,
      shareToken: null,
      event: { ...EVENT, startsAt: '2026-06-15T07:00:00+07:00' },
      receipt: {
        orderCode: CODE,
        items: [{ name: 'Vé tham dự', unitPrice: 0, quantity: 1, amount: 0 }],
        totalAmount: 0,
        paidAt: '2026-06-01T01:00:00.000Z',
      },
    });
    await page.goto(`/tickets/${ticketId(1)}`);
    const row = page.locator('[data-slot="ticket-history"]');
    await expect(row).toContainText(EVENT.name);
    await expect(row.locator('[data-slot="ticket-history-when"]')).toHaveText('15/06/2026 · Đã tham dự');
    await expect(row).toContainText('Vé VIP · Vé 1/2');
    await expect(page.locator('[data-slot="ticket-card"]')).toHaveCount(0);
    await expect(qrImages(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Chia sẻ Vé|Tạo lại link/ })).toHaveCount(0);
    const receipt = page.locator('[data-slot="ticket-receipt"]');
    await expect(receipt.locator('[data-slot="receipt-line"]')).toHaveText(['Vé tham dự × 1Miễn phí']);
    await expect(receipt.locator('[data-slot="receipt-total"]')).toHaveText('Miễn phí');
    await expect(receipt.locator('[data-slot="receipt-paid-at"]')).toHaveText('Đăng ký lúc 08:00 01/06/2026 (giờ Việt Nam)');
    await expect(receipt.locator('[data-slot="receipt-recipient"]')).toHaveCount(0);
    expect((await wakeLock()).requests).toBe(0);

    api.detail = ticketDetail({ ended: true, attended: false, qr: null, shareToken: null });
    await page.reload();
    await expect(page.locator('[data-slot="ticket-history-when"]')).toHaveText('15/11/2099 · Chưa check-in');
  });

  test('404 TICKET_NOT_FOUND → empty-state "Không tìm thấy Vé"', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.detail = apiError(404, 'TICKET_NOT_FOUND');
    await page.goto(`/tickets/${ticketId(9)}`);
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toContainText('Không tìm thấy Vé');
    await expect(page.locator('[data-slot="ticket-card"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="ticket-receipt"]')).toHaveCount(0);
  });
});

test.describe('lối vào Vé của tôi', () => {
  test('menu tài khoản có "Vé của tôi" → /tickets', async ({ page }) => {
    await mockMyTickets(page);
    await page.goto(`/tickets/${ticketId(1)}`);
    await page.getByRole('button', { name: `Tài khoản: ${EMAIL}` }).click();
    const item = page.getByRole('menuitem', { name: 'Vé của tôi' });
    await expect(item).toHaveAttribute('href', '/tickets');
    await item.click();
    await page.waitForURL('**/tickets');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vé của tôi');
  });

  test('màn Thành công: nút chính "Xem Vé của tôi" cuối màn → /tickets', async ({ page }) => {
    const api = await mockMyTickets(page);
    api.view = { ...emptyView(), active: [activeTicket(1), activeTicket(2)] };
    await page.route('**/v1/me/orders/*', (route) =>
      reply(route, {
        status: 200,
        body: {
          code: CODE,
          buyerStatus: 'paid',
          event: { slug: 'giai-chay-ho-guom', name: EVENT.name, startsAt: EVENT.startsAt, ended: false },
          items: [{ ticketTypeId: '019a3b2c-0800-7abc-8def-000000000001', name: 'Vé VIP', unitPrice: 0, quantity: 2, amount: 0 }],
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
            ticketTypeName: 'Vé VIP',
            holderName: HOLDER,
            qr: ticketQr(n),
            shareToken: shareToken(n),
          })),
          organizer: ORGANIZER,
        },
      }),
    );
    await page.route('**/v1/me/orders/*/live', (route) => reply(route, apiError(503, 'SERVICE_UNAVAILABLE')));
    await page.goto(`/orders/${CODE}`);
    const button = page.locator('[data-slot="order-success"]').getByRole('link', { name: 'Xem Vé của tôi' });
    await expect(button).toBeVisible();
    // Nút chính trên nền sáng (`button-primary-on-light`), sau mã Đơn, cuối màn.
    await expect(button).toHaveClass(/bg-btn-on-light/);
    await button.click();
    await page.waitForURL('**/tickets');
    await expect(rows(page)).toHaveCount(2);
  });
});
