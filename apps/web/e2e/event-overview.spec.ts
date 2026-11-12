import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, type Call, type Reply } from './identity-mock';
import { fakeEventSource, setVisibility } from './live-mock';
import { emptyOverview, mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Story 3.11: tab Tổng quan của Sự kiện đã rời nháp có `stat-card` doanh thu và `recent-orders-block` (5 Đơn gần đây) nằm
 * trên thẻ "Thông tin", tự cập nhật qua `useLiveResource` (SSE `…/overview/live` giả bằng `EventSource` điều khiển được,
 * hoặc 503 → polling 10 giây). Giờ luôn theo giờ Việt Nam: trình duyệt chạy múi giờ New York. Ca full-stack (stream thật,
 * IPN → tín hiệu, lọc theo Sự kiện) ở test tích hợp api `test/reporting/event-overview.test.ts`.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const eventPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const overviewPath = `${eventPath}/overview`;
/** "Bây giờ" của các ca cần nhãn giờ cố định: 12/11/2026 10:04 giờ Việt Nam. */
const NOW = new Date('2026-11-12T10:04:00+07:00');

type Status = 'draft' | 'published' | 'hidden' | 'cancelled';

const eventOf = (status: Status) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: 'giai-cau-long-ba-dinh-2026-c4d5',
  name: 'Giải cầu lông Ba Đình 2026',
  status,
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  effectiveEndAt: '2099-11-16T23:59:59+07:00',
  endedManuallyAt: null,
  venue: 'Nhà thi đấu Quần Ngựa',
  description: null,
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

type RecentOrder = {
  code: string;
  buyerName: string;
  ticketCount: number;
  totalAmount: number;
  status: string;
  createdAt: string;
  review: { type: string; receivedAmount: number | null } | null;
};

const order = (patch: Partial<RecentOrder> & Pick<RecentOrder, 'code'>): RecentOrder => ({
  buyerName: 'Nguyễn Văn Minh',
  ticketCount: 1,
  totalAmount: 300_000,
  status: 'paid',
  createdAt: '2026-11-12T08:12:00+07:00',
  review: null,
  ...patch,
});

/** 5 Đơn mọi trạng thái, mới nhất trước (như api trả). */
const ORDERS: RecentOrder[] = [
  order({ code: 'TK8F3Q2AXM', buyerName: 'Nguyễn Văn Minh', ticketCount: 2, totalAmount: 450_000 }),
  order({
    code: 'TK5R8W1CAB',
    buyerName: 'Phạm Thu Hà',
    ticketCount: 2,
    status: 'review',
    createdAt: '2026-11-12T07:58:00+07:00',
    review: { type: 'amount_mismatch', receivedAmount: 250_000 },
  }),
  order({ code: 'TK3J6N4DAB', buyerName: 'Lê Hoàng Nam', totalAmount: 150_000, status: 'pending', createdAt: '2026-11-12T07:55:00+07:00' }),
  order({
    code: 'TK9B2X7EAB',
    buyerName: 'Trần Quốc Bảo',
    status: 'review',
    createdAt: '2026-11-12T07:31:00+07:00',
    review: { type: 'orphan', receivedAmount: 300_000 },
  }),
  order({ code: 'TK1Q4Z8HAB', buyerName: 'Võ Minh Thư', totalAmount: 150_000, status: 'expired', createdAt: '2026-11-11T22:10:00+07:00' }),
];
const OVERVIEW = { revenue: { amount: 450_000, paidOrders: 1 }, recentOrders: ORDERS };

type State = {
  status: Status;
  overview: unknown;
  /** Phiên hết hạn ngay ở lần tải Tổng quan kế tiếp: lần đó và mọi `GET /identity/me` sau đó trả 401. */
  expireOnOverview?: boolean;
  signedOut?: boolean;
  /** Số lần tải Tổng quan kế tiếp trả `reply` (đếm lùi). */
  fail: number;
  failReply: Reply;
};

/** Owner đã đăng nhập; Sự kiện `state.status`; `GET …/overview` trả `state.overview`; SSE `…/overview/live` mặc định 503. */
async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ state: State; calls: Call[] }> {
  const state: State = { status: 'published', overview: OVERVIEW, fail: 0, failReply: apiError(500, 'INTERNAL_ERROR'), ...initial };
  await mockIdentityApi(page, { 'GET /identity/me': () => (state.signedOut ? unauthenticated() : me(CONSENTED)) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization(),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: 'CLB Cầu lông', role: 'owner' }] }),
    [`GET ${eventPath}`]: () => ({ status: 200, body: eventOf(state.status) }),
    [`GET ${overviewPath}`]: () => {
      if (state.expireOnOverview || state.signedOut) {
        state.signedOut = true;
        return unauthenticated();
      }
      if (state.fail > 0) {
        state.fail -= 1;
        return state.failReply;
      }
      return { status: 200, body: state.overview };
    },
  });
  return { state, calls };
}

const overviewGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === overviewPath);
const liveGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === `${overviewPath}/live`);
const statCard = (page: Page) => page.locator('[data-slot="stat-card"]');
const statValue = (page: Page) => page.locator('[data-slot="stat-card-value"]');
const statCaption = (page: Page) => page.locator('[data-slot="stat-card-caption"]');
const cards = (page: Page) => page.locator('[data-slot="recent-order-card"]');
const rows = (page: Page) => page.locator('[data-slot="recent-order-row"]');
const offlineToasts = (page: Page) => page.locator('[data-sonner-toast]', { hasText: 'Mất kết nối. Đang thử lại…' });
const updatedAt = (page: Page) => page.locator('[data-slot="overview-updated-at"]');

/** Đếm số lần toast "Mất kết nối" *xuất hiện* (mỗi phần tử toast mới một lần; toast cập nhật tại chỗ không tính). */
async function countOfflineToasts(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __offlineToasts: number };
    w.__offlineToasts = 0;
    const seen = new WeakSet<Element>();
    const scan = () =>
      document.querySelectorAll('[data-sonner-toast]').forEach((el) => {
        if (seen.has(el) || !el.textContent?.includes('Mất kết nối')) return;
        seen.add(el);
        w.__offlineToasts += 1;
      });
    document.addEventListener('DOMContentLoaded', () =>
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true }),
    );
  });
  return () => page.evaluate(() => (window as unknown as { __offlineToasts: number }).__offlineToasts);
}

test.describe('Tổng quan Sự kiện: stat-card doanh thu và Đơn gần đây', () => {
  test('dưới md: stat-card stage, danh sách thẻ (không bảng), badge, dòng loại Cần xử lý, giờ Việt Nam; hai khối nằm trên "Thông tin"', async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await openApi(page);
    await page.goto(base);

    await expect(statCard(page)).toBeVisible();
    await expect(page.locator('[data-slot="stat-card-label"]')).toHaveText('Doanh thu');
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(statCaption(page)).toHaveText('Chỉ tính Đơn Đã thanh toán · 1 Đơn');

    const block = page.locator('[data-slot="recent-orders-block"]');
    await expect(block.getByRole('heading', { name: 'Đơn gần đây', level: 2 })).toBeVisible();
    await expect(cards(page)).toHaveCount(5);
    await expect(page.locator('[data-slot="recent-orders-table"]')).toBeHidden();

    const first = cards(page).nth(0);
    await expect(first).toContainText('Nguyễn Văn Minh');
    await expect(first).toContainText('TK8F3Q2AXM · 2 Vé · 08:12');
    await expect(first).toContainText('450.000đ');
    await expect(first.locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(first.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');

    const mismatch = cards(page).nth(1);
    await expect(mismatch.locator('[data-slot="status-badge"]')).toHaveText('Cần xử lý');
    await expect(mismatch.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger');
    await expect(mismatch.locator('[data-slot="review-line"]')).toHaveText('Lệch số tiền · nhận 250.000đ / Đơn 300.000đ');
    await expect(cards(page).nth(2).locator('[data-slot="status-badge"]')).toHaveText('Chờ thanh toán');
    await expect(cards(page).nth(2).locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'warning');
    await expect(cards(page).nth(3).locator('[data-slot="review-line"]')).toHaveText('Thanh toán mồ côi');
    const expired = cards(page).nth(4);
    await expect(expired.locator('[data-slot="status-badge"]')).toHaveText('Hết hạn');
    await expect(expired.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
    await expect(expired).toContainText('TK1Q4Z8HAB · 1 Vé · 11/11 · 22:10');

    // Thứ tự: stat-card → Đơn gần đây → thẻ "Thông tin".
    const tops = await Promise.all(
      ['[data-slot="stat-card"]', '[data-slot="recent-orders-block"]', '[data-slot="event-overview"]'].map(
        async (sel) => (await page.locator(sel).boundingBox())!.y,
      ),
    );
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    // Không cuộn ngang ở 375px.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('từ md: bảng Mã Đơn · Người mua · Vé · Số tiền · Trạng thái · Thời gian, không danh sách thẻ', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.clock.install({ time: NOW });
    await openApi(page);
    await page.goto(base);

    const table = page.locator('[data-slot="recent-orders-table"]');
    await expect(table).toBeVisible();
    await expect(page.locator('[data-slot="recent-orders-list"]')).toBeHidden();
    await expect(table.getByRole('columnheader')).toHaveText(['Mã Đơn', 'Người mua', 'Vé', 'Số tiền', 'Trạng thái', 'Thời gian']);
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).nth(0).getByRole('cell')).toHaveText([
      'TK8F3Q2AXM',
      'Nguyễn Văn Minh',
      '2 Vé',
      '450.000đ',
      'Đã thanh toán',
      '08:12',
    ]);
    const reviewCell = rows(page).nth(1).getByRole('cell').nth(4);
    await expect(reviewCell.locator('[data-slot="status-badge"]')).toHaveText('Cần xử lý');
    await expect(reviewCell.locator('[data-slot="review-line"]')).toHaveText('Lệch số tiền · nhận 250.000đ / Đơn 300.000đ');
    await expect(rows(page).nth(4).getByRole('cell').nth(5)).toHaveText('11/11 · 22:10');
    // Mã Đơn font code, số tiền căn phải.
    await expect(rows(page).nth(0).getByRole('cell').nth(0)).toHaveClass(/font-mono/);
    await expect(rows(page).nth(0).getByRole('cell').nth(3)).toHaveClass(/text-right/);
  });

  test('chưa có Đơn: "0đ", "· 0 Đơn", "Chưa có Đơn nào."', async ({ page }) => {
    await openApi(page, { overview: emptyOverview() });
    await page.goto(base);
    await expect(statValue(page)).toHaveText('0đ');
    await expect(statCaption(page)).toHaveText('Chỉ tính Đơn Đã thanh toán · 0 Đơn');
    await expect(page.locator('[data-slot="recent-orders-empty"]')).toHaveText('Chưa có Đơn nào.');
    await expect(cards(page)).toHaveCount(0);
  });

  test('Sự kiện nháp: không có hai khối, không gọi Tổng quan', async ({ page }) => {
    const { calls } = await openApi(page, { status: 'draft' });
    await page.goto(base);
    await expect(page.locator('[data-slot="event-overview"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tiếp tục thiết lập' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(statCard(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="recent-orders-block"]')).toHaveCount(0);
    expect(overviewGets(calls)).toHaveLength(0);
    expect(liveGets(calls)).toHaveLength(0);
  });

  test('Sự kiện Ẩn hay Đã hủy vẫn có hai khối', async ({ page }) => {
    const { state } = await openApi(page, { status: 'hidden' });
    await page.goto(base);
    await expect(statValue(page)).toHaveText('450.000đ');
    state.status = 'cancelled';
    await page.reload();
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(cards(page)).toHaveCount(5);
  });
});

test.describe('Tổng quan tự cập nhật', () => {
  test('tín hiệu SSE → tải lại: Đơn 0đ mới lên đầu, "· n Đơn" tăng; IPN trả Đơn → badge và doanh thu đổi, không tải lại trang', async ({
    page,
  }) => {
    const sse = await fakeEventSource(page);
    const { state, calls } = await openApi(page);
    await page.goto(base);
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect.poll(sse.count).toBe(1);
    const info = await sse.info();
    expect(info.withCredentials).toBe(true);
    expect(info.url).toMatch(new RegExp(`/v1/orgs/${ORG_ID}/events/${EVENT_ID}/overview/live$`));

    const beforeOpen = overviewGets(calls).length;
    await sse.open();
    await expect.poll(() => overviewGets(calls).length).toBe(beforeOpen + 1);

    // Người mua đăng ký Sự kiện miễn phí: Đơn 0đ đã thanh toán hiện đầu khối.
    const fresh = order({ code: 'TK7M2P9XAB', buyerName: 'Đỗ Thị Lan', ticketCount: 2, totalAmount: 0 });
    state.overview = { revenue: { amount: 450_000, paidOrders: 2 }, recentOrders: [fresh, ...ORDERS.slice(0, 4)] };
    await sse.message('event_orders_changed');
    await expect(cards(page).nth(0)).toContainText('Đỗ Thị Lan', { timeout: 2_500 });
    await expect(cards(page).nth(0).locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(statCaption(page)).toHaveText('Chỉ tính Đơn Đã thanh toán · 2 Đơn');
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(cards(page)).toHaveCount(5);

    // IPN trả Đơn đang chờ (Lê Hoàng Nam, 150.000đ).
    const paid = [fresh, ...ORDERS.slice(0, 4)].map((o) => (o.code === 'TK3J6N4DAB' ? { ...o, status: 'paid' } : o));
    state.overview = { revenue: { amount: 600_000, paidOrders: 3 }, recentOrders: paid };
    await sse.message('event_orders_changed');
    await expect(statValue(page)).toHaveText('600.000đ', { timeout: 2_500 });
    await expect(cards(page).nth(3).locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    expect(await sse.count()).toBe(1);
  });

  test('không có SSE (503) → polling 10 giây', async ({ page }) => {
    test.setTimeout(45_000);
    const { state, calls } = await openApi(page);
    await page.goto(base);
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect.poll(() => liveGets(calls).length).toBeGreaterThanOrEqual(1);
    const start = overviewGets(calls).length;
    const startedAt = Date.now();

    state.overview = { revenue: { amount: 750_000, paidOrders: 2 }, recentOrders: ORDERS };
    await page.waitForTimeout(7_000);
    // Không polling dày hơn 10 giây (vd. 2 giây của màn chờ thanh toán).
    expect(overviewGets(calls).length).toBe(start);
    await expect(statValue(page)).toHaveText('750.000đ', { timeout: 8_000 });
    expect(overviewGets(calls).length).toBe(start + 1);
    expect(Date.now() - startedAt).toBeLessThan(13_000);
  });

  test('mất mạng: một toast mỗi lần mất mạng, số liệu cũ + "Cập nhật lúc HH:MM"; có mạng lại → tải lại, ẩn nhãn', async ({
    page,
  }) => {
    const toastsShown = await countOfflineToasts(page);
    await page.clock.install({ time: NOW });
    const { state, calls } = await openApi(page);
    await page.goto(base);
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(updatedAt(page)).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(offlineToasts(page)).toHaveCount(1);
    await expect(updatedAt(page)).toHaveText('Cập nhật lúc 10:04');
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(cards(page)).toHaveCount(5);

    // Lần tải lại khi vẫn mất mạng (tab hiện lại) lỗi mạng: không thêm toast, số liệu giữ nguyên.
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await page.waitForTimeout(800);
    expect(await toastsShown()).toBe(1);
    await expect(updatedAt(page)).toHaveText('Cập nhật lúc 10:04');
    await expect(statValue(page)).toHaveText('450.000đ');
    const beforeOnline = overviewGets(calls).length;

    state.overview = { revenue: { amount: 900_000, paidOrders: 2 }, recentOrders: ORDERS };
    // Toast vẫn đang hiện ngay trước khi có mạng lại (chưa tới hạn tự đóng 4 giây của sonner).
    await expect(offlineToasts(page)).toHaveCount(1);
    await page.context().setOffline(false);
    await expect(statValue(page)).toHaveText('900.000đ', { timeout: 5_000 });
    await expect(updatedAt(page)).toHaveCount(0);
    // Gỡ ngay khi có mạng lại, không chờ sonner tự đóng.
    await expect(offlineToasts(page)).toHaveCount(0, { timeout: 500 });
    expect(await toastsShown()).toBe(1);
    expect(overviewGets(calls).length).toBeGreaterThan(beforeOnline);

    // Lần mất mạng sau: lại đúng một toast.
    await page.context().setOffline(true);
    await expect(offlineToasts(page)).toHaveCount(1);
    expect(await toastsShown()).toBe(2);
    await page.context().setOffline(false);
  });

  test('đã có số liệu mà lần tải lại lỗi 5xx → giữ số liệu cũ + "Cập nhật lúc HH:MM", không toast; tải lại được → ẩn nhãn', async ({
    page,
  }) => {
    const toastsShown = await countOfflineToasts(page);
    await page.clock.install({ time: NOW });
    const sse = await fakeEventSource(page);
    const { state } = await openApi(page);
    await page.goto(base);
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect.poll(sse.count).toBe(1);
    await sse.open();
    await expect(updatedAt(page)).toHaveCount(0);

    // Mọi lần tải lại kế tiếp trả 500 (kể cả 2 lần thử lại).
    state.fail = 10;
    state.overview = { revenue: { amount: 900_000, paidOrders: 2 }, recentOrders: ORDERS };
    await sse.message('event_orders_changed');
    await expect(updatedAt(page)).toHaveText('Cập nhật lúc 10:04', { timeout: 10_000 });
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(cards(page)).toHaveCount(5);
    await expect(page.locator('[data-slot="event-overview-error"]')).toHaveCount(0);
    expect(await toastsShown()).toBe(0);

    state.fail = 0;
    await sse.message('event_orders_changed');
    await expect(statValue(page)).toHaveText('900.000đ', { timeout: 5_000 });
    await expect(updatedAt(page)).toHaveCount(0);
    expect(await toastsShown()).toBe(0);
  });

  test('tải lần đầu lỗi → báo lỗi trong khối kèm "Thử lại"; Thử lại được → hai khối', async ({ page }) => {
    // Lỗi 5xx được thử lại 2 lần trước khi báo lỗi.
    const { state } = await openApi(page, { fail: 3 });
    await page.goto(base);
    const error = page.locator('[data-slot="event-overview-error"]');
    await expect(error).toContainText('Chưa tải được số liệu Sự kiện', { timeout: 15_000 });
    await expect(statCard(page)).toHaveCount(0);
    // Thẻ "Thông tin" vẫn hiện.
    await expect(page.locator('[data-slot="event-overview"]')).toBeVisible();

    expect(state.fail).toBe(0);
    await error.getByRole('button', { name: 'Thử lại' }).click();
    await expect(statValue(page)).toHaveText('450.000đ');
    await expect(error).toHaveCount(0);
  });

  test('401 khi tải Tổng quan → sang đăng nhập, quay lại đúng trang này', async ({ page }) => {
    await openApi(page, { expireOnOverview: true });
    await page.goto(base);
    await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);
  });
});
