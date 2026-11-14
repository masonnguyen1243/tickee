import type { Page } from '@playwright/test';
import type { EventSaleReason } from '@tickee/contracts';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, type Call, type Handler } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Tab "Cài đặt" của Sự kiện (Story 2.12): form thông tin (dùng chung với wizard bước 1), Ẩn / Hiện lại (không hỏi xác
 * nhận) và "Kết thúc" qua `Dialog`. API giả có trạng thái, luật trạng thái như server. Story 3.10: lưu lệnh đổi giờ hoặc
 * địa điểm của Sự kiện đã mở bán, chưa kết thúc → đếm Người mua (`GET …/buyer-count`) rồi `Dialog` "Email sẽ được gửi tới
 * {n} Người mua." trước khi `PATCH`. E3-2: bấm "Kết thúc" → đếm Đơn đang chờ thanh toán (`GET …/pending-payment-count`)
 * rồi mới mở `Dialog` nêu đủ hậu quả (và số Đơn đó khi > 0). Story 4.2-c: `GET …/event-sale-status` có trạng thái, suy
 * `reason` từ trạng thái Sự kiện của API giả (badge Tổng quan lấy nhãn từ đây).
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const SLUG = 'giai-chay-ha-noi-2026-c4d5';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const settings = `${base}?tab=cai-dat`;
const eventPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const SALE_STATUS_PATH = `/orgs/${ORG_ID}/event-sale-status`;

/** ISO 8601 theo giờ Việt Nam (`+07:00`, không mili giây) như api trả. */
const vnIso = (ms: number) => `${new Date(ms + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;

type Status = 'draft' | 'published' | 'hidden' | 'cancelled';
type State = {
  status: Status;
  name: string;
  startsAt: string;
  endsAt: string;
  /** Mốc tự kết thúc khi chưa bấm "Kết thúc" (API giả không tự tính lại khi đổi `endsAt`). */
  effectiveEndAt: string;
  venue: string | null;
  description: string | null;
  endedManuallyAt: string | null;
  /** `GET …/buyer-count` trả số này (Story 3.10). */
  buyers: number;
  /** `GET …/buyer-count` trả 500. */
  failCount?: boolean;
  /** Chặn phản hồi `GET …/buyer-count` tới khi promise xong. */
  holdCount?: Promise<void>;
  /** Session hết hạn: `GET …/buyer-count`, `GET …/pending-payment-count` và `GET /identity/me` trả 401. */
  signedOut?: boolean;
  /** `GET …/pending-payment-count` trả số này (E3-2). */
  pendingOrders: number;
  /** `GET …/pending-payment-count` trả 500. */
  failPendingCount?: boolean;
  /** Chặn phản hồi `GET …/pending-payment-count` tới khi promise xong. */
  holdPendingCount?: Promise<void>;
  /** Chặn phản hồi `PATCH` tới khi promise xong. */
  holdPatch?: Promise<void>;
  /** Chặn phản hồi Ẩn/Hiện lại/Kết thúc tới khi promise xong. */
  hold?: Promise<void>;
  /** Ẩn trả 500 (lỗi không phải đổi trạng thái). */
  failHide?: boolean;
  /** Kết thúc trả 409 EVENT_NOT_STARTED dù nút đang bật (vd. đồng hồ máy khách lệch). */
  forceNotStarted?: boolean;
  /** Lưu (PATCH) trả lỗi: 400 VALIDATION_FAILED tại `endsAt` hoặc 500. */
  failPatch?: 'validation' | 'server';
  /** Chặn phản hồi `GET …/event-sale-status` tới khi promise xong (Story 4.2-c). */
  holdSale?: Promise<void>;
  /** `reason` api trả thay cho lý do suy từ trạng thái (vd. `paused`, máy khách không tự tính được). */
  saleReason?: EventSaleReason | null;
};

const NOT_STARTED_MESSAGE = 'Sự kiện chưa bắt đầu — dùng Ẩn để dừng nhận Đơn.';
/** Câu chữ "Kết thúc" (E3-2, C2). */
const END_HINT = 'Kết thúc sớm: ngừng nhận Đơn và Vé hết hiệu lực ngay, không mở lại được.';
const END_CONSEQUENCES =
  'Ngừng nhận Đơn ngay, không mở lại được. Từ lúc này Vé hết hiệu lực: không check-in được, CTV hết quyền, Vé rời “Vé của tôi” và link chia sẻ Vé ngừng hoạt động.';
const pendingNotice = (n: number) =>
  `Còn ${n} Đơn đang chờ thanh toán. Người mua đang ở trang thanh toán vẫn có thể chuyển tiền trong tối đa 15 phút; khoản đó không thành Vé và bạn sẽ phải hoàn tay.`;

const EFFECTIVE_END = '2099-11-16T23:59:59+07:00';

const eventOf = (state: State) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: SLUG,
  name: state.name,
  status: state.status,
  startsAt: state.startsAt,
  endsAt: state.endsAt,
  effectiveEndAt: state.endedManuallyAt ?? state.effectiveEndAt,
  endedManuallyAt: state.endedManuallyAt,
  venue: state.venue,
  description: state.description,
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ calls: Call[]; state: State }> {
  const state: State = {
    status: 'published',
    name: 'Giải chạy Hà Nội 2026',
    // Đã bắt đầu: "Kết thúc" bấm được.
    startsAt: '2020-11-16T07:00:00+07:00',
    endsAt: '2099-11-16T17:00:00+07:00',
    effectiveEndAt: EFFECTIVE_END,
    venue: 'Hồ Gươm',
    description: null,
    endedManuallyAt: null,
    buyers: 0,
    pendingOrders: 0,
    ...initial,
  };
  await mockIdentityApi(page, { 'GET /identity/me': () => (state.signedOut ? unauthenticated() : me(CONSENTED)) });
  const ended = () => state.endedManuallyAt !== null;
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] }),
    [`GET /orgs/${ORG_ID}/events`]: () => {
      const { id, slug, name, status, startsAt, endsAt, effectiveEndAt } = eventOf(state);
      return { status: 200, body: [{ id, slug, name, status, startsAt, endsAt, effectiveEndAt }] };
    },
    [`GET ${eventPath}`]: () => ({ status: 200, body: eventOf(state) }),
    // Trạng thái bán như api (Story 4.2-c): nháp không có trong danh sách; hủy > kết thúc > Ẩn; còn lại đang bán.
    [`GET ${SALE_STATUS_PATH}`]: async () => {
      if (state.holdSale) await state.holdSale;
      if (state.status === 'draft') return { status: 200, body: { events: [] } };
      const derived: EventSaleReason | null =
        state.status === 'cancelled' ? 'cancelled' : ended() ? 'ended' : state.status === 'hidden' ? 'hidden' : null;
      const reason = state.saleReason !== undefined ? state.saleReason : derived;
      return { status: 200, body: { events: [{ eventId: EVENT_ID, reason, partial: false }] } };
    },
    [`PATCH ${eventPath}`]: async (request) => {
      if (state.holdPatch) await state.holdPatch;
      if (state.failPatch === 'validation') {
        return apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'endsAt', code: 'custom' }] });
      }
      if (state.failPatch === 'server') return apiError(500, 'INTERNAL');
      if (state.status === 'cancelled') return apiError(409, 'EVENT_CANCELLED');
      const body = request.postDataJSON() as Pick<State, 'name' | 'startsAt' | 'endsAt' | 'venue' | 'description'>;
      Object.assign(state, {
        name: body.name,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        venue: body.venue,
        description: body.description,
      });
      return { status: 200, body: eventOf(state) };
    },
    [`GET ${eventPath}/buyer-count`]: async () => {
      if (state.holdCount) await state.holdCount;
      if (state.signedOut) return unauthenticated();
      return state.failCount ? apiError(500, 'INTERNAL') : { status: 200, body: { buyers: state.buyers } };
    },
    [`GET ${eventPath}/pending-payment-count`]: async () => {
      if (state.holdPendingCount) await state.holdPendingCount;
      if (state.signedOut) return unauthenticated();
      return state.failPendingCount ? apiError(500, 'INTERNAL_ERROR') : { status: 200, body: { orders: state.pendingOrders } };
    },
    [`POST ${eventPath}/hide`]: async () => {
      if (state.hold) await state.hold;
      if (state.failHide) return apiError(500, 'INTERNAL');
      if (state.status !== 'published') return apiError(409, 'EVENT_STATUS_CONFLICT', { status: state.status });
      if (ended()) return apiError(409, 'EVENT_ALREADY_ENDED');
      state.status = 'hidden';
      return { status: 200, body: eventOf(state) };
    },
    [`POST ${eventPath}/unhide`]: async () => {
      if (state.hold) await state.hold;
      if (state.status !== 'hidden') return apiError(409, 'EVENT_STATUS_CONFLICT', { status: state.status });
      if (ended()) return apiError(409, 'EVENT_ALREADY_ENDED');
      state.status = 'published';
      return { status: 200, body: eventOf(state) };
    },
    [`POST ${eventPath}/end`]: async () => {
      if (state.hold) await state.hold;
      if (state.status !== 'published' && state.status !== 'hidden') {
        return apiError(409, 'EVENT_STATUS_CONFLICT', { status: state.status });
      }
      if (ended()) return apiError(409, 'EVENT_ALREADY_ENDED');
      if (state.forceNotStarted) {
        return { status: 409, body: { error: { code: 'EVENT_NOT_STARTED', message: NOT_STARTED_MESSAGE, details: null } } };
      }
      if (new Date(state.startsAt).getTime() > Date.now()) return apiError(409, 'EVENT_NOT_STARTED');
      state.endedManuallyAt = vnIso(Date.now());
      return { status: 200, body: eventOf(state) };
    },
  };
  const calls = await mockOrganizerApi(page, handlers);
  return { calls, state };
}

const statusSection = (page: Page) => page.locator('[data-slot="event-status-actions"]');
const callsTo = (calls: Call[], action: string) =>
  calls.filter((c) => c.method === 'POST' && c.path === `${eventPath}/${action}`);
const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH' && c.path === eventPath);
const buyerCounts = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === `${eventPath}/buyer-count`);
const pendingCounts = (calls: Call[]) =>
  calls.filter((c) => c.method === 'GET' && c.path === `${eventPath}/pending-payment-count`);
const saleGets = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === SALE_STATUS_PATH);
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const saveButton = (page: Page) => page.getByRole('button', { name: 'Lưu thay đổi' });

test('sửa tên ở Cài đặt: PATCH đủ trường, toast, tiêu đề đổi theo', async ({ page }) => {
  const { calls } = await openApi(page);
  await page.goto(settings);
  await expect(page.getByRole('tab', { name: 'Cài đặt' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Tên Sự kiện')).toHaveValue('Giải chạy Hà Nội 2026');
  await expect(page.getByLabel('Địa điểm (không bắt buộc)')).toHaveValue('Hồ Gươm');
  await expect(page.getByText('Cần có để bán vé. Để trống thì mọi Hạng vé chuyển Tạm ngừng bán.')).toBeVisible();

  await page.getByLabel('Tên Sự kiện').fill('Giải chạy Hà Nội 2026 — mùa thu');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Giải chạy Hà Nội 2026 — mùa thu', level: 1 })).toBeVisible();
  const patch = calls.find((c) => c.method === 'PATCH' && c.path === eventPath);
  expect(patch?.body).toMatchObject({
    name: 'Giải chạy Hà Nội 2026 — mùa thu',
    startsAt: '2020-11-16T07:00:00+07:00',
    endsAt: '2099-11-16T17:00:00+07:00',
    venue: 'Hồ Gươm',
    refundPolicy: 'Hoàn 100% trước 7 ngày.',
  });
});

test('lưu ở Cài đặt, api trả 400 VALIDATION_FAILED tại endsAt → lỗi tại ô "Kết thúc", không banner chung', async ({
  page,
}) => {
  const { calls } = await openApi(page, { failPatch: 'validation' });
  await page.goto(settings);
  await page.getByLabel('Tên Sự kiện').fill('Giải chạy Hà Nội 2026 — mùa thu');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Giờ kết thúc phải sau giờ bắt đầu.')).toBeVisible();
  await expect(page.getByLabel('Kết thúc', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Chưa lưu được thông tin')).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
});

test('lưu ở Cài đặt lỗi 500: banner "Chưa lưu được thông tin"; "Thử lại" gửi đúng một PATCH nữa rồi lưu được', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { failPatch: 'server' });
  await page.goto(settings);
  await page.getByLabel('Tên Sự kiện').fill('Giải chạy Hà Nội 2026 — mùa thu');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Chưa lưu được thông tin')).toBeVisible();
  await expect(page.getByLabel('Tên Sự kiện')).toHaveValue('Giải chạy Hà Nội 2026 — mùa thu');
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);

  state.failPatch = undefined;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByText('Chưa lưu được thông tin')).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  expect(state.name).toBe('Giải chạy Hà Nội 2026 — mùa thu');
});

test('tên trống → lỗi tại ô, không gọi api', async ({ page }) => {
  const { calls } = await openApi(page);
  await page.goto(settings);
  await page.getByLabel('Tên Sự kiện').fill('  ');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Nhập tên Sự kiện.')).toBeVisible();
  expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
});

test('Ẩn không hỏi xác nhận, có spinner, không gửi lặp; badge "Ẩn"; "Hiện lại" bán lại', async ({ page }) => {
  let release = () => {};
  const { calls, state } = await openApi(page, { hold: new Promise<void>((resolve) => (release = resolve)) });
  await page.goto(settings);
  const hide = statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' });
  await hide.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hide).toHaveAttribute('aria-busy', 'true');
  await hide.click({ force: true });
  release();
  await expect(page.getByText('Đã ẩn Sự kiện. Link vẫn mở được nhưng không nhận Đơn mới.')).toBeVisible();
  expect(callsTo(calls, 'hide')).toHaveLength(1);
  expect(state.status).toBe('hidden');

  state.hold = undefined;
  await statusSection(page).getByRole('button', { name: 'Hiện lại' }).click();
  await expect(page.getByText('Đã hiện lại Sự kiện.')).toBeVisible();
  await expect(statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' })).toBeVisible();
  expect(callsTo(calls, 'unhide')).toHaveLength(1);

  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect(page.locator('[data-slot="event-overview"] [data-slot="status-badge"]')).toHaveText('Đang mở bán');
});

test('badge "Ẩn" ở Tổng quan sau khi ẩn', async ({ page }) => {
  await openApi(page);
  await page.goto(settings);
  await statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' }).click();
  await expect(statusSection(page).getByRole('button', { name: 'Hiện lại' })).toBeVisible();
  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect(page.locator('[data-slot="event-overview"] [data-slot="status-badge"]')).toHaveText('Ẩn');
});

test('trạng thái bán (Story 4.2-c): Ẩn ở Cài đặt bỏ dòng cũ khỏi cache → Tổng quan hiện "Ẩn" ngay khi đang tải lại, rồi nhãn của api', async ({
  page,
}) => {
  const { calls, state } = await openApi(page);
  await page.goto(base);
  const badge = page.locator('[data-slot="event-overview"] [data-slot="status-badge"]');
  await expect(badge).toHaveText('Đang mở bán');
  await expect.poll(() => saleGets(calls).length).toBeGreaterThanOrEqual(1);

  await page.getByRole('tab', { name: 'Cài đặt' }).click();
  // Lần tải lại trạng thái bán sau khi Ẩn bị giữ: badge không được hiện dòng cũ ("Đang mở bán") trong lúc chờ.
  let release = () => {};
  state.holdSale = new Promise<void>((resolve) => (release = resolve));
  const before = saleGets(calls).length;
  await statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' }).click();
  await expect(statusSection(page).getByRole('button', { name: 'Hiện lại' })).toBeVisible();
  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect.poll(() => saleGets(calls).length).toBe(before + 1);
  await expect(badge).toHaveText('Ẩn');

  // Lần tải lại trả lý do máy khách không tự tính được: badge đổi theo dữ liệu api, không còn là nhãn dự phòng.
  state.saleReason = 'paused';
  release();
  await expect(badge).toHaveText('Tạm ngừng bán');
});

test('Kết thúc qua Dialog nêu hậu quả: "Hủy" không gọi api; xác nhận → "Đã kết thúc lúc …", hết nút Kết thúc, badge "Đã kết thúc"', async ({
  page,
}) => {
  const { calls } = await openApi(page);
  await page.goto(settings);
  const end = statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true });
  await expect(statusSection(page).getByText(END_HINT, { exact: true })).toBeVisible();

  await end.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kết thúc Sự kiện?' })).toBeVisible();
  // E3-2: đếm Đơn đang chờ thanh toán trước khi mở; 0 Đơn → chỉ câu hậu quả.
  expect(pendingCounts(calls)).toHaveLength(1);
  await expect(dialog.locator('[data-slot="end-event-consequences"]')).toHaveText(END_CONSEQUENCES);
  await expect(dialog.locator('[data-slot="end-event-pending-payments"]')).toHaveCount(0);
  // `ConfirmDialog` mặc định vẫn là nút kiểu destructive (Story 3.10 thêm `confirmVariant`).
  await expect(dialog.getByRole('button', { name: 'Kết thúc', exact: true })).toHaveClass(/bg-destructive/);
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toHaveCount(0);
  expect(callsTo(calls, 'end')).toEqual([]);

  await end.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByText('Đã kết thúc Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(statusSection(page).locator('[data-slot="event-ended-at"]')).toContainText(/^Đã kết thúc lúc .+\d{2}:\d{2}/);
  await expect(statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true })).toHaveCount(0);
  await expect(statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' })).toHaveCount(0);
  expect(callsTo(calls, 'end')).toHaveLength(1);

  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect(page.locator('[data-slot="event-overview"] [data-slot="status-badge"]')).toHaveText('Đã kết thúc');
  // Đổi tab gọi `router.replace` (bỏ `?tab=`): chờ xong rồi mới `goto`, không thì hai lần điều hướng đè nhau.
  await page.waitForURL((url) => url.pathname === base && url.search === '');
  await page.goto(`/btc/${ORG_ID}`);
  await expect(page.locator('[data-slot="event-card"] [data-slot="status-badge"]')).toHaveText('Đã kết thúc');
});

test('Kết thúc khi còn Đơn đang chờ thanh toán: đếm trước (spinner, không bấm lặp) rồi Dialog nêu số Đơn và việc hoàn tay', async ({
  page,
}) => {
  let release = () => {};
  const { calls } = await openApi(page, {
    pendingOrders: 3,
    holdPendingCount: new Promise<void>((resolve) => (release = resolve)),
  });
  await page.goto(settings);
  // Đang đếm: spinner đổi tên truy cập của nút (như nút xác nhận đang chạy trong Dialog).
  const end = statusSection(page).getByRole('button', { name: /^Kết thúc/ });
  await end.click();
  await expect(end).toHaveAttribute('aria-busy', 'true');
  await end.click({ force: true });
  await statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(pendingCounts(calls)).toHaveLength(1);
  expect(callsTo(calls, 'hide')).toEqual([]);

  release();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kết thúc Sự kiện?' })).toBeVisible();
  await expect(dialog.locator('[data-slot="end-event-consequences"] p').first()).toHaveText(END_CONSEQUENCES);
  await expect(dialog.locator('[data-slot="end-event-pending-payments"]')).toHaveText(pendingNotice(3));
  expect(pendingCounts(calls)).toHaveLength(1);
  expect(callsTo(calls, 'end')).toEqual([]);

  await dialog.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByText('Đã kết thúc Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(callsTo(calls, 'end')).toHaveLength(1);
});

test('đếm Đơn đang chờ thanh toán lỗi: banner "Chưa kết thúc được" kèm lỗi, không mở Dialog; Ẩn xóa banner; bấm lại đếm được thì mở Dialog', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { pendingOrders: 1, failPendingCount: true });
  await page.goto(settings);
  const end = statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true });
  await end.click();
  const failure = statusSection(page).locator('[data-slot="status-banner"]');
  await expect(failure).toContainText('Chưa kết thúc được');
  await expect(failure).toContainText('Lỗi giả lập');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(pendingCounts(calls)).toHaveLength(1);
  expect(callsTo(calls, 'end')).toEqual([]);

  // Ẩn sau lần đếm lỗi: lỗi đếm không còn đúng chỗ, banner biến mất; Sự kiện đang ẩn vẫn Kết thúc được.
  await statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' }).click();
  await expect(statusSection(page).getByRole('button', { name: 'Hiện lại' })).toBeVisible();
  await expect(statusSection(page).getByText('Chưa kết thúc được')).toHaveCount(0);
  expect(callsTo(calls, 'hide')).toHaveLength(1);

  state.failPendingCount = false;
  await end.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-slot="end-event-pending-payments"]')).toHaveText(pendingNotice(1));
  await expect(dialog.locator('[data-slot="status-banner"]')).toHaveCount(0);
  expect(pendingCounts(calls)).toHaveLength(2);
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(statusSection(page).getByText('Chưa kết thúc được')).toHaveCount(0);
  expect(callsTo(calls, 'end')).toEqual([]);
});

test('đếm Đơn đang chờ thanh toán trả 401 (session hết hạn): sang trang đăng nhập kèm returnTo, không Dialog, không Kết thúc', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { pendingOrders: 2 });
  await page.goto(settings);
  state.signedOut = true;
  await statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(pendingCounts(calls)).toHaveLength(1);
  expect(callsTo(calls, 'end')).toEqual([]);
});

test('Kết thúc đang chạy: Esc và "Hủy" không đóng Dialog, không gửi lặp; xong thì Dialog đóng', async ({ page }) => {
  let release = () => {};
  const { calls } = await openApi(page, { hold: new Promise<void>((resolve) => (release = resolve)) });
  await page.goto(settings);
  await statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kết thúc Sự kiện?' })).toBeVisible();

  const confirm = dialog.getByRole('button', { name: /^Kết thúc/ });
  await confirm.click();
  await expect(confirm).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Kết thúc Sự kiện?' })).toBeVisible();
  expect(callsTo(calls, 'end')).toHaveLength(1);

  release();
  await expect(page.getByText('Đã kết thúc Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(callsTo(calls, 'end')).toHaveLength(1);
});

test('chưa bắt đầu: "Kết thúc" tắt, lý do nối bằng aria-describedby; Ẩn vẫn bấm được', async ({ page }) => {
  await openApi(page, { startsAt: '2099-11-16T07:00:00+07:00' });
  await page.goto(settings);
  const end = statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true });
  await expect(end).toBeDisabled();
  const describedBy = await end.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('Sự kiện chưa bắt đầu — dùng Ẩn để dừng nhận Đơn.');
  await expect(statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' })).toBeEnabled();
});

test('đang ẩn, chưa bắt đầu: lý do ngắn "Sự kiện chưa bắt đầu." (không gợi ý dùng Ẩn), nối bằng aria-describedby', async ({
  page,
}) => {
  await openApi(page, { status: 'hidden', startsAt: '2099-11-16T07:00:00+07:00' });
  await page.goto(settings);
  const end = statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true });
  await expect(end).toBeDisabled();
  const describedBy = await end.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('Sự kiện chưa bắt đầu.');
  await expect(statusSection(page).getByText(/dùng Ẩn/)).toHaveCount(0);
  await expect(statusSection(page).getByRole('button', { name: 'Hiện lại' })).toBeEnabled();
});

test('server trả 409 EVENT_NOT_STARTED khi nút đang bật: Dialog vẫn mở, banner "Chưa kết thúc được" với câu của server, không toast tải lại', async ({
  page,
}) => {
  const { calls } = await openApi(page, { forceNotStarted: true });
  await page.goto(settings);
  await statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(dialog.getByText('Chưa kết thúc được')).toBeVisible();
  await expect(dialog).toContainText(NOT_STARTED_MESSAGE);
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Trạng thái Sự kiện vừa đổi. Đã tải lại.')).toHaveCount(0);
  expect(callsTo(calls, 'end')).toHaveLength(1);
});

test('người khác vừa ẩn (409 EVENT_STATUS_CONFLICT): toast, tải lại Sự kiện và hiện "Hiện lại"', async ({ page }) => {
  const { state } = await openApi(page);
  await page.goto(settings);
  await expect(statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' })).toBeVisible();
  state.status = 'hidden';
  await statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' }).click();
  await expect(page.getByText('Trạng thái Sự kiện vừa đổi. Đã tải lại.')).toBeVisible();
  await expect(statusSection(page).getByRole('button', { name: 'Hiện lại' })).toBeVisible();
});

test('vừa kết thúc ở nơi khác (409 EVENT_ALREADY_ENDED từ Dialog): toast, không banner lỗi, Dialog đóng, tải lại thấy "Đã kết thúc lúc …"', async ({
  page,
}) => {
  const { state } = await openApi(page);
  await page.goto(settings);
  await statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kết thúc Sự kiện?' })).toBeVisible();
  state.endedManuallyAt = vnIso(Date.now() - 60_000);
  await dialog.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(page.getByText('Trạng thái Sự kiện vừa đổi. Đã tải lại.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Chưa kết thúc được')).toHaveCount(0);
  await expect(page.getByText('Chưa đổi được trạng thái')).toHaveCount(0);
  await expect(statusSection(page).locator('[data-slot="event-ended-at"]')).toBeVisible();
});

test('Sự kiện ẩn đã kết thúc: không còn nút Hiện lại / Ẩn / Kết thúc, hiện "Đã kết thúc lúc …", badge "Đã kết thúc"', async ({
  page,
}) => {
  await openApi(page, { status: 'hidden', endedManuallyAt: '2026-11-01T09:30:00+07:00' });
  await page.goto(settings);
  await expect(statusSection(page).locator('[data-slot="event-ended-at"]')).toContainText(/^Đã kết thúc lúc .+\d{2}:\d{2}/);
  await expect(statusSection(page).getByRole('button')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect(page.locator('[data-slot="event-overview"] [data-slot="status-badge"]')).toHaveText('Đã kết thúc');
});

test('lỗi Ẩn trước đó không hiện trong Dialog Kết thúc', async ({ page }) => {
  const { state } = await openApi(page, { failHide: true });
  await page.goto(settings);
  await statusSection(page).getByRole('button', { name: 'Ẩn Sự kiện' }).click();
  await expect(statusSection(page).getByText('Chưa đổi được trạng thái')).toBeVisible();
  state.failHide = false;
  await statusSection(page).getByRole('button', { name: 'Kết thúc', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kết thúc Sự kiện?' })).toBeVisible();
  await expect(dialog.getByText('Chưa kết thúc được')).toHaveCount(0);
  await expect(dialog.locator('[data-slot="status-banner"]')).toHaveCount(0);
});

test('lưu khi Sự kiện vừa bị hủy (409 EVENT_CANCELLED): toast, không banner lỗi; tải lại thì form chỉ đọc với giá trị server', async ({
  page,
}) => {
  const { state } = await openApi(page);
  await page.goto(settings);
  await expect(page.getByLabel('Tên Sự kiện')).toHaveValue('Giải chạy Hà Nội 2026');
  state.status = 'cancelled';
  await page.getByLabel('Tên Sự kiện').fill('Tên chưa lưu');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Sự kiện đã hủy, không sửa được. Đã tải lại Sự kiện.')).toBeVisible();
  await expect(page.getByText('Chưa lưu được thông tin')).toHaveCount(0);
  await expect(page.getByText('Thông tin chỉ để xem, không sửa được nữa.')).toBeVisible();
  await expect(page.getByLabel('Tên Sự kiện')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Tên Sự kiện')).toHaveValue('Giải chạy Hà Nội 2026');
  await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toHaveCount(0);
});

test('đã hủy: form chỉ đọc kèm lý do, không có nút lưu hay nút trạng thái', async ({ page }) => {
  await openApi(page, { status: 'cancelled' });
  await page.goto(settings);
  await expect(page.getByText('Thông tin chỉ để xem, không sửa được nữa.')).toBeVisible();
  await expect(page.getByLabel('Tên Sự kiện')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toHaveCount(0);
  await expect(statusSection(page).getByRole('button')).toHaveCount(0);
  await expect(statusSection(page)).toContainText('Sự kiện đã hủy, không đổi trạng thái được nữa.');
});

// ---------------------------------------------------------------------------------------------------------------
// Story 3.10: báo Người mua khi đổi giờ hoặc địa điểm
// ---------------------------------------------------------------------------------------------------------------

test('đổi giờ, có 3 Người mua: Dialog "Email sẽ được gửi tới 3 Người mua."; "Hủy" không PATCH; "Lưu và gửi email" thì PATCH', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { buyers: 3 });
  await page.goto(settings);
  await field(page, 'Bắt đầu').fill('2020-11-16T08:00');
  await saveButton(page).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Lưu thay đổi?' })).toBeVisible();
  await expect(dialog).toContainText('Email sẽ được gửi tới 3 Người mua.');
  const confirm = dialog.getByRole('button', { name: 'Lưu và gửi email' });
  await expect(confirm).toBeVisible();
  // Không phải nút kiểu destructive.
  await expect(confirm).not.toHaveClass(/bg-destructive/);
  expect(buyerCounts(calls)).toHaveLength(1);
  expect(patches(calls)).toEqual([]);

  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(patches(calls)).toEqual([]);
  expect(state.startsAt).toBe('2020-11-16T07:00:00+07:00');

  await saveButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu và gửi email' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toHaveLength(2);
  expect(patches(calls)).toHaveLength(1);
  expect(patches(calls)[0]?.body).toMatchObject({ startsAt: '2020-11-16T08:00:00+07:00', venue: 'Hồ Gươm' });
});

test('đổi địa điểm, đang lưu trong Dialog: spinner, Esc và "Hủy" không đóng, không gửi lặp; xong thì Dialog đóng', async ({
  page,
}) => {
  let release = () => {};
  const { calls } = await openApi(page, { buyers: 1, holdPatch: new Promise<void>((resolve) => (release = resolve)) });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Email sẽ được gửi tới 1 Người mua.');
  const confirm = dialog.getByRole('button', { name: 'Lưu và gửi email' });
  await confirm.click();
  await expect(confirm).toHaveAttribute('aria-busy', 'true');
  await confirm.click({ force: true });
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeVisible();
  expect(patches(calls)).toHaveLength(1);

  release();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(patches(calls)).toHaveLength(1);
  expect(patches(calls)[0]?.body).toMatchObject({ venue: 'Sân Mỹ Đình' });
});

test('đổi địa điểm, 0 Người mua: đếm rồi lưu luôn, không Dialog', async ({ page }) => {
  const { calls, state } = await openApi(page, { buyers: 0 });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('');
  await saveButton(page).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toHaveLength(1);
  expect(patches(calls)).toHaveLength(1);
  expect(state.venue).toBeNull();
});

test('chỉ sửa mô tả, có Người mua: không đếm, không Dialog, lưu luôn', async ({ page }) => {
  const { calls } = await openApi(page, { buyers: 5 });
  await page.goto(settings);
  await field(page, 'Mô tả (không bắt buộc)').fill('Mô tả mới');
  await saveButton(page).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toEqual([]);
  expect(patches(calls)).toHaveLength(1);
});

test('nháp: đổi giờ và địa điểm → không đếm, không Dialog', async ({ page }) => {
  const { calls } = await openApi(page, { status: 'draft', buyers: 5 });
  await page.goto(settings);
  await field(page, 'Bắt đầu').fill('2020-11-16T08:00');
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toEqual([]);
  expect(patches(calls)).toHaveLength(1);
});

test('đã bấm "Kết thúc": dời giờ kết thúc sang tương lai và đổi địa điểm → không đếm, không Dialog', async ({ page }) => {
  const { calls } = await openApi(page, { buyers: 5, endedManuallyAt: '2026-11-01T09:30:00+07:00' });
  await page.goto(settings);
  await field(page, 'Kết thúc').fill('2099-11-20T17:00');
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(buyerCounts(calls)).toEqual([]);
  expect(patches(calls)).toHaveLength(1);
});

test('đã tự kết thúc, sửa địa điểm (giờ giữ trong quá khứ) → không đếm, không Dialog', async ({ page }) => {
  const { calls } = await openApi(page, {
    buyers: 5,
    endsAt: '2020-11-16T17:00:00+07:00',
    effectiveEndAt: '2020-11-16T23:59:59+07:00',
  });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toEqual([]);
  expect(patches(calls)).toHaveLength(1);
});

test('đếm Người mua lỗi: banner "Chưa lưu được thông tin", không PATCH; "Thử lại" đếm lại rồi mở Dialog', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { buyers: 2, failCount: true });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  await expect(page.getByText('Chưa lưu được thông tin')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toHaveLength(1);
  expect(patches(calls)).toEqual([]);

  state.failCount = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Email sẽ được gửi tới 2 Người mua.');
  await expect(page.locator('[data-slot="event-settings-info"]').getByText('Chưa lưu được thông tin')).toHaveCount(0);
  expect(buyerCounts(calls)).toHaveLength(2);
  expect(patches(calls)).toEqual([]);
});

test('PATCH lỗi khi lưu từ Dialog: lỗi hiện trong Dialog, Dialog vẫn mở; "Hủy" đóng và không còn banner', async ({
  page,
}) => {
  const { calls } = await openApi(page, { buyers: 2, failPatch: 'server' });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Lưu và gửi email' }).click();
  await expect(dialog.getByText('Chưa lưu được thông tin')).toBeVisible();
  await expect(dialog.locator('[data-slot="status-banner"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="event-settings-info"]').getByText('Chưa lưu được thông tin')).toHaveCount(0);
  expect(patches(calls)).toHaveLength(1);

  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Chưa lưu được thông tin')).toHaveCount(0);
  await expect(field(page, 'Địa điểm (không bắt buộc)')).toHaveValue('Sân Mỹ Đình');
});

test('400 VALIDATION_FAILED khi lưu từ Dialog: báo trong Dialog; "Hủy" thì thấy lỗi tại ô "Kết thúc"', async ({ page }) => {
  await openApi(page, { buyers: 2, failPatch: 'validation' });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Lưu và gửi email' }).click();
  await expect(dialog.getByText('Chưa lưu được thông tin')).toBeVisible();
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(field(page, 'Kết thúc')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Giờ kết thúc phải sau giờ bắt đầu.')).toBeVisible();
});

test('đang đếm Người mua: "Lưu thay đổi" aria-busy, bấm lại hay Enter không đếm lần nữa; đếm xong thì mở Dialog', async ({
  page,
}) => {
  let release = () => {};
  const { calls } = await openApi(page, { buyers: 2, holdCount: new Promise<void>((resolve) => (release = resolve)) });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  const save = saveButton(page);
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await save.click({ force: true });
  await field(page, 'Tên Sự kiện').press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(buyerCounts(calls)).toHaveLength(1);

  release();
  await expect(page.getByRole('dialog')).toContainText('Email sẽ được gửi tới 2 Người mua.');
  expect(buyerCounts(calls)).toHaveLength(1);
  expect(patches(calls)).toEqual([]);
});

test('lưu từ Dialog khi Sự kiện vừa bị hủy (409 EVENT_CANCELLED): Dialog đóng, toast, form chỉ đọc', async ({ page }) => {
  const { calls, state } = await openApi(page, { buyers: 2 });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  await saveButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Email sẽ được gửi tới 2 Người mua.');
  state.status = 'cancelled';
  await dialog.getByRole('button', { name: 'Lưu và gửi email' }).click();
  await expect(page.getByText('Sự kiện đã hủy, không sửa được. Đã tải lại Sự kiện.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Thông tin chỉ để xem, không sửa được nữa.')).toBeVisible();
  await expect(field(page, 'Tên Sự kiện')).toHaveAttribute('readonly', '');
  await expect(saveButton(page)).toHaveCount(0);
  expect(patches(calls)).toHaveLength(1);
});

test('đếm Người mua trả 401 (session hết hạn): sang trang đăng nhập kèm returnTo, không PATCH', async ({ page }) => {
  const { calls, state } = await openApi(page, { buyers: 2 });
  await page.goto(settings);
  await field(page, 'Địa điểm (không bắt buộc)').fill('Sân Mỹ Đình');
  state.signedOut = true;
  await saveButton(page).click();
  await page.waitForURL(`**/dang-nhap?returnTo=${encodeURIComponent(base)}`);
  expect(buyerCounts(calls)).toHaveLength(1);
  expect(patches(calls)).toEqual([]);
});

test('320px: tab Cài đặt không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApi(page);
  await page.goto(settings);
  await expect(statusSection(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
