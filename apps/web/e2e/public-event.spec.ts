import type { Page } from '@playwright/test';

import { PORT_PUBLIC_EVENT } from '../playwright.config';
import { expect, test } from './fixtures';
import { mockIdentityApi } from './identity-mock';
import { SLUG_DRAFT, SLUG_HIDDEN, SLUG_ON_SALE, TIER_FREE_ID, TIER_PAID_ID } from './public-event-api';

/*
 * Trang Sự kiện công khai `/e/{slug}` (Story 2.11-b). Phần tĩnh SSR lấy từ API giả `e2e/public-event-api.ts` (server
 * Next riêng có `API_INTERNAL_URL`); `/availability` gọi từ trình duyệt nên giả bằng `page.route`.
 */

const ORIGIN = `http://localhost:${PORT_PUBLIC_EVENT}`;
test.use({ baseURL: ORIGIN, timezoneId: 'America/New_York' });

type Tier = { ticketTypeId: string; status: string; remaining: number; saleStartsAt: string | null };
type Availability = { eventReason: string | null; tiers: Tier[] };
type Reply = { status: number; body: unknown };

const tier = (ticketTypeId: string, patch: Partial<Tier> = {}): Tier => ({
  ticketTypeId,
  status: 'on_sale',
  remaining: 50,
  saleStartsAt: null,
  ...patch,
});
const ok = (eventReason: string | null, tiers: Tier[]): Reply => ({ status: 200, body: { eventReason, tiers } });
const ON_SALE = ok(null, [tier(TIER_FREE_ID), tier(TIER_PAID_ID, { remaining: 120 })]);

/** Giả `/availability`; trả về hàm đổi phản hồi và số lần đã gọi. */
async function mockAvailability(page: Page, initial: Reply) {
  let reply = initial;
  let calls = 0;
  await page.route('**/v1/events/*/availability', async (route) => {
    calls += 1;
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(reply.body),
    });
  });
  return {
    set: (next: Reply) => {
      reply = next;
    },
    calls: () => calls,
  };
}

const tierRow = (page: Page, name: string) =>
  page.locator('[data-slot^="ticket-tier-row"]').filter({ has: page.getByRole('heading', { name }) });

test.beforeEach(async ({ page }) => {
  await mockIdentityApi(page);
});

test('đang bán: hero, hàng BTC, Hạng vé "Còn N vé", không banner', async ({ page }) => {
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);

  const hero = page.locator('[data-slot="event-hero"]');
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Giải chạy Hồ Gươm mùa thu 2026');
  // Giờ theo Việt Nam dù máy ở New York.
  await expect(hero).toContainText('Chủ nhật, 15/11/2026 · 07:00 – 17:00');
  const venue = hero.getByRole('link', { name: /Hồ Hoàn Kiếm, Hà Nội/ });
  await expect(venue).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  await expect(page.locator('[data-slot="event-organizer"]')).toHaveText('Tổ chức bởi CLB Chạy Bộ Phố Cổ');
  await expect(page.getByRole('heading', { name: 'Chính sách hoàn vé' })).toBeVisible();

  const free = tierRow(page, 'Vé phổ thông');
  await expect(free).toContainText('0đ');
  await expect(free).toContainText('Còn 50 vé');
  await expect(free).toHaveAttribute('data-slot', 'ticket-tier-row');
  await expect(tierRow(page, 'Vé VIP')).toContainText('300.000đ');
  await expect(tierRow(page, 'Vé VIP')).toContainText('Còn 120 vé');
  await expect(page.locator('[data-slot="status-banner"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mua/ })).toHaveCount(0);
});

test('sắp hết: "Còn 7 vé" đậm màu thương hiệu', async ({ page }) => {
  await mockAvailability(page, ok(null, [tier(TIER_FREE_ID, { remaining: 7 }), tier(TIER_PAID_ID)]));
  await page.goto(`/e/${SLUG_ON_SALE}`);

  const status = tierRow(page, 'Vé phổ thông').locator('[data-slot="ticket-tier-status"]');
  await expect(status).toHaveText('Còn 7 vé');
  await expect(status).toHaveClass(/font-bold/);
  await expect(status).toHaveClass(/text-brand-text/);
  await expect(tierRow(page, 'Vé VIP').locator('[data-slot="ticket-tier-status"]')).not.toHaveClass(/text-brand-text/);
});

test('chưa mở bán: giờ mở theo giờ Việt Nam, viền nét đứt', async ({ page }) => {
  await mockAvailability(
    page,
    ok(null, [tier(TIER_FREE_ID), tier(TIER_PAID_ID, { status: 'not_started', saleStartsAt: '2026-11-14T08:00:00+07:00' })]),
  );
  await page.goto(`/e/${SLUG_ON_SALE}`);

  const paid = tierRow(page, 'Vé VIP');
  await expect(paid).toContainText('Chưa mở bán · mở Thứ bảy, 14/11/2026 · 08:00');
  await expect(paid).toHaveAttribute('data-slot', 'ticket-tier-row-unavailable');
  await expect(paid).toHaveCSS('border-top-style', 'dashed');
});

test('tạm ngừng một phần: banner "Một số Hạng vé đang tạm ngừng bán."', async ({ page }) => {
  await mockAvailability(page, ok('paused', [tier(TIER_FREE_ID), tier(TIER_PAID_ID, { status: 'paused' })]));
  await page.goto(`/e/${SLUG_ON_SALE}`);

  const banner = page.locator('[data-slot="status-banner"]');
  await expect(banner).toHaveText('Một số Hạng vé đang tạm ngừng bán.');
  await expect(banner).toHaveAttribute('data-tone', 'warning');
  await expect(banner.getByRole('button', { name: 'Đóng thông báo' })).toHaveCount(0);
  await expect(tierRow(page, 'Vé VIP')).toContainText('Tạm ngừng bán');
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Còn 50 vé');
});

test('Ẩn: 200, banner warning, Hạng vé "Không nhận Đơn", noindex', async ({ page }) => {
  await mockAvailability(
    page,
    ok('hidden', [tier(TIER_FREE_ID, { status: 'unavailable' }), tier(TIER_PAID_ID, { status: 'unavailable' })]),
  );
  const response = await page.goto(`/e/${SLUG_HIDDEN}`);

  expect(response?.status()).toBe(200);
  const banner = page.locator('[data-slot="status-banner"]');
  await expect(banner).toHaveText('Sự kiện tạm dừng nhận Đơn');
  await expect(banner).toHaveAttribute('data-tone', 'warning');
  await expect(page.locator('[data-slot="ticket-tier-row-unavailable"]')).toHaveCount(2);
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Không nhận Đơn');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('đang bán: không noindex', async ({ page }) => {
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
});

for (const [label, slug] of [
  ['nháp', SLUG_DRAFT],
  ['slug sai', 'khong-co-su-kien-nay'],
] as const) {
  test(`${label}: empty-state, HTTP 404, không nút`, async ({ page }) => {
    const response = await page.goto(`/e/${slug}`);

    expect(response?.status()).toBe(404);
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toContainText('Không tìm thấy Sự kiện này.');
    await expect(empty).toContainText('Kiểm tra lại link BTC gửi bạn.');
    await expect(empty.getByRole('button')).toHaveCount(0);
    await expect(empty.getByRole('link')).toHaveCount(0);
  });
}

test('availability lỗi: giá vẫn hiện, "Chưa tải được số vé." + "Thử lại"', async ({ page }) => {
  const availability = await mockAvailability(page, {
    status: 503,
    body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Lỗi giả lập', details: null } },
  });
  await page.goto(`/e/${SLUG_ON_SALE}`);

  // Query tự thử lại 5xx 2 lần trước khi báo lỗi.
  await expect(page.getByText('Chưa tải được số vé.')).toBeVisible({ timeout: 15_000 });
  await expect(tierRow(page, 'Vé VIP')).toContainText('300.000đ');
  await expect(page.locator('[data-slot="ticket-tier-status"]')).toHaveCount(0);

  availability.set(ON_SALE);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Còn 50 vé');
  await expect(page.getByText('Chưa tải được số vé.')).toHaveCount(0);
});

test('quay lại tab: "Còn N vé" cập nhật không cần tải lại', async ({ page }) => {
  const availability = await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Còn 50 vé');

  availability.set(ok(null, [tier(TIER_FREE_ID, { remaining: 42 }), tier(TIER_PAID_ID, { remaining: 120 })]));
  await page.evaluate(() => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      // Như trình duyệt thật: sự kiện nổi bọt lên `window`, nơi TanStack Query lắng nghe.
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    };
    setVisibility('hidden');
    setVisibility('visible');
  });
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Còn 42 vé');
});

const switchTabAway = (page: Page) =>
  page.evaluate(() => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    };
    setVisibility('hidden');
    setVisibility('visible');
  });

test('quay lại tab mà tải lại lỗi: báo lỗi, không giữ "Còn N vé" cũ', async ({ page }) => {
  const availability = await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Còn 50 vé');

  availability.set({
    status: 503,
    body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Lỗi giả lập', details: null } },
  });
  await switchTabAway(page);

  // Query tự thử lại 5xx 2 lần trước khi báo lỗi.
  await expect(page.getByText('Chưa tải được số vé.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await expect(page.getByText(/Còn \d+ vé/)).toHaveCount(0);
  await expect(tierRow(page, 'Vé VIP')).toContainText('300.000đ');
});

test('chia sẻ dùng Web Share API với link trang', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: ShareData) => {
        (window as unknown as { __shared: ShareData }).__shared = data;
        return Promise.resolve();
      },
    });
  });
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);

  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  const shared = await page.evaluate(() => (window as unknown as { __shared?: ShareData }).__shared);
  expect(shared).toEqual({ title: 'Giải chạy Hồ Gươm mùa thu 2026', url: `${ORIGIN}/e/${SLUG_ON_SALE}` });
});

test('không có Web Share API: sao chép link, toast "Đã sao chép"', async ({ page, browserName }) => {
  await page.addInitScript(() => {
    // `share` nằm trên prototype ở trình duyệt có hỗ trợ.
    delete (Navigator.prototype as { share?: unknown }).share;
    delete (navigator as { share?: unknown }).share;
  });
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);
  expect(await page.evaluate(() => 'share' in navigator)).toBe(false);

  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ORIGIN}/e/${SLUG_ON_SALE}`);
  }
});

test('320px không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);
  await expect(tierRow(page, 'Vé phổ thông')).toContainText('Còn 50 vé');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('≥ lg: 2 cột, Hạng vé bên phải và dính khi cuộn', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);

  const hero = await page.locator('[data-slot="event-hero"]').boundingBox();
  const tiers = page.getByRole('complementary', { name: 'Hạng vé' });
  const aside = await tiers.boundingBox();
  expect(hero && aside).toBeTruthy();
  // Khung công khai phải nở ra (không bị giữ ở 480px).
  expect(hero!.width).toBeGreaterThan(500);
  expect(aside!.x).toBeGreaterThanOrEqual(hero!.x + hero!.width);
  expect(Math.abs(aside!.y - hero!.y)).toBeLessThan(4);
  await expect(tiers.locator('> div')).toHaveCSS('position', 'sticky');
});

test('thẻ meta OG và ảnh OG 1200×630', async ({ page, request }) => {
  await mockAvailability(page, ON_SALE);
  await page.goto(`/e/${SLUG_ON_SALE}`);

  await expect(page).toHaveTitle('Giải chạy Hồ Gươm mùa thu 2026 · Tickee');
  const meta = (property: string) => page.locator(`meta[property="${property}"]`);
  await expect(meta('og:title')).toHaveAttribute('content', 'Giải chạy Hồ Gươm mùa thu 2026 · Tickee');
  await expect(meta('og:description')).toHaveAttribute(
    'content',
    'Chủ nhật, 15/11/2026 · 07:00 – 17:00 · Hồ Hoàn Kiếm, Hà Nội',
  );
  await expect(meta('og:image:width')).toHaveAttribute('content', '1200');
  await expect(meta('og:image:height')).toHaveAttribute('content', '630');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', /opengraph-image/);

  const imageUrl = await meta('og:image').getAttribute('content');
  expect(imageUrl).toMatch(new RegExp(`^${ORIGIN}/e/${SLUG_ON_SALE}/opengraph-image`));
  const image = await request.get(imageUrl!);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  // Kích thước thật đọc từ khối IHDR của PNG.
  const png = await image.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);

  // Cùng route ảnh (đường dẫn có hậu tố hash do Next sinh) với Sự kiện nháp → 404.
  const draftImage = await request.get(new URL(imageUrl!).pathname.replace(SLUG_ON_SALE, SLUG_DRAFT));
  expect(draftImage.status()).toBe(404);
});
