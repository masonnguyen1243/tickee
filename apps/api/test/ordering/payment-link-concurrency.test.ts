import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TINGEE_CLIENT, HttpTingeeClient, type TingeeCredential } from '../../src/modules/tingee/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { CREATE_LINK_PATH, fakeAccount, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';
import {
  eventOnSale,
  inventory,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
} from './order-fixtures.js';

/*
 * Story 3.4: một lần gọi `create-link` tại một thời điểm cho mỗi Đơn, trên Postgres thật và Tingee fake. Tingee fake
 * hoãn phản hồi để các request chồng lên nhau thật; CAS giành lượt (`payment_link_attempt_at`) bảo đảm đúng một lời
 * gọi, mọi request đều trả `BuyerOrder` (200).
 */

const MAIN: TingeeCredential = { clientId: 'tg-race-main-3b4c', secretToken: 'tg-race-main-secret-Zx1Cv2Bn3' };
const account = fakeAccount({ accountName: 'NGUYEN VAN TUAN' });

let fake: TingeeFake;
let h: Harness;
let org: Org;

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness(
    { TINGEE_BASE_URL: fake.url },
    { overrides: [{ provide: TINGEE_CLIENT, useValue: new HttpTingeeClient({ baseUrl: fake.url }) }] },
  );
  org = await paidReadyOrg(h, {
    credential: MAIN,
    payout: { vaAccountNumber: String(account.vaAccountNumber), accountName: 'NGUYEN VAN TUAN', bankName: 'MB Bank' },
  });
});
beforeEach(async () => {
  fake.reset();
  fake.merchant(MAIN.clientId).linkReplies = [];
  fake.merchant(MAIN.clientId).linkDelayMs = 0;
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

const linkCalls = () => fake.calls(CREATE_LINK_PATH);

/** Đơn `pending` chưa có link (lần tạo link đầu bị từ chối bằng mã thường), còn lượt. */
async function orderWithoutLink() {
  fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Đơn nam', price: 300_000, capacity: 5 }]);
  const tierId = sale.tiers[0]!.id;
  const key = randomUUID();
  const body = orderBody([{ ticketTypeId: tierId, quantity: 2 }]);
  const order = parseOrder((await postOrder(h, buyer, sale.event.slug, body, key).expect(201)).body);
  expect(order.payment).toMatchObject({ checkoutUrl: null, linkError: 'provider_error' });
  fake.reset();
  return { buyer, slug: sale.event.slug, tierId, key, body, order };
}

const retry = (cookie: string, code: string) => h.http.post(`/v1/me/orders/${code}/payment-link`).set('cookie', cookie).send();

describe('thử lại song song', () => {
  it('hai request thử lại cùng lúc → đúng một lời gọi create-link; cả hai 200', async () => {
    const { buyer, tierId, order } = await orderWithoutLink();
    fake.merchant(MAIN.clientId).linkDelayMs = 400;
    const results = await Promise.all([retry(buyer.cookie, order.code), retry(buyer.cookie, order.code)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(linkCalls()).toHaveLength(1);
    for (const r of results) expect(parseOrder(r.body)).toMatchObject({ code: order.code, status: 'pending' });
    // Một bên trả link; bên thua lượt trả Đơn hiện tại (chưa có link). Đọc lại thì có link.
    expect(results.filter((r) => parseOrder(r.body).payment?.checkoutUrl).length).toBeGreaterThanOrEqual(1);
    const again = parseOrder((await h.http.get(`/v1/me/orders/${order.code}`).set('cookie', buyer.cookie).expect(200)).body);
    expect(again.payment?.checkoutUrl).toContain(`/checkout/${order.code}`);
    expect(await inventory(h, tierId)).toMatchObject({ held: 2 });
  });

  it('năm request (thử lại + gửi lại cùng khóa) cùng lúc → đúng một lời gọi; mọi request 200 cùng Đơn', async () => {
    const { buyer, slug, key, body, order } = await orderWithoutLink();
    fake.merchant(MAIN.clientId).linkDelayMs = 400;
    const results = await Promise.all([
      retry(buyer.cookie, order.code),
      postOrder(h, buyer, slug, body, key),
      retry(buyer.cookie, order.code),
      postOrder(h, buyer, slug, body, key),
      retry(buyer.cookie, order.code),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    for (const r of results) expect(parseOrder(r.body).code).toBe(order.code);
    expect(linkCalls()).toHaveLength(1);
  });

  it('Tingee từ chối lần thử lại song song → vẫn một lời gọi, lượt được trả, lần sau gọi được', async () => {
    const { buyer, order } = await orderWithoutLink();
    fake.merchant(MAIN.clientId).linkDelayMs = 300;
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const results = await Promise.all([retry(buyer.cookie, order.code), retry(buyer.cookie, order.code)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(linkCalls()).toHaveLength(1);
    const next = parseOrder((await retry(buyer.cookie, order.code).expect(200)).body);
    expect(next.payment?.checkoutUrl).toContain(`/checkout/${order.code}`);
    expect(linkCalls()).toHaveLength(2);
  });
});
