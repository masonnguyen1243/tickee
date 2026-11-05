import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Sự kiện nháp (Story 2.7): wizard tạo/thiết lập (bước 1 "Thông tin"; bước 2 Hạng vé — xem `ticket-types.spec.ts`;
 * bước 3–4 "Sắp có"), danh sách `event-card` ở
 * `/btc/{id}`, khung tab của Sự kiện. API giả có trạng thái như api thật: POST tạo nháp, PATCH sửa, GET đọc. Máy chạy
 * test đặt múi giờ khác +07 (New York): giờ nhập vẫn hiểu theo giờ Việt Nam.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const base = `/btc/${ORG_ID}`;
const eventId = (n: number) => `019a3b2c-07${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`;
const EVENT_IDS = Array.from({ length: 6 }, (_, n) => eventId(n));

type EventBody = {
  name: string;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  description: string | null;
  refundPolicy: string | null;
};
type EventDetail = EventBody & {
  id: string;
  organizationId: string;
  slug: string;
  status: 'draft';
  effectiveEndAt: string;
  maxTicketsPerOrder: number;
  createdAt: string;
  updatedAt: string;
};

const detail = (n: number, body: EventBody): EventDetail => ({
  id: eventId(n),
  organizationId: ORG_ID,
  slug: `su-kien-${n}a2b`,
  status: 'draft',
  ...body,
  // Không kiểm ở web: api tính.
  effectiveEndAt: body.endsAt,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

const summary = ({ id, slug, name, status, startsAt, endsAt }: EventDetail) => ({ id, slug, name, status, startsAt, endsAt });

const trim = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * API Sự kiện giả có trạng thái; `events` theo thứ tự tạo. `intercept(key)` trả reply thì dùng reply đó thay handler
 * (vd. 500 lần đầu), `undefined` thì handler chạy như thường.
 */
async function openApi(
  page: Page,
  events: EventDetail[] = [],
  intercept: (key: string) => Reply | undefined = () => undefined,
): Promise<Call[]> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const bodyOf = (raw: unknown): EventBody | null => {
    const b = raw as Record<string, unknown>;
    if (typeof b.name !== 'string' || typeof b.startsAt !== 'string' || typeof b.endsAt !== 'string') return null;
    if (Date.parse(b.endsAt) <= Date.parse(b.startsAt)) return null;
    return {
      name: b.name.trim(),
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      venue: trim(b.venue),
      description: trim(b.description),
      refundPolicy: trim(b.refundPolicy),
    };
  };
  const invalid = () => apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'endsAt', code: 'custom' }] });
  const perEvent = Object.fromEntries(
    EVENT_IDS.flatMap((id) => [
      [
        `GET /orgs/${ORG_ID}/events/${id}`,
        () => {
          const found = events.find((e) => e.id === id);
          return found ? { status: 200, body: found } : apiError(404, 'EVENT_NOT_FOUND');
        },
      ],
      [
        `PATCH /orgs/${ORG_ID}/events/${id}`,
        (request: { postDataJSON(): unknown }) => {
          const index = events.findIndex((e) => e.id === id);
          if (index < 0) return apiError(404, 'EVENT_NOT_FOUND');
          const body = bodyOf(request.postDataJSON());
          if (!body) return invalid();
          events[index] = { ...events[index]!, ...body };
          return { status: 200, body: events[index] };
        },
      ],
    ]),
  );
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] }),
    [`GET /orgs/${ORG_ID}/events`]: () => ({ status: 200, body: [...events].reverse().map(summary) }),
    [`POST /orgs/${ORG_ID}/events`]: (request) => {
      const body = bodyOf(request.postDataJSON());
      if (!body) return invalid();
      const created = detail(events.length, body);
      events.push(created);
      return { status: 201, body: created };
    },
    ...perEvent,
  };
  const intercepted = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]): [string, Handler] => [
      key,
      (request) => intercept(key) ?? handler(request),
    ]),
  );
  return mockOrganizerApi(page, intercepted);
}

/** `intercept` trả 500 cho `key` đúng `times` lần đầu. */
function failFirst(key: string, times = 1) {
  let left = times;
  return (k: string): Reply | undefined => {
    if (k !== key || left === 0) return undefined;
    left--;
    return apiError(500, 'INTERNAL_ERROR');
  };
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const nameInput = (page: Page) => field(page, 'Tên Sự kiện');
const startsInput = (page: Page) => field(page, 'Bắt đầu');
const endsInput = (page: Page) => field(page, 'Kết thúc');
const venueInput = (page: Page) => field(page, 'Địa điểm (không bắt buộc)');
const descriptionInput = (page: Page) => field(page, 'Mô tả (không bắt buộc)');
const refundInput = (page: Page) => field(page, 'Chính sách hoàn vé');
const saveDraft = (page: Page) => page.getByRole('button', { name: 'Lưu nháp' });
const next = (page: Page) => page.getByRole('button', { name: 'Tiếp' });
const writes = (calls: Call[]) => calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const seeded = (): EventDetail =>
  detail(0, {
    name: 'Giải chạy Hà Nội 2026',
    startsAt: '2026-11-16T07:00:00+07:00',
    endsAt: '2026-11-16T17:00:00+07:00',
    venue: 'Hồ Gươm',
    description: null,
    refundPolicy: null,
  });

test('tạo nháp: giờ gửi theo +07:00 dù máy ở múi giờ khác; URL sang thiet-lap nên lưu lần nữa là PATCH; danh sách hiện thẻ', async ({
  page,
}) => {
  const calls = await openApi(page);
  await page.goto(`${base}/su-kien/tao`);
  await expect(page.getByRole('heading', { name: 'Tạo Sự kiện' })).toBeVisible();
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  // Máy đúng là đang ở múi giờ khác +07.
  expect(await page.evaluate(() => new Date('2026-11-16T07:00:00+07:00').getHours())).not.toBe(7);

  await nameInput(page).fill('Giải chạy Hà Nội 2026');
  await startsInput(page).fill('2026-11-16T07:00');
  await endsInput(page).fill('2026-11-16T17:00');
  await saveDraft(page).click();

  await page.waitForURL(`**${base}/su-kien/${eventId(0)}/thiet-lap`);
  await expect(page.getByText('Đã lưu nháp.')).toBeVisible();
  expect(writes(calls)).toEqual([
    {
      method: 'POST',
      path: `/orgs/${ORG_ID}/events`,
      body: {
        name: 'Giải chạy Hà Nội 2026',
        startsAt: '2026-11-16T07:00:00+07:00',
        endsAt: '2026-11-16T17:00:00+07:00',
        venue: null,
        description: null,
        refundPolicy: null,
      },
    },
  ]);
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Giải chạy Hà Nội 2026');
  await expect(startsInput(page)).toHaveValue('2026-11-16T07:00');

  await venueInput(page).fill('Hồ Gươm');
  await saveDraft(page).click();
  await expect.poll(() => writes(calls).length).toBe(2);
  expect(writes(calls)[1]).toMatchObject({
    method: 'PATCH',
    path: `/orgs/${ORG_ID}/events/${eventId(0)}`,
    body: { venue: 'Hồ Gươm', startsAt: '2026-11-16T07:00:00+07:00' },
  });
  expect(writes(calls).filter((c) => c.method === 'POST')).toHaveLength(1);

  await page.goto(base);
  const card = page.locator('[data-slot="event-card"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Giải chạy Hà Nội 2026');
  await expect(card).toContainText('Thứ hai, 16/11/2026 · 07:00');
  await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Nháp');
  await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
});

test('lỗi tại trường: thiếu tên/giờ, kết thúc ≤ bắt đầu; không gọi api, sửa xong thì lưu được', async ({ page }) => {
  const calls = await openApi(page);
  await page.goto(`${base}/su-kien/tao`);
  await next(page).click();
  await expect(page.getByText('Nhập tên Sự kiện.')).toBeVisible();
  await expect(page.getByText('Chọn ngày và giờ bắt đầu.')).toBeVisible();
  await expect(page.getByText('Chọn ngày và giờ kết thúc.')).toBeVisible();
  await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');

  await nameInput(page).fill('Đêm nhạc');
  await expect(page.getByText('Nhập tên Sự kiện.')).toHaveCount(0);
  await startsInput(page).fill('2026-11-16T20:00');
  await endsInput(page).fill('2026-11-16T19:00');
  await saveDraft(page).click();
  await expect(page.getByText('Giờ kết thúc phải sau giờ bắt đầu.')).toBeVisible();
  await expect(endsInput(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(startsInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  expect(writes(calls)).toEqual([]);

  await endsInput(page).fill('2026-11-16T22:00');
  await next(page).click();
  await page.waitForURL(`**${base}/su-kien/${eventId(0)}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
});

test('"Tiếp" lưu rồi sang bước 2; "Quay lại" giữ nguyên mọi ô; bước 2–4 có "Lưu nháp", không tạo Sự kiện thứ hai', async ({
  page,
}) => {
  const calls = await openApi(page);
  await page.goto(`${base}/su-kien/tao`);
  await nameInput(page).fill('Giải chạy Hà Nội 2026');
  await startsInput(page).fill('2026-11-16T07:00');
  await endsInput(page).fill('2026-11-16T17:00');
  await venueInput(page).fill('Hồ Gươm, Hoàn Kiếm');
  await descriptionInput(page).fill('Chạy 5 km quanh hồ.\nNhận áo tại chỗ.');
  await refundInput(page).fill('Hoàn 100% trước 7 ngày.');
  await next(page).click();

  await page.waitForURL(`**${base}/su-kien/${eventId(0)}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  await expect(page.getByText('Chưa có Hạng vé nào.')).toBeVisible();
  await expect(saveDraft(page)).toBeVisible();

  await page.getByRole('button', { name: 'Quay lại' }).click();
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Giải chạy Hà Nội 2026');
  await expect(startsInput(page)).toHaveValue('2026-11-16T07:00');
  await expect(endsInput(page)).toHaveValue('2026-11-16T17:00');
  await expect(venueInput(page)).toHaveValue('Hồ Gươm, Hoàn Kiếm');
  await expect(descriptionInput(page)).toHaveValue('Chạy 5 km quanh hồ.\nNhận áo tại chỗ.');
  await expect(refundInput(page)).toHaveValue('Hoàn 100% trước 7 ngày.');

  // Sửa ở bước 1 rồi đi tiếp tới bước 4: mỗi "Tiếp" là PATCH; bước 4 không còn "Tiếp".
  await nameInput(page).fill('Giải chạy Hà Nội mùa đông');
  await next(page).click();
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  await next(page).click();
  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();
  await next(page).click();
  await expect(page.getByText('Bước 4/4 · Xem trước & mở bán')).toBeVisible();
  await expect(next(page)).toHaveCount(0);
  await saveDraft(page).click();
  await expect(page.getByText('Đã lưu nháp.')).toBeVisible();

  await page.getByRole('button', { name: 'Quay lại' }).click();
  await page.getByRole('button', { name: 'Quay lại' }).click();
  await page.getByRole('button', { name: 'Quay lại' }).click();
  await expect(nameInput(page)).toHaveValue('Giải chạy Hà Nội mùa đông');

  expect(writes(calls).map((c) => c.method)).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH', 'PATCH']);
  expect(writes(calls)[1]?.body).toMatchObject({ name: 'Giải chạy Hà Nội mùa đông', refundPolicy: 'Hoàn 100% trước 7 ngày.' });
});

test('bấm cả hàng event-card → tab Tổng quan; tab Hạng vé (?tab=); "Tiếp tục thiết lập" mở lại wizard', async ({
  page,
}) => {
  await openApi(page, [seeded()]);
  await page.goto(base);
  const card = page.locator('[data-slot="event-card"]');
  await expect(page.getByText('Chưa có Sự kiện nào.')).toHaveCount(0);
  // Bấm vào ô ảnh (không phải chữ): cả hàng là link.
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await page.waitForURL(`**${base}/su-kien/${eventId(0)}`);

  await expect(page.getByRole('heading', { name: 'Giải chạy Hà Nội 2026', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tổng quan' })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Đơn', 'Hạng vé', 'Form mua', 'Check-in', 'Cài đặt']) {
    await expect(page.getByRole('tab', { name, exact: true })).toBeAttached();
  }
  const overview = page.locator('[data-slot="event-overview"]');
  await expect(overview).toContainText('Thứ hai, 16/11/2026 · 07:00 – Thứ hai, 16/11/2026 · 17:00');
  await expect(overview).toContainText('Hồ Gươm');
  await expect(overview).toContainText('Chưa có — cần có để mở bán.');
  await expect(overview.locator('[data-slot="status-badge"]')).toHaveText('Nháp');

  await page.getByRole('tab', { name: 'Hạng vé' }).click();
  await page.waitForURL(`**${base}/su-kien/${eventId(0)}?tab=hang-ve`);
  await expect(page.getByText('Chưa có Hạng vé nào.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Hạng vé' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await expect(overview).toBeVisible();

  await page.getByRole('link', { name: 'Tiếp tục thiết lập' }).click();
  await page.waitForURL(`**${base}/su-kien/${eventId(0)}/thiet-lap`);
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Giải chạy Hà Nội 2026');
  await expect(venueInput(page)).toHaveValue('Hồ Gươm');
  await expect(refundInput(page)).toHaveValue('');
});

test('Sự kiện không tồn tại hoặc của BTC khác → "Không tìm thấy Sự kiện này." + về danh sách', async ({ page }) => {
  await openApi(page);
  await page.goto(`${base}/su-kien/${eventId(5)}`);
  await expect(page.getByText('Không tìm thấy Sự kiện này.')).toBeVisible();
  await page.getByRole('link', { name: 'Về danh sách Sự kiện' }).click();
  await page.waitForURL(`**${base}`);
  await expect(page.getByText('Chưa có Sự kiện nào.')).toBeVisible();
});

test('năm ngoài 2000–2100: lỗi "Năm phải trong khoảng 2000–2100." tại ô, không gọi api', async ({ page }) => {
  const calls = await openApi(page);
  await page.goto(`${base}/su-kien/tao`);
  await nameInput(page).fill('Giải chạy');
  await startsInput(page).fill('2026-11-16T07:00');
  await endsInput(page).fill('2101-11-16T17:00');
  await saveDraft(page).click();
  await expect(page.getByText('Năm phải trong khoảng 2000–2100.')).toBeVisible();
  await expect(endsInput(page)).toHaveAttribute('aria-invalid', 'true');
  expect(writes(calls)).toEqual([]);
});

test('api trả 400 VALIDATION_FAILED cho lần lưu hợp lệ phía web → lỗi tại ô endsAt, quay về bước 1', async ({ page }) => {
  let rejectPatch = false;
  const patchKey = `PATCH /orgs/${ORG_ID}/events/${eventId(0)}`;
  const calls = await openApi(page, [seeded()], (key) =>
    rejectPatch && key === patchKey
      ? apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'endsAt', code: 'custom' }] })
      : undefined,
  );
  await page.goto(`${base}/su-kien/${eventId(0)}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  rejectPatch = true;
  await next(page).click();

  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(page.getByText('Giờ kết thúc phải sau giờ bắt đầu.')).toBeVisible();
  await expect(endsInput(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Chưa lưu được Sự kiện')).toHaveCount(0);
  expect(writes(calls).map((c) => c.method)).toEqual(['PATCH']);
});

test('api trả 400 VALIDATION_FAILED với path wizard không biết → báo chung tại ô tên, quay về bước 1', async ({ page }) => {
  let rejectPatch = false;
  const patchKey = `PATCH /orgs/${ORG_ID}/events/${eventId(0)}`;
  await openApi(page, [seeded()], (key) =>
    rejectPatch && key === patchKey
      ? apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'unknown', code: 'custom' }] })
      : undefined,
  );
  await page.goto(`${base}/su-kien/${eventId(0)}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  rejectPatch = true;
  await next(page).click();

  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(page.getByText('Thông tin chưa hợp lệ. Kiểm tra lại các ô rồi lưu lại.')).toBeVisible();
  await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Tên Sự kiện tối đa/)).toHaveCount(0);
});

test('lưu lỗi 5xx: banner "Chưa lưu được Sự kiện"; "Thử lại" gửi đúng một POST nữa rồi sang bước 2', async ({ page }) => {
  const calls = await openApi(page, [], failFirst(`POST /orgs/${ORG_ID}/events`));
  await page.goto(`${base}/su-kien/tao`);
  await nameInput(page).fill('Giải chạy');
  await startsInput(page).fill('2026-11-16T07:00');
  await endsInput(page).fill('2026-11-16T17:00');
  await next(page).click();

  await expect(page.getByText('Chưa lưu được Sự kiện')).toBeVisible();
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Giải chạy');
  expect(writes(calls)).toHaveLength(1);

  await page.getByRole('button', { name: 'Thử lại' }).click();
  await page.waitForURL(`**${base}/su-kien/${eventId(0)}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  expect(writes(calls).map((c) => c.method)).toEqual(['POST', 'POST']);
});

test('tải lỗi 5xx: danh sách và Sự kiện báo "Chưa tải được…" (không phải "Không tìm thấy"); "Thử lại" tải được', async ({
  page,
}) => {
  // Query tự thử lại 2 lần với lỗi 5xx: 3 lần 500 thì mới hiện banner.
  const listFails = failFirst(`GET /orgs/${ORG_ID}/events`, 3);
  const eventFails = failFirst(`GET /orgs/${ORG_ID}/events/${eventId(0)}`, 3);
  await openApi(page, [seeded()], (key) => listFails(key) ?? eventFails(key));

  await page.goto(base);
  await expect(page.getByText('Chưa tải được danh sách Sự kiện')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('[data-slot="event-card"]')).toHaveCount(1);
  await expect(page.getByText('Chưa tải được danh sách Sự kiện')).toHaveCount(0);

  await page.goto(`${base}/su-kien/${eventId(0)}`);
  await expect(page.getByText('Chưa tải được Sự kiện', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Không tìm thấy Sự kiện này.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('[data-slot="event-overview"]')).toBeVisible();
});

test('320px không cuộn ngang: wizard, danh sách, khung tab', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const long = detail(0, {
    ...seeded(),
    name: 'Giải chạy bán marathon quốc tế vì cộng đồng phường Võ Thị Sáu quận Ba thành phố Hồ Chí Minh 2026',
  });
  await openApi(page, [long]);
  await page.goto(`${base}/su-kien/tao`);
  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto(base);
  await expect(page.locator('[data-slot="event-card"]')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto(`${base}/su-kien/${eventId(0)}`);
  await expect(page.locator('[data-slot="event-overview"]')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
