import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Hạng vé (Story 2.8): trình sửa dùng chung ở wizard bước 2 và tab "Hạng vé". Thêm/Sửa qua `Dialog` chứa form, Xóa qua
 * `Dialog` xác nhận, ô "Giới hạn Vé/Đơn" cạnh danh sách. API giả có trạng thái như api thật (sàn giá 2.000đ, trần 200 Vé
 * của Sự kiện miễn phí, số suất không dưới đã bán + đang giữ chỗ).
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const EVENT_ID = '019a3b2c-0700-7abc-8def-0123456789ab';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const ticketTypeId = (n: number) => `019a3b2c-08${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`;
const TICKET_TYPE_IDS = Array.from({ length: 6 }, (_, n) => ticketTypeId(n));
const ticketTypesPath = `/orgs/${ORG_ID}/events/${EVENT_ID}/ticket-types`;

type TicketType = {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  price: number;
  capacity: number;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  sold: number;
  held: number;
  createdAt: string;
  updatedAt: string;
};

const event = (maxTicketsPerOrder = 10) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: 'giai-chay-ha-noi-2026-a2b3',
  name: 'Giải chạy Hà Nội 2026',
  status: 'draft',
  startsAt: '2026-11-16T07:00:00+07:00',
  endsAt: '2026-11-16T17:00:00+07:00',
  effectiveEndAt: '2026-11-16T23:59:59+07:00',
  venue: null,
  description: null,
  refundPolicy: null,
  maxTicketsPerOrder,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

const ticketType = (n: number, overrides: Partial<TicketType> = {}): TicketType => ({
  id: ticketTypeId(n),
  eventId: EVENT_ID,
  name: 'Đơn nam',
  description: null,
  price: 300_000,
  capacity: 32,
  saleStartsAt: null,
  saleEndsAt: null,
  sold: 0,
  held: 0,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
  ...overrides,
});

type Body = Pick<TicketType, 'name' | 'description' | 'price' | 'capacity' | 'saleStartsAt' | 'saleEndsAt'>;

const freeCapExceeded = (list: { price: number; capacity: number }[]) =>
  list.every((t) => t.price === 0) && list.reduce((sum, t) => sum + t.capacity, 0) > 200;

/** API giả có trạng thái: Sự kiện nháp + Hạng vé của nó. */
async function openApi(page: Page, seeded: TicketType[] = []): Promise<{ calls: Call[]; ticketTypes: TicketType[] }> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const ticketTypes = [...seeded];
  let limit = 10;
  let next = seeded.length;
  const perTicketType = Object.fromEntries(
    TICKET_TYPE_IDS.flatMap((id): [string, Handler][] => [
      [
        `PATCH ${ticketTypesPath}/${id}`,
        (request) => {
          const index = ticketTypes.findIndex((t) => t.id === id);
          if (index < 0) return apiError(404, 'TICKET_TYPE_NOT_FOUND');
          const current = ticketTypes[index]!;
          const body = request.postDataJSON() as Body;
          const minimum = current.sold + current.held;
          if (body.capacity < minimum) return apiError(409, 'CAPACITY_BELOW_COMMITTED', { minimum });
          const after = ticketTypes.map((t) => (t.id === id ? body : t));
          if (freeCapExceeded(after)) return apiError(409, 'FREE_EVENT_CAPACITY_EXCEEDED', { limit: 200 });
          ticketTypes[index] = { ...current, ...body };
          return { status: 200, body: ticketTypes[index] };
        },
      ],
      [
        `DELETE ${ticketTypesPath}/${id}`,
        () => {
          const index = ticketTypes.findIndex((t) => t.id === id);
          if (index < 0) return apiError(404, 'TICKET_TYPE_NOT_FOUND');
          if (ticketTypes[index]!.sold + ticketTypes[index]!.held > 0) return apiError(409, 'TICKET_TYPE_IN_USE');
          ticketTypes.splice(index, 1);
          return { status: 204 };
        },
      ],
    ]),
  );
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] }),
    [`GET /orgs/${ORG_ID}/events/${EVENT_ID}`]: () => ({ status: 200, body: event(limit) }),
    [`PATCH /orgs/${ORG_ID}/events/${EVENT_ID}`]: () => ({ status: 200, body: event(limit) }),
    [`PATCH /orgs/${ORG_ID}/events/${EVENT_ID}/order-limit`]: (request) => {
      const value = (request.postDataJSON() as { maxTicketsPerOrder: number }).maxTicketsPerOrder;
      if (!Number.isInteger(value) || value < 1 || value > 50) {
        return apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'maxTicketsPerOrder', code: 'too_small' }] });
      }
      limit = value;
      return { status: 200, body: event(limit) };
    },
    [`GET ${ticketTypesPath}`]: () => ({ status: 200, body: ticketTypes }),
    [`POST ${ticketTypesPath}`]: (request): Reply => {
      const body = request.postDataJSON() as Body;
      if (body.price > 0 && body.price < 2_000) {
        return apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'price', code: 'custom' }] });
      }
      if (freeCapExceeded([...ticketTypes, body])) return apiError(409, 'FREE_EVENT_CAPACITY_EXCEEDED', { limit: 200 });
      const created = ticketType(next++, body);
      ticketTypes.push(created);
      return { status: 201, body: created };
    },
    ...perTicketType,
  };
  const calls = await mockOrganizerApi(page, handlers);
  return { calls, ticketTypes };
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');
const dialog = (page: Page) => page.getByRole('dialog');
const inDialog = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const rows = (page: Page) => page.locator('[data-slot="ticket-type-row"]');
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function fillTicketType(page: Page, values: { name?: string; price?: string; capacity?: string }) {
  if (values.name !== undefined) await inDialog(page, 'Tên Hạng vé').fill(values.name);
  if (values.price !== undefined) await inDialog(page, 'Giá (đồng)').fill(values.price);
  if (values.capacity !== undefined) await inDialog(page, 'Số suất').fill(values.capacity);
}

test('wizard bước 2: thêm "Đơn nam" 300.000đ 32 suất → hàng mới hiện ngay; tab "Hạng vé" thấy đúng hàng đó', async ({
  page,
}) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  await expect(page.getByText('Chưa có Hạng vé nào.')).toBeVisible();
  await expect(page.getByLabel('Số Vé tối đa mỗi Đơn')).toHaveValue('10');

  await page.getByRole('button', { name: 'Thêm Hạng vé' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Thêm Hạng vé' })).toBeVisible();
  await fillTicketType(page, { name: 'Đơn nam', price: '300.000', capacity: '32' });
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Đơn nam');
  await expect(rows(page).first().locator('[data-slot="ticket-type-price"]')).toHaveText('300.000đ');
  await expect(rows(page).first().locator('[data-slot="ticket-type-capacity"]')).toHaveText('32 suất');
  // Vẫn ở bước 2 của wizard: submit trong `Dialog` không gửi form wizard.
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  expect(writes(calls)).toEqual([
    {
      method: 'POST',
      path: ticketTypesPath,
      body: { name: 'Đơn nam', description: null, price: 300_000, capacity: 32, saleStartsAt: null, saleEndsAt: null },
    },
  ]);

  await page.goto(`${base}?tab=hang-ve`);
  await expect(page.getByRole('tab', { name: 'Hạng vé' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('300.000đ');
  await expect(rows(page).first()).toContainText('32 suất');
});

test('giờ bán theo giờ Việt Nam; giờ đóng ≤ giờ mở → lỗi tại ô, không gọi api', async ({ page }) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}?tab=hang-ve`);
  await page.getByRole('button', { name: 'Thêm Hạng vé' }).click();
  await fillTicketType(page, { name: 'Sớm', price: '200000', capacity: '10' });
  await inDialog(page, 'Mở bán').fill('2026-11-01T08:00');
  await inDialog(page, 'Đóng bán').fill('2026-11-01T08:00');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page).getByText('Giờ đóng bán phải sau giờ mở bán.')).toBeVisible();
  await expect(inDialog(page, 'Đóng bán')).toHaveAttribute('aria-invalid', 'true');
  expect(writes(calls)).toEqual([]);

  await inDialog(page, 'Đóng bán').fill('2026-11-15T22:00');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(writes(calls)[0]?.body).toMatchObject({
    saleStartsAt: '2026-11-01T08:00:00+07:00',
    saleEndsAt: '2026-11-15T22:00:00+07:00',
  });
  await expect(rows(page).first()).toContainText('Bán từ Chủ nhật, 01/11/2026 · 08:00 đến Chủ nhật, 15/11/2026 · 22:00');
});

test('giá 1.500 → lỗi tại ô giá, không gọi api; giá 0 lưu được và hiện "Miễn phí"', async ({ page }) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}?tab=hang-ve`);
  await page.getByRole('button', { name: 'Thêm Hạng vé' }).click();
  await fillTicketType(page, { name: 'Vé lẻ', price: '1500', capacity: '10' });
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page).getByText('Hạng vé có phí tối thiểu 2.000đ (hoặc 0đ nếu miễn phí).')).toBeVisible();
  await expect(inDialog(page, 'Giá (đồng)')).toHaveAttribute('aria-invalid', 'true');
  expect(writes(calls)).toEqual([]);

  await fillTicketType(page, { price: '0' });
  await expect(inDialog(page, 'Giá (đồng)')).not.toHaveAttribute('aria-invalid', 'true');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(rows(page).first().locator('[data-slot="ticket-type-price"]')).toHaveText('Miễn phí');
});

test('409 trần Sự kiện miễn phí khi thêm → lỗi tại ô số suất, Dialog giữ dữ liệu', async ({ page }) => {
  await openApi(page, [ticketType(0, { name: 'Miễn phí', price: 0, capacity: 120 })]);
  await page.goto(`${base}?tab=hang-ve`);
  await page.getByRole('button', { name: 'Thêm Hạng vé' }).click();
  await fillTicketType(page, { name: 'Miễn phí 2', price: '0', capacity: '90' });
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(
    dialog(page).getByText('Sự kiện miễn phí tối đa 200 Vé — giảm số suất hoặc đặt giá có phí.'),
  ).toBeVisible();
  await expect(inDialog(page, 'Số suất')).toHaveAttribute('aria-invalid', 'true');
  await expect(inDialog(page, 'Tên Hạng vé')).toHaveValue('Miễn phí 2');
  await expect(rows(page)).toHaveCount(1);
});

test('sửa: Dialog điền sẵn mô tả và giờ bán (giờ Việt Nam); số suất dưới đã bán + đang giữ chỗ → "Tối thiểu 8 — …" tại ô số suất; 8 thì lưu, giữ nguyên các trường khác', async ({
  page,
}) => {
  const { calls } = await openApi(page, [
    ticketType(0, {
      sold: 5,
      held: 3,
      description: 'Áo size M',
      saleStartsAt: '2026-11-01T08:00:00+07:00',
      saleEndsAt: '2026-11-15T22:00:00+07:00',
    }),
  ]);
  await page.goto(`${base}?tab=hang-ve`);
  await expect(rows(page).first()).toContainText('Đã bán 5 · Đang giữ chỗ 3');
  await page.getByRole('button', { name: 'Sửa Đơn nam' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Sửa Hạng vé' })).toBeVisible();
  await expect(inDialog(page, 'Giá (đồng)')).toHaveValue('300000');
  await expect(inDialog(page, 'Mô tả Hạng vé (không bắt buộc)')).toHaveValue('Áo size M');
  await expect(inDialog(page, 'Mở bán')).toHaveValue('2026-11-01T08:00');
  await expect(inDialog(page, 'Đóng bán')).toHaveValue('2026-11-15T22:00');
  await fillTicketType(page, { capacity: '7' });
  await dialog(page).getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(dialog(page).getByText('Tối thiểu 8 — đã bán và đang giữ chỗ.')).toBeVisible();
  await expect(inDialog(page, 'Số suất')).toHaveAttribute('aria-invalid', 'true');

  await fillTicketType(page, { capacity: '8' });
  await dialog(page).getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).first().locator('[data-slot="ticket-type-capacity"]')).toHaveText('8 suất');
  expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual([
    `PATCH ${ticketTypesPath}/${ticketTypeId(0)}`,
    `PATCH ${ticketTypesPath}/${ticketTypeId(0)}`,
  ]);
  expect(writes(calls)[1]?.body).toEqual({
    name: 'Đơn nam',
    description: 'Áo size M',
    price: 300_000,
    capacity: 8,
    saleStartsAt: '2026-11-01T08:00:00+07:00',
    saleEndsAt: '2026-11-15T22:00:00+07:00',
  });
});

test('sửa Hạng vé đã bị xóa ở nơi khác (404) → toast "Hạng vé này không còn nữa.", Dialog đóng, hàng biến mất', async ({
  page,
}) => {
  const { ticketTypes } = await openApi(page, [ticketType(0)]);
  await page.goto(`${base}?tab=hang-ve`);
  await page.getByRole('button', { name: 'Sửa Đơn nam' }).click();
  await expect(dialog(page)).toBeVisible();
  ticketTypes.splice(0);
  await fillTicketType(page, { capacity: '40' });
  await dialog(page).getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Hạng vé này không còn nữa.')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('Chưa có Hạng vé nào.')).toBeVisible();
});

test('xóa Hạng vé đã bị xóa ở nơi khác (404) → toast "Hạng vé này không còn nữa.", Dialog đóng, hàng biến mất', async ({
  page,
}) => {
  const { ticketTypes } = await openApi(page, [ticketType(0)]);
  await page.goto(`${base}?tab=hang-ve`);
  await page.getByRole('button', { name: 'Xóa Đơn nam' }).click();
  await expect(dialog(page)).toBeVisible();
  ticketTypes.splice(0);
  await dialog(page).getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(page.getByText('Hạng vé này không còn nữa.')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
});

test('xóa qua Dialog xác nhận nêu hậu quả; Hạng vé đã có người mua → báo không xóa được', async ({ page }) => {
  const { calls } = await openApi(page, [
    ticketType(0),
    ticketType(1, { name: 'Đôi nam nữ', price: 500_000, capacity: 10, sold: 1 }),
  ]);
  await page.goto(`${base}?tab=hang-ve`);
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Xóa Đơn nam' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Xóa Hạng vé Đơn nam?' })).toBeVisible();
  await expect(dialog(page)).toContainText('không khôi phục được');
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(writes(calls)).toEqual([]);

  await page.getByRole('button', { name: 'Xóa Đơn nam' }).click();
  await dialog(page).getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText('Đã xóa Đơn nam.')).toBeVisible();
  // Nút "Xóa" của hàng đã mất: focus sang "Thêm Hạng vé", không rơi về body.
  await expect(page.getByRole('button', { name: 'Thêm Hạng vé' })).toBeFocused();

  await page.getByRole('button', { name: 'Xóa Đôi nam nữ' }).click();
  await dialog(page).getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(dialog(page).getByText('Hạng vé đã có người mua hoặc đang giữ chỗ, không xóa được.')).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual([
    `DELETE ${ticketTypesPath}/${ticketTypeId(0)}`,
    `DELETE ${ticketTypesPath}/${ticketTypeId(1)}`,
  ]);
});

test('giới hạn Vé/Đơn: 0 → lỗi tại ô, không gọi api; 4 → PATCH order-limit; Enter trong wizard không gửi form wizard', async ({
  page,
}) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}/thiet-lap?buoc=2`);
  const limit = page.getByLabel('Số Vé tối đa mỗi Đơn');
  await expect(limit).toHaveValue('10');
  await limit.fill('0');
  await page.locator('[data-slot="order-limit"]').getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Nhập số nguyên từ 1 đến 50.')).toBeVisible();
  await expect(limit).toHaveAttribute('aria-invalid', 'true');
  expect(writes(calls)).toEqual([]);

  // Số lẻ không bị đọc thành 45.
  await limit.fill('4,5');
  await expect(limit).not.toHaveAttribute('aria-invalid', 'true');
  await page.locator('[data-slot="order-limit"]').getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Nhập số nguyên từ 1 đến 50.')).toBeVisible();
  await expect(limit).toHaveAttribute('aria-invalid', 'true');
  expect(writes(calls)).toEqual([]);

  await limit.fill('4');
  await limit.press('Enter');
  await expect(page.getByText('Đã lưu giới hạn Vé/Đơn.')).toBeVisible();
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  expect(writes(calls)).toEqual([
    { method: 'PATCH', path: `/orgs/${ORG_ID}/events/${EVENT_ID}/order-limit`, body: { maxTicketsPerOrder: 4 } },
  ]);
});

test('wizard bước 2: gõ giới hạn 4 rồi bấm "Tiếp" (không bấm "Lưu") → vẫn gửi PATCH order-limit', async ({ page }) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}/thiet-lap?buoc=2`);
  const limit = page.getByLabel('Số Vé tối đa mỗi Đơn');
  await expect(limit).toHaveValue('10');
  await limit.fill('4');
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();
  await expect
    .poll(() => writes(calls).filter((c) => c.path.endsWith('/order-limit')))
    .toEqual([
      { method: 'PATCH', path: `/orgs/${ORG_ID}/events/${EVENT_ID}/order-limit`, body: { maxTicketsPerOrder: 4 } },
    ]);
});

test('320px: danh sách, ô giới hạn và Dialog không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApi(page, [
    ticketType(0, { name: 'Hạng vé có tên rất dài để kiểm tra xuống dòng ở màn hình hẹp', sold: 2, held: 1 }),
    ticketType(1, { name: 'Đôi', price: 100_000_000, capacity: 100_000, saleStartsAt: '2026-11-01T08:00:00+07:00' }),
  ]);
  await page.goto(`${base}?tab=hang-ve`);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('[data-slot="order-limit"]')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Thêm Hạng vé' }).click();
  await expect(dialog(page)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
