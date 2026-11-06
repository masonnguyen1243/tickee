import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler } from './identity-mock';
import { ALWAYS_CONDITIONS, mockOrganizerApi, organization, ORG_ID, readiness, statusNotice } from './organizer-mock';

/*
 * Wizard bước 4 "Xem trước & mở bán" (Story 2.10): danh sách điều kiện chưa đạt kèm link sửa nhanh, nút "Mở bán" tắt có
 * lý do, mở bán xong hiện link công khai + "Sao chép link". API giả có trạng thái: điều kiện tính từ Sự kiện hiện tại
 * (chính sách hoàn vé) cộng các mã ép thêm từ test.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const EVENT_ID = '019a3b2c-0700-7abc-8def-0123456789ab';
const SLUG = 'giai-chay-ha-noi-2026-a2b3';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const eventPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const PAID_CONDITIONS = [...ALWAYS_CONDITIONS, 'CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED', 'PAID_PRICE_MINIMUM'];

type State = {
  status: 'draft' | 'published';
  refundPolicy: string | null;
  name: string;
  /** Mã điều kiện trả về (thứ tự như server). */
  codes: string[];
  /** Mã chưa đạt ép thêm (ngoài REFUND_POLICY tính từ chính sách). */
  forcedUnmet: string[];
  /** Lần mở bán tới trả lỗi này (rồi tự xóa). */
  publishError?: { status: number; code: string; details?: unknown; then?: (state: State) => void };
  /** Tải điều kiện trả 500 tới khi test tắt cờ (query tự thử lại khi 5xx, nên không dùng lỗi một lần). */
  readinessFails?: boolean;
  /** Chặn phản hồi tải điều kiện tới khi promise xong. */
  holdReadiness?: Promise<void>;
  /** Chặn phản hồi mở bán tới khi `release` được gọi. */
  holdPublish?: Promise<void>;
  /** Vai của người xem ở BTC (mặc định Admin). */
  role: 'owner' | 'admin';
  /** `GET /orgs/:id/notices`. */
  notices: unknown[];
};

const eventOf = (state: State) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: SLUG,
  name: state.name,
  status: state.status,
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  effectiveEndAt: '2099-11-16T23:59:59+07:00',
  venue: 'Hồ Gươm',
  description: null,
  refundPolicy: state.refundPolicy,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

const unmetOf = (state: State) => [
  ...(state.refundPolicy?.trim() ? [] : ['REFUND_POLICY']),
  ...state.forcedUnmet,
];

async function openApi(page: Page, initial: Partial<State> = {}): Promise<{ calls: Call[]; state: State }> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const state: State = {
    status: 'draft',
    refundPolicy: 'Hoàn 100% trước 7 ngày.',
    name: 'Giải chạy Hà Nội 2026',
    codes: ALWAYS_CONDITIONS,
    forcedUnmet: [],
    role: 'admin',
    notices: [],
    ...initial,
  };
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: state.role }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: state.role }] }),
    [`GET /orgs/${ORG_ID}/notices`]: () => ({ status: 200, body: state.notices }),
    [`GET /orgs/${ORG_ID}/events`]: () => {
      const { id, slug, name, status, startsAt, endsAt } = eventOf(state);
      return { status: 200, body: [{ id, slug, name, status, startsAt, endsAt }] };
    },
    [`GET ${eventPath}`]: () => ({ status: 200, body: eventOf(state) }),
    [`PATCH ${eventPath}`]: (request) => {
      const body = request.postDataJSON() as { name: string; refundPolicy: string | null };
      state.name = body.name;
      state.refundPolicy = body.refundPolicy?.trim() ? body.refundPolicy.trim() : null;
      return { status: 200, body: eventOf(state) };
    },
    [`GET ${eventPath}/publish-readiness`]: async () => {
      if (state.holdReadiness) await state.holdReadiness;
      if (state.readinessFails) return apiError(500, 'INTERNAL_ERROR');
      return { status: 200, body: readiness(state.codes, unmetOf(state)) };
    },
    [`POST ${eventPath}/publish`]: async () => {
      if (state.holdPublish) await state.holdPublish;
      const error = state.publishError;
      if (error) {
        state.publishError = undefined;
        error.then?.(state);
        return apiError(error.status, error.code, error.details ?? null);
      }
      if (state.status !== 'draft') return apiError(409, 'EVENT_NOT_DRAFT');
      const unmet = unmetOf(state);
      if (unmet.length > 0) return apiError(409, 'EVENT_NOT_READY', { unmet });
      state.status = 'published';
      return { status: 200, body: eventOf(state) };
    },
  };
  const calls = await mockOrganizerApi(page, handlers);
  return { calls, state };
}

const panel = (page: Page) => page.locator('[data-slot="publish-panel"]');
const publishButton = (page: Page) => panel(page).getByRole('button', { name: 'Mở bán' });
const unmetRows = (page: Page) => panel(page).locator('[data-slot="publish-unmet"] > li');
const publishCalls = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === `${eventPath}/publish`);
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Nút tắt và lý do nằm ngay cạnh, nối bằng `aria-describedby`. */
async function expectDisabledWithReason(page: Page, reason: string | RegExp) {
  await expect(publishButton(page)).toBeDisabled();
  const describedBy = await publishButton(page).getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(reason);
}

test('thiếu chính sách hoàn vé: câu rõ, "Mở bán" tắt có lý do; link sửa về bước 1 giữ dữ liệu; thêm chính sách rồi quay lại thì đủ điều kiện', async ({
  page,
}) => {
  const { calls } = await openApi(page, { refundPolicy: null });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(page.getByText('Bước 4/4 · Xem trước & mở bán')).toBeVisible();
  await expect(unmetRows(page)).toHaveCount(1);
  await expect(unmetRows(page).first()).toContainText('Thiếu chính sách hoàn vé — chưa mở bán được.');
  await expectDisabledWithReason(page, 'Chưa mở bán được: còn 1 điều kiện chưa đạt.');

  await panel(page).getByRole('button', { name: 'Thêm chính sách hoàn vé' }).click();
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(page.getByLabel('Tên Sự kiện')).toHaveValue('Giải chạy Hà Nội 2026');
  await expect(page.getByLabel('Địa điểm (không bắt buộc)')).toHaveValue('Hồ Gươm');

  await page.getByLabel('Chính sách hoàn vé').fill('Hoàn 100% trước 7 ngày.');
  for (const next of ['Bước 2/4 · Hạng vé', 'Bước 3/4 · Form mua', 'Bước 4/4 · Xem trước & mở bán']) {
    await page.getByRole('button', { name: 'Tiếp' }).click();
    await expect(page.getByText(next)).toBeVisible();
  }
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await expect(publishButton(page)).toBeEnabled();
  expect(publishCalls(calls)).toEqual([]);
});

test('đủ điều kiện: "Mở bán" có spinner và không gửi lặp; xong hiện link + "Sao chép link" (toast "Đã sao chép"); badge "Đang mở bán"', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let release = () => {};
  const { calls } = await openApi(page, { holdPublish: new Promise<void>((resolve) => (release = resolve)) });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await expect(panel(page).locator('[data-slot="publish-reason"]')).toHaveCount(0);

  await publishButton(page).click();
  await expect(publishButton(page)).toHaveAttribute('aria-busy', 'true');
  await publishButton(page).click({ force: true });
  release();

  const origin = new URL(page.url()).origin;
  const link = panel(page).locator('[data-slot="public-event-link"]');
  await expect(link).toHaveText(`${origin}/e/${SLUG}`);
  await expect(link).toHaveAttribute('href', `${origin}/e/${SLUG}`);
  // Nút "Mở bán" bị gỡ: focus chuyển sang tiêu đề "Đang mở bán", không rơi về đầu trang.
  await expect(panel(page).getByRole('heading', { name: 'Đang mở bán' })).toBeFocused();
  expect(publishCalls(calls)).toHaveLength(1);

  await panel(page).getByRole('button', { name: 'Sao chép link' }).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/e/${SLUG}`);
  }

  await page.goto(base);
  await expect(page.getByText('Đang mở bán', { exact: true }).first()).toBeVisible();
  await page.goto(`/btc/${ORG_ID}`);
  await expect(page.getByText('Đang mở bán', { exact: true })).toBeVisible();
  await expect(page.getByText('Nháp', { exact: true })).toHaveCount(0);
});

test('web thấy đủ nhưng server đã đổi (Closed Beta bị thu hồi) → 409 EVENT_NOT_READY: báo lỗi, tải lại danh sách điều kiện', async ({
  page,
}) => {
  const { calls } = await openApi(page, {
    codes: PAID_CONDITIONS,
    publishError: {
      status: 409,
      code: 'EVENT_NOT_READY',
      details: { unmet: ['CLOSED_BETA_APPROVED'] },
      then: (state) => state.forcedUnmet.push('CLOSED_BETA_APPROVED'),
    },
  });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  const before = calls.filter((c) => c.path.endsWith('/publish-readiness')).length;

  await publishButton(page).click();
  await expect(page.getByText('Sự kiện chưa đủ điều kiện mở bán. Đang tải lại danh sách điều kiện.')).toBeVisible();
  await expect(unmetRows(page)).toHaveCount(1);
  // Cùng câu với banner `CLOSED_BETA_PENDING`; chưa có kênh liên hệ Tingee nên không có link.
  await expect(unmetRows(page).first()).toContainText('Chờ duyệt Closed Beta');
  await expect(unmetRows(page).first()).toContainText('Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.');
  await expect(unmetRows(page).first()).not.toContainText('Liên hệ Tingee');
  await expect(unmetRows(page).first().getByRole('link')).toHaveCount(0);
  await expectDisabledWithReason(page, 'Chưa mở bán được: còn 1 điều kiện chưa đạt.');
  // Nút bị tắt: focus ở tiêu đề "Mở bán", ngay trên danh sách điều kiện.
  await expect(panel(page).getByRole('heading', { name: 'Mở bán' })).toBeFocused();
  expect(calls.filter((c) => c.path.endsWith('/publish-readiness')).length).toBeGreaterThan(before);
  await expect(panel(page).locator('[data-slot="public-event-link"]')).toHaveCount(0);
});

test('Sự kiện có phí còn thiếu (Admin): mỗi mã một dòng theo thứ tự, link sửa đúng nơi; tài khoản nhận tiền thì nhờ Owner', async ({
  page,
}) => {
  await openApi(page, {
    refundPolicy: null,
    codes: PAID_CONDITIONS,
    forcedUnmet: ['HAS_TICKET_TYPE', 'EVENT_NOT_ENDED', 'CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'],
  });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(unmetRows(page)).toHaveCount(5);
  expect(await unmetRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-code')))).toEqual([
    'REFUND_POLICY',
    'HAS_TICKET_TYPE',
    'EVENT_NOT_ENDED',
    'CLOSED_BETA_APPROVED',
    'PAYOUT_ACCOUNT_LINKED',
  ]);
  await expect(unmetRows(page).nth(1)).toContainText('Chưa có Hạng vé nào.');
  await expect(unmetRows(page).nth(2)).toContainText('Sự kiện đã kết thúc.');
  // Admin không mở được trang tài khoản nhận tiền (chỉ Owner): không có link, chỉ nhắc nhờ Owner như banner.
  await expect(unmetRows(page).nth(4)).toContainText('Chưa có tài khoản nhận tiền.');
  await expect(unmetRows(page).nth(4)).toContainText('Nhờ Owner liên kết tài khoản nhận tiền.');
  await expect(unmetRows(page).nth(4).getByRole('link')).toHaveCount(0);
  await expectDisabledWithReason(page, 'Chưa mở bán được: còn 5 điều kiện chưa đạt.');

  await unmetRows(page).nth(2).getByRole('button', { name: 'Sửa thời gian' }).click();
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();

  await page.goto(`${base}/thiet-lap?buoc=4`);
  await unmetRows(page).nth(1).getByRole('button', { name: 'Thêm Hạng vé' }).click();
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
});

test('Owner: tài khoản nhận tiền có link sửa; BTC bị thu hồi Closed Beta thấy đúng câu của banner', async ({ page }) => {
  await openApi(page, {
    role: 'owner',
    codes: PAID_CONDITIONS,
    forcedUnmet: ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'],
    notices: [statusNotice('CLOSED_BETA_REVOKED')],
  });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(unmetRows(page)).toHaveCount(2);
  await expect(unmetRows(page).first()).toContainText('Closed Beta đã bị thu hồi');
  await expect(unmetRows(page).first()).not.toContainText('Chờ duyệt');
  await expect(unmetRows(page).first().getByRole('link')).toHaveCount(0);
  await expect(unmetRows(page).nth(1).getByRole('link', { name: 'Liên kết tài khoản nhận tiền' })).toHaveAttribute(
    'href',
    `/btc/${ORG_ID}/tai-khoan-nhan-tien`,
  );
});

test('quay lại bước 4: danh sách cũ trong cache không mở khóa "Mở bán" khi đang tải lại', async ({ page }) => {
  const { state } = await openApi(page);
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await expect(publishButton(page)).toBeEnabled();

  // Trong lúc ở bước 3, điều kiện đổi (vd. Hạng vé cuối bị xóa ở tab khác); lần tải lại bị giữ.
  await page.getByRole('button', { name: 'Quay lại' }).click();
  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();
  let release = () => {};
  state.holdReadiness = new Promise<void>((resolve) => (release = resolve));
  state.forcedUnmet = ['HAS_TICKET_TYPE'];
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(page.getByText('Bước 4/4 · Xem trước & mở bán')).toBeVisible();
  await expectDisabledWithReason(page, 'Đang kiểm tra điều kiện…');

  release();
  state.holdReadiness = undefined;
  await expect(unmetRows(page)).toHaveCount(1);
  await expectDisabledWithReason(page, 'Chưa mở bán được: còn 1 điều kiện chưa đạt.');
});

test('409 EVENT_NOT_READY rồi tải lại điều kiện lỗi → banner lỗi, không giữ "Đã đủ điều kiện", nút tắt', async ({ page }) => {
  await openApi(page, {
    publishError: { status: 409, code: 'EVENT_NOT_READY', then: (state) => (state.readinessFails = true) },
  });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await publishButton(page).click();
  // Query tự thử lại khi 5xx (tối đa 2 lần) trước khi báo lỗi.
  await expect(panel(page).getByText('Chưa tải được điều kiện mở bán', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toHaveCount(0);
  await expectDisabledWithReason(page, 'Chưa tải được điều kiện mở bán.');
});

test('Sự kiện đã mở bán: vào bước 4 thấy ngay link, không tải điều kiện', async ({ page }) => {
  const { calls } = await openApi(page, { status: 'published' });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  const origin = new URL(page.url()).origin;
  await expect(panel(page).locator('[data-slot="public-event-link"]')).toHaveText(`${origin}/e/${SLUG}`);
  await expect(panel(page).getByRole('button', { name: 'Sao chép link' })).toBeVisible();
  await expect(publishButton(page)).toHaveCount(0);
  expect(calls.filter((c) => c.path.endsWith('/publish-readiness'))).toEqual([]);
});

test('320px: danh sách điều kiện và phần link không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const { state } = await openApi(page, {
    refundPolicy: null,
    codes: PAID_CONDITIONS,
    forcedUnmet: ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'],
  });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(unmetRows(page)).toHaveCount(3);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  state.status = 'published';
  await page.reload();
  await expect(panel(page).locator('[data-slot="public-event-link"]')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('409 EVENT_NOT_DRAFT (người khác vừa mở bán): toast, tải lại Sự kiện rồi hiện link', async ({ page }) => {
  await openApi(page, {
    publishError: { status: 409, code: 'EVENT_NOT_DRAFT', then: (state) => (state.status = 'published') },
  });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await publishButton(page).click();
  await expect(page.getByText('Sự kiện không còn ở trạng thái nháp. Đã tải lại Sự kiện.')).toBeVisible();
  await expect(panel(page).locator('[data-slot="public-event-link"]')).toBeVisible();
  await expect(page.getByText('Chưa mở bán được', { exact: true })).toHaveCount(0);
});

test('tải điều kiện lỗi 500 → banner "Chưa tải được điều kiện mở bán"; "Thử lại" tải lại và đủ điều kiện', async ({
  page,
}) => {
  const { state } = await openApi(page, { readinessFails: true });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Chưa tải được điều kiện mở bán', { exact: true })).toBeVisible();
  await expectDisabledWithReason(page, 'Chưa tải được điều kiện mở bán.');
  state.readinessFails = false;
  await panel(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await expect(publishButton(page)).toBeEnabled();
});

test('mở bán lỗi 500 → banner "Chưa mở bán được"; "Thử lại" mở bán xong và hiện link', async ({ page }) => {
  const { calls } = await openApi(page, { publishError: { status: 500, code: 'INTERNAL_ERROR' } });
  await page.goto(`${base}/thiet-lap?buoc=4`);
  await expect(panel(page).getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
  await publishButton(page).click();
  await expect(panel(page).getByText('Chưa mở bán được', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(panel(page).locator('[data-slot="public-event-link"]')).toBeVisible();
  expect(publishCalls(calls)).toHaveLength(2);
});
