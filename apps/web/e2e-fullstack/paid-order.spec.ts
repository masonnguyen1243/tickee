import type { Page } from '@playwright/test';

import { expect, test, waitForHydration } from '../e2e/fixtures';
import { testEvent, WEB_ORIGIN } from './env';
import { Mailbox } from './mailpit';
import { buyerEmail, returnToOf, signInWithOtp } from './sign-in';

/*
 * Đơn có phí với mọi thứ chạy thật (AI-6, AC 4.7): web → api → Tingee fake → IPN ký thật → `markPaid` → SSE → Trang
 * Đơn, và email Vé do worker gửi. Sự kiện do `global-setup.ts` mở bán.
 *
 * Hai tab cùng phiên: tab B đi trọn đường chuyển trang qua Tingee fake (về lại Trang Đơn là lần tải mới, nên thấy
 * Thành công là đương nhiên). Tab A giữ Trang Đơn mở và luôn hiện (Playwright không đưa trang nào xuống nền, nên đường
 * `visibilitychange` không được kiểm ở đây). Với tab A, test chứng minh:
 * - stream `/live` cross-origin (cổng 3001) mở bằng cookie phiên: 200 `text/event-stream`, CORS cho đúng origin web
 *   kèm credentials;
 * - từ lúc stream mở tới ngay trước khi trả tiền, tab A không gửi GET Đơn nào trong hơn 2 giây (polling 2 giây khi SSE
 *   chưa kết nối hay đã rớt sẽ gửi), tức SSE còn kết nối khi tiền về;
 * - tab A sang Thành công trong ≤ 3 giây sau khi api ACK IPN, thấy Đơn chuyển `paid` ngay trên trang, không tải lại.
 */

const SIGNAL_BUDGET_MS = 3_000;

const bar = (page: Page) => page.locator('[data-slot="purchase-bar"]');
const success = (page: Page) => page.locator('[data-slot="order-success"]');
const ORDER_PATH = /^\/orders\/([A-Z0-9]+)$/;
const LIVE_PATH = /^\/v1\/me\/orders\/[A-Z0-9]+\/live$/;
/** REST của Đơn (không phải stream `/live`): mỗi lần Trang Đơn tải lại. */
const ORDER_API_PATH = /^\/v1\/me\/orders\/[A-Z0-9]+$/;
/** Lớn hơn chu kỳ polling 2 giây (`ORDER_WAITING_POLL_MS`) của Trang Đơn khi SSE chưa kết nối. */
const NO_POLLING_WINDOW_MS = 2_500;

test('Mua → đăng nhập → Gửi Đơn; tab B trả qua Tingee fake; tab A tự sang Thành công qua SSE; email Vé', async ({
  page: tabA,
  context,
}, testInfo) => {
  const event = testEvent();
  const email = buyerEmail(testInfo, 'paid');
  const mailbox = await Mailbox.open(email);
  const checkoutPath = `/e/${event.slug}/checkout`;

  await tabA.goto(`/e/${event.slug}`);
  await tabA.getByRole('button', { name: `Tăng số vé ${event.tierName}` }).click();
  await expect(bar(tabA)).toContainText('Tổng · 1 vé');
  await bar(tabA).getByRole('button', { name: 'Mua' }).click();
  await tabA.waitForURL('**/dang-nhap?returnTo=*');
  expect(new URL(returnToOf(tabA)!, WEB_ORIGIN).pathname).toBe(checkoutPath);

  await signInWithOtp(tabA, email);
  await tabA.waitForURL('**/dong-y?returnTo=*');
  await tabA.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await tabA.waitForURL((url) => url.pathname === checkoutPath);

  await tabA.getByLabel('Tên').fill('Nguyễn Văn E2E');
  await tabA.getByLabel('Số điện thoại').fill('0912345678');
  const orderGets: number[] = [];
  tabA.on('request', (req) => {
    if (req.method() === 'GET' && ORDER_API_PATH.test(new URL(req.url()).pathname)) orderGets.push(Date.now());
  });
  const live = tabA.waitForResponse((res) => LIVE_PATH.test(new URL(res.url()).pathname));
  await bar(tabA).getByRole('button', { name: 'Gửi Đơn' }).click();
  await tabA.waitForURL((url) => ORDER_PATH.test(url.pathname));
  const orderUrl = tabA.url();
  const code = ORDER_PATH.exec(new URL(orderUrl).pathname)![1]!;
  await expect(tabA.locator('[data-slot="order-payment"]')).toHaveAttribute('data-link', 'ready');

  // SSE cross-origin (cổng 3001) mở được bằng cookie phiên (không có cookie thì 401) và CORS nhận origin web.
  const stream = await live;
  const headers = stream.headers();
  expect(stream.status()).toBe(200);
  expect(headers['content-type']).toContain('text/event-stream');
  expect(headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  expect(headers['access-control-allow-credentials']).toBe('true');
  // Stream mở thì tải lại REST một lần (gom trong 1 giây): qua cửa sổ đó rồi mới đếm.
  await expect.poll(() => orderGets.length).toBeGreaterThan(0);
  await tabA.waitForTimeout(1_500);
  const connected = orderGets.length;
  // Đã kết nối SSE thì không polling: polling sẽ thêm ít nhất một GET trong cửa sổ này.
  await tabA.waitForTimeout(NO_POLLING_WINDOW_MS);
  expect(orderGets.length).toBe(connected);
  await tabA.evaluate(() => {
    (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
  });

  const tabB = await context.newPage();
  await tabB.goto(orderUrl);
  await waitForHydration(tabB);
  await tabB.getByRole('button', { name: /^Thanh toán/ }).click();
  await tabB.waitForURL((url) => url.pathname === `/checkout/${code}`);
  // Tab A vẫn chưa gửi GET nào: SSE còn kết nối ngay trước khi tiền về.
  expect(orderGets.length).toBe(connected);
  // Fake ký IPN, chờ api ACK (Đơn đã `paid`) rồi mới 303 về Trang Đơn: từ lúc đó tab A có ≤ 3 giây.
  await Promise.all([
    tabB.waitForURL(orderUrl, { waitUntil: 'commit' }),
    tabB.getByRole('button', { name: 'Đã thanh toán (giả lập)' }).click(),
  ]);

  await expect(success(tabA)).toBeVisible({ timeout: SIGNAL_BUDGET_MS });
  await expect(success(tabA).getByRole('heading', { name: 'Vé của bạn đã sẵn sàng!' })).toBeVisible();
  // Trang đang mở thấy Đơn chuyển `paid` (không phải lần tải mới), và chưa hề tải lại.
  await expect(success(tabA)).toHaveAttribute('data-celebrate', 'true');
  expect(await tabA.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload)).toBe(true);
  expect(tabA.url()).toBe(orderUrl);

  await waitForHydration(tabB);
  await expect(success(tabB).getByRole('heading', { name: 'Vé của bạn đã sẵn sàng!' })).toBeVisible();
  await expect(success(tabB)).toContainText(`Đã gửi Vé tới ${email}`);

  const ticketMail = await mailbox.next(`Vé của bạn · ${event.name}`, 30_000);
  expect(ticketMail.text).toContain(`Mã Đơn: ${code}`);
  expect(ticketMail.text).toContain(`Vé 1/1 · ${event.tierName}`);
});
