import { PORT_PUBLIC_EVENT } from '../playwright.config';
import { expect, test } from './fixtures';
import { mockIdentityApi } from './identity-mock';
import { E2E_REVALIDATE_SECRET, PUBLIC_EVENT_API_PORT, renameEventPath, TIER_FREE_ID, TIER_PAID_ID } from './public-event-api';

/*
 * Revalidate ngay trang `/e/{slug}` (Story 2.11-c) trên server Next thật: phần tĩnh cache 30 giây theo tag
 * `event:{slug}`; worker gọi `POST /api/revalidate` (ở đây spec gọi thay worker) thì lần tải sau lấy bản mới. API giả
 * đổi tên qua `renameEventPath`. Mỗi project một slug riêng vì hai project chạy song song trên cùng server.
 */

const ORIGIN = `http://localhost:${PORT_PUBLIC_EVENT}`;
test.use({ baseURL: ORIGIN });

test('BTC đổi tên: trang vẫn trả bản cache cho tới khi gọi /api/revalidate, sau đó trả tên mới', async ({
  page,
  request,
}, testInfo) => {
  await mockIdentityApi(page);
  await page.route('**/v1/events/*/availability', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({
        eventReason: null,
        tiers: [TIER_FREE_ID, TIER_PAID_ID].map((ticketTypeId) => ({
          ticketTypeId,
          status: 'on_sale',
          remaining: 50,
          saleStartsAt: null,
        })),
      }),
    }),
  );

  const slug = `doi-ten-${testInfo.project.name}`;
  const rename = async (name: string) => {
    const res = await request.post(`http://localhost:${PUBLIC_EVENT_API_PORT}${renameEventPath(slug)}`, { data: { name } });
    expect(res.status()).toBe(204);
  };
  const revalidate = () =>
    request.post('/api/revalidate', {
      headers: { authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
      data: { tag: `event:${slug}` },
    });
  const heading = page.locator('[data-slot="event-hero"]').getByRole('heading', { level: 1 });

  // Bắt đầu sạch: server có thể còn cache của lần chạy trước (chạy lại local, retry ở CI).
  await rename('Giải chạy tên cũ');
  expect((await revalidate()).status()).toBe(204);
  await page.goto(`/e/${slug}`);
  await expect(heading).toHaveText('Giải chạy tên cũ');

  // BTC đổi tên, chưa revalidate: vẫn là bản cache (cache nóng, chưa tới 30 giây).
  await rename('Giải chạy tên mới');
  await page.reload();
  await expect(heading).toHaveText('Giải chạy tên cũ');

  // Worker gọi route revalidate → lần tải sau thấy tên mới ngay.
  expect((await revalidate()).status()).toBe(204);
  await page.reload();
  await expect(heading).toHaveText('Giải chạy tên mới');
});
