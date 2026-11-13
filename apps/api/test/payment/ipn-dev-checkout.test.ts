import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BuyerOrderView, orderPath, tingeeIpnUrl } from '@tickee/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  ipnKeyOf,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
} from '../ordering/order-fixtures.js';
import { fakeAccount, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';
import { ACK_TEXT, expectInvariants, orderState, paymentEventsOf } from './ipn-fixtures.js';

/*
 * Luồng Đơn có phí ở dev local (spec-tingee-fake-gui-ipn): api thật (nghe cổng thật) tạo link trên Tingee fake, trình
 * duyệt mở trang thanh toán giả và bấm một nút; fake ký IPN bằng Secret Token của merchant rồi gửi tới URL IPN của BTC
 * (điền sẵn như merchant demo của `pnpm db:seed`) và đưa trình duyệt về Trang Đơn. Sau mỗi nhánh: bất biến tồn kho – Vé.
 */

const MERCHANT: TingeeCredential = { clientId: 'tg-devcheckout-6e1f', secretToken: 'tg-devcheckout-secret-Zx1Cv2Bn3' };
const account = fakeAccount({ accountName: 'PHAM VAN DUNG' });
const PRICE = 250_000;

let fake: TingeeFake;
let h: Harness;
let org: Org;
let api: Server;
let ipnUrl: string;

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MERCHANT, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, {
    name: 'CLB Bơi lội Quận 1',
    credential: MERCHANT,
    payout: {
      vaAccountNumber: String(account.vaAccountNumber),
      accountName: String(account.accountName),
      bankName: String(account.bankName),
    },
  });
  // Harness không nghe cổng (supertest): fake cần một URL thật để POST IPN.
  api = createServer(h.app.getHttpAdapter().getInstance());
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiOrigin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  // Như `main.ts` với merchant demo: fake biết sẵn "Đường dẫn IPN" của BTC.
  ipnUrl = tingeeIpnUrl(apiOrigin, await ipnKeyOf(h, org.orgId));
  fake.merchant(MERCHANT.clientId).ipnUrl = ipnUrl;
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await h.close();
  await fake.close();
});

/** Người mua mới đặt `quantity` Vé ở Sự kiện mới của BTC; Đơn `pending` có link thanh toán trên fake. */
async function placePaid(quantity: number) {
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Vé thường', price: PRICE, capacity: 5 }]);
  const tierId = sale.tiers[0]!.id;
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity }]));
  expect(res.status).toBe(201);
  const order = parseOrder(res.body);
  expect(order.buyerStatus).toBe('awaiting_payment');
  expect(order.payment?.checkoutUrl).toEqual(expect.any(String));
  return { buyer, eventId: sale.event.id, tierId, code: order.code, checkoutUrl: order.payment!.checkoutUrl! };
}

/** Như trình duyệt: mở checkout URL rồi bấm nút `status` của form, ô "Đường dẫn IPN" giữ giá trị điền sẵn. */
async function press(checkoutUrl: string, status: string): Promise<Response> {
  const page = await fetch(checkoutUrl);
  expect(page.status).toBe(200);
  const html = await page.text();
  const action = /<form method="post" action="([^"]+)">/.exec(html)?.[1];
  const prefilled = /<input id="ipnUrl" name="ipnUrl"[^>]* value="([^"]*)"/.exec(html)?.[1];
  expect(action).toBeDefined();
  expect(prefilled).toBe(ipnUrl);
  return fetch(new URL(action!, checkoutUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ipnUrl: prefilled!, status }).toString(),
    redirect: 'manual',
  });
}

const orderPage = (code: string) => new URL(orderPath(code), TEST_WEB_ORIGIN).toString();

describe('trang thanh toán giả → IPN tới api thật', () => {
  it('"Đã thanh toán (giả lập)" → 303 về Trang Đơn; Đơn paid (ipn) đủ Vé, held → sold; bấm lại không phát thêm Vé', async () => {
    const placed = await placePaid(2);

    const res = await press(placed.checkoutUrl, 'success');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(orderPage(placed.code));
    expect(fake.ipnDeliveries.at(-1)).toMatchObject({
      orderId: placed.code,
      clientId: MERCHANT.clientId,
      url: ipnUrl,
      status: 'success',
      result: { kind: 'replied', httpStatus: 200, body: ACK_TEXT },
    });
    expect(await orderState(h, placed.code)).toMatchObject({
      status: 'paid',
      paid_source: 'ipn',
      paid_amount: String(2 * PRICE),
      tickets: 2,
    });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });
    // Trang Đơn (poll) thấy Thành công kèm Vé.
    const order = BuyerOrderView.parse(
      (await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body,
    );
    expect(order.buyerStatus).toBe('paid');
    expect(order.tickets).toHaveLength(2);
    await expectInvariants(h, placed.eventId);

    // Bấm lại: IPN mới (mã giao dịch mới) cho Đơn đã paid → api chỉ lưu, vẫn đúng 2 Vé.
    expect((await press(placed.checkoutUrl, 'success')).status).toBe(303);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect((await paymentEventsOf(h, org.orgId, placed.code)).map((e) => e.status)).toEqual(['success', 'success']);
    await expectInvariants(h, placed.eventId);
  });

  it.each(['expired', 'canceled'])('"%s" → 303 về Trang Đơn; Đơn hết hạn, không Vé, nhả chỗ', async (status) => {
    const placed = await placePaid(3);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 3 });

    const res = await press(placed.checkoutUrl, status);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(orderPage(placed.code));
    expect(fake.ipnDeliveries.at(-1)).toMatchObject({ status, result: { kind: 'replied', httpStatus: 200 } });
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'expired', tickets: 0 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toMatchObject([{ kind: 'status', status }]);
    await expectInvariants(h, placed.eventId);
  });
});
