import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, type Call, type Reply } from './identity-mock';
import { fakeEventSource } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Story 6.1: tab Đơn của Sự kiện — chip trạng thái, ô tìm, bảng (từ md) / thẻ (dưới md), phân trang "Trang trước"/"Trang
 * sau", `Sheet` chi tiết, empty-state và tự cập nhật qua stream Tổng quan (giả bằng `EventSource` điều khiển được, hoặc 503
 * → polling). API giả lọc như api thật (chip, mã Đơn/email/SĐT khớp đầy đủ, cursor). Giờ theo giờ Việt Nam: trình duyệt
 * chạy múi giờ New York. Ca lọc/phân trang/cách ly trên Postgres thật ở `apps/api/test/reporting/event-orders.test.ts`.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const SLUG = 'giai-cau-long-ba-dinh-2026-c4d5';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const ordersTab = `${base}?tab=don`;
const eventPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const ordersPath = `${eventPath}/orders`;
const DESKTOP = { width: 1024, height: 900 };
/** "Bây giờ" của các ca cần nhãn giờ cố định: 12/11/2026 10:04 giờ Việt Nam. */
const NOW = new Date('2026-11-12T10:04:00+07:00');
const OVERVIEW_LIVE_URL = /\/overview\/live$/;

type Status = 'draft' | 'published';

const eventOf = (status: Status) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: SLUG,
  name: 'Giải cầu lông Ba Đình 2026',
  status,
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  effectiveEndAt: '2099-11-16T23:59:59+07:00',
  endedManuallyAt: null,
  venue: 'Nhà thi đấu Quần Ngựa',
  description: null,
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
  imageKey: null,
  imageUrl: null,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

type Row = {
  code: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  items: { ticketTypeName: string; quantity: number }[];
  totalAmount: number;
  paidAmount: number | null;
  status: string;
  createdAt: string;
  paidAt: string | null;
  review: { type: string; receivedAmount: number | null } | null;
};

const row = (patch: Partial<Row> & Pick<Row, 'code' | 'buyerName'>): Row => ({
  buyerEmail: 'nguoi-mua@vidu.vn',
  buyerPhone: '+84900000001',
  items: [{ ticketTypeName: 'VIP', quantity: 1 }],
  totalAmount: 300_000,
  paidAmount: null,
  status: 'pending',
  createdAt: '2026-11-12T07:00:00+07:00',
  paidAt: null,
  review: null,
  ...patch,
});

/** Đơn mọi trạng thái, mới nhất trước (như api trả). */
const ORDERS: Row[] = [
  row({
    code: 'TK8F3Q2AXM',
    buyerName: 'Nguyễn Văn Minh',
    buyerEmail: 'minh.nguyen@vidu.vn',
    buyerPhone: '+84912345678',
    items: [
      { ticketTypeName: 'VIP', quantity: 2 },
      { ticketTypeName: 'Thường', quantity: 1 },
    ],
    totalAmount: 700_000,
    paidAmount: 700_000,
    status: 'paid',
    createdAt: '2026-11-12T08:12:00+07:00',
    paidAt: '2026-11-12T08:13:00+07:00',
  }),
  row({
    code: 'TK5R8W1CAB',
    buyerName: 'Phạm Thu Hà',
    status: 'review',
    createdAt: '2026-11-12T07:58:00+07:00',
    review: { type: 'amount_mismatch', receivedAmount: 250_000 },
  }),
  row({
    code: 'TK7M2P9XAB',
    buyerName: 'Đỗ Thị Lan',
    buyerEmail: 'lan.do@vidu.vn',
    buyerPhone: '+84912345678',
    items: [{ ticketTypeName: 'VIP', quantity: 2 }],
    totalAmount: 300_000,
    paidAmount: 250_000,
    status: 'paid',
    createdAt: '2026-11-12T07:40:00+07:00',
    paidAt: '2026-11-12T07:41:00+07:00',
  }),
  row({
    code: 'TK9B2X7EAB',
    buyerName: 'Trần Quốc Bảo',
    paidAmount: 300_000,
    status: 'paid',
    createdAt: '2026-11-12T07:31:00+07:00',
    paidAt: '2026-11-12T07:32:00+07:00',
    review: { type: 'duplicate_payment', receivedAmount: 300_000 },
  }),
  row({ code: 'TK1Q4Z8HAB', buyerName: 'Võ Minh Thư', status: 'expired', createdAt: '2026-11-11T22:10:00+07:00' }),
];

/** Chi tiết: Đơn duyệt tay khi lệch tiền (Đơn 300.000đ, nhận 250.000đ), 2 Vé (một đã check-in), câu trả lời form. */
const MANUAL_DETAIL = {
  ...ORDERS[2]!,
  paidSource: 'manual',
  cancelReason: null,
  answers: [
    { label: 'Size áo', answer: 'L' },
    { label: 'Câu lạc bộ (câu đã xóa)', answer: 'CLB Hồ Tây' },
  ],
  tickets: [
    {
      seq: 1,
      orderTicketCount: 2,
      ticketTypeName: 'VIP',
      holderName: 'Đỗ Thị Lan',
      status: 'valid',
      cancelReason: null,
      checkedInAt: '2026-11-12T09:30:00+07:00',
    },
    {
      seq: 2,
      orderTicketCount: 2,
      ticketTypeName: 'VIP',
      holderName: 'Đỗ Thị Lan',
      status: 'valid',
      cancelReason: null,
      checkedInAt: null,
    },
  ],
  history: [
    { kind: 'created', at: '2026-11-12T07:40:00+07:00' },
    { kind: 'review_opened', at: '2026-11-12T07:41:30+07:00', reviewType: 'amount_mismatch' },
    { kind: 'paid', at: '2026-11-12T07:50:00+07:00', paidSource: 'manual' },
  ],
};

/** Chi tiết: Đơn đã thanh toán, còn mục "Thanh toán trùng" `open`. */
const DUPLICATE_DETAIL = {
  ...ORDERS[3]!,
  paidSource: 'ipn',
  cancelReason: null,
  answers: [],
  tickets: [
    {
      seq: 1,
      orderTicketCount: 1,
      ticketTypeName: 'VIP',
      holderName: 'Trần Quốc Bảo',
      status: 'cancelled',
      cancelReason: 'voided',
      checkedInAt: null,
    },
  ],
  history: [
    { kind: 'created', at: '2026-11-12T07:31:00+07:00' },
    { kind: 'paid', at: '2026-11-12T07:32:00+07:00', paidSource: 'ipn' },
    { kind: 'review_opened', at: '2026-11-12T07:35:00+07:00', reviewType: 'duplicate_payment' },
  ],
};

const STATUS_OF: Record<string, (r: Row) => boolean> = {
  paid: (r) => r.status === 'paid',
  pending: (r) => r.status === 'pending',
  needs_action: (r) => r.review !== null,
  cancelled: (r) => r.status === 'cancelled',
  refunded: (r) => r.status === 'refunded',
};

/** Như `parseOrderSearch` của api, đủ cho dữ liệu giả: mã Đơn viết hoa, email chữ thường, SĐT E.164. */
function matches(r: Row, q: string): boolean {
  const s = q.trim();
  const digits = s.replace(/[\s.()-]+/g, '');
  const phone = digits.startsWith('0') ? `+84${digits.slice(1)}` : digits;
  return r.code === s.toUpperCase() || r.buyerEmail === s.toLowerCase() || r.buyerPhone === phone;
}

type State = {
  status: Status;
  orders: Row[];
  /** Số Đơn mỗi trang của API giả (cursor `c<vị trí>`). */
  pageSize: number;
  /** Query của từng lần tải danh sách (`URLSearchParams` dạng chuỗi), theo thứ tự. */
  listQueries: URLSearchParams[];
  /** Số lần tải danh sách kế tiếp trả `failReply`. */
  fail: number;
  failReply: Reply;
  /** Phiên hết hạn ở lần tải danh sách kế tiếp: lần đó và mọi `GET /identity/me` sau đó trả 401. */
  expireOnList?: boolean;
  signedOut?: boolean;
  details: Record<string, unknown>;
  /** Số lần tải chi tiết kế tiếp trả 500 (lỗi 5xx được thử lại 2 lần trước khi báo lỗi). */
  failDetail: number;
};

async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ state: State; calls: Call[] }> {
  const state: State = {
    status: 'published',
    orders: ORDERS,
    pageSize: 50,
    listQueries: [],
    fail: 0,
    failReply: apiError(500, 'INTERNAL_ERROR'),
    details: { [MANUAL_DETAIL.code]: MANUAL_DETAIL, [DUPLICATE_DETAIL.code]: DUPLICATE_DETAIL },
    failDetail: 0,
    ...initial,
  };
  await mockIdentityApi(page, { 'GET /identity/me': () => (state.signedOut ? unauthenticated() : me(CONSENTED)) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization(),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: 'CLB Cầu lông', role: 'owner' }] }),
    [`GET ${eventPath}`]: () => ({ status: 200, body: eventOf(state.status) }),
    [`GET ${ordersPath}`]: (request) => {
      const params = new URL(request.url()).searchParams;
      state.listQueries.push(params);
      if (state.expireOnList || state.signedOut) {
        state.signedOut = true;
        return unauthenticated();
      }
      if (state.fail > 0) {
        state.fail -= 1;
        return state.failReply;
      }
      const status = params.get('status');
      const q = params.get('q');
      const rows = state.orders.filter((r) => (!status || STATUS_OF[status]!(r)) && (!q || matches(r, q)));
      const start = Number(params.get('cursor')?.slice(1) ?? 0);
      const end = start + state.pageSize;
      return { status: 200, body: { orders: rows.slice(start, end), nextCursor: end < rows.length ? `c${end}` : null } };
    },
    ...Object.fromEntries(
      ORDERS.map((o) => [
        `GET ${ordersPath}/${o.code}`,
        () => {
          if (state.failDetail > 0) {
            state.failDetail -= 1;
            return apiError(500, 'INTERNAL_ERROR');
          }
          return state.details[o.code] ? { status: 200, body: state.details[o.code] } : apiError(404, 'ORDER_NOT_FOUND');
        },
      ]),
    ),
  });
  return { state, calls };
}

const lastQuery = (state: State) => state.listQueries.at(-1)!;
const table = (page: Page) => page.locator('[data-slot="event-orders-table"]');
const rows = (page: Page) => page.locator('[data-slot="event-order-row"]');
const cards = (page: Page) => page.locator('[data-slot="event-order-card"]');
const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const searchBox = (page: Page) => page.getByLabel('Tìm Đơn');
const searchError = (page: Page) => page.locator('[data-slot="order-search"] [role="alert"]');
const sheet = (page: Page) => page.locator('[data-slot="event-order-sheet"]');
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('tab Đơn: bảng và thẻ', () => {
  test('từ md (1024px): bảng Mã Đơn · Người mua · Vé · Số tiền · Trạng thái · Thời gian; chip "Tất cả" bật; không thẻ', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.clock.install({ time: NOW });
    const { state } = await openApi(page);
    await page.goto(ordersTab);

    await expect(page.getByRole('tab', { name: 'Đơn' })).toHaveAttribute('aria-selected', 'true');
    await expect(table(page)).toBeVisible();
    await expect(page.locator('[data-slot="event-orders-list"]')).toBeHidden();
    await expect(table(page).getByRole('columnheader')).toHaveText(['Mã Đơn', 'Người mua', 'Vé', 'Số tiền', 'Trạng thái', 'Thời gian']);
    await expect(rows(page)).toHaveCount(5);
    const first = rows(page).nth(0).getByRole('cell');
    await expect(first.nth(0)).toHaveText('TK8F3Q2AXM');
    await expect(first.nth(0).getByRole('button')).toHaveClass(/font-mono/);
    await expect(first.nth(1)).toHaveText('Nguyễn Văn Minhminh.nguyen@vidu.vn0912345678');
    await expect(first.nth(2)).toHaveText('2 × VIP, 1 × Thường');
    await expect(first.nth(3)).toHaveText('700.000đ');
    await expect(first.nth(3)).toHaveClass(/text-right/);
    await expect(first.nth(4).locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(first.nth(5)).toHaveText('Tạo 08:12Thanh toán 08:13');
    // Đơn review: dòng loại; Đơn đã thanh toán còn mục trả trùng: badge "Đã thanh toán" kèm dòng loại.
    await expect(rows(page).nth(1).locator('[data-slot="review-line"]')).toHaveText(
      'Lệch số tiền · nhận 250.000đ / Đơn 300.000đ',
    );
    await expect(rows(page).nth(3).locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(rows(page).nth(3).locator('[data-slot="review-line"]')).toHaveText('Thanh toán trùng');
    await expect(rows(page).nth(4).getByRole('cell').nth(5)).toHaveText('Tạo 11/11 · 22:10');

    await expect(page.locator('[data-slot="order-filter-chip"]')).toHaveText([
      'Tất cả',
      'Đã thanh toán',
      'Chờ thanh toán',
      'Cần xử lý',
      'Đã hủy',
      'Đã hoàn tay',
    ]);
    await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');
    expect(lastQuery(state).toString()).toBe('');
    // Một trang, không có phân trang.
    await expect(page.locator('[data-slot="event-orders-pager"]')).toHaveCount(0);
  });

  test('dưới md (375px): danh sách thẻ, không bảng; 375px và 320px không cuộn ngang', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openApi(page);
    await page.goto(ordersTab);
    await expect(cards(page)).toHaveCount(5);
    await expect(table(page)).toBeHidden();
    const first = cards(page).nth(0);
    await expect(first).toContainText('Nguyễn Văn Minh');
    await expect(first).toContainText('TK8F3Q2AXM · 2 × VIP, 1 × Thường');
    await expect(first).toContainText('minh.nguyen@vidu.vn');
    await expect(first).toContainText('0912345678 · Tạo 08:12 · Thanh toán 08:13');
    await expect(first).toContainText('700.000đ');
    await expect(first.locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(cards(page).nth(1).locator('[data-slot="review-line"]')).toHaveText(
      'Lệch số tiền · nhận 250.000đ / Đơn 300.000đ',
    );
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(cards(page)).toHaveCount(5);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // Chip đủ vùng chạm.
    const chipBox = (await chip(page, 'Cần xử lý').boundingBox())!;
    expect(chipBox.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('tab Đơn: lọc và tìm trên URL', () => {
  test('chip lọc ở server, giữ trên URL sau F5; "Tất cả" bỏ lọc; giá trị lạ trên URL bị bỏ qua', async ({ page }) => {
    const { state } = await openApi(page);
    await page.goto(ordersTab);
    await expect(cards(page)).toHaveCount(5);

    await chip(page, 'Cần xử lý').click();
    await page.waitForURL(`**${ordersTab}&trangThai=can-xu-ly`);
    await expect(chip(page, 'Cần xử lý')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(2);
    expect(lastQuery(state).get('status')).toBe('needs_action');
    await expect(cards(page).nth(1)).toContainText('Trần Quốc Bảo');

    await page.reload();
    await expect(chip(page, 'Cần xử lý')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(2);
    expect(lastQuery(state).get('status')).toBe('needs_action');

    await chip(page, 'Đã thanh toán').click();
    await page.waitForURL(`**${ordersTab}&trangThai=da-thanh-toan`);
    await expect(cards(page)).toHaveCount(3);
    expect(lastQuery(state).get('status')).toBe('paid');

    await chip(page, 'Tất cả').click();
    await page.waitForURL(`**${ordersTab}`);
    await expect(cards(page)).toHaveCount(5);
    expect(lastQuery(state).has('status')).toBe(false);

    await page.goto(`${ordersTab}&trangThai=het-han&tim=0912`);
    await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');
    await expect(searchBox(page)).toHaveValue('');
    await expect(cards(page)).toHaveCount(5);
    expect(lastQuery(state).toString()).toBe('');
  });

  test('tìm: chỉ gửi khi Enter hoặc "Tìm"; sai dạng báo ngay dưới ô, không gọi API; F5 giữ ô tìm và kết quả; nút xóa', async ({
    page,
  }) => {
    const { state } = await openApi(page);
    await page.goto(ordersTab);
    await expect(cards(page)).toHaveCount(5);
    const loads = state.listQueries.length;

    await searchBox(page).fill('0912');
    await page.waitForTimeout(400);
    expect(state.listQueries).toHaveLength(loads);
    await searchBox(page).press('Enter');
    await expect(searchError(page)).toHaveText('Nhập mã Đơn, email hoặc SĐT đầy đủ');
    await expect(searchBox(page)).toHaveAttribute('aria-invalid', 'true');
    await searchBox(page).fill('minh@');
    await page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await expect(searchError(page)).toHaveText('Nhập mã Đơn, email hoặc SĐT đầy đủ');
    await page.waitForTimeout(300);
    expect(state.listQueries.filter((q) => q.has('q'))).toEqual([]);
    expect(page.url()).toMatch(/\?tab=don$/);

    await searchBox(page).fill('0912 345 678');
    await expect(searchError(page)).toHaveText('');
    await expect(searchBox(page)).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await page.waitForURL(`**${ordersTab}&tim=0912+345+678`);
    await expect(cards(page)).toHaveCount(2);
    expect(lastQuery(state).get('q')).toBe('0912 345 678');
    await expect(searchBox(page)).toHaveValue('0912 345 678');

    // Chip cùng ô tìm: giao (AND), cả hai trên URL.
    await chip(page, 'Đã thanh toán').click();
    await page.waitForURL(`**${ordersTab}&trangThai=da-thanh-toan&tim=0912+345+678`);
    await expect.poll(() => lastQuery(state).get('status')).toBe('paid');
    expect(lastQuery(state).get('q')).toBe('0912 345 678');

    await page.getByRole('button', { name: 'Xóa ô tìm' }).click();
    await page.waitForURL(`**${ordersTab}&trangThai=da-thanh-toan`);
    await expect(searchBox(page)).toHaveValue('');
    await expect(searchBox(page)).toBeFocused();
    await expect(cards(page)).toHaveCount(3);

    // Mã Đơn chữ thường vẫn nhận ra.
    await searchBox(page).fill('tk1q4z8hab');
    await searchBox(page).press('Enter');
    await expect(page.locator('[data-slot="empty-state"]')).toContainText('Không có Đơn nào khớp bộ lọc.');
    await chip(page, 'Tất cả').click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).nth(0)).toContainText('TK1Q4Z8HAB');
  });

  test('AC: URL ?tab=don&tim=0912345678 → tải lại trang, ô tìm giữ giá trị, bảng chỉ có Đơn khớp', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const { state } = await openApi(page);
    await page.goto(`${ordersTab}&tim=0912345678`);
    await page.reload();
    await expect(searchBox(page)).toHaveValue('0912345678');
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).getByRole('button')).toHaveText(['TK8F3Q2AXM', 'TK7M2P9XAB']);
    expect(lastQuery(state).get('q')).toBe('0912345678');
  });

  test('có bộ lọc mà không Đơn nào khớp → "Không có Đơn nào khớp bộ lọc." + "Bỏ lọc" về Tất cả, xóa cả ô tìm', async ({
    page,
  }) => {
    await openApi(page);
    // Mã Đơn đúng dạng nhưng không có Đơn nào.
    await page.goto(`${ordersTab}&trangThai=da-hoan-tay&tim=TK2W6Y3ZAB`);
    await expect(searchBox(page)).toHaveValue('TK2W6Y3ZAB');
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toContainText('Không có Đơn nào khớp bộ lọc.');
    await empty.getByRole('button', { name: 'Bỏ lọc' }).click();
    await page.waitForURL(`**${ordersTab}`);
    expect(new URL(page.url()).search).toBe('?tab=don');
    await expect(searchBox(page)).toHaveValue('');
    await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(5);
  });
});

test.describe('tab Đơn: phân trang', () => {
  test('"Trang sau" gửi cursor, "Trang trước" về trang trước; cursor không lên URL; đổi bộ lọc về trang đầu', async ({ page }) => {
    const { state } = await openApi(page, { pageSize: 2 });
    await page.goto(ordersTab);
    await expect(cards(page)).toHaveCount(2);
    const pager = page.locator('[data-slot="event-orders-pager"]');
    await expect(pager.getByRole('button', { name: 'Trang trước' })).toHaveCount(0);
    await expect(pager).toContainText('Trang 1');

    await pager.getByRole('button', { name: 'Trang sau' }).click();
    await expect(cards(page).nth(0)).toContainText('Đỗ Thị Lan');
    expect(lastQuery(state).get('cursor')).toBe('c2');
    await expect(pager).toContainText('Trang 2');
    await pager.getByRole('button', { name: 'Trang sau' }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).nth(0)).toContainText('Võ Minh Thư');
    await expect(pager.getByRole('button', { name: 'Trang sau' })).toHaveCount(0);
    expect(page.url()).toMatch(/\?tab=don$/);

    await pager.getByRole('button', { name: 'Trang trước' }).click();
    await expect(cards(page).nth(0)).toContainText('Đỗ Thị Lan');
    await expect(pager).toContainText('Trang 2');

    await chip(page, 'Đã thanh toán').click();
    await expect(cards(page).nth(0)).toContainText('Nguyễn Văn Minh');
    expect(lastQuery(state).has('cursor')).toBe(false);
    expect(lastQuery(state).get('status')).toBe('paid');
    await expect(pager).toContainText('Trang 1');
  });
});

test.describe('tab Đơn: Sheet chi tiết', () => {
  test('từ md: Enter trên mã Đơn mở Sheet — Người mua, câu trả lời form, Vé, "300.000đ" kèm "đã nhận 250.000đ", lịch sử; không Mã QR; Esc đóng, focus về nút', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openApi(page);
    await page.goto(ordersTab);
    const open = rows(page).nth(2).getByRole('button', { name: 'TK7M2P9XAB' });
    await open.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Đơn TK7M2P9XAB' });
    await expect(dialog).toBeVisible();
    await expect(sheet(page)).toHaveAttribute('data-side', 'right');
    const buyer = dialog.locator('[data-slot="order-buyer"]');
    await expect(buyer).toContainText('TênĐỗ Thị Lan');
    await expect(buyer).toContainText('Emaillan.do@vidu.vn');
    await expect(buyer).toContainText('SĐT0912345678');
    await expect(buyer.locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(dialog.locator('[data-slot="order-answer"]')).toHaveText(['Size áoL', 'Câu lạc bộ (câu đã xóa)CLB Hồ Tây']);
    const tickets = dialog.locator('[data-slot="order-ticket"]');
    await expect(tickets.locator('[data-slot="order-ticket-line"]')).toHaveText(['Vé 1/2 · VIP · Đỗ Thị Lan', 'Vé 2/2 · VIP · Đỗ Thị Lan']);
    await expect(tickets.nth(0).locator('[data-slot="status-badge"]')).toHaveText('Đã check-in');
    await expect(tickets.nth(0).locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
    await expect(tickets.nth(0)).toContainText('lúc 09:30 12/11/2026');
    await expect(tickets.nth(1).locator('[data-slot="status-badge"]')).toHaveText('Hợp lệ');
    await expect(tickets.nth(1).locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');
    await expect(dialog.locator('[data-slot="order-amount-total"]')).toHaveText('300.000đ');
    await expect(dialog.locator('[data-slot="order-amount-received"]')).toHaveText('đã nhận 250.000đ');
    await expect(dialog.locator('[data-slot="order-history-entry"]')).toHaveText([
      '07:40 12/11/2026Tạo Đơn',
      '07:41 12/11/2026Cần xử lý · Lệch số tiền',
      '07:50 12/11/2026Đã thanh toán · Duyệt tay',
    ]);
    await expect(dialog.locator('[data-slot="order-review"]')).toHaveCount(0);
    await expect(dialog.locator('img, canvas, [data-slot="qr-plate"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('Đơn còn mục Cần xử lý open: dòng loại + "Xử lý ở trang Cần xử lý" (không có nút thao tác); Vé đã hủy; dưới md mở bằng thẻ, đóng thì focus về thẻ', async ({
    page,
  }) => {
    await openApi(page);
    await page.goto(ordersTab);
    await cards(page).nth(3).click();
    const dialog = page.getByRole('dialog', { name: 'Đơn TK9B2X7EAB' });
    const review = dialog.locator('[data-slot="order-review"]');
    await expect(review).toContainText('Thanh toán trùng');
    await expect(review.getByRole('link', { name: 'Xử lý ở trang Cần xử lý' })).toHaveAttribute(
      'href',
      `/btc/${ORG_ID}/can-xu-ly?suKien=${EVENT_ID}`,
    );
    await expect(dialog.getByRole('button', { name: /Duyệt tay|Từ chối|Đã hoàn tay|Ghép/ })).toHaveCount(0);
    await expect(dialog.locator('[data-slot="order-answers"]')).toContainText('Đơn không có câu trả lời form.');
    const ticket = dialog.locator('[data-slot="order-ticket"]');
    await expect(ticket.locator('[data-slot="status-badge"]')).toHaveText('Đã hủy');
    await expect(ticket.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger');
    // Tổng bằng số đã nhận: không có dòng "đã nhận".
    await expect(dialog.locator('[data-slot="order-amount-received"]')).toHaveCount(0);
    await sheet(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cards(page).nth(3)).toBeFocused();
  });

  test('stream Tổng quan báo org_review_items_changed khi Sheet đang mở → chi tiết tải lại, khối Cần xử lý biến mất', async ({
    page,
  }) => {
    const sse = await fakeEventSource(page, { url: OVERVIEW_LIVE_URL });
    const { state } = await openApi(page);
    await page.goto(ordersTab);
    await cards(page).nth(3).click();
    const dialog = page.getByRole('dialog', { name: 'Đơn TK9B2X7EAB' });
    await expect(dialog.locator('[data-slot="order-review"]')).toContainText('Thanh toán trùng');
    // Danh sách và `Sheet` mỗi bên một stream; stream mở sau cùng là của `Sheet`.
    await expect.poll(sse.count).toBe(2);
    await sse.open();

    state.details = { ...state.details, [DUPLICATE_DETAIL.code]: { ...DUPLICATE_DETAIL, review: null } };
    await sse.message('org_review_items_changed');
    await expect(dialog.locator('[data-slot="order-review"]')).toHaveCount(0, { timeout: 2_500 });
    await expect(dialog).toBeVisible();
  });

  test('lỗi tải chi tiết → "Chưa tải được chi tiết Đơn" + "Thử lại"; Thử lại được → chi tiết', async ({ page }) => {
    // Lỗi 5xx được thử lại 2 lần trước khi báo lỗi: ba lần lỗi rồi được.
    const { state } = await openApi(page, { failDetail: 3 });
    await page.goto(ordersTab);
    await cards(page).nth(2).click();
    const dialog = page.getByRole('dialog', { name: 'Đơn TK7M2P9XAB' });
    await expect(dialog).toContainText('Chưa tải được chi tiết Đơn', { timeout: 15_000 });
    expect(state.failDetail).toBe(0);
    await dialog.getByRole('button', { name: 'Thử lại' }).click();
    await expect(dialog.locator('[data-slot="order-amount-total"]')).toHaveText('300.000đ');
    await expect(dialog).not.toContainText('Chưa tải được chi tiết Đơn');
  });

  test('Đơn không còn → "Không tìm thấy Đơn này."', async ({ page }) => {
    await openApi(page, { details: {} });
    await page.goto(ordersTab);
    await cards(page).nth(0).click();
    await expect(page.getByRole('dialog', { name: 'Đơn TK8F3Q2AXM' })).toContainText('Không tìm thấy Đơn này.');
  });
});

test.describe('tab Đơn: khi trống', () => {
  test('Sự kiện chưa có Đơn: "Chưa có Đơn nào." / "Gửi link Sự kiện để bắt đầu bán." + "Sao chép link" (toast "Đã sao chép")', async ({
    page,
    browserName,
  }) => {
    if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApi(page, { orders: [] });
    await page.goto(ordersTab);
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toContainText('Chưa có Đơn nào.');
    await expect(empty).toContainText('Gửi link Sự kiện để bắt đầu bán.');
    await empty.getByRole('button', { name: 'Sao chép link' }).click();
    await expect(page.getByText('Đã sao chép')).toBeVisible();
    if (browserName === 'chromium') {
      const origin = new URL(page.url()).origin;
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/e/${SLUG}`);
    }
  });

  test('Sự kiện nháp: không có nút, mô tả "Mở bán Sự kiện để có link gửi Người mua."', async ({ page }) => {
    await openApi(page, { orders: [], status: 'draft' });
    await page.goto(ordersTab);
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toContainText('Chưa có Đơn nào.');
    await expect(empty).toContainText('Mở bán Sự kiện để có link gửi Người mua.');
    await expect(empty.getByRole('button')).toHaveCount(0);
  });
});

test.describe('tab Đơn: tự cập nhật và lỗi', () => {
  test('stream Tổng quan báo event_orders_changed → Đơn mới hiện đầu danh sách, không tải lại trang', async ({ page }) => {
    const sse = await fakeEventSource(page, { url: OVERVIEW_LIVE_URL });
    const { state } = await openApi(page);
    await page.goto(ordersTab);
    await expect(cards(page)).toHaveCount(5);
    await expect.poll(sse.count).toBe(1);
    expect((await sse.info()).url).toMatch(new RegExp(`/v1/orgs/${ORG_ID}/events/${EVENT_ID}/overview/live$`));
    await sse.open();
    await page.evaluate(() => ((window as unknown as { __mark: boolean }).__mark = true));

    state.orders = [
      row({ code: 'TK2W6Y3ZAB', buyerName: 'Hoàng Gia Huy', status: 'paid', paidAmount: 0, totalAmount: 0 }),
      ...ORDERS,
    ];
    await sse.message('event_orders_changed');
    await expect(cards(page).nth(0)).toContainText('Hoàng Gia Huy', { timeout: 2_500 });
    await expect(cards(page)).toHaveCount(6);
    expect(await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark)).toBe(true);
  });

  test('tải lần đầu lỗi → banner "Chưa tải được danh sách Đơn" + "Thử lại"; 401 → đăng nhập', async ({ page }) => {
    const { state } = await openApi(page, { fail: 3 });
    await page.goto(ordersTab);
    const error = page.locator('[data-slot="event-orders-error"]');
    await expect(error).toContainText('Chưa tải được danh sách Đơn', { timeout: 15_000 });
    expect(state.fail).toBe(0);
    await error.getByRole('button', { name: 'Thử lại' }).click();
    await expect(cards(page)).toHaveCount(5);

    state.expireOnList = true;
    await page.goto(`${ordersTab}&trangThai=cho-thanh-toan`);
    await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);
  });
});
