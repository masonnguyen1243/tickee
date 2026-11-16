import type { Page, Request } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import { fakeEventSource } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID, ORG_LIVE_URL } from './organizer-mock';

/*
 * Story 4.3: hàng "Cần xử lý" của BTC với API giả — trang `/btc/:id/can-xu-ly` (bảng từ `md`, thẻ dưới `md`), lọc theo
 * Sự kiện (`?suKien=`, chip "Bỏ lọc"), `Sheet` chi tiết (Enter mở, Esc đóng), hàng trống, lỗi, mất mạng; badge số ở
 * sidebar và tab bar cập nhật qua stream cấp BTC duy nhất của khung (giả bằng `EventSource` điều khiển được). Giờ luôn
 * theo giờ Việt Nam: trình duyệt chạy múi giờ New York. Ca full-stack (IPN → mục → tín hiệu) ở test api.
 *
 * Story 4.4-a: footer thao tác của `Sheet` (Duyệt tay, Từ chối, Đã hoàn tay, Bỏ qua) trên API giả có trạng thái: nút theo
 * `actions` của chi tiết, `Dialog` (Hủy không gọi API), `Idempotency-Key`, toast, lỗi hết chỗ, thua cuộc đua, focus khi
 * mục rời hàng, 320px.
 *
 * Story 4.4-b: "Ghép với Đơn" trên mục chưa khớp — `Dialog` chọn Đơn ứng viên (lọc Sự kiện, ứng viên bị chặn tắt kèm lý
 * do, rỗng, bị cắt ở 100), ghép thành công, hết chỗ, Đơn vừa đổi trạng thái, thua cuộc đua, 320px.
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

type LogEntry = { kind: string; at: string; actorName?: string; note?: string };

/** `ReviewItemDetail` (phần test đổi được). */
type Detail = {
  id: string;
  type: string;
  status: string;
  resolution: string | null;
  order: ({ code: string; status: string; ticketCount: number } & Record<string, unknown>) | null;
  transaction: { receivedAmount: number | null } & Record<string, unknown>;
  log: LogEntry[];
  actions: string[];
  approveBlockedReason: string | null;
} & Record<string, unknown>;

/** Mục chỉ kết thúc bằng hoàn tay hoặc bỏ qua (không phát Vé); mục chưa khớp còn "Ghép với Đơn" đứng đầu (Story 4.4-b). */
const REFUND_ONLY = ['event_cancelled', 'duplicate_payment'];

/** Thao tác của mục `open` như api tính (Đơn `review`, mục chỉ hoàn, mục chưa khớp). */
const actionsOf = (type: string): string[] =>
  type === 'unmatched' ? ['match', 'refund', 'dismiss'] : REFUND_ONLY.includes(type) ? ['refund', 'dismiss'] : ['approve', 'reject'];

/** `ReviewItemDetail` của một mục trong `ITEMS`; `actions` như api tính cho mục `open` (Đơn `review` hoặc mục chỉ hoàn). */
function detailOf(item: Item, patch: Partial<Detail> = {}): Detail {
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
    actions: actionsOf(item.type),
    approveBlockedReason: null,
    ...patch,
  };
}

/** Tên thành viên làm thao tác trên API giả. */
const ACTOR = 'Lê Minh';
const ACTION_AT = '2026-11-16T09:00:00+07:00';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Một lần `POST …/review-items/:itemId/{action}`: thao tác, mục, header `Idempotency-Key`, thân. */
type ActionCall = { action: string; itemId: string; key: string | null; body: unknown };

/** `ReviewActionResult` của mục sau thao tác. */
const resultOf = (detail: Detail, action: string) => ({
  itemId: detail.id,
  action,
  status: detail.status,
  resolution: detail.resolution,
  orderCode: detail.order?.code ?? null,
  orderStatus: detail.order?.status ?? null,
  ticketCount: detail.order?.ticketCount ?? 0,
  amount: detail.transaction.receivedAmount,
});

/** Đơn ứng viên của "Ghép với Đơn" (`MatchCandidate`). */
type Candidate = {
  code: string;
  buyerName: string;
  event: { id: string; name: string };
  status: string;
  ticketCount: number;
  createdAt: string;
  blockedReason: string | null;
};

/** Ứng viên mặc định: mới nhất trước; Đơn cuối thuộc Sự kiện đã kết thúc (tắt kèm lý do). */
const CANDIDATES: Candidate[] = [
  {
    code: 'TK7M4Q2HAB',
    buyerName: 'Nguyễn Văn An',
    event: EVENT_A,
    status: 'expired',
    ticketCount: 2,
    createdAt: '2026-11-16T07:30:00+07:00',
    blockedReason: null,
  },
  {
    code: 'TK8P3R6KAB',
    buyerName: 'Đỗ Minh Châu',
    event: EVENT_B,
    status: 'review',
    ticketCount: 1,
    createdAt: '2026-11-15T20:10:00+07:00',
    blockedReason: null,
  },
  {
    code: 'TK2W9X5ZAB',
    buyerName: 'Hoàng Thị Lan',
    event: EVENT_B,
    status: 'expired',
    ticketCount: 3,
    createdAt: '2026-11-14T09:00:00+07:00',
    blockedReason: 'event_ended',
  },
];

/** Sự kiện của BTC (`GET /orgs/:id/events`): hai Sự kiện đã rời nháp và một bản nháp (không có trong ô chọn). */
const eventSummary = (event: { id: string; name: string }, status: string) => ({
  ...event,
  slug: `su-kien-${event.id.slice(9, 13)}`,
  status,
  startsAt: '2026-11-20T18:00:00+07:00',
  endsAt: '2026-11-20T22:00:00+07:00',
  effectiveEndAt: '2026-11-20T22:00:00+07:00',
});
const ORG_EVENTS = [
  eventSummary({ id: '019a3b2c-0d0d-7abc-8def-0123456789ab', name: 'Sự kiện nháp' }, 'draft'),
  eventSummary(EVENT_B, 'hidden'),
  eventSummary(EVENT_A, 'published'),
];

type State = {
  items: Item[];
  openCount: number;
  /** Chi tiết hiện tại của từng mục (thao tác giả đổi tại chỗ). */
  details: Record<string, Detail>;
  /** Mọi lần POST thao tác, theo thứ tự. */
  actions: ActionCall[];
  /** Trả lời thay cho thao tác (vd. 409, 500); `undefined` → API giả xử lý như api thật. */
  actionReply?: (call: ActionCall, state: State) => Reply | undefined | Promise<Reply | undefined>;
  /** Trả lời của `GET …/review-items` thay cho hàng (vd. lỗi). */
  listReply?: Reply;
  /** Số lần tải hàng kế tiếp trả 500 (đếm lùi). */
  failList: number;
  /** `eventId` của lần tải hàng gần nhất. */
  lastFilter?: string | null;
  /** Đơn ứng viên của "Ghép với Đơn" (mọi mục chưa khớp dùng chung); API giả lọc theo `?eventId=`. */
  candidates: Candidate[];
  /** `truncated` của danh sách ứng viên. */
  truncated: boolean;
  /** `eventId` của mọi lần tải ứng viên, theo thứ tự (`null` = mọi Sự kiện). */
  candidateFilters: (string | null)[];
};

/** Owner (hoặc `role`) đã đăng nhập; hàng `state.items`, lọc theo `?eventId=` như api; summary `state.openCount`. */
async function openApi(
  page: Page,
  initial: Partial<State> = {},
  { role = 'owner', handlers = {} }: { role?: string; handlers?: Record<string, Handler> } = {},
): Promise<{ state: State; calls: Call[] }> {
  const state: State = {
    items: ITEMS,
    openCount: ITEMS.length,
    failList: 0,
    details: Object.fromEntries(ITEMS.map((item) => [item.id, detailOf(item)])),
    actions: [],
    candidates: CANDIDATES,
    truncated: false,
    candidateFilters: [],
    ...initial,
  };
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
    [`GET /orgs/${ORG_ID}/events`]: () => ({ status: 200, body: ORG_EVENTS }),
    ...Object.fromEntries(
      ITEMS.map((item) => [`GET ${REVIEW_PATH}/${item.id}`, () => ({ status: 200, body: state.details[item.id] })]),
    ),
    ...Object.fromEntries(
      ITEMS.map((item) => [
        `GET ${REVIEW_PATH}/${item.id}/match-candidates`,
        (request: Request) => {
          const eventId = new URL(request.url()).searchParams.get('eventId');
          state.candidateFilters.push(eventId);
          // Như api: mục không có "Ghép với Đơn" → danh sách rỗng.
          if (!state.details[item.id]!.actions.includes('match')) return { status: 200, body: { candidates: [], truncated: false } };
          const candidates = eventId ? state.candidates.filter((c) => c.event.id === eventId) : state.candidates;
          return { status: 200, body: { candidates, truncated: state.truncated } };
        },
      ]),
    ),
    ...Object.fromEntries(
      ITEMS.flatMap((item) =>
        ['approve', 'reject', 'refund', 'dismiss', 'match'].map((action) => [
          `POST ${REVIEW_PATH}/${item.id}/${action}`,
          (request: Request) => act(state, { action, itemId: item.id, key: request.headers()['idempotency-key'] ?? null, body: request.postDataJSON() as unknown }),
        ]),
      ),
    ),
    ...handlers,
  });
  return { state, calls };
}

/** Mục rời hàng (đã xử lý): bỏ khỏi hàng, giảm badge. */
function leave(state: State, itemId: string): void {
  state.items = state.items.filter((i) => i.id !== itemId);
  state.openCount = Math.max(0, state.openCount - 1);
}

/** Thao tác như api: chỉ khi có trong `actions`; mục đã ở kết quả của thao tác → 200 trạng thái hiện tại; còn lại 409. */
async function act(state: State, call: ActionCall): Promise<Reply> {
  state.actions.push(call);
  const override = await state.actionReply?.(call, state);
  if (override) return override;
  const detail = state.details[call.itemId]!;
  if (!detail.actions.includes(call.action)) return apiError(409, 'REVIEW_ACTION_NOT_ALLOWED');
  const log = (kind: string, extra: Partial<LogEntry> = {}) => detail.log.push({ kind, at: ACTION_AT, actorName: ACTOR, ...extra });
  const resolve = (resolution: string) => {
    detail.status = 'resolved';
    detail.resolution = resolution;
    detail.actions = [];
    detail.approveBlockedReason = null;
    leave(state, call.itemId);
  };
  switch (call.action) {
    case 'approve':
      detail.order!.status = 'paid';
      resolve('approved');
      log('approved');
      break;
    case 'reject':
      detail.order!.status = 'cancelled';
      detail.actions = ['refund'];
      log('rejected');
      break;
    case 'refund':
      if (detail.order?.status === 'cancelled') detail.order.status = 'refunded';
      resolve('refunded');
      log('refunded');
      break;
    case 'dismiss':
      resolve('dismissed');
      log('dismissed', { note: (call.body as { reason: string }).reason });
      break;
    case 'match': {
      const { orderCode } = call.body as { orderCode: string };
      const candidate = state.candidates.find((c) => c.code === orderCode);
      if (!candidate) return apiError(409, 'MATCH_ORDER_NOT_ELIGIBLE');
      if (candidate.blockedReason === 'event_ended') return apiError(409, 'EVENT_ALREADY_ENDED');
      // Đơn ghép xong là Đơn của mục (qua liên kết giao dịch → Đơn), không còn là ứng viên.
      state.candidates = state.candidates.filter((c) => c.code !== orderCode);
      detail.order = {
        code: candidate.code,
        status: 'paid',
        buyerName: candidate.buyerName,
        ticketCount: candidate.ticketCount,
        totalAmount: detail.transaction.receivedAmount ?? 0,
        createdAt: candidate.createdAt,
      };
      detail.event = candidate.event;
      resolve('approved');
      log('matched', { note: candidate.code });
      break;
    }
  }
  return { status: 200, body: resultOf(detail, call.action) };
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
    // Story 4.4: footer thao tác theo `actions` của máy chủ (Đơn `review`: Duyệt tay, Từ chối).
    const footer = dialog.locator('[data-slot="review-actions"]');
    await expect(footer.getByRole('button')).toHaveText(['Duyệt tay phát Vé', 'Từ chối']);

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

/** Toast đang hiện có chữ `text`. */
const toastOf = (page: Page, text: string) => page.locator('[data-sonner-toast]', { hasText: text });
const footerOf = (page: Page) => sheet(page).locator('[data-slot="review-actions"]');
const logOf = (page: Page) => sheet(page).locator('[data-slot="review-log-entry"]');

test.describe('thao tác trên mục (Story 4.4-a)', () => {
  test('Duyệt tay phát Vé: spinner chặn bấm lặp; POST approve kèm Idempotency-Key (uuid), không thân; toast; Sheet đóng, hàng rời, focus về hàng kế tiếp', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { state } = await openApi(page, {
      actionReply: async () => {
        await gate;
        return undefined;
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const dialog = page.getByRole('dialog', { name: 'Lệch số tiền' });
    const approve = dialog.getByRole('button', { name: 'Duyệt tay phát Vé' });
    await expect(dialog.getByRole('button', { name: 'Từ chối' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: /Đã hoàn tay|Bỏ qua/ })).toHaveCount(0);

    await approve.click();
    await expect(approve).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    await approve.click();
    release();

    await expect(toastOf(page, 'Đã phát 2 Vé cho Đơn TK5R8W1CAB.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(0)).toContainText('Không khớp Đơn nào');
    await expect(cards(page).nth(0)).toBeFocused();
    await expect(tabBadge(page)).toHaveText('3');
    expect(state.actions).toEqual([{ action: 'approve', itemId: itemId(1), key: expect.stringMatching(UUID), body: null }]);
  });

  test('Sự kiện không còn cho duyệt: nút tắt kèm lý do cạnh nút, không gọi API; "Từ chối" vẫn bấm được', async ({ page }) => {
    const blocked = detailOf(ITEMS[0]!, { approveBlockedReason: 'event_ended' });
    const { state } = await openApi(page, { details: { [itemId(1)]: blocked } });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const approve = footerOf(page).getByRole('button', { name: 'Duyệt tay phát Vé' });
    await expect(approve).toBeDisabled();
    await expect(footerOf(page).locator('[data-slot="review-approve-blocked"]')).toHaveText('Sự kiện đã kết thúc');
    await expect(approve).toHaveAccessibleDescription('Sự kiện đã kết thúc');
    await expect(footerOf(page).getByRole('button', { name: 'Từ chối' })).toBeEnabled();
    expect(state.actions).toEqual([]);
  });

  test('API từ chối duyệt vì Sự kiện (409 EVENT_LOCKED) → báo tại chỗ, chi tiết tải lại: nút tắt kèm "Sự kiện đang bị khóa"', async ({
    page,
  }) => {
    const { state } = await openApi(page, {
      actionReply: (call, s) => {
        s.details[call.itemId]!.approveBlockedReason = 'event_locked';
        return apiError(409, 'EVENT_LOCKED');
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    await footerOf(page).getByRole('button', { name: 'Duyệt tay phát Vé' }).click();
    await expect(footerOf(page).locator('[data-slot="review-action-error"]')).toContainText('Sự kiện đang bị khóa.');
    await expect(footerOf(page).locator('[data-slot="review-approve-blocked"]')).toHaveText('Sự kiện đang bị khóa');
    await expect(footerOf(page).getByRole('button', { name: 'Duyệt tay phát Vé' })).toBeDisabled();
    await expect(cards(page)).toHaveCount(4);
    expect(state.actions).toHaveLength(1);
  });

  test('hết chỗ (409 TICKET_TYPE_SOLD_OUT): Sheet giữ mở, báo tại chỗ, nhật ký thêm "Duyệt tay không thành · Hết chỗ", mục vẫn ở hàng', async ({
    page,
  }) => {
    await openApi(page, {
      actionReply: (call, s) => {
        s.details[call.itemId]!.log.push({ kind: 'approve_sold_out', at: ACTION_AT, actorName: ACTOR });
        return apiError(409, 'TICKET_TYPE_SOLD_OUT');
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(2).click();
    const dialog = page.getByRole('dialog', { name: 'Thanh toán mồ côi' });
    await dialog.getByRole('button', { name: 'Duyệt tay phát Vé' }).click();
    await expect(dialog.locator('[data-slot="review-action-error"]')).toContainText('Duyệt tay không thành · Hết chỗ');
    await expect(logOf(page)).toHaveCount(3);
    await expect(logOf(page).nth(2)).toHaveText('09:00 16/11/2026Duyệt tay không thành · Hết chỗ · Lê Minh');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Duyệt tay phát Vé' })).toBeEnabled();
    await expect(cards(page)).toHaveCount(4);
  });

  test('lỗi máy chủ khi duyệt → báo tại chỗ; bấm lại gửi cùng Idempotency-Key', async ({ page }) => {
    let fail = true;
    const { state } = await openApi(page, {
      actionReply: () => {
        if (!fail) return undefined;
        fail = false;
        return apiError(500, 'INTERNAL_ERROR');
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const approve = footerOf(page).getByRole('button', { name: 'Duyệt tay phát Vé' });
    await approve.click();
    await expect(footerOf(page).locator('[data-slot="review-action-error"]')).toContainText('Chưa duyệt tay được');
    await approve.click();
    await expect(toastOf(page, 'Đã phát 2 Vé cho Đơn TK5R8W1CAB.')).toBeVisible();
    expect(state.actions).toHaveLength(2);
    expect(state.actions[0]!.key).toMatch(UUID);
    expect(state.actions[1]!.key).toBe(state.actions[0]!.key);
  });

  test('lỗi máy chủ trong Dialog "Từ chối" → Dialog giữ mở, báo "Chưa từ chối được"; xác nhận lại gửi cùng Idempotency-Key', async ({
    page,
  }) => {
    let fail = true;
    const { state } = await openApi(page, {
      actionReply: (call) => {
        if (call.action !== 'reject' || !fail) return undefined;
        fail = false;
        return apiError(500, 'INTERNAL_ERROR');
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    await footerOf(page).getByRole('button', { name: 'Từ chối' }).click();
    const reject = page.getByRole('dialog', { name: 'Từ chối khoản tiền này?' });
    await reject.getByRole('button', { name: 'Từ chối' }).click();
    await expect(reject).toContainText('Chưa từ chối được');
    await expect(reject).toBeVisible();
    expect(state.actions).toHaveLength(1);
    await reject.getByRole('button', { name: 'Từ chối' }).click();
    await expect(toastOf(page, 'Đã hủy Đơn TK5R8W1CAB. Hoàn tiền cho khách rồi bấm "Đã hoàn tay".')).toBeVisible();
    await expect(reject).toBeHidden();
    expect(state.actions.map((a) => a.action)).toEqual(['reject', 'reject']);
    expect(state.actions[0]!.key).toMatch(UUID);
    expect(state.actions[1]!.key).toBe(state.actions[0]!.key);
  });

  test('từ md: Từ chối qua Dialog (Hủy không gọi API) → Đơn hủy, Sheet ở lại chỉ còn "Đã hoàn tay"; Đã hoàn tay (Dialog) → hàng rời, focus về hàng kế tiếp; mỗi thao tác một khóa', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const { state } = await openApi(page);
    await page.goto(queuePath);
    await rows(page).nth(2).getByRole('button', { name: 'TK9B2X7EAB' }).click();
    const sheetDialog = page.getByRole('dialog', { name: 'Thanh toán mồ côi' });
    await sheetDialog.getByRole('button', { name: 'Từ chối' }).click();

    const reject = page.getByRole('dialog', { name: 'Từ chối khoản tiền này?' });
    await expect(reject).toContainText('Đơn TK9B2X7EAB sẽ bị hủy.');
    await expect(reject).toContainText('Mục ở lại hàng Cần xử lý tới khi bạn bấm "Đã hoàn tay".');
    await reject.getByRole('button', { name: 'Hủy' }).click();
    await expect(reject).toBeHidden();
    expect(state.actions).toEqual([]);

    await sheetDialog.getByRole('button', { name: 'Từ chối' }).click();
    await reject.getByRole('button', { name: 'Từ chối' }).click();
    await expect(toastOf(page, 'Đã hủy Đơn TK9B2X7EAB. Hoàn tiền cho khách rồi bấm "Đã hoàn tay".')).toBeVisible();
    await expect(reject).toBeHidden();
    await expect(sheetDialog).toBeVisible();
    await expect(footerOf(page).getByRole('button')).toHaveText(['Đã hoàn tay']);
    // Nút "Từ chối" đã mất: focus ở lại trong `Sheet`, trên "Đã hoàn tay".
    await expect(footerOf(page).getByRole('button', { name: 'Đã hoàn tay' })).toBeFocused();
    await expect(sheetDialog.locator('[data-slot="review-order"] [data-slot="status-badge"]')).toHaveText('Đã hủy');
    await expect(logOf(page).last()).toHaveText('09:00 16/11/2026Từ chối · Lê Minh');
    // Mục vẫn `open`: ở lại hàng.
    await expect(rows(page)).toHaveCount(4);

    await footerOf(page).getByRole('button', { name: 'Đã hoàn tay' }).click();
    const refund = page.getByRole('dialog', { name: 'Ghi nhận đã hoàn tay?' });
    await expect(refund).toContainText('Bạn đã chuyển trả 300.000đ cho khách ngoài Tickee.');
    await expect(refund).toContainText('Đơn TK9B2X7EAB chuyển "Đã hoàn tay", mục rời hàng Cần xử lý.');
    await expect(refund).toContainText('Không hoàn tác được.');
    await refund.getByRole('button', { name: 'Đã hoàn tay' }).click();
    await expect(toastOf(page, 'Đã ghi nhận hoàn tay 300.000đ.')).toBeVisible();
    await expect(sheetDialog).toBeHidden();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2).getByRole('button', { name: 'TK3J6N4DAB' })).toBeFocused();

    expect(state.actions.map((a) => [a.action, a.itemId, a.body])).toEqual([
      ['reject', itemId(3), null],
      ['refund', itemId(3), null],
    ]);
    expect(state.actions[0]!.key).toMatch(UUID);
    expect(state.actions[1]!.key).toMatch(UUID);
    expect(state.actions[1]!.key).not.toBe(state.actions[0]!.key);
  });

  test('Bỏ qua: lý do bắt buộc (nút xác nhận tắt, FieldError), Hủy không gọi API; xác nhận gửi lý do đã trim, nhật ký kèm lý do', async ({
    page,
  }) => {
    const { state } = await openApi(page);
    await page.goto(queuePath);
    await cards(page).nth(1).click();
    const sheetDialog = page.getByRole('dialog', { name: 'Giao dịch chưa khớp' });
    await expect(footerOf(page).getByRole('button')).toHaveText(['Ghép với Đơn', 'Đã hoàn tay', 'Bỏ qua']);
    await sheetDialog.getByRole('button', { name: 'Bỏ qua' }).click();

    const dismiss = page.getByRole('dialog', { name: 'Bỏ qua mục này?' });
    const confirm = dismiss.getByRole('button', { name: 'Bỏ qua' });
    const reason = dismiss.getByRole('textbox', { name: 'Lý do' });
    await expect(confirm).toBeDisabled();
    await reason.fill('   ');
    await expect(dismiss.getByRole('alert')).toHaveText('Nhập lý do bỏ qua.');
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await expect(confirm).toBeDisabled();
    await dismiss.getByRole('button', { name: 'Hủy' }).click();
    await expect(dismiss).toBeHidden();
    expect(state.actions).toEqual([]);

    await sheetDialog.getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(reason).toHaveValue('');
    await reason.fill('  Khách chuyển nhầm, đã liên hệ  ');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(toastOf(page, 'Đã bỏ qua mục.')).toBeVisible();
    await expect(sheetDialog).toBeHidden();
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(1)).toContainText('TK9B2X7EAB');
    await expect(cards(page).nth(1)).toBeFocused();
    expect(state.actions).toEqual([
      { action: 'dismiss', itemId: itemId(2), key: expect.stringMatching(UUID), body: { reason: 'Khách chuyển nhầm, đã liên hệ' } },
    ]);
    expect(state.details[itemId(2)]!.log.at(-1)).toMatchObject({ kind: 'dismissed', note: 'Khách chuyển nhầm, đã liên hệ' });
  });

  test('nhật ký mục đã xử lý: dòng "Bỏ qua" kèm lý do; người làm không có tên → "Thành viên BTC"; không có nút thao tác', async ({
    page,
  }) => {
    const done = detailOf(ITEMS[1]!, {
      status: 'resolved',
      resolution: 'dismissed',
      actions: [],
      log: [
        { kind: 'payment_received', at: '2026-11-16T08:11:30+07:00' },
        { kind: 'item_opened', at: ITEMS[1]!.createdAt },
        { kind: 'dismissed', at: ACTION_AT, actorName: '', note: 'Khách chuyển nhầm' },
      ],
    });
    await openApi(page, { details: { [itemId(2)]: done } });
    await page.goto(queuePath);
    await cards(page).nth(1).click();
    await expect(logOf(page).last()).toContainText('Bỏ qua · Thành viên BTC');
    await expect(logOf(page).last().locator('[data-slot="review-log-note"]')).toHaveText('Lý do: Khách chuyển nhầm');
    await expect(footerOf(page)).toHaveCount(0);
  });

  test('Đã hoàn tay trên Thanh toán trùng: Dialog nêu Đơn giữ nguyên (Hủy không gọi API); mục cuối cùng rời hàng → focus về tiêu đề trang', async ({
    page,
  }) => {
    const { state } = await openApi(page, { items: [ITEMS[3]!], openCount: 1 });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const sheetDialog = page.getByRole('dialog', { name: 'Thanh toán trùng' });
    await sheetDialog.getByRole('button', { name: 'Đã hoàn tay' }).click();
    const refund = page.getByRole('dialog', { name: 'Ghi nhận đã hoàn tay?' });
    await expect(refund).toContainText('Đơn TK3J6N4DAB, Vé và doanh thu giữ nguyên.');
    await refund.getByRole('button', { name: 'Hủy' }).click();
    await expect(refund).toBeHidden();
    expect(state.actions).toEqual([]);

    await sheetDialog.getByRole('button', { name: 'Đã hoàn tay' }).click();
    await refund.getByRole('button', { name: 'Đã hoàn tay' }).click();
    await expect(toastOf(page, 'Đã ghi nhận hoàn tay 300.000đ.')).toBeVisible();
    await expect(sheetDialog).toBeHidden();
    await expect(page.locator('[data-slot="empty-state"]')).toContainText('Không có gì cần xử lý.');
    await expect(heading(page)).toBeFocused();
    expect(state.actions.map((a) => a.action)).toEqual(['refund']);
  });

  test('thua cuộc đua (409 REVIEW_ACTION_NOT_ALLOWED): toast "Mục này vừa được xử lý.", hàng và chi tiết tải lại', async ({
    page,
  }) => {
    const { state, calls } = await openApi(page, {
      actionReply: (call, s) => {
        // Thành viên khác vừa từ chối rồi hoàn tay mục này.
        const detail = s.details[call.itemId]!;
        Object.assign(detail, { status: 'resolved', resolution: 'refunded', actions: [] });
        detail.order!.status = 'refunded';
        detail.log.push({ kind: 'refunded', at: ACTION_AT, actorName: 'Phạm Hà' });
        leave(s, call.itemId);
        return apiError(409, 'REVIEW_ACTION_NOT_ALLOWED');
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(0).click();
    const before = listGets(calls).length;
    await footerOf(page).getByRole('button', { name: 'Duyệt tay phát Vé' }).click();
    await expect(toastOf(page, 'Mục này vừa được xử lý.')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    expect(listGets(calls).length).toBeGreaterThan(before);
    const dialog = page.getByRole('dialog', { name: 'Lệch số tiền' });
    await expect(logOf(page).last()).toHaveText('09:00 16/11/2026Đã hoàn tay · Phạm Hà');
    await expect(dialog.locator('[data-slot="review-actions"]')).toHaveCount(0);
    expect(state.actions).toHaveLength(1);
    // Hàng đã mở `Sheet` không còn: đóng → focus về tiêu đề trang.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(heading(page)).toBeFocused();
  });

  test('320px: Sheet có thao tác và các Dialog không cuộn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openApi(page);
    await page.goto(queuePath);
    const settle = (locator: ReturnType<Page['locator']>) =>
      locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const within320 = async (locator: ReturnType<Page['locator']>) => {
      const box = (await locator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    };

    await cards(page).nth(0).click();
    await expect(footerOf(page).getByRole('button')).toHaveCount(2);
    await settle(sheet(page));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await within320(footerOf(page));
    await footerOf(page).getByRole('button', { name: 'Từ chối' }).click();
    const reject = page.getByRole('dialog', { name: 'Từ chối khoản tiền này?' });
    await settle(reject);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await within320(reject);
    await reject.getByRole('button', { name: 'Hủy' }).click();
    await expect(reject).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    await cards(page).nth(1).click();
    await footerOf(page).getByRole('button', { name: 'Bỏ qua' }).click();
    const dismiss = page.getByRole('dialog', { name: 'Bỏ qua mục này?' });
    await dismiss.getByRole('textbox', { name: 'Lý do' }).fill('Khách chuyển nhầm '.repeat(10));
    await settle(dismiss);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await within320(dismiss);
    await dismiss.getByRole('button', { name: 'Hủy' }).click();
    await footerOf(page).getByRole('button', { name: 'Đã hoàn tay' }).click();
    const refund = page.getByRole('dialog', { name: 'Ghi nhận đã hoàn tay?' });
    // Mục chưa khớp không có Đơn: chỉ đóng mục.
    await expect(refund).toContainText('Mục rời hàng Cần xử lý.');
    await settle(refund);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await within320(refund);
  });
});

const matchDialog = (page: Page) => page.getByRole('dialog', { name: 'Ghép với Đơn' });
const candidateRows = (page: Page) => matchDialog(page).locator('[data-slot="match-candidate"]');
const radioOf = (page: Page, code: string) => matchDialog(page).getByRole('radio', { name: new RegExp(code) });
const confirmMatch = (page: Page) => matchDialog(page).getByRole('button', { name: 'Ghép và phát Vé' });

/** Mở `Sheet` của mục chưa khớp (`ITEMS[1]`, nhận 75.000đ) rồi mở `Dialog` "Ghép với Đơn". */
async function openMatch(page: Page): Promise<void> {
  await cards(page).nth(1).click();
  await footerOf(page).getByRole('button', { name: 'Ghép với Đơn' }).click();
  await expect(matchDialog(page)).toBeVisible();
}

test.describe('Ghép với Đơn (Story 4.4-b)', () => {
  test('nút chính đứng đầu; Dialog: số tiền nhận, mã Đơn trong giao dịch, Sự kiện (không nháp), ứng viên (bị chặn tắt kèm lý do); chọn → spinner chặn bấm lặp; toast, hàng rời, focus về hàng kế tiếp', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { state } = await openApi(page, {
      actionReply: async (call) => {
        if (call.action === 'match') await gate;
        return undefined;
      },
    });
    await page.goto(queuePath);
    await cards(page).nth(1).click();
    await expect(footerOf(page).getByRole('button')).toHaveText(['Ghép với Đơn', 'Đã hoàn tay', 'Bỏ qua']);
    // Nút đầu là nút chính; "Đã hoàn tay" lùi thành nút phụ.
    await expect(footerOf(page).getByRole('button', { name: 'Ghép với Đơn' })).toHaveClass(/bg-btn-on-light/);
    await expect(footerOf(page).getByRole('button', { name: 'Đã hoàn tay' })).not.toHaveClass(/bg-btn-on-light/);
    await footerOf(page).getByRole('button', { name: 'Ghép với Đơn' }).click();

    const dialog = matchDialog(page);
    await expect(dialog.locator('[data-slot="match-transaction"]')).toContainText('Số tiền nhận75.000đ');
    await expect(dialog.locator('[data-slot="match-transaction"]')).toContainText('Mã Đơn trong giao dịchTK0000ZZZZ');
    const select = dialog.getByRole('combobox', { name: 'Sự kiện' });
    await expect(select.locator('option')).toHaveText(['Mọi Sự kiện', EVENT_B.name, EVENT_A.name]);
    await expect(select).toHaveValue('');
    await expect(candidateRows(page)).toHaveCount(3);
    await expect(candidateRows(page).nth(0)).toContainText('TK7M4Q2HAB');
    await expect(candidateRows(page).nth(0).locator('[data-slot="status-badge"]')).toHaveText('Hết hạn');
    await expect(candidateRows(page).nth(0)).toContainText('Nguyễn Văn An');
    await expect(candidateRows(page).nth(0)).toContainText(EVENT_A.name);
    await expect(candidateRows(page).nth(0)).toContainText('2 Vé · 07:30 16/11/2026');
    await expect(candidateRows(page).nth(1).locator('[data-slot="status-badge"]')).toHaveText('Cần xử lý');
    // Sự kiện đã kết thúc: tắt kèm lý do.
    await expect(radioOf(page, 'TK2W9X5ZAB')).toBeDisabled();
    await expect(candidateRows(page).nth(2).locator('[data-slot="match-candidate-blocked"]')).toHaveText('Sự kiện đã kết thúc');
    await expect(radioOf(page, 'TK2W9X5ZAB')).toHaveAccessibleDescription('Sự kiện đã kết thúc');
    await expect(dialog.locator('[data-slot="match-truncated"]')).toHaveCount(0);
    expect(state.candidateFilters).toEqual([null]);

    const confirm = confirmMatch(page);
    await expect(confirm).toBeDisabled();
    await radioOf(page, 'TK8P3R6KAB').check();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
    await confirm.click();
    release();

    await expect(toastOf(page, 'Đã ghép giao dịch vào Đơn TK8P3R6KAB. Đã phát 1 Vé.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(sheet(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(1)).toContainText('TK9B2X7EAB');
    await expect(cards(page).nth(1)).toBeFocused();
    await expect(tabBadge(page)).toHaveText('3');
    expect(state.actions).toEqual([
      { action: 'match', itemId: itemId(2), key: expect.stringMatching(UUID), body: { orderCode: 'TK8P3R6KAB' } },
    ]);
  });

  test('lọc theo Sự kiện: tải lại ứng viên ?eventId=; Đơn đã chọn không còn trong danh sách → bỏ chọn; danh sách bị cắt → "Chỉ hiện 100 Đơn mới nhất."', async ({
    page,
  }) => {
    const { state } = await openApi(page, { truncated: true });
    await page.goto(queuePath);
    await openMatch(page);
    await expect(matchDialog(page).locator('[data-slot="match-truncated"]')).toHaveText(
      'Chỉ hiện 100 Đơn mới nhất. Chọn Sự kiện để thu hẹp.',
    );
    await radioOf(page, 'TK7M4Q2HAB').check();
    await expect(confirmMatch(page)).toBeEnabled();

    await matchDialog(page).getByRole('combobox', { name: 'Sự kiện' }).selectOption(EVENT_B.id);
    await expect(candidateRows(page)).toHaveCount(2);
    await expect(candidateRows(page).nth(0)).toContainText('TK8P3R6KAB');
    expect(state.candidateFilters.at(-1)).toBe(EVENT_B.id);
    // Đơn đã chọn (Sự kiện khác) không còn trong danh sách: bỏ chọn, nút xác nhận tắt.
    await expect(confirmMatch(page)).toBeDisabled();
    await expect(matchDialog(page).getByRole('radio', { checked: true })).toHaveCount(0);

    // Về "Mọi Sự kiện": danh sách đầy đủ (từ bộ nhớ đệm), không còn Đơn nào được chọn.
    await matchDialog(page).getByRole('combobox', { name: 'Sự kiện' }).selectOption('');
    await expect(candidateRows(page)).toHaveCount(3);
    await expect(confirmMatch(page)).toBeDisabled();

    // Hủy không gọi API; mở lại là một lần chọn mới (bộ lọc về "Mọi Sự kiện").
    await radioOf(page, 'TK7M4Q2HAB').check();
    await matchDialog(page).getByRole('button', { name: 'Hủy' }).click();
    await expect(matchDialog(page)).toBeHidden();
    await expect(footerOf(page).getByRole('button', { name: 'Ghép với Đơn' })).toBeFocused();
    await footerOf(page).getByRole('button', { name: 'Ghép với Đơn' }).click();
    await expect(matchDialog(page).getByRole('combobox', { name: 'Sự kiện' })).toHaveValue('');
    await expect(confirmMatch(page)).toBeDisabled();
    expect(state.actions).toEqual([]);
  });

  test('không có ứng viên: empty-state nêu số tiền, nút xác nhận tắt', async ({ page }) => {
    const { state } = await openApi(page, { candidates: [] });
    await page.goto(queuePath);
    await openMatch(page);
    await expect(matchDialog(page).locator('[data-slot="empty-state"]')).toHaveText(
      'Không có Đơn hết hạn hay Cần xử lý nào cùng số tiền 75.000đ.',
    );
    await expect(candidateRows(page)).toHaveCount(0);
    await expect(confirmMatch(page)).toBeDisabled();
    expect(state.actions).toEqual([]);
  });

  test('hết chỗ (409 TICKET_TYPE_SOLD_OUT): Dialog ở lại, báo "Đơn {mã} không còn đủ chỗ.", ứng viên tải lại; nhật ký có dòng "không thành"; mục vẫn ở hàng; lần sau là khóa mới', async ({
    page,
  }) => {
    let soldOut = true;
    const { state } = await openApi(page, {
      actionReply: (call, s) => {
        if (call.action !== 'match' || !soldOut) return undefined;
        soldOut = false;
        s.details[call.itemId]!.log.push({ kind: 'match_sold_out', at: ACTION_AT, actorName: ACTOR });
        return apiError(409, 'TICKET_TYPE_SOLD_OUT');
      },
    });
    await page.goto(queuePath);
    await openMatch(page);
    await radioOf(page, 'TK7M4Q2HAB').check();
    const loads = state.candidateFilters.length;
    await confirmMatch(page).click();
    await expect(matchDialog(page)).toContainText('Chưa ghép được');
    await expect(matchDialog(page)).toContainText('Đơn TK7M4Q2HAB không còn đủ chỗ.');
    await expect(matchDialog(page)).toBeVisible();
    await expect.poll(() => state.candidateFilters.length).toBeGreaterThan(loads);
    await expect(logOf(page).last()).toHaveText('09:00 16/11/2026Ghép với Đơn không thành · Hết chỗ · Lê Minh');
    await expect(cards(page)).toHaveCount(4);

    // Thử Đơn khác: lần gửi mới (khóa mới), thành công.
    await radioOf(page, 'TK8P3R6KAB').check();
    await confirmMatch(page).click();
    await expect(toastOf(page, 'Đã ghép giao dịch vào Đơn TK8P3R6KAB. Đã phát 1 Vé.')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    expect(state.actions.map((a) => (a.body as { orderCode: string }).orderCode)).toEqual(['TK7M4Q2HAB', 'TK8P3R6KAB']);
    expect(state.actions[1]!.key).not.toBe(state.actions[0]!.key);
  });

  test('Đơn vừa đổi trạng thái (409 MATCH_ORDER_NOT_ELIGIBLE): báo "Chọn Đơn khác.", danh sách tải lại không còn Đơn đó, bỏ chọn', async ({
    page,
  }) => {
    const { state } = await openApi(page, {
      actionReply: (call, s) => {
        if (call.action !== 'match') return undefined;
        // Giao dịch khác vừa ghép vào Đơn này.
        s.candidates = s.candidates.filter((c) => c.code !== (call.body as { orderCode: string }).orderCode);
        return apiError(409, 'MATCH_ORDER_NOT_ELIGIBLE');
      },
    });
    await page.goto(queuePath);
    await openMatch(page);
    await radioOf(page, 'TK7M4Q2HAB').check();
    await confirmMatch(page).click();
    await expect(matchDialog(page)).toContainText('Đơn này vừa đổi trạng thái. Chọn Đơn khác.');
    await expect(candidateRows(page)).toHaveCount(2);
    await expect(radioOf(page, 'TK7M4Q2HAB')).toHaveCount(0);
    await expect(confirmMatch(page)).toBeDisabled();
    await expect(matchDialog(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
    expect(state.actions).toHaveLength(1);
  });

  test('Sự kiện của Đơn vừa kết thúc (409 EVENT_ALREADY_ENDED): báo tại chỗ; thua cuộc đua (409 REVIEW_ACTION_NOT_ALLOWED): Dialog đóng, toast "Mục này vừa được xử lý."', async ({
    page,
  }) => {
    const { state } = await openApi(page, {
      actionReply: (call, s) => {
        if (call.action !== 'match') return undefined;
        const { orderCode } = call.body as { orderCode: string };
        if (orderCode === 'TK7M4Q2HAB') {
          s.candidates = s.candidates.map((c) => (c.code === orderCode ? { ...c, blockedReason: 'event_ended' } : c));
          return apiError(409, 'EVENT_ALREADY_ENDED');
        }
        // Thành viên khác vừa bỏ qua mục này.
        Object.assign(s.details[call.itemId]!, { status: 'resolved', resolution: 'dismissed', actions: [] });
        leave(s, call.itemId);
        return apiError(409, 'REVIEW_ACTION_NOT_ALLOWED');
      },
    });
    await page.goto(queuePath);
    await openMatch(page);
    await radioOf(page, 'TK7M4Q2HAB').check();
    await confirmMatch(page).click();
    await expect(matchDialog(page)).toContainText('Đơn TK7M4Q2HAB: Sự kiện đã kết thúc.');
    await expect(radioOf(page, 'TK7M4Q2HAB')).toBeDisabled();
    await expect(confirmMatch(page)).toBeDisabled();

    await radioOf(page, 'TK8P3R6KAB').check();
    await confirmMatch(page).click();
    await expect(toastOf(page, 'Mục này vừa được xử lý.')).toBeVisible();
    await expect(matchDialog(page)).toBeHidden();
    await expect(cards(page)).toHaveCount(3);
    await expect(footerOf(page)).toHaveCount(0);
    expect(state.actions).toHaveLength(2);
  });

  test('mục đã ghép: Đơn liên quan là Đơn được ghép, nhật ký "Đã ghép với Đơn {mã}"; mục lệch tiền của Đơn đã thanh toán nhờ ghép: chỉ "Đã hoàn tay"/"Bỏ qua", Dialog nêu Đơn giữ nguyên', async ({
    page,
  }) => {
    const matched = detailOf(ITEMS[1]!, {
      status: 'resolved',
      resolution: 'approved',
      actions: [],
      order: {
        code: 'TK8P3R6KAB',
        status: 'paid',
        buyerName: 'Đỗ Minh Châu',
        ticketCount: 1,
        totalAmount: 75_000,
        createdAt: '2026-11-15T20:10:00+07:00',
      },
      event: EVENT_B,
      log: [
        { kind: 'payment_received', at: '2026-11-16T08:11:30+07:00' },
        { kind: 'item_opened', at: ITEMS[1]!.createdAt },
        { kind: 'match_sold_out', at: '2026-11-16T08:50:00+07:00', actorName: '' },
        { kind: 'matched', at: ACTION_AT, actorName: ACTOR, note: 'TK8P3R6KAB' },
      ],
    });
    const mismatchPaid = detailOf(ITEMS[0]!, { actions: ['refund', 'dismiss'] });
    mismatchPaid.order!.status = 'paid';
    const { state } = await openApi(page, { details: { [itemId(2)]: matched, [itemId(1)]: mismatchPaid } });
    await page.goto(queuePath);
    await cards(page).nth(1).click();
    const order = sheet(page).locator('[data-slot="review-order"]');
    await expect(order).toContainText('Mã ĐơnTK8P3R6KAB');
    await expect(order.locator('[data-slot="status-badge"]')).toHaveText('Đã thanh toán');
    await expect(order).toContainText(`Sự kiện${EVENT_B.name}`);
    await expect(logOf(page)).toHaveText([
      '08:11 16/11/2026Nhận tiền',
      '08:20 16/11/2026Mở mục · Giao dịch chưa khớp',
      '08:50 16/11/2026Ghép với Đơn không thành · Hết chỗ · Thành viên BTC',
      '09:00 16/11/2026Đã ghép với Đơn TK8P3R6KAB · Lê Minh',
    ]);
    await expect(footerOf(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    await cards(page).nth(0).click();
    await expect(footerOf(page).getByRole('button')).toHaveText(['Đã hoàn tay', 'Bỏ qua']);
    await footerOf(page).getByRole('button', { name: 'Đã hoàn tay' }).click();
    const refund = page.getByRole('dialog', { name: 'Ghi nhận đã hoàn tay?' });
    await expect(refund).toContainText('Bạn đã chuyển trả 250.000đ cho khách ngoài Tickee.');
    await expect(refund).toContainText('Đơn TK5R8W1CAB, Vé và doanh thu giữ nguyên.');
    await refund.getByRole('button', { name: 'Đã hoàn tay' }).click();
    await expect(toastOf(page, 'Đã ghi nhận hoàn tay 250.000đ.')).toBeVisible();
    expect(state.details[itemId(1)]!.order!.status).toBe('paid');
  });

  test('320px: Dialog không cuộn ngang; danh sách dài cuộn bên trong, nút xác nhận luôn thấy', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const many: Candidate[] = Array.from({ length: 30 }, (_, i) => ({
      ...CANDIDATES[i % 2]!,
      code: `TK${String(i).padStart(2, '0')}AAAAAA`,
      buyerName: `Nguyễn Thị Phương Thảo Hoàng Bảo Ngọc ${i}`,
      event: { id: EVENT_A.id, name: 'Giải cầu lông mở rộng Ba Đình — Hà Nội 2026 (vòng loại)' },
    }));
    await openApi(page, { candidates: many, truncated: true });
    await page.goto(queuePath);
    await openMatch(page);
    await expect(candidateRows(page)).toHaveCount(30);
    await matchDialog(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const box = (await matchDialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    const list = matchDialog(page).locator('[data-slot="match-candidates"]');
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(confirmMatch(page)).toBeInViewport();
    await expect(matchDialog(page).getByRole('button', { name: 'Hủy' })).toBeInViewport();

    // Chọn Đơn cuối danh sách (cuộn trong danh sách): nút xác nhận vẫn thấy và bật.
    await radioOf(page, 'TK29AAAAAA').check();
    await expect(confirmMatch(page)).toBeEnabled();
    await expect(confirmMatch(page)).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
