import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BuyerOrder, ErrorResponse } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parsesAsJson } from '../../src/modules/identity/identity.module.js';
import { tingeeTimestamp, type TingeeCredential } from '../../src/modules/tingee/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  ipnKeyOf,
  linkPayoutAccount,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type PayoutSpec,
  type User,
} from '../ordering/order-fixtures.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type FakeIpnPayload, type TingeeFake } from '../tingee-fake/server.js';
import { ACK_TEXT, expectInvariants, ipnPath, orderState, paymentEventsOf, postIpn } from './ipn-fixtures.js';

/*
 * Story 3.5: `POST /v1/payments/tingee/ipn/:ipnKey` trên Postgres thật và Tingee fake (link thanh toán thật, IPN ký bằng
 * secret của từng merchant). Mọi dòng của I/O Matrix trừ gửi đồng thời (ipn-concurrency.test.ts). Sau mỗi nhánh: bất biến
 * tồn kho – Vé (`expectInvariants`).
 */

const MAIN: TingeeCredential = { clientId: 'tg-ipn-main-3a1c', secretToken: 'tg-ipn-main-secret-Zx9Cv8Bn7' };
const NEXT: TingeeCredential = { clientId: 'tg-ipn-next-5d2e', secretToken: 'tg-ipn-next-secret-Mq4Wr3Et2' };
const OTHER: TingeeCredential = { clientId: 'tg-ipn-other-8f4a', secretToken: 'tg-ipn-other-secret-Ly6Ui5Op4' };
const mainAccount = fakeAccount({ accountName: 'NGUYEN VAN TUAN' });
const nextAccount = fakeAccount({ accountName: 'TRAN THI BINH' });
const otherAccount = fakeAccount({ accountName: 'LE VAN CUONG' });
const payoutOf = (account: Record<string, unknown>): PayoutSpec => ({
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
});
const PRICE = 300_000;
const CUSTOMER_EMAIL = 'nguoi-tra-ipn@vidu.vn';

let fake: TingeeFake;
let h: Harness;
let org: Org;
let other: Org;
let ipnKey: string;
let otherKey: string;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [mainAccount] },
      { ...NEXT, accounts: [nextAccount] },
      { ...OTHER, accounts: [otherAccount] },
    ],
  });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, { name: 'CLB Pickleball Quận 7', credential: MAIN, payout: payoutOf(mainAccount) });
  other = await paidReadyOrg(h, { name: 'CLB Cầu lông Thủ Đức', credential: OTHER, payout: payoutOf(otherAccount) });
  ipnKey = await ipnKeyOf(h, org.orgId);
  otherKey = await ipnKeyOf(h, other.orgId);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

interface Placed {
  buyer: User;
  eventId: string;
  tierId: string;
  code: string;
  orderId: string;
  total: number;
  funnelId: string;
}

/**
 * Người mua mới đặt `quantity` Vé (300.000đ, 5 suất) ở Sự kiện mới của `owner`; Đơn `pending` có link thanh toán (tạo
 * bằng credential hiện hành của `owner`). `link: false`: Tingee từ chối `create-link` (`1006`) nên Đơn `pending` chưa có
 * link (`merchant` là merchant Tingee của credential hiện hành).
 */
async function place(
  quantity = 2,
  owner: Org = org,
  options: { link?: boolean; merchant?: TingeeCredential } = {},
): Promise<Placed> {
  const buyer = await signUp(h);
  const sale = await eventOnSale(owner, [{ name: 'Đơn nam', price: PRICE, capacity: 5 }]);
  const tierId = sale.tiers[0]!.id;
  const funnelId = randomUUID();
  const withLink = options.link ?? true;
  if (!withLink) fake.merchant((options.merchant ?? MAIN).clientId).linkReplies = [{ code: '1006' }];
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity }], { funnelId }));
  expect(res.status).toBe(201);
  const order = parseOrder(res.body);
  expect(order).toMatchObject({
    status: 'pending',
    payment: { checkoutUrl: withLink ? expect.any(String) : null },
  });
  const { id } = await orderState(h, order.code);
  return { buyer, eventId: sale.event.id, tierId, code: order.code, orderId: id, total: quantity * PRICE, funnelId };
}

/** Body IPN `success` của Đơn (kèm `customerEmail`, `description` để kiểm whitelist). */
const paid = (placed: Pick<Placed, 'code' | 'total'>, overrides: FakeIpnPayload = {}) =>
  fakeIpnPayload(placed.code, placed.total, { customerEmail: CUSTOMER_EMAIL, ...overrides });

/** Body IPN trạng thái (`expired`, `canceled`, …) như Tingee: không có giao dịch, chưa trả tiền. */
const statusIpn = (code: string, status: string, total = 2 * PRICE) =>
  fakeIpnPayload(code, total, {
    status,
    statusCode: '01',
    paidAmount: null,
    paidAt: null,
    providerTransactionCode: null,
    paymentMethod: null,
  });

const send = (payload: FakeIpnPayload, credential: TingeeCredential = MAIN, key = ipnKey) =>
  postIpn(h, key, signIpn(credential.secretToken, payload));

const logsWith = (fields: Record<string, unknown>) =>
  h.logs.lines.filter((line) => Object.entries(fields).every(([k, v]) => line[k] === v));

async function auditCount(orderId: string): Promise<number> {
  const { rows } = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
    orderId,
  ]);
  return rows.length;
}

/** Server HTTP thật trên cùng app Express (để gửi request thô: body treo, chunked). */
async function listen(): Promise<{ server: Server; port: number }> {
  const server = createServer(h.app.getHttpAdapter().getInstance());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

describe('IPN đúng', () => {
  it('success khớp tiền, ký bằng secret hiện hành → 200 00; Đơn paid (ipn, paid_at = paidAt), held → sold, N Vé, 1 event gắn Đơn, audit, phễu', async () => {
    const placed = await place(2);
    const paidAt = new Date(Date.now() - 90_000);
    const payload = paid(placed, { paidAt: paidAt.toISOString() });
    const ipn = signIpn(MAIN.secretToken, payload);
    const res = await postIpn(h, ipnKey, ipn).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    expect(res.headers['content-type']).toMatch(/^application\/json/);

    const state = await orderState(h, placed.code);
    expect(state).toMatchObject({ status: 'paid', paid_source: 'ipn', paid_amount: String(placed.total), tickets: 2 });
    expect(state.paid_at!.toISOString()).toBe(paidAt.toISOString());
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });
    // Vé phát theo đồng hồ DB (không phải giờ Tingee báo).
    const tickets = await h.db.pool.query<{ issued_at: Date }>('SELECT issued_at FROM tickets WHERE order_id = $1', [
      placed.orderId,
    ]);
    for (const { issued_at } of tickets.rows) {
      expect(issued_at.getTime()).toBeGreaterThan(paidAt.getTime() + 60_000);
      expect(Math.abs(issued_at.getTime() - Date.now())).toBeLessThan(30_000);
    }

    const events = await paymentEventsOf(h, org.orgId, placed.code);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      organization_id: org.orgId,
      order_id: placed.orderId,
      kind: 'payment',
      status: 'success',
      provider_order_id: placed.code,
      provider_transaction_code: payload.providerTransactionCode,
      amount: String(placed.total),
      paid_amount: String(placed.total),
      status_code: '00',
      payment_method: 'qr',
      bill_id: null,
      merchant_id: '29267',
      request_id: payload.requestId,
    });
    expect(events[0]!.paid_at!.toISOString()).toBe(paidAt.toISOString());
    // Whitelist: không có cột cho nội dung tự do hay email người trả.
    const columns = await h.db.pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_events'",
    );
    const names = columns.rows.map((r) => r.column_name);
    for (const banned of ['description', 'order_info', 'customer_email']) expect(names).not.toContain(banned);

    expect(await auditCount(placed.orderId)).toBe(1);
    const funnel = await h.db.pool.query<{ type: string }>(
      'SELECT type FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [placed.funnelId],
    );
    expect(funnel.rows.map((r) => r.type)).toEqual(['order_created', 'paid']);

    // Trang Đơn của Người mua thấy Thành công kèm Vé.
    const order = BuyerOrder.parse(
      (await h.http.get(`/v1/me/orders/${placed.code}`).set('cookie', placed.buyer.cookie).expect(200)).body,
    );
    expect(order.status).toBe('paid');
    expect(order.tickets).toHaveLength(2);
    await expectInvariants(h, placed.eventId);

    expect(logsWith({ organizationId: org.orgId, orderCode: placed.code, branch: 'paid' })).toHaveLength(1);
    // Không bao giờ log secret, chữ ký, raw body hay email người trả.
    for (const secret of [MAIN.secretToken, ipn.headers['x-signature'], ipn.body, CUSTOMER_EMAIL]) {
      expect(h.logs.text).not.toContain(secret);
    }
  });

});

/** BTC mới có credential `MAIN` (hiện hành) và một tài khoản nhận tiền, cùng `ipnKey` của nó. */
async function ownOrg(name: string): Promise<{ own: Org; key: string }> {
  const own = await paidReadyOrg(h, { name, credential: MAIN, payout: payoutOf(mainAccount) });
  return { own, key: await ipnKeyOf(h, own.orgId) };
}

/**
 * Đổi key (Story 2.13-b): credential và tài khoản hiện hành gỡ mềm (giữ ciphertext), credential `to` (mặc định `NEXT`;
 * nhập lại cùng key cũng được) + tài khoản mặc định mới; `ipnKey` giữ nguyên.
 */
async function rotateKey(
  own: Org,
  to: TingeeCredential = NEXT,
  payout: PayoutSpec = payoutOf(nextAccount),
): Promise<void> {
  const key = await ipnKeyOf(h, own.orgId);
  await h.db.orm.execute(sql`
    UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${own.orgId}`);
  await h.db.orm.execute(sql`
    UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${own.orgId} AND retired_at IS NULL`);
  await linkPayoutAccount(own, to, payout);
  expect(await ipnKeyOf(h, own.orgId)).toBe(key);
}

describe('key cũ sau khi đổi key (AD-35): chỉ có hiệu lực với Đơn có link tạo bằng key đó', () => {
  it('Đơn có link tạo trước khi đổi key: success ký bằng key cũ → như IPN đúng; Đơn tạo sau ký bằng key mới', async () => {
    const { own, key } = await ownOrg('CLB Bóng bàn');
    const before = await place(1, own);
    await rotateKey(own);
    const after = await place(1, own);

    await send(paid(before), MAIN, key).expect(200);
    await send(paid(after), NEXT, key).expect(200);
    for (const placed of [before, after]) {
      expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 1 });
      expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 1, held: 0 });
      await expectInvariants(h, placed.eventId);
    }
    expect((await paymentEventsOf(h, own.orgId)).map((e) => e.order_id).sort()).toEqual(
      [before.orderId, after.orderId].sort(),
    );
  });

  it('IPN trạng thái ký bằng key cũ cho Đơn có link tạo trước khi đổi key → Đơn expired như thường', async () => {
    const { own, key } = await ownOrg('CLB Bơi lội');
    const before = await place(2, own);
    await rotateKey(own);
    await send(statusIpn(before.code, 'expired', before.total), MAIN, key).expect(200);
    expect(await orderState(h, before.code)).toMatchObject({ status: 'expired', tickets: 0 });
    expect(await inventory(h, before.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await paymentEventsOf(h, own.orgId, before.code)).toHaveLength(1);
    await expectInvariants(h, before.eventId);
  });

  it('Key cũ cho Đơn mới (link tạo sau khi đổi key), success hay expired → 401; không lưu; Đơn, tồn kho, Vé không đổi; log warn', async () => {
    const { own, key } = await ownOrg('CLB Cờ vua');
    await rotateKey(own);
    const after = await place(2, own);
    for (const payload of [paid(after), statusIpn(after.code, 'expired', after.total), statusIpn(after.code, 'canceled', after.total)]) {
      const res = await send(payload, MAIN, key);
      expect(res.status, String(payload.status)).toBe(401);
      expect(errorOf(res.body).code).toBe('IPN_SIGNATURE_INVALID');
    }
    expect(logsWith({ organizationId: own.orgId, reason: 'retired_key_other_credential', level: 40 })).toHaveLength(3);
    expect(await paymentEventsOf(h, own.orgId)).toEqual([]);
    expect(await orderState(h, after.code)).toMatchObject({ status: 'pending', paid_at: null, tickets: 0 });
    expect(await inventory(h, after.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInvariants(h, after.eventId);
    // Cùng IPN ký bằng key hiện hành → nhận.
    await send(paid(after), NEXT, key).expect(200);
    expect(await orderState(h, after.code)).toMatchObject({ status: 'paid', tickets: 2 });
  });

  it('Đơn của credential cũ khác (đổi key hai lần): ký bằng key cũ đầu tiên cho Đơn tạo bằng key cũ thứ hai → 401', async () => {
    const LATEST: TingeeCredential = { clientId: 'tg-ipn-latest-7c3b', secretToken: 'tg-ipn-latest-secret-Rt5Yu4Io3' };
    const { own, key } = await ownOrg('CLB Đá cầu');
    await rotateKey(own); // MAIN → NEXT
    const middle = await place(1, own);
    // Đổi key lần hai: NEXT → LATEST (chỉ cần trong DB; Đơn tạo bằng NEXT đã có link).
    await h.db.orm.execute(sql`
      UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${own.orgId}`);
    await h.db.orm.execute(sql`
      UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${own.orgId} AND retired_at IS NULL`);
    await linkPayoutAccount(own, LATEST, payoutOf(otherAccount));

    const res = await send(paid(middle), MAIN, key);
    expect(res.status).toBe(401);
    expect(logsWith({ organizationId: own.orgId, reason: 'retired_key_other_credential' })).toHaveLength(1);
    expect((await orderState(h, middle.code)).status).toBe('pending');
    // Key cũ đúng của Đơn (NEXT) → nhận.
    await send(paid(middle), NEXT, key).expect(200);
    expect(await orderState(h, middle.code)).toMatchObject({ status: 'paid', tickets: 1 });
    await expectInvariants(h, middle.eventId);
  });

  it('nhập lại cùng Secret Token: credential hiện hành và cũ chung secret → khớp hiện hành; hai credential cũ chung secret → Đơn ràng với credential cũ hơn vẫn nhận', async () => {
    const { own, key } = await ownOrg('CLB Quần vợt');
    const a = await place(1, own); // link bằng credential MAIN thứ nhất
    await rotateKey(own, MAIN, payoutOf(mainAccount)); // credential MAIN thứ hai (hiện hành), cùng secret với cái đã thay
    const b = await place(1, own);
    await send(paid(b), MAIN, key).expect(200);
    expect(await orderState(h, b.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 1 });

    await rotateKey(own); // NEXT hiện hành; hai credential cũ cùng secret MAIN
    await send(paid(a), MAIN, key).expect(200);
    expect(await orderState(h, a.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 1 });
    expect(logsWith({ organizationId: own.orgId, level: 40 })).toEqual([]);
    for (const placed of [a, b]) {
      expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 1, held: 0 });
      await expectInvariants(h, placed.eventId);
    }
  });

  it('chữ ký chỉ khớp key cũ mà không ràng được Đơn → 401 với reason riêng, không lưu (kể cả body hỏng: không phải 400)', async () => {
    const { own, key } = await ownOrg('CLB Bi-a');
    const noLink = await place(1, own, { link: false });
    const before = await place(1, own);
    await rotateKey(own);
    // Đơn `pending` của `org` (BTC khác, MAIN vẫn là key hiện hành của BTC đó).
    const foreign = await place(1, org);

    const { providerTransactionCode: _code, ...withoutCode } = paid(before);
    const cases: [string, string | FakeIpnPayload, string][] = [
      ['mã sai dạng', fakeIpnPayload(`SDK-${Date.now()}`, 50_000), 'retired_key_invalid_order_code'],
      ['không có Đơn', fakeIpnPayload('TK00000000', 50_000), 'retired_key_order_not_found'],
      ['Đơn thuộc BTC khác', paid(foreign), 'retired_key_other_organization'],
      ['Đơn thuộc BTC khác, IPN trạng thái', statusIpn(foreign.code, 'expired', foreign.total), 'retired_key_other_organization'],
      ['Đơn chưa có link', paid(noLink), 'retired_key_order_without_link'],
      ['body không phải JSON', `{"orderId": "${before.code}",`, 'retired_key_unreadable_body'],
      ['body sai schema', withoutCode, 'retired_key_unreadable_body'],
    ];
    for (const [name, body, reason] of cases) {
      const res = await postIpn(h, key, signIpn(MAIN.secretToken, body));
      expect(res.status, name).toBe(401);
      expect(errorOf(res.body).code, name).toBe('IPN_SIGNATURE_INVALID');
      expect(logsWith({ organizationId: own.orgId, reason, level: 40 }).length, name).toBeGreaterThanOrEqual(1);
    }
    expect(await paymentEventsOf(h, own.orgId)).toEqual([]);
    expect(await paymentEventsOf(h, org.orgId, foreign.code)).toEqual([]);
    for (const placed of [noLink, before, foreign]) {
      expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
      expect(await inventory(h, placed.tierId)).toMatchObject({ held: 1, sold: 0 });
      await expectInvariants(h, placed.eventId);
    }
    // Ký bằng key hiện hành: body hỏng là 400 như thường; Đơn của BTC khác đi nhánh lưu (other_organization).
    expect((await postIpn(h, key, signIpn(NEXT.secretToken, `{"orderId": "${before.code}",`))).status).toBe(400);
    await send(paid(foreign), NEXT, key).expect(200);
    expect(await paymentEventsOf(h, own.orgId, foreign.code)).toHaveLength(1);
  });
});

describe('từ chối', () => {
  it('ipnKey lạ → 404 NOT_FOUND trước khi đọc body (body còn treo vẫn nhận 404 ngay); không lưu; log warn', async () => {
    const res = await postIpn(h, 'khong-co-btc-nao-AAAAAA', signIpn(MAIN.secretToken, fakeIpnPayload('TK00000000', 2_000)));
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('NOT_FOUND');
    for (const key of ['a.b', 'x'.repeat(200)]) {
      expect((await postIpn(h, key, signIpn(MAIN.secretToken, '{}'))).status).toBe(404);
    }
    expect(logsWith({ reason: 'unknown_ipn_key' }).length).toBeGreaterThanOrEqual(3);

    // Request khai 1000 byte nhưng mới gửi 1 byte: handler không chờ body.
    const { server, port } = await listen();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: ipnPath('khong-co-btc-nao-BBBBBB'),
            headers: { 'content-type': 'application/json', 'content-length': '1000' },
          },
          (response: IncomingMessage) => {
            resolve(response.statusCode ?? 0);
            response.resume();
            req.destroy();
          },
        );
        req.on('error', () => undefined);
        req.write('{');
        setTimeout(() => reject(new Error('api chờ body của ipnKey lạ')), 5_000);
      });
      expect(status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('sai chữ ký: ký sai, ký bằng secret BTC khác, thiếu chữ ký → 401 IPN_SIGNATURE_INVALID; không lưu; log warn', async () => {
    const placed = await place(2);
    const payload = paid(placed);
    const good = signIpn(MAIN.secretToken, payload);
    const cases = [
      { name: 'ký sai', ipn: { ...good, headers: { ...good.headers, 'x-signature': 'ab'.repeat(64) } }, reason: 'signature_mismatch' },
      // IPN ký bằng secret của BTC khác gửi vào URL của BTC này.
      { name: 'secret BTC khác', ipn: signIpn(OTHER.secretToken, payload), reason: 'signature_mismatch' },
      {
        name: 'thiếu chữ ký',
        ipn: { body: good.body, headers: { 'content-type': 'application/json', 'x-request-timestamp': good.headers['x-request-timestamp'] } },
        reason: 'signature_missing',
      },
    ];
    for (const { name, ipn, reason } of cases) {
      const res = await h.http.post(ipnPath(ipnKey)).set(ipn.headers).send(ipn.body);
      expect(res.status, name).toBe(401);
      expect(errorOf(res.body).code).toBe('IPN_SIGNATURE_INVALID');
      expect(logsWith({ organizationId: org.orgId, reason }).length, name).toBeGreaterThanOrEqual(1);
    }
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 2, sold: 0 });
    await expectInvariants(h, placed.eventId);
    expect(h.logs.text).not.toContain(good.headers['x-signature']);
    expect(h.logs.text).not.toContain(OTHER.secretToken);
  });

  it('timestamp sai dạng hoặc lệch > 10 phút (cả hai chiều) → 401; lệch 9 phút vẫn nhận', async () => {
    const placed = await place(1);
    const payload = paid(placed);
    const now = Date.now();
    const cases: [string, string | undefined, string][] = [
      ['quá khứ 11 phút', tingeeTimestamp(new Date(now - 11 * 60_000)), 'timestamp_skew'],
      ['tương lai 11 phút', tingeeTimestamp(new Date(now + 11 * 60_000)), 'timestamp_skew'],
      ['UNIX ms', String(now), 'timestamp_invalid'],
      ['ISO', new Date(now).toISOString(), 'timestamp_invalid'],
      ['ngày không có thật', '20261131100000000', 'timestamp_invalid'],
      ['thiếu', undefined, 'timestamp_missing'],
    ];
    for (const [name, timestamp, reason] of cases) {
      const ipn = signIpn(MAIN.secretToken, payload, { timestamp: timestamp ?? tingeeTimestamp(new Date()) });
      const headers: Record<string, string> = { ...ipn.headers };
      if (timestamp === undefined) delete headers['x-request-timestamp'];
      const res = await h.http.post(ipnPath(ipnKey)).set(headers).send(ipn.body);
      expect(res.status, name).toBe(401);
      expect(errorOf(res.body).code, name).toBe('IPN_SIGNATURE_INVALID');
      expect(logsWith({ organizationId: org.orgId, reason }).length, name).toBeGreaterThanOrEqual(1);
    }
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect((await orderState(h, placed.code)).status).toBe('pending');

    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, payload, { at: new Date(Date.now() - 9 * 60_000) })).expect(200);
    expect((await orderState(h, placed.code)).status).toBe('paid');
    await expectInvariants(h, placed.eventId);
  });

  it('AC: body có khoảng trắng, thứ tự khóa, \\uXXXX → ký trên đúng byte gửi đi: 200; ký trên bản serialize lại: 401', async () => {
    const placed = await place(2);
    const raw =
      `{\n  "status" : "success",\n\t"orderId": "${placed.code}",  "amount":${placed.total}, "paidAmount" : ${placed.total},\n` +
      `  "description": "Thanh to\\u00e1n \\u0110\\u01a1n ${placed.code} — xong",\n` +
      `  "providerTransactionCode": "tg-ws-${randomUUID()}", "paidAt": "${new Date().toISOString()}",\n` +
      `  "merchantId": 29267, "statusCode": "00", "paymentMethod": "qr", "customerEmail": "${CUSTOMER_EMAIL}"\n}\n`;
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);

    const wrong = signIpn(MAIN.secretToken, reserialized);
    const rejected = await h.http.post(ipnPath(ipnKey)).set(wrong.headers).send(raw);
    expect(rejected.status).toBe(401);
    expect(errorOf(rejected.body).code).toBe('IPN_SIGNATURE_INVALID');
    expect((await orderState(h, placed.code)).status).toBe('pending');

    const res = await postIpn(h, ipnKey, signIpn(MAIN.secretToken, raw)).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
    await expectInvariants(h, placed.eventId);
  });
});

describe('lặp', () => {
  it('cùng providerTransactionCode (gửi lại nguyên văn, hay ký lại timestamp mới) → 200 00; không thêm event hay Vé', async () => {
    const placed = await place(2);
    const payload = paid(placed);
    const ipn = signIpn(MAIN.secretToken, payload);
    for (const again of [ipn, ipn, signIpn(MAIN.secretToken, { ...payload, requestId: randomUUID() })]) {
      expect((await postIpn(h, ipnKey, again).expect(200)).text).toBe(ACK_TEXT);
    }
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(1);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await auditCount(placed.orderId)).toBe(1);
    expect(logsWith({ organizationId: org.orgId, orderCode: placed.code, branch: 'duplicate' })).toHaveLength(2);
    await expectInvariants(h, placed.eventId);
  });
});

describe('hết hạn / hủy', () => {
  it('expired cho Đơn pending → expired, held -= n; lặp (orderId, status) → no-op; canceled cho Đơn pending khác → expired', async () => {
    const a = await place(2);
    expect((await send(statusIpn(a.code, 'expired')).expect(200)).text).toBe(ACK_TEXT);
    expect(await orderState(h, a.code)).toMatchObject({ status: 'expired', tickets: 0 });
    expect(await inventory(h, a.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    const events = await paymentEventsOf(h, org.orgId, a.code);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'status', status: 'expired', order_id: a.orderId, provider_transaction_code: null });
    // Lặp cùng (orderId, status), kể cả requestId mới → no-op.
    await send(statusIpn(a.code, 'expired')).expect(200);
    expect(await paymentEventsOf(h, org.orgId, a.code)).toHaveLength(1);
    expect(logsWith({ orderCode: a.code, branch: 'duplicate' })).toHaveLength(1);
    // `canceled` sau đó cho Đơn đã hết hạn: chỉ lưu.
    await send(statusIpn(a.code, 'canceled')).expect(200);
    expect(await paymentEventsOf(h, org.orgId, a.code)).toHaveLength(2);
    expect(logsWith({ orderCode: a.code, status: 'canceled', branch: 'stored' })).toHaveLength(1);
    await expectInvariants(h, a.eventId);

    const b = await place(1);
    await send(statusIpn(b.code, 'canceled', b.total)).expect(200);
    expect(await orderState(h, b.code)).toMatchObject({ status: 'expired', tickets: 0 });
    expect(await inventory(h, b.tierId)).toMatchObject({ held: 0, sold: 0 });
    await expectInvariants(h, b.eventId);
  });

  it('trạng thái muộn: expired cho Đơn đã paid → chỉ lưu (gắn Đơn); Đơn, Vé, tồn kho không đổi', async () => {
    const placed = await place(2);
    await send(paid(placed)).expect(200);
    await send(statusIpn(placed.code, 'expired')).expect(200);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });
    const events = await paymentEventsOf(h, org.orgId, placed.code);
    expect(events.map((e) => [e.kind, e.status, e.order_id])).toEqual([
      ['payment', 'success', placed.orderId],
      ['status', 'expired', placed.orderId],
    ]);
    await expectInvariants(h, placed.eventId);
  });
});

describe('nhánh của Story 3.6: 200 00, chỉ lưu event, log warn kèm nhánh; Đơn, tồn kho, Vé không đổi', () => {
  /** Gửi IPN, kiểm 200 + event đã lưu + log warn đúng nhánh; trả event. */
  async function expectStoredOnly(payload: FakeIpnPayload, branch: string) {
    const res = await send(payload).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    const events = await paymentEventsOf(h, org.orgId, String(payload.orderId));
    const event = events.find((e) => e.provider_transaction_code === payload.providerTransactionCode && e.status === payload.status);
    expect(event, branch).toBeDefined();
    const warning = h.logs.lines.find((l) => l.paymentEventId === event!.id);
    expect(warning).toMatchObject({ level: 40, organizationId: org.orgId, branch });
    return event!;
  }

  it('lệch tiền (thiếu hay thừa) → mismatch, gắn Đơn', async () => {
    const placed = await place(2);
    for (const delta of [-1_000, 1_000]) {
      const event = await expectStoredOnly(paid(placed, { paidAmount: placed.total + delta }), 'mismatch');
      expect(event.order_id).toBe(placed.orderId);
    }
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', paid_at: null, tickets: 0 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInvariants(h, placed.eventId);
  });

  it('Sự kiện đã hủy → event_cancelled (thắng cả lệch tiền)', async () => {
    const placed = await place(1);
    await h.db.orm.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${placed.eventId}`);
    await expectStoredOnly(paid(placed, { paidAmount: 1 }), 'event_cancelled');
    await expectStoredOnly(paid(placed), 'event_cancelled');
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    await expectInvariants(h, placed.eventId);
  });

  it('quá effective_end_at → orphan; Sự kiện bị khóa (chưa kết thúc) vẫn phát Vé', async () => {
    const ended = await place(1);
    await h.db.orm.execute(
      sql`UPDATE events SET effective_end_at = now() - interval '1 minute' WHERE id = ${ended.eventId}`,
    );
    await expectStoredOnly(paid(ended), 'orphan');
    expect(await orderState(h, ended.code)).toMatchObject({ status: 'pending', tickets: 0 });
    await expectInvariants(h, ended.eventId);

    const locked = await place(2);
    await h.db.orm.execute(sql`UPDATE events SET locked_at = now(), lock_reason = 'test' WHERE id = ${locked.eventId}`);
    await send(paid(locked)).expect(200);
    expect(await orderState(h, locked.code)).toMatchObject({ status: 'paid', tickets: 2 });
    await expectInvariants(h, locked.eventId);
  });

  it('Đơn không còn pending (tiền về sau khi đã hết hạn) → order_not_pending, gắn Đơn', async () => {
    const placed = await place(2);
    await send(statusIpn(placed.code, 'expired')).expect(200);
    const event = await expectStoredOnly(paid(placed), 'order_not_pending');
    expect(event.order_id).toBe(placed.orderId);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'expired', tickets: 0 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, placed.eventId);
  });

  it('Đơn thuộc BTC khác (IPN lạc, ký đúng secret của BTC này) → other_organization, không gắn Đơn; khóa chống lặp theo BTC: cùng mã giao dịch ký lại gửi vào URL BTC kia vẫn phát Vé', async () => {
    const foreign = await place(1, other);
    const payload = paid(foreign);
    const event = await expectStoredOnly(payload, 'other_organization');
    expect(event).toMatchObject({ organization_id: org.orgId, order_id: null });
    expect(await orderState(h, foreign.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await paymentEventsOf(h, other.orgId)).toEqual([]);
    await expectInvariants(h, foreign.eventId);
    // Ký bằng secret của BTC kia (chủ Đơn) nhưng gửi vào URL BTC này → sai chữ ký.
    expect((await send(payload, OTHER, ipnKey)).status).toBe(401);
    // Cùng payload (cùng providerTransactionCode) ký lại bằng secret BTC kia, gửi đúng URL BTC kia → không bị coi là lặp:
    // phát Vé bình thường.
    await send(payload, OTHER, otherKey).expect(200);
    expect(await orderState(h, foreign.code)).toMatchObject({ status: 'paid', tickets: 1 });
    const theirs = await paymentEventsOf(h, other.orgId, foreign.code);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({
      order_id: foreign.orderId,
      provider_transaction_code: payload.providerTransactionCode,
    });
    expect(await paymentEventsOf(h, org.orgId, foreign.code)).toHaveLength(1);
    await expectInvariants(h, foreign.eventId);
  });

  it('IPN expired ký đúng gửi vào URL BTC này với mã Đơn pending của BTC khác → chỉ lưu dưới BTC này (order_id null); Đơn kia vẫn pending, held không đổi', async () => {
    const foreign = await place(2, other);
    const res = await send(statusIpn(foreign.code, 'expired', foreign.total)).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    expect(await orderState(h, foreign.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, foreign.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    const events = await paymentEventsOf(h, org.orgId, foreign.code);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ organization_id: org.orgId, order_id: null, kind: 'status', status: 'expired' });
    expect(await paymentEventsOf(h, other.orgId, foreign.code)).toEqual([]);
    expect(logsWith({ paymentEventId: events[0]!.id, branch: 'stored' })).toHaveLength(1);
    await expectInvariants(h, foreign.eventId);
  });

  it('mã đúng định dạng nhưng không có Đơn → order_not_found; mã khác định dạng Tickee → invalid_order_code (không log mã)', async () => {
    const missing = await expectStoredOnly(fakeIpnPayload('TK00000000', 50_000), 'order_not_found');
    expect(missing.order_id).toBeNull();
    const foreignCode = `SDK-${Date.now()}`;
    const invalid = await expectStoredOnly(fakeIpnPayload(foreignCode, 50_000), 'invalid_order_code');
    expect(invalid).toMatchObject({ order_id: null, provider_order_id: foreignCode });
    expect(h.logs.text).not.toContain(foreignCode);
  });

  it('status lạ → chỉ lưu (kind status), log warn unknown_status', async () => {
    const placed = await place(1);
    const event = await expectStoredOnly(statusIpn(placed.code, 'pending', placed.total), 'unknown_status');
    expect(event).toMatchObject({ kind: 'status', status: 'pending', order_id: placed.orderId });
    expect((await orderState(h, placed.code)).status).toBe('pending');
    await expectInvariants(h, placed.eventId);
  });
});

describe('body hỏng', () => {
  it('chữ ký đúng nhưng không phải JSON hay sai schema → 400 VALIDATION_FAILED, log error (chỉ tên trường), không lưu', async () => {
    const placed = await place(1);
    const base = paid(placed);
    const { orderId: _orderId, ...noOrderId } = base;
    const cases: [string, string | FakeIpnPayload, string][] = [
      ['không phải JSON', `{"orderId": "${placed.code}",`, 'invalid_json'],
      ['mảng', '[]', 'invalid_payload'],
      ['thiếu orderId', noOrderId, 'invalid_payload'],
      ['success thiếu providerTransactionCode', { ...base, providerTransactionCode: null }, 'invalid_payload'],
      ['success thiếu paidAmount', { ...base, paidAmount: undefined }, 'invalid_payload'],
      ['paidAmount là chuỗi', { ...base, paidAmount: String(placed.total) }, 'invalid_payload'],
      ['paidAmount âm', { ...base, paidAmount: -1 }, 'invalid_payload'],
      ['providerTransactionCode là số', { ...base, providerTransactionCode: 12345 }, 'invalid_payload'],
      ['status rỗng', { ...base, status: '' }, 'invalid_payload'],
    ];
    for (const [name, body, reason] of cases) {
      const res = await postIpn(h, ipnKey, signIpn(MAIN.secretToken, body));
      expect(res.status, name).toBe(400);
      expect(errorOf(res.body).code, name).toBe('VALIDATION_FAILED');
      const logged = logsWith({ organizationId: org.orgId, reason });
      expect(logged.length, name).toBeGreaterThanOrEqual(1);
      expect(logged.at(-1)!.level, name).toBe(50);
    }
    expect(logsWith({ reason: 'invalid_payload' }).some((l) => JSON.stringify(l.fields).includes('providerTransactionCode'))).toBe(true);
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect((await orderState(h, placed.code)).status).toBe('pending');
  });

  it('trường phụ sai định dạng → lưu null, vẫn xử lý (200, phát Vé); paidAt không có múi giờ → paid_at theo đồng hồ DB', async () => {
    const placed = await place(2);
    const payload = paid(placed, {
      paidAt: '2026-11-11T10:15:00', // thiếu offset: không đoán múi giờ
      requestId: 'r'.repeat(500),
      billId: { id: 1 },
      statusCode: 0,
      paymentMethod: 'p'.repeat(80),
      merchantId: { id: 29267 },
      amount: String(placed.total),
    });
    const res = await send(payload).expect(200);
    expect(res.text).toBe(ACK_TEXT);
    const state = await orderState(h, placed.code);
    expect(state).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 2 });
    expect(Math.abs(state.paid_at!.getTime() - Date.now())).toBeLessThan(30_000);
    const [event] = await paymentEventsOf(h, org.orgId, placed.code);
    expect(event).toMatchObject({
      order_id: placed.orderId,
      provider_transaction_code: payload.providerTransactionCode,
      paid_amount: String(placed.total),
      paid_at: null,
      request_id: null,
      bill_id: null,
      status_code: null,
      payment_method: null,
      merchant_id: null,
      amount: null,
    });
    await expectInvariants(h, placed.eventId);

    // `paidAt` có offset khác Z vẫn đọc đúng; ISO không có giây lẻ cũng nhận.
    const other = await place(1);
    await send(paid(other, { paidAt: '2026-11-11T10:15:00+07:00' })).expect(200);
    expect((await orderState(h, other.code)).paid_at!.toISOString()).toBe('2026-11-11T03:15:00.000Z');
  });

  it('IPN trạng thái: paidAmount / providerTransactionCode sai định dạng là trường phụ → null, vẫn hết hạn Đơn', async () => {
    const placed = await place(1);
    await send({ ...statusIpn(placed.code, 'expired', placed.total), paidAmount: 'abc', providerTransactionCode: 42 }).expect(200);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'expired', tickets: 0 });
    const [event] = await paymentEventsOf(h, org.orgId, placed.code);
    expect(event).toMatchObject({ kind: 'status', paid_amount: null, provider_transaction_code: null });
    await expectInvariants(h, placed.eventId);
  });

  it('body > 64 KB → 413 (khai content-length hay gửi chunked), không lưu', async () => {
    const placed = await place(1);
    const big = paid(placed, { description: 'x'.repeat(70 * 1024) });
    const res = await postIpn(h, ipnKey, signIpn(MAIN.secretToken, big));
    expect(res.status).toBe(413);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');

    const ipn = signIpn(MAIN.secretToken, big);
    const { server, port } = await listen();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: ipnPath(ipnKey),
            headers: { ...ipn.headers, 'transfer-encoding': 'chunked' },
          },
          (response) => {
            resolve(response.statusCode ?? 0);
            response.resume();
          },
        );
        req.on('error', reject);
        for (let i = 0; i < ipn.body.length; i += 8 * 1024) req.write(ipn.body.slice(i, i + 8 * 1024));
        req.end();
      });
      expect(status).toBe(413);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect((await orderState(h, placed.code)).status).toBe('pending');
  });
});

describe('parser JSON toàn cục bỏ qua tiền tố IPN', () => {
  it('đường dẫn IPN viết hoa (router không phân biệt) vẫn đọc được byte thô; route JSON khác vẫn parse', async () => {
    const placed = await place(1);
    const upper = ipnPath(ipnKey).replace('/payments/tingee/ipn/', '/PAYMENTS/Tingee/IPN/');
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, paid(placed)), upper).expect(200);
    expect((await orderState(h, placed.code)).status).toBe('paid');
    await expectInvariants(h, placed.eventId);
  });

  it('parsesAsJson: application/json (kèm charset, hoa thường) ngoài tiền tố IPN', () => {
    const req = (url: string, type?: string) =>
      ({ url, originalUrl: url, headers: type ? { 'content-type': type } : {} }) as unknown as IncomingMessage;
    expect(parsesAsJson(req('/v1/orgs', 'application/json'))).toBe(true);
    expect(parsesAsJson(req('/v1/orgs', 'Application/JSON; charset=utf-8'))).toBe(true);
    expect(parsesAsJson(req('/v1/orgs', 'text/plain'))).toBe(false);
    expect(parsesAsJson(req('/v1/orgs'))).toBe(false);
    expect(parsesAsJson(req('/v1/payments/tingee/ipn/abc', 'application/json'))).toBe(false);
    expect(parsesAsJson(req('/v1/payments/tingee/ipn/abc?x=1', 'application/json'))).toBe(false);
    expect(parsesAsJson(req('/V1/Payments/Tingee/IPN/abc', 'application/json'))).toBe(false);
    expect(parsesAsJson(req('/v1/payments/tingee/ipnx', 'application/json'))).toBe(true);
    // Absolute-form (`POST http://host/…`): `originalUrl` giữ nguyên URL tuyệt đối.
    expect(parsesAsJson(req('http://api.tickee.vn/v1/payments/tingee/ipn/abc', 'application/json'))).toBe(false);
    expect(parsesAsJson(req('HTTP://API.tickee.vn:8080/V1/payments/tingee/IPN/abc?x=1', 'application/json'))).toBe(false);
    expect(parsesAsJson(req('http://api.tickee.vn/v1/orgs', 'application/json'))).toBe(true);
  });

  it('request dạng absolute-form (POST http://host/v1/payments/…) → handler vẫn đọc được byte thô: 200, phát Vé', async () => {
    const placed = await place(1);
    const ipn = signIpn(MAIN.secretToken, paid(placed));
    const { server, port } = await listen();
    try {
      const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `http://127.0.0.1:${port}${ipnPath(ipnKey)}`,
            headers: { ...ipn.headers, 'content-length': String(Buffer.byteLength(ipn.body)) },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
          },
        );
        req.on('error', reject);
        req.end(ipn.body);
      });
      expect(status).toBe(200);
      expect(body).toBe(ACK_TEXT);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 1 });
    await expectInvariants(h, placed.eventId);
  });
});

describe('lỗi xử lý và quyền DB', () => {
  const pgCode = (err: unknown) => (err as { code?: string }).code;

  it('markPaid lỗi giữa chừng (phát Vé lỗi) → 5xx, không lưu payment_events, Đơn vẫn pending; gỡ lỗi rồi gửi lại cùng mã giao dịch → 200, paid, một event', async () => {
    const placed = await place(2);
    // Chiếm trước seq 1 của Đơn: INSERT Vé của markPaid vi phạm `tickets_order_id_seq_key`.
    await h.db.pool.query(
      `INSERT INTO tickets (order_id, event_id, organization_id, user_id, ticket_type_id, seq, order_ticket_count,
         holder_name, ticket_type_name, order_code, issued_at, qr_key_version)
       SELECT o.id, o.event_id, o.organization_id, o.user_id, $2, 1, 2, 'X', 'Đơn nam', o.code, now(), 1
         FROM orders o WHERE o.id = $1`,
      [placed.orderId, placed.tierId],
    );
    const ipn = signIpn(MAIN.secretToken, paid(placed));
    const failed = await postIpn(h, ipnKey, ipn);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toEqual([]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', paid_at: null });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });

    await h.db.pool.query('DELETE FROM tickets WHERE order_id = $1', [placed.orderId]);
    // Tingee gửi lại đúng IPN đó (cùng mã giao dịch, cùng chữ ký).
    expect((await postIpn(h, ipnKey, ipn).expect(200)).text).toBe(ACK_TEXT);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 2 });
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(1);
    expect(await auditCount(placed.orderId)).toBe(1);
    await expectInvariants(h, placed.eventId);
  });

  it('credential của BTC không giải mã được → IPN 500, không lưu, Đơn vẫn pending; secret không vào log', async () => {
    const { own, key } = await ownOrg('CLB Bóng rổ');
    const placed = await place(1, own);
    // Ciphertext mã bằng phiên bản khóa không còn trong TINGEE_CREDENTIAL_KEYS.
    await h.db.orm.execute(sql`
      UPDATE tingee_credentials SET secret_token_ciphertext = 'v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
       WHERE organization_id = ${own.orgId}`);
    const res = await send(paid(placed), MAIN, key);
    expect(res.status).toBe(500);
    expect(await paymentEventsOf(h, own.orgId)).toEqual([]);
    expect(await orderState(h, placed.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 1, sold: 0 });
    await expectInvariants(h, placed.eventId);
    expect(h.logs.text).not.toContain(MAIN.secretToken);
  });

  it('payment_events chỉ INSERT/SELECT với tickee_app: UPDATE, DELETE, TRUNCATE → 42501', async () => {
    const placed = await place(1);
    await send(paid(placed)).expect(200);
    for (const statement of [
      "UPDATE payment_events SET status = 'expired' WHERE provider_order_id = $1",
      'UPDATE payment_events SET order_id = NULL WHERE provider_order_id = $1',
      'DELETE FROM payment_events WHERE provider_order_id = $1',
    ]) {
      await expect(h.db.pool.query(statement, [placed.code])).rejects.toSatisfy((err) => pgCode(err) === '42501');
    }
    // TRUNCATE trong transaction rồi rollback: lỡ có quyền thì cũng không xóa dữ liệu của test khác.
    const client = await h.db.pool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query('TRUNCATE payment_events')).rejects.toSatisfy((err) => pgCode(err) === '42501');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(1);
  });
});
