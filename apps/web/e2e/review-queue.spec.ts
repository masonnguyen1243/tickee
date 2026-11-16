import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import { fakeEventSource } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID, ORG_LIVE_URL } from './organizer-mock';

/*
 * Story 4.3: hàng "Cần xử lý" của BTC với API giả — trang `/btc/:id/can-xu-ly` (bảng từ `md`, thẻ dưới `md`), lọc theo
 * Sự kiện (`?suKien=`, chip "Bỏ lọc"), `Sheet` chi tiết (Enter mở, Esc đóng), hàng trống, lỗi, mất mạng; badge số ở
 * sidebar và tab bar cập nhật qua stream cấp BTC duy nhất của khung (giả bằng `EventSource` điều khiển được). Giờ luôn
 * theo giờ Việt Nam: trình duyệt chạy múi giờ New York. Ca full-stack (IPN → mục → tín hiệu) ở test api.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cầu lông Ba Đình';
const base = `/btc/${ORG_ID}`;
const queuePath = `${base}/can-xu-ly`;
const REVIEW_PATH = `/orgs/${ORG_ID}/review-items`;
const SUMMARY_PATH = `${REVIEW_PATH}/summary`;
const DESKTOP = { width: 1280, height: 800 };

const EVENT_A = { id: '019a3b2c-0a0a-7abc-8def-0123456789ab', name: 'Giải cầu lông Ba Đình 2026' };
const EVENT_B = { id: '019a3b2c-0b0b-7abc-8def-0123456789ab', name: 'Đêm nhạc gây quỹ' };

type Item = {
  id: string;
  type: string;
  receivedAmount: number | null;
  createdAt: string;
  order: { code: string; buyerName: string; totalAmount: number } | null;
  event: { id: string; name: string } | null;
};

const itemId = (n: number) => `019a3b2c-0c0${n}-7abc-8def-0123456789ab`;

/** 4 mục `open`, cũ nhất trước (như api trả). */
const ITEMS: Item[] = [
  {
    id: itemId(1),
    type: 'amount_mismatch',
    receivedAmount: 250_000,
    createdAt: '2026-11-16T08:12:00+07:00',
    order: { code: 'TK5R8W1CAB', buyerName: 'Phạm Thu Hà', totalAmount: 300_000 },
    event: EVENT_A,
  },
  {
    id: itemId(2),
    type: 'unmatched',
    receivedAmount: 75_000,
    createdAt: '2026-11-16T08:20:00+07:00',
    order: null,
    event: null,
  },
  {
    id: itemId(3),
    type: 'orphan',
    receivedAmount: 300_000,
    createdAt: '2026-11-16T08:31:00+07:00',
    order: { code: 'TK9B2X7EAB', buyerName: 'Trần Quốc Bảo', totalAmount: 300_000 },
    event: EVENT_B,
  },
  {
    id: itemId(4),
    type: 'duplicate_payment',
    receivedAmount: 300_000,
    createdAt: '2026-11-16T08:40:00+07:00',
    order: { code: 'TK3J6N4DAB', buyerName: 'Lê Hoàng Nam', totalAmount: 300_000 },
    event: EVENT_A,
  },
];

/** `ReviewItemDetail` của một mục trong `ITEMS`. */
function detailOf(item: Item) {
  const orphan = item.type === 'orphan';
  const unmatched = item.type === 'unmatched';
  return {
    id: item.id,
    type: item.type,
    reason: orphan ? 'sold_out' : null,
    status: 'open',
    resolution: null,
    createdAt: item.createdAt,
    transaction: {
      receivedAmount: item.receivedAmount,
      transactionCode: `FT2632${item.id.slice(10, 14).toUpperCase()}`,
      paidAt: '2026-11-16T08:11:30+07:00',
      receivedAt: '2026-11-16T08:11:31+07:00',
      paymentMethod: 'qr',
      providerOrderId: unmatched ? 'TK0000ZZZZ' : null,
    },
    order: item.order
      ? {
          code: item.order.code,
          status: item.type === 'duplicate_payment' ? 'paid' : 'review',
          buyerName: item.order.buyerName,
          ticketCount: 2,
          totalAmount: item.order.totalAmount,
          createdAt: '2026-11-16T07:58:00+07:00',
        }
      : null,
    event: item.event,
    log: [
      { kind: 'payment_received', at: '2026-11-16T08:11:30+07:00' },
      { kind: 'item_opened', at: item.createdAt },
    ],
  };
}

type State = {
  items: Item[];
  openCount: number;
  /** Trả lời của `GET …/review-items` thay cho hàng (vd. lỗi). */
  listReply?: Reply;
  /** Số lần tải hàng kế tiếp trả 500 (đếm lùi). */
  failList: number;
  /** `eventId` của lần tải hàng gần nhất. */
  lastFilter?: string | null;
};

/** Owner (hoặc `role`) đã đăng nhập; hàng `state.items`, lọc theo `?eventId=` như api; summary `state.openCount`. */
async function openApi(
  page: Page,
  initial: Partial<State> = {},
  { role = 'owner', handlers = {} }: { role?: string; handlers?: Record<string, Handler> } = {},
): Promise<{ state: State; calls: Call[] }> {
  const state: State = { items: ITEMS, openCount: ITEMS.length, failList: 0, ...initial };
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role, name: ORG_NAME }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role }] }),
    [`GET ${SUMMARY_PATH}`]: () => ({ status: 200, body: { openCount: state.openCount } }),
    [`GET ${REVIEW_PATH}`]: (request) => {
      const eventId = new URL(request.url()).searchParams.get('eventId');
      state.lastFilter = eventId;
      if (state.failList > 0) {
        state.failList -= 1;
        return apiError(500, 'INTERNAL_ERROR');
      }
      if (state.listReply) return state.listReply;
      if (!eventId) return { status: 200, body: { event: null, items: state.items } };
      const event = [EVENT_A, EVENT_B].find((e) => e.id === eventId);
      if (!event) return apiError(404, 'EVENT_NOT_FOUND');
      return { status: 200, body: { event, items: state.items.filter((i) => i.event?.id === eventId) } };
    },
    ...Object.fromEntries(ITEMS.map((item) => [`GET ${REVIEW_PATH}/${item.id}`, () => ({ status: 200, body: detailOf(item) })])),
    ...handlers,
  });
  return { state, calls };
}

const heading = (page: Page) => page.getByRole('heading', { name: 'Cần xử lý', level: 1 });
const cards = (page: Page) => page.locator('[data-slot="review-queue-list"] [data-slot="needs-action-row"]');
const rows = (page: Page) => page.locator('[data-slot="review-queue-table"] [data-slot="needs-action-row"]');
const sheet = (page: Page) => page.locator('[data-slot="review-item-sheet"]');
const chip = (page: Page) => page.locator('[data-slot="review-filter-chip"]');
const tabBar = (page: Page) => page.locator('[data-slot="bottom-tab-bar"]');
const sidebar = (page: Page) => page.locator('[data-slot="dashboard-sidebar"]');
const tabBadge = (page: Page) => tabBar(page).locator('[data-slot="nav-badge"]');
const sidebarBadge = (page: Page) => sidebar(page).locator('[data-slot="nav-badge"]');
const listGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === REVIEW_PATH);
const summaryGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === SUMMARY_PATH);

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('hàng Cần xử lý', () => {
  test('dưới md: danh sách thẻ (không bảng), cũ nhất trước; badge loại danger, mã Đơn, Người mua, số tiền (phần chênh danger-text), Sự kiện; mục chưa khớp', async ({
    page,
  }) => {
    await openApi(page);
    await page.goto(queuePath);
    await expect(heading(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
    await expect(page.locator('[data-slot="review-queue-table"]')).toBeHidden();

    const first = cards(page).nth(0);
    await expect(first.locator('[data-slot="status-badge"]')).toHaveText('Lệch số tiền');
    await expect(first.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger');
    await expect(first).toContainText('Phạm Thu Hà');
    await expect(first).toContainText('TK5R8W1CAB · Giải cầu lông Ba Đình 2026');
    await expect(first.locator('[data-slot="review-amount"]')).toHaveText('nhận 250.000đ / Đơn 300.000đ');
    await expect(first.locator('[data-slot="review-amount-diff"]')).toHaveText('nhận 250.000đ');
    await expect(first.locator('[data-slot="review-amount-diff"]')).toHaveClass(/text-danger-text/);

    const unmatched = cards(page).nth(1);
    await expect(unmatched.locator('[data-slot="status-badge"]')).toHaveText('Giao dịch chưa khớp');
    await expect(unmatched).toContainText('Không khớp Đơn nào · —');
    await expect(unmatched.locator('[data-slot="review-amount"]')).toHaveText('nhận 75.000đ');
    await expect(unmatched.locator('[data-slot="review-amount-diff"]')).toHaveCount(0);

    // Hai số bằng nhau: không tô.
    await expect(cards(page).nth(2).locator('[data-slot="status-badge"]')).toHaveText('Thanh toán mồ côi');
    await expect(cards(page).nth(2).locator('[data-slot="review-amount-diff"]')).toHaveCount(0);
    await expect(cards(page).nth(3).locator('[data-slot="status-badge"]')).toHaveText('Thanh toán trùng');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('từ md: bảng Loại · Mã Đơn · Người mua · Số tiền · Sự kiện, không danh sách thẻ', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openApi(page);
    await page.goto(queuePath);
    const table = page.locator('[data-slot="review-queue-table"]');
    await expect(table).toBeVisible();
    await expect(page.locator('[data-slot="review-queue-list"]')).toBeHidden();
    await expect(table.getByRole('columnheader')).toHaveText(['Loại', 'Mã Đơn', 'Người mua', 'Số tiền', 'Sự kiện']);
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(0).getByRole('cell')).toHaveText([
      'Lệch số tiền',
      'TK5R8W1CAB',
      'Phạm Thu Hà',
      'nhận 250.000đ / Đơn 300.000đ',
      'Giải cầu lông Ba Đình 2026',
    ]);
    await expect(rows(page).nth(1).getByRole('cell')).toHaveText([
      'Giao dịch chưa khớp',
      'Không khớp Đơn nào',
      '—',
      'nhận 75.000đ',
      '—',
    ]);
  });

  test('hàng trống: "Không có gì cần xử lý.", không badge', async ({ page }) => {
    await openApi(page, { items: [], openCount: 0 });
    await page.goto(queuePath);
    await expect(page.locator('[data-slot="empty-state"]')).toContainText('Không có gì cần xử lý.');
    await expect(cards(page)).toHaveCount(0);
    await expect(tabBadge(page)).toHaveCount(0);
  });

  test('tải lần đầu lỗi → banner kèm "Thử lại"; Thử lại được → hàng', async ({ page }) => {
    // Lỗi 5xx được thử lại 2 lần trước khi báo lỗi.
    const { state } = await openApi(page, { failList: 3 });
    await page.goto(queuePath);
    const error = page.locator('[data-slot="review-queue-error"]');
    await expect(error).toContainText('Chưa tải được hàng Cần xử lý', { timeout: 15_000 });
    expect(state.failList).toBe(0);
    await error.getByRole('button', { name: 'Thử lại' }).click();
    await expect(cards(page)).toHaveCount(4);
    await expect(error).toHaveCount(0);
  });

  test('đang tải: skeleton; mất mạng: một toast, hàng giữ nguyên kèm "Cập nhật lúc HH:MM"; có mạng lại → ẩn nhãn', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await openApi(page, {}, {
      handlers: {
        [`GET ${REVIEW_PATH}`]: async () => {
          await gate;
          return { status: 200, body: { event: null, items: ITEMS } };
        },
      },
    });
    await page.goto(queuePath);
    await expect(page.locator('[data-slot="review-queue-skeleton"]')).toBeVisible();
    release();
    await expect(cards(page)).toHaveCount(4);
    await expect(page.locator('[data-slot="review-queue-skeleton"]')).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(page.locator('[data-sonner-toast]', { hasText: 'Mất kết nối. Đang thử lại…' })).toHaveCount(1);
    await expect(page.locator('[data-slot="review-queue-updated-at"]')).toHaveText(/^Cập nhật lúc \d\d:\d\d$/);
    await expect(cards(page)).toHaveCount(4);
    await page.context().setOffline(false);
    await expect(page.locator('[data-slot="review-queue-updated-at"]')).toHaveCount(0, { timeout: 5_000 });
  });
});

test.describe('lọc theo Sự kiện', () => {
  test('?suKien= → chip "Sự kiện: {tên} · Bỏ lọc", chỉ mục của Sự kiện; "Bỏ lọc" → mọi mục', async ({ page }) => {
    const { state } = await openApi(page);
    await page.goto(`${queuePath}?suKien=${EVENT_A.id}`);
    await expect(chip(page)).toContainText('Sự kiện: Giải cầu lông Ba Đình 2026');
    await expect(chip(page).getByRole('link', { name: 'Bỏ lọc' })).toHaveAttribute('href', queuePath);
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(0)).toContainText('TK5R8W1CAB');
    await expect(cards(page).nth(1)).toContainText('TK3J6N4DAB');
    expect(state.lastFilter).toBe(EVENT_A.id);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await chip(page).getByRole('link', { name: 'Bỏ lọc' }).click();
    await page.waitForURL((url) => url.pathname === queuePath && url.search === '');
    await expect(cards(page)).toHaveCount(4);
    await expect(chip(page)).toHaveCount(0);
    expect(state.lastFilter).toBeNull();
  });

  test('Sự kiện không tồn tại (404 EVENT_NOT_FOUND) → empty-state kèm "Xem mọi mục Cần xử lý"', async ({ page }) => {
    await openApi(page);
    await page.goto(`${queuePath}?suKien=019a3b2c-dead-7abc-8def-0123456789ab`);
    await expect(page.getByText('Không tìm thấy Sự kiện này.')).toBeVisible();
    await page.getByRole('link', { name: 'Xem mọi mục Cần xử lý' }).click();
    await page.waitForURL((url) => url.pathname === queuePath && url.search === '');
    await expect(cards(page)).toHaveCount(4);
  });
});

test.describe('Sheet chi tiết', () => {
  test('từ md: Enter trên mã Đơn mở Sheet (Giao dịch, Đơn liên quan, Nhật ký); Esc đóng, focus về hàng', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openApi(page);
    await page.goto(queuePath);
    const open = rows(page).nth(0).getByRole('button', { name: 'TK5R8W1CAB' });
    await open.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Lệch số tiền' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('TK5R8W1CAB · Giải cầu lông Ba Đình 2026');
    const transaction = dialog.locator('[data-slot="review-transaction"]');
    await expect(transaction.getByRole('heading', { name: 'Giao dịch' })).toBeVisible();
    await expect(transaction).toContainText('Số tiền nhận250.000đ');
    await expect(transaction).toContainText('Mã giao dịch');
    await expect(transaction).toContainText('Thời điểm trả08:11 16/11/2026');
    await expect(transaction).toContainText('Phương thứcQuét mã QR');
    await expect(transaction).not.toContainText('Mã Đơn trong giao dịch');
    const order = dialog.locator('[data-slot="review-order"]');
    await expect(order.getByRole('heading', { name: 'Đơn liên quan' })).toBeVisible();
    await expect(order).toContainText('Mã ĐơnTK5R8W1CAB');
    await expect(order.locator('[data-slot="status-badge"]')).toHaveText('Cần xử lý');
    await expect(order).toContainText('Người muaPhạm Thu Hà');
    await expect(order).toContainText('Số Vé2 Vé');
    await expect(order).toContainText('Tổng tiền300.000đ');
    await expect(order).toContainText('Lúc tạo07:58 16/11/2026');
    const log = dialog.locator('[data-slot="review-log-entry"]');
    await expect(log).toHaveText(['08:11 16/11/2026Nhận tiền', '08:12 16/11/2026Mở mục · Lệch số tiền']);
    // Chỉ đọc: chưa có nút thao tác (Story 4.4).
    await expect(dialog.getByRole('button', { name: /Duyệt|Từ chối|Đã hoàn tay|Bỏ qua/ })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('mục chưa khớp: "Mã Đơn trong giao dịch", Đơn liên quan "Không khớp Đơn nào"; mồ côi: "Lý do: Hết chỗ"', async ({
    page,
  }) => {
    await openApi(page);
    await page.goto(queuePath);
    await cards(page).nth(1).click();
    const unmatched = page.getByRole('dialog', { name: 'Giao dịch chưa khớp' });
    await expect(unmatched.locator('[data-slot="review-transaction"]')).toContainText('Mã Đơn trong giao dịchTK0000ZZZZ');
    await expect(unmatched.locator('[data-slot="review-order"]')).toContainText('Không khớp Đơn nào');
    await expect(unmatched.locator('[data-slot="review-log-entry"]').nth(1)).toContainText('Mở mục · Giao dịch chưa khớp');
    await page.keyboard.press('Escape');
    await expect(unmatched).toBeHidden();

    await cards(page).nth(2).click();
    const orphan = page.getByRole('dialog', { name: 'Thanh toán mồ côi' });
    await expect(orphan.locator('[data-slot="review-reason"]')).toHaveText('Lý do: Hết chỗ');
    await expect(orphan.locator('[data-slot="review-order"]')).toContainText('Mã ĐơnTK9B2X7EAB');
  });

  test('320px: hàng và Sheet không cuộn ngang; thẻ mở bằng Enter', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openApi(page);
    await page.goto(queuePath);
    await expect(cards(page)).toHaveCount(4);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await cards(page).nth(0).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Lệch số tiền' });
    await expect(dialog.locator('[data-slot="review-log-entry"]')).toHaveCount(2);
    // Đo sau khi hiệu ứng trượt vào kết thúc.
    await sheet(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const box = (await sheet(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cards(page).nth(0)).toBeFocused();
  });
});

test.describe('Sheet: lỗi tải chi tiết', () => {
  test('lỗi 5xx → "Chưa tải được chi tiết mục" + "Thử lại"; Thử lại được → nội dung', async ({ page }) => {
    let fail = 3;
    const detailPath = `${REVIEW_PATH}/${ITEMS[0]!.id}`;
    await openApi(page, {}, {
      handlers: {
        [`GET ${detailPath}`]: () => {
          if (fail > 0) {
            fail -= 1;
            return apiError(500, 'INTERNAL_ERROR');
          }
          return { status: 200, body: detailOf(ITEMS[0]!) };
        },
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const dialog = page.getByRole('dialog', { name: 'Lệch số tiền' });
    // Lỗi 5xx được thử lại 2 lần trước khi báo lỗi.
    await expect(dialog.locator('[data-slot="status-banner"]')).toContainText('Chưa tải được chi tiết mục', {
      timeout: 15_000,
    });
    expect(fail).toBe(0);
    await dialog.getByRole('button', { name: 'Thử lại' }).click();
    await expect(dialog.locator('[data-slot="review-log-entry"]')).toHaveCount(2);
    await expect(dialog.locator('[data-slot="status-banner"]')).toHaveCount(0);
  });

  test('404 REVIEW_ITEM_NOT_FOUND → "Không tìm thấy mục này.", không có "Thử lại"', async ({ page }) => {
    await openApi(page, {}, {
      handlers: { [`GET ${REVIEW_PATH}/${ITEMS[0]!.id}`]: () => apiError(404, 'REVIEW_ITEM_NOT_FOUND') },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const dialog = page.getByRole('dialog', { name: 'Lệch số tiền' });
    await expect(dialog.locator('[data-slot="status-banner"]')).toContainText('Không tìm thấy mục này.');
    await expect(dialog.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
    await expect(dialog.locator('[data-slot="review-transaction"]')).toHaveCount(0);
  });
});

test.describe('badge "Cần xử lý"', () => {
  test('stream cấp BTC báo org_review_items_changed → badge tab bar và hàng tải lại, không tải lại trang, không mở EventSource thứ hai; >99 → "99+"', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const sse = await fakeEventSource(page, { url: ORG_LIVE_URL });
    const all = await fakeEventSource(page);
    const { state, calls } = await openApi(page, { items: [], openCount: 0 });
    await page.goto(queuePath);
    await expect(page.getByText('Không có gì cần xử lý.')).toBeVisible();
    await expect.poll(sse.count).toBe(1);
    await sse.open();
    await expect(tabBadge(page)).toHaveCount(0);

    // Stream đã kết nối: badge và hàng thôi polling (chỉ tải lại theo tín hiệu). Chờ lần tải lại do `open` xong rồi đếm.
    await page.waitForTimeout(1_500);
    const connected = { list: listGets(calls).length, summary: summaryGets(calls).length };
    await page.waitForTimeout(11_000);
    expect(listGets(calls).length).toBe(connected.list);
    expect(summaryGets(calls).length).toBe(connected.summary);
    const tab = tabBar(page).getByRole('link', { name: /^Cần xử lý/ });
    await expect(tab).not.toHaveAttribute('aria-label', /.*/);

    await page.evaluate(() => ((window as unknown as { __mark: boolean }).__mark = true));
    const before = { list: listGets(calls).length, summary: summaryGets(calls).length };
    state.items = ITEMS.slice(0, 3);
    state.openCount = 3;
    await sse.message('org_review_items_changed');
    await expect(tabBadge(page)).toHaveText('3', { timeout: 3_000 });
    await expect(tab).toHaveAttribute('aria-label', 'Cần xử lý, 3 mục');
    await expect(tabBadge(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(cards(page)).toHaveCount(3);
    expect(listGets(calls).length).toBeGreaterThan(before.list);
    expect(summaryGets(calls).length).toBeGreaterThan(before.summary);

    state.openCount = 120;
    await sse.message('org_review_items_changed');
    await expect(tabBadge(page)).toHaveText('99+', { timeout: 3_000 });
    await expect(tab).toHaveAttribute('aria-label', 'Cần xử lý, 120 mục');

    state.items = [];
    state.openCount = 0;
    await sse.message('org_review_items_changed');
    await expect(tabBadge(page)).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByText('Không có gì cần xử lý.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark)).toBe(true);
    // Đúng một EventSource cho cả trang: stream cấp BTC của khung (trang Cần xử lý không mở stream riêng).
    expect(await sse.count()).toBe(1);
    expect(await all.count()).toBe(1);
  });

  test('desktop: badge sidebar nền brand, chữ on-brand; tên truy cập "Cần xử lý, 3 mục"; Admin cũng thấy', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openApi(page, { openCount: 3 }, { role: 'admin' });
    await page.goto(base);
    await expect(sidebarBadge(page)).toHaveText('3');
    await expect(sidebarBadge(page)).toHaveClass(/bg-primary/);
    await expect(sidebarBadge(page)).toHaveClass(/text-primary-foreground/);
    await expect(sidebar(page).getByRole('link', { name: 'Cần xử lý, 3 mục', exact: true })).toBeVisible();

    // md–lg chỉ icon: badge vẫn hiện ở góc icon.
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(sidebarBadge(page)).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Cần xử lý, 3 mục', exact: true })).toBeVisible();
  });

  test('không có SSE (503) → hàng polling 10 giây, không tải lại trang', async ({ page }) => {
    test.setTimeout(45_000);
    const { state, calls } = await openApi(page, { items: ITEMS.slice(0, 1) });
    await page.goto(queuePath);
    await expect(cards(page)).toHaveCount(1);
    const liveGets = () => calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/live`).length;
    await expect.poll(liveGets).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => ((window as unknown as { __mark: boolean }).__mark = true));
    const startedAt = Date.now();
    state.items = ITEMS;
    await expect(cards(page)).toHaveCount(4, { timeout: 12_000 });
    expect(Date.now() - startedAt).toBeLessThan(12_000);
    expect(await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark)).toBe(true);
  });

  test('không có SSE (503) → badge polling 10 giây', async ({ page }) => {
    test.setTimeout(45_000);
    const { state, calls } = await openApi(page, { openCount: 0 });
    await page.goto(base);
    const liveGets = () => calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/live`).length;
    await expect.poll(liveGets).toBeGreaterThanOrEqual(1);
    await expect.poll(() => summaryGets(calls).length).toBeGreaterThanOrEqual(1);
    await expect(tabBadge(page)).toHaveCount(0);
    const startedAt = Date.now();
    state.openCount = 2;
    await expect(tabBadge(page)).toHaveText('2', { timeout: 12_000 });
    expect(Date.now() - startedAt).toBeLessThan(12_000);
  });
});
