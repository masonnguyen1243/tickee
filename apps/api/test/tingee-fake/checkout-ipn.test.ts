import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseTingeeTimestamp, sign, tingeeTimestamp } from '../../src/modules/tingee/signing.js';
import {
  CHECKOUT_IPN_TIMEOUT_MS,
  CREATE_LINK_PATH,
  fakeAccount,
  startTingeeFake,
  type FakeAccount,
  type TingeeFake,
} from './server.js';

/*
 * Trang thanh toán giả gửi IPN (spec-tingee-fake-gui-ipn): Tingee fake thật và một server HTTP nhận giả đứng thay api.
 * Mọi dòng I/O Matrix trừ Seed (dev-seed/seed.test.ts): header, chữ ký và body IPN như Tingee gửi; fake → api thật ở
 * payment/ipn-dev-checkout.test.ts.
 */

interface Credential {
  clientId: string;
  secretToken: string;
}

const A: Credential = { clientId: 'tg-checkout-a-7b2d', secretToken: 'tg-checkout-a-secret-Qw8Er7Ty6' };
const B: Credential = { clientId: 'tg-checkout-b-4c9e', secretToken: 'tg-checkout-b-secret-As5Df4Gh3' };
const accountA = fakeAccount({ accountName: 'NGUYEN THI HOA' });
const accountB = fakeAccount({ accountName: 'TRAN VAN KHOA' });
/** Timeout gửi IPN ngắn cho test (mặc định 10 giây). */
const IPN_TIMEOUT_MS = 300;
const ACK = '{"code":"00","message":"Success"}';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Received {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Phản hồi kế tiếp của server nhận giả (mặc định 200 + ACK của api); `hang`: không trả lời. */
type ReceiverReply = { status: number; body: string; location?: string } | 'hang';

let fake: TingeeFake;
const logs: string[] = [];
const received: Received[] = [];
const replies: ReceiverReply[] = [];
const hanging = new Set<ServerResponse>();
const receiver = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    received.push({
      method: req.method ?? '',
      path: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    const reply = replies.shift() ?? { status: 200, body: ACK };
    if (reply === 'hang') {
      hanging.add(res);
      return;
    }
    res.writeHead(reply.status, {
      'content-type': 'application/json',
      ...(reply.location ? { location: reply.location } : {}),
    });
    res.end(reply.body);
  });
});
let receiverOrigin = '';
/** Một URL IPN trên server nhận giả. */
const ipnUrlAt = (name: string) => `${receiverOrigin}/v1/payments/tingee/ipn/${name}`;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...A, accounts: [accountA] },
      { ...B, accounts: [accountB] },
    ],
    ipnTimeoutMs: IPN_TIMEOUT_MS,
    log: (line) => logs.push(line),
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverOrigin = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
});
beforeEach(() => {
  received.length = 0;
  replies.length = 0;
  fake.reset();
  fake.merchant(A.clientId).ipnUrl = ipnUrlAt('khoa-btc-a');
  delete fake.merchant(B.clientId).ipnUrl;
});
afterAll(async () => {
  for (const res of hanging) res.destroy();
  receiver.closeAllConnections();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await fake.close();
});

let orderSeq = 0;

interface Link {
  orderId: string;
  amount: number;
  returnUrl: string | null;
  checkoutUrl: string;
}

/** Tạo link qua `create-link` của fake (request ký như api); `returnUrl: null` = không gửi trường này. */
async function createLink(
  credential: Credential = A,
  account: FakeAccount = accountA,
  options: { amount?: number; returnUrl?: string | null } = {},
): Promise<Link> {
  orderSeq += 1;
  const orderId = `TKIPN${Date.now().toString(36).toUpperCase()}${orderSeq}`;
  const amount = options.amount ?? 450_000;
  const returnUrl = options.returnUrl === undefined ? `http://web.tickee.test/orders/${orderId}` : options.returnUrl;
  const body = JSON.stringify({
    requestId: randomUUID(),
    orderId,
    amount,
    vaAccountNumber: String(account.vaAccountNumber),
    expireInMinute: 15,
    ...(returnUrl === null ? {} : { returnUrl }),
    description: `Thanh toán Đơn ${orderId}`,
  });
  const timestamp = tingeeTimestamp(new Date());
  const res = await fetch(`${fake.url}${CREATE_LINK_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-id': credential.clientId,
      'x-request-timestamp': timestamp,
      'x-signature': sign(timestamp, body, credential.secretToken),
    },
    body,
  });
  const reply = (await res.json()) as { code: string; data: string };
  expect(reply.code).toBe('00');
  return { orderId, amount, returnUrl, checkoutUrl: reply.data };
}

/** Bấm một nút trên trang giả: POST form như trình duyệt, không theo redirect. */
function press(orderId: string, form: Record<string, string>) {
  return fetch(`${fake.url}/checkout/${encodeURIComponent(orderId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    redirect: 'manual',
  });
}

/** Giá trị ô "Đường dẫn IPN" của trang (đã bỏ escape HTML). */
function ipnField(html: string): string | undefined {
  const value = /<input id="ipnUrl" name="ipnUrl"[^>]* value="([^"]*)"/.exec(html)?.[1];
  return value?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Trang có form gửi IPN với đủ ba nút. */
function expectForm(html: string, orderId: string): void {
  expect(html).toContain(`<form method="post" action="/checkout/${orderId}">`);
  expect(html).toContain('<button type="submit" name="status" value="success">Đã thanh toán (giả lập)</button>');
  expect(html).toContain('<button type="submit" name="status" value="expired">Hết hạn</button>');
  expect(html).toContain('<button type="submit" name="status" value="canceled">Hủy</button>');
}

/** Một IPN nhận được: header như Tingee (timestamp `yyyyMMddHHmmssSSS` UTC+7, HMAC-SHA512 hex của `timestamp:rawBody`). */
function expectSignedLikeTingee(ipn: Received, credential: Credential): Record<string, unknown> {
  expect(ipn.method).toBe('POST');
  expect(ipn.headers['content-type']).toBe('application/json');
  const timestamp = String(ipn.headers['x-request-timestamp']);
  expect(timestamp).toMatch(/^\d{17}$/);
  // Đọc theo giờ Việt Nam phải ra gần bây giờ (giờ UTC thì lệch 7 tiếng).
  expect(Math.abs(parseTingeeTimestamp(timestamp)!.getTime() - Date.now())).toBeLessThan(30_000);
  const signature = String(ipn.headers['x-signature']);
  expect(signature).toMatch(/^[0-9a-f]{128}$/);
  expect(signature).toBe(sign(timestamp, ipn.body, credential.secretToken));
  return JSON.parse(ipn.body) as Record<string, unknown>;
}

/** Trang (nếu có) và log không lộ secret hay chữ ký của lần gửi nào. */
function expectNoSecrets(html = ''): void {
  const signatures = fake.ipnDeliveries.map((d) => d.ipn.headers['x-signature']);
  for (const secret of [A.secretToken, B.secretToken, ...signatures]) {
    expect(html).not.toContain(secret);
    expect(logs.join('\n')).not.toContain(secret);
  }
}

describe('GET /checkout/:orderId', () => {
  it('form có ô Đường dẫn IPN điền sẵn URL của merchant tạo link và ba nút; merchant chưa có URL → ô trống; link quay về giữ nguyên', async () => {
    const a = await createLink(A, accountA, { returnUrl: 'http://web.tickee.test/orders/X?a=1&b=2' });
    const page = await fetch(a.checkoutUrl);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`Mã Đơn ${a.orderId} · ${a.amount} đồng`);
    expect(html).toContain('href="http://web.tickee.test/orders/X?a=1&amp;b=2"');
    expectForm(html, a.orderId);
    expect(ipnField(html)).toBe(ipnUrlAt('khoa-btc-a'));

    const b = await createLink(B, accountB);
    expect(ipnField(await (await fetch(b.checkoutUrl)).text())).toBe('');
    expect(received).toHaveLength(0);
  });
});

describe('POST /checkout/:orderId: Thanh toán', () => {
  it('success → IPN success ký bằng secret của merchant tạo link tới URL đã nhập; lưu URL vào merchant; 303 về returnUrl', async () => {
    const link = await createLink(B, accountB, { amount: 620_000 });
    const url = ipnUrlAt('khoa-btc-b');

    const res = await press(link.orderId, { ipnUrl: url, status: 'success' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(link.returnUrl);
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe('/v1/payments/tingee/ipn/khoa-btc-b');
    const body = expectSignedLikeTingee(received[0]!, B);
    expect(body).toEqual({
      requestId: expect.stringMatching(UUID_V4),
      orderId: link.orderId,
      amount: 620_000,
      paidAmount: 620_000,
      description: expect.any(String),
      orderInfo: null,
      status: 'success',
      statusCode: '00',
      billId: null,
      customerEmail: expect.any(String),
      paymentMethod: 'qr',
      providerTransactionCode: expect.stringMatching(/^\S+$/),
      paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      merchantId: 29267,
    });
    expect(Math.abs(new Date(String(body.paidAt)).getTime() - Date.now())).toBeLessThan(30_000);
    // Gửi nguyên chuỗi đã ký.
    expect(fake.ipnDeliveries).toHaveLength(1);
    expect(received[0]!.body).toBe(fake.ipnDeliveries[0]!.ipn.body);
    expect(fake.ipnDeliveries[0]).toMatchObject({
      orderId: link.orderId,
      clientId: B.clientId,
      url,
      status: 'success',
      result: { kind: 'replied', httpStatus: 200, body: ACK },
    });
    expect(fake.merchant(B.clientId).ipnUrl).toBe(url);
    // Merchant khác không đổi.
    expect(fake.merchant(A.clientId).ipnUrl).toBe(ipnUrlAt('khoa-btc-a'));

    // Bấm lại: IPN mới (`requestId` mới) của cùng lần trả (Story 4.1: link giữ mã giao dịch, như Tingee gửi lại IPN).
    expect((await press(link.orderId, { ipnUrl: url, status: 'success' })).status).toBe(303);
    const again = expectSignedLikeTingee(received[1]!, B);
    expect(again.providerTransactionCode).toBe(body.providerTransactionCode);
    expect(again.paidAt).toBe(body.paidAt);
    expect(again.requestId).not.toBe(body.requestId);
    expect(fake.order(link.orderId)).toMatchObject({
      status: 'success',
      providerTransactionCode: body.providerTransactionCode,
      paidAmount: 620_000,
    });

    // Link mới của cùng merchant: ô điền sẵn URL đã lưu (tới khi fake khởi động lại).
    const next = await createLink(B, accountB);
    expect(ipnField(await (await fetch(next.checkoutUrl)).text())).toBe(url);
    expectNoSecrets();
  });

  it('link không có returnUrl → 200 trang kết quả (HTTP và body bên nhận), form gửi lại được', async () => {
    const link = await createLink(A, accountA, { returnUrl: null });

    const res = await press(link.orderId, { ipnUrl: ipnUrlAt('khoa-btc-a'), status: 'success' });

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain('Đã gửi IPN success');
    expect(html).toContain('HTTP 200');
    expect(html).toContain('{&quot;code&quot;:&quot;00&quot;,&quot;message&quot;:&quot;Success&quot;}');
    expectForm(html, link.orderId);
    expect(received).toHaveLength(1);
    expectSignedLikeTingee(received[0]!, A);
    expectNoSecrets(html);
  });
});

describe('POST /checkout/:orderId: Hết hạn / Hủy', () => {
  it.each(['expired', 'canceled'])('%s → IPN trạng thái (01, chưa có giao dịch) đã ký; 303 về returnUrl', async (status) => {
    const link = await createLink(A, accountA, { amount: 300_000 });

    const res = await press(link.orderId, { ipnUrl: ipnUrlAt('khoa-btc-a'), status });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(link.returnUrl);
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe('/v1/payments/tingee/ipn/khoa-btc-a');
    expect(expectSignedLikeTingee(received[0]!, A)).toMatchObject({
      requestId: expect.stringMatching(UUID_V4),
      orderId: link.orderId,
      amount: 300_000,
      status,
      statusCode: '01',
      paidAmount: null,
      providerTransactionCode: null,
      paidAt: null,
      paymentMethod: null,
    });
    expect(fake.ipnDeliveries[0]).toMatchObject({ status, result: { kind: 'replied', httpStatus: 200 } });
  });
});

describe('POST /checkout/:orderId: api từ chối', () => {
  it.each([
    [401, '{"error":{"code":"IPN_SIGNATURE_INVALID","message":"Chữ ký <không> hợp lệ"}}', 'api từ chối chữ ký'],
    [404, '{"error":{"code":"NOT_FOUND","message":"Không tìm thấy"}}', 'ipnKey không thuộc BTC nào hoặc đường dẫn sai'],
    [500, 'Internal Server Error', null],
    [302, '', null],
  ])('HTTP %i → 502: trang nêu HTTP status và body api, lại form (URL đã nhập); không chuyển trang, không lưu URL', async (status, body, hint) => {
    const link = await createLink(B, accountB);
    const url = ipnUrlAt('khoa-sai');
    replies.push({ status, body, ...(status === 302 ? { location: 'http://web.tickee.test/' } : {}) });

    const res = await press(link.orderId, { ipnUrl: url, status: 'success' });

    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain(`Bên nhận từ chối IPN success: HTTP ${status}`);
    if (body) expect(html).toContain(body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
    if (hint) expect(html).toContain(hint);
    expectForm(html, link.orderId);
    expect(ipnField(html)).toBe(url);
    // Gửi đúng một lần, không theo redirect.
    expect(received).toHaveLength(1);
    expect(fake.ipnDeliveries[0]).toMatchObject({ url, result: { kind: 'replied', httpStatus: status, body } });
    expect(fake.merchant(B.clientId).ipnUrl).toBeUndefined();
    expectNoSecrets(html);
  });

  it.each([
    ['JSON code khác 00 (vd. chính Tingee fake: 92)', '{"code":"92","message":"Client ID không tồn tại hoặc bị khóa"}'],
    ['không phải JSON', 'OK'],
    ['body rỗng', ''],
    ['JSON không có code', '{"ok":true}'],
  ])('HTTP 200 nhưng không phải ACK của api (%s) → 502, gợi ý trỏ nhầm dịch vụ; không chuyển trang, không lưu URL', async (_name, body) => {
    const link = await createLink(B, accountB);
    const receiverUrl = ipnUrlAt('khoa-nham');
    replies.push({ status: 200, body });

    const res = await press(link.orderId, { ipnUrl: receiverUrl, status: 'success' });

    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain('Bên nhận không trả ACK cho IPN success: HTTP 200');
    expect(html).toContain('không phải ACK của api Tickee');
    if (body) expect(html).toContain(body.replace(/"/g, '&quot;'));
    expectForm(html, link.orderId);
    expect(ipnField(html)).toBe(receiverUrl);
    expect(fake.ipnDeliveries[0]).toMatchObject({ result: { kind: 'replied', httpStatus: 200, body } });
    expect(fake.merchant(B.clientId).ipnUrl).toBeUndefined();
    expectNoSecrets(html);
  });

  it('URL trỏ vào chính Tingee fake (HTTP 200, code 92) → 502, không chuyển trang, không lưu URL', async () => {
    const link = await createLink(B, accountB);
    const url = `${fake.url}/v1/payments/tingee/ipn/khoa`;

    const res = await press(link.orderId, { ipnUrl: url, status: 'success' });

    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).toContain('Bên nhận không trả ACK cho IPN success: HTTP 200');
    expect(fake.ipnDeliveries[0]).toMatchObject({ url, result: { kind: 'replied', httpStatus: 200 } });
    expect(fake.merchant(B.clientId).ipnUrl).toBeUndefined();
  });
});

describe('POST /checkout/:orderId: không tới được', () => {
  it('URL IPN không nghe → 502 lỗi mạng (ECONNREFUSED); không chuyển trang, không lưu URL', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const link = await createLink(B, accountB);
    const url = `http://127.0.0.1:${port}/v1/payments/tingee/ipn/khoa`;

    const res = await press(link.orderId, { ipnUrl: url, status: 'success' });

    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain('Không gửi được IPN success: lỗi mạng (ECONNREFUSED)');
    expectForm(html, link.orderId);
    expect(ipnField(html)).toBe(url);
    expect(fake.ipnDeliveries[0]).toMatchObject({ url, result: { kind: 'failed', reason: 'network', code: 'ECONNREFUSED' } });
    expect(fake.merchant(B.clientId).ipnUrl).toBeUndefined();
    expectNoSecrets(html);
  });

  it('bên nhận không trả lời → 502 timeout sau ipnTimeoutMs (mặc định 10 giây); không chuyển trang', async () => {
    expect(CHECKOUT_IPN_TIMEOUT_MS).toBe(10_000);
    const link = await createLink(A, accountA);
    replies.push('hang');
    const started = Date.now();

    const res = await press(link.orderId, { ipnUrl: ipnUrlAt('khoa-btc-a'), status: 'expired' });

    expect(res.status).toBe(502);
    expect(Date.now() - started).toBeGreaterThanOrEqual(IPN_TIMEOUT_MS - 50);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain(`Không có phản hồi cho IPN expired sau ${IPN_TIMEOUT_MS} ms (timeout)`);
    expect(html).toContain('IPN đã được gửi và có thể api đã xử lý: xem Trang Đơn trước khi bấm lại.');
    expect(html).not.toContain('Không gửi được');
    expectForm(html, link.orderId);
    expect(received).toHaveLength(1);
    expect(fake.ipnDeliveries[0]).toMatchObject({ result: { kind: 'failed', reason: 'timeout' } });
  });
});

describe('POST /checkout/:orderId: đầu vào sai', () => {
  it.each([
    ['URL rỗng', { ipnUrl: '', status: 'success' }, 'Chưa nhập Đường dẫn IPN.'],
    ['URL toàn khoảng trắng', { ipnUrl: '   ', status: 'success' }, 'Chưa nhập Đường dẫn IPN.'],
    ['thiếu ô URL', { status: 'success' }, 'Chưa nhập Đường dẫn IPN.'],
    ['URL không phải http(s)', { ipnUrl: 'ftp://127.0.0.1/ipn', status: 'success' }, 'phải là URL http:// hoặc https://'],
    ['URL thiếu scheme', { ipnUrl: 'localhost:3001/v1/payments/tingee/ipn/k', status: 'success' }, 'phải là URL http'],
    ['không phải URL', { ipnUrl: 'khong phai url', status: 'expired' }, 'phải là URL http'],
    ['status lạ', { ipnUrl: 'http://127.0.0.1:9/ipn', status: 'paid' }, 'Nút lạ'],
    ['status chữ hoa', { ipnUrl: 'http://127.0.0.1:9/ipn', status: 'SUCCESS' }, 'Nút lạ'],
    ['thiếu status', { ipnUrl: 'http://127.0.0.1:9/ipn' }, 'Nút lạ'],
  ])('%s → 400, lại form, không gửi gì', async (_name, form, message) => {
    const link = await createLink(A, accountA);

    const res = await press(link.orderId, form);

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Chưa gửi IPN');
    expect(html).toContain(message);
    expectForm(html, link.orderId);
    expect(received).toHaveLength(0);
    expect(fake.ipnDeliveries).toHaveLength(0);
    expect(fake.merchant(A.clientId).ipnUrl).toBe(ipnUrlAt('khoa-btc-a'));
  });
});

describe('Ô Đường dẫn IPN: escape HTML', () => {
  it('URL có ", & và < được escape trong value: đọc lại đúng nguyên văn, không có " thô trong thẻ input', async () => {
    const link = await createLink(A, accountA);
    const typed = 'http://127.0.0.1:9/ipn?a="x"&b=<y>&c=\'z\'';

    const res = await press(link.orderId, { ipnUrl: typed, status: 'paid' });

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(ipnField(html)).toBe(typed);
    const tag = /<input id="ipnUrl"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toContain('value="http://127.0.0.1:9/ipn?a=&quot;x&quot;&amp;b=&lt;y&gt;&amp;c=&#39;z&#39;"');
    expect(tag).not.toContain('"x"');
    expect(tag).not.toContain('<y>');
    expect(received).toHaveLength(0);
  });
});

describe('Link lạ', () => {
  it('orderId fake chưa tạo link (kể cả mã % hỏng) → 404 cho cả trang lẫn nút; không gửi gì', async () => {
    for (const path of ['/checkout/TKKHONGCO00', '/checkout/%E0%A4%A']) {
      expect((await fetch(`${fake.url}${path}`)).status).toBe(404);
      const res = await fetch(`${fake.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ipnUrl: ipnUrlAt('khoa-btc-a'), status: 'success' }).toString(),
        redirect: 'manual',
      });
      expect(res.status).toBe(404);
    }
    expect(received).toHaveLength(0);
    expect(fake.ipnDeliveries).toHaveLength(0);
  });
});
