import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreateLinkError,
  domainErrorOf,
  HttpTingeeClient,
  parseGatewayTimestamp,
  TINGEE_ACCOUNT_PAGE_SIZE,
  TINGEE_CREATE_LINK_PATH,
  TINGEE_PAYMENT_LINK_TIMEOUT_MS,
  TINGEE_TIMEOUT_MS,
  tingeePortalUrl,
  type PaymentLinkInput,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { AppError } from '../../src/platform/http/index.js';
import {
  CREATE_LINK_PATH,
  fakeAccount,
  startTingeeFake,
  type FakeAccount,
  type TingeeFake,
} from '../tingee-fake/server.js';

/*
 * Adapter Tingee trên Tingee fake (server HTTP thật, nhiều merchant): ký bằng credential của từng BTC, timeout, đổi mã
 * lỗi, lọc danh sách tài khoản; `create-link` của Cổng thanh toán (Story 3.4): timestamp UNIX ms, timeout riêng, phân
 * loại rõ ràng/mơ hồ. Không bao giờ gọi Tingee thật.
 */

const A: TingeeCredential = { clientId: 'btc-a-client', secretToken: 'btc-a-secret-0123456789' };
const B: TingeeCredential = { clientId: 'btc-b-client', secretToken: 'btc-b-secret-9876543210' };
const SUSPENDED: TingeeCredential = { clientId: 'btc-suspended', secretToken: 'secret-suspended' };
const FORBIDDEN: TingeeCredential = { clientId: 'btc-forbidden', secretToken: 'secret-forbidden' };
const BROKEN: TingeeCredential = { clientId: 'btc-error', secretToken: 'secret-error' };
const HANGING: TingeeCredential = { clientId: 'btc-hang', secretToken: 'secret-hang' };

const mb = fakeAccount({ bankName: 'MB Bank', bankBin: '970422', accountName: 'NGUYEN VAN AN' });
const vietin = fakeAccount({ bankName: 'VietinBank', bankBin: '970415', accountName: 'TRAN THI BINH' });
const inactive = fakeAccount({ status: 'inactive' });
const debitOnly = fakeAccount({ transactionType: 'debit' });
const vcb = fakeAccount({ bankName: 'Vietcombank', bankBin: '970436', accountType: 'business-account' });

let fake: TingeeFake;
let client: HttpTingeeClient;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...A, accounts: [mb, vietin, inactive, debitOnly] },
      { ...B, accounts: [vcb] },
      { ...SUSPENDED, accounts: [], behavior: 'suspended' },
      { ...FORBIDDEN, accounts: [], behavior: 'forbidden' },
      { ...BROKEN, accounts: [], behavior: 'error' },
      { ...HANGING, accounts: [], behavior: 'hang' },
    ],
  });
  client = new HttpTingeeClient({ baseUrl: fake.url, timeoutMs: 500 });
});
beforeEach(() => fake.reset());
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await fake.close();
});

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('HttpTingeeClient.listAccounts', () => {
  it('ký bằng credential của BTC; body đúng, không có merchantId; x-client-id là Client ID của BTC', async () => {
    await client.listAccounts(A);
    const [req] = fake.calls('/v1/get-va-paging');
    expect(req).toMatchObject({ clientId: A.clientId, signatureValid: true });
    expect(req?.timestamp).toMatch(/^\d{17}$/);
    expect(req?.body).toEqual({ skipCount: 0, maxResultCount: TINGEE_ACCOUNT_PAGE_SIZE });
    expect(req?.body).not.toHaveProperty('merchantId');
    expect(TINGEE_ACCOUNT_PAGE_SIZE).toBe(200);
  });

  it('chỉ tài khoản active, bỏ dòng debit; chỉ 4 số cuối, không có số tài khoản đầy đủ', async () => {
    const accounts = await client.listAccounts(A);
    expect(accounts).toEqual([
      {
        vaAccountNumber: mb.vaAccountNumber,
        bankBin: '970422',
        bankName: 'MB Bank',
        accountType: 'personal-account',
        accountLast4: String(mb.accountNumber).slice(-4),
        accountName: 'NGUYEN VAN AN',
        shopId: mb.shopId,
      },
      expect.objectContaining({ vaAccountNumber: vietin.vaAccountNumber, bankBin: '970415' }),
    ]);
    const text = JSON.stringify(accounts);
    for (const row of [mb, vietin]) expect(text).not.toContain(String(row.accountNumber));
  });

  it('mỗi cặp key một danh sách', async () => {
    const accounts = await client.listAccounts(B);
    expect(accounts.map((a) => a.vaAccountNumber)).toEqual([vcb.vaAccountNumber]);
    expect(accounts[0]?.accountType).toBe('business-account');
    expect(fake.requests.at(-1)?.clientId).toBe(B.clientId);
  });

  it.each([
    ['Client ID lạ (92)', { clientId: 'khong-co', secretToken: A.secretToken }],
    ['Secret Token sai (97)', { clientId: A.clientId, secretToken: 'sai' }],
    ['secret của BTC khác (97)', { clientId: A.clientId, secretToken: B.secretToken }],
    ['key thiếu quyền (1133)', FORBIDDEN],
  ])('%s → 422 TINGEE_CREDENTIAL_INVALID', async (_name, credential) => {
    const err = await errorOf(client.listAccounts(credential));
    expect(err.code).toBe(ErrorCode.TINGEE_CREDENTIAL_INVALID);
    expect(err.status).toBe(422);
    expect(err.message).toBe('Client ID hoặc Secret Token không đúng.');
  });

  it('merchant bị khóa (1007) → 409 MERCHANT_SUSPENDED', async () => {
    const err = await errorOf(client.listAccounts(SUSPENDED));
    expect(err.code).toBe(ErrorCode.MERCHANT_SUSPENDED);
    expect(err.status).toBe(409);
  });

  it('HTTP 500 → 503 PAYMENT_PROVIDER_UNAVAILABLE', async () => {
    const err = await errorOf(client.listAccounts(BROKEN));
    expect(err.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
    expect(err.status).toBe(503);
    expect(err.message).toBe('Tingee tạm lỗi, thử lại sau ít phút.');
  });

  it('timeout → PAYMENT_PROVIDER_UNAVAILABLE (503); mặc định 15 giây', async () => {
    expect(TINGEE_TIMEOUT_MS).toBe(15_000);
    const started = Date.now();
    const err = await errorOf(client.listAccounts(HANGING));
    expect(err.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('lỗi mạng và timestamp lệch giờ (91) → PAYMENT_PROVIDER_UNAVAILABLE, không phải key sai', async () => {
    const down = new HttpTingeeClient({ baseUrl: 'http://127.0.0.1:1' });
    expect((await errorOf(down.listAccounts(A))).code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
    const old = new HttpTingeeClient({ baseUrl: fake.url, now: () => new Date(Date.now() - 11 * 60 * 1000) });
    expect((await errorOf(old.listAccounts(A))).code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
  });

  it('bảng mã đúng spec (dùng chung với create-link); mã lạ → PAYMENT_PROVIDER_UNAVAILABLE', () => {
    const expected: Record<string, string[]> = {
      TINGEE_CREDENTIAL_INVALID: ['92', '97', '1009', '1133'],
      MERCHANT_SUSPENDED: ['1007', '1033', '1034'],
      PAYMENT_ACCOUNT_NOT_ALLOWED: ['2023', '1023', '1045', '1024', '1072'],
      PAYMENT_PROVIDER_UNAVAILABLE: ['90', '91', '400', '500', '1001', '1006', '1043', '9999'],
    };
    for (const [domain, codes] of Object.entries(expected)) {
      for (const code of codes) expect(domainErrorOf(code), code).toBe(domain);
    }
  });

  it('VA chưa được cho phép (2023) khi đọc danh sách → 409 PAYMENT_ACCOUNT_NOT_ALLOWED', async () => {
    await withServerOnce(200, JSON.stringify({ code: '2023', message: 'x' }), async (c) => {
      const err = await errorOf(c.listAccounts(A));
      expect(err.code).toBe(ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED);
      expect(err.status).toBe(409);
    });
  });
});

/** Server một lần: trả đúng `status` + `body` thô cho mọi request. */
async function withServerOnce(status: number, body: string, run: (c: HttpTingeeClient) => Promise<void>) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(new HttpTingeeClient({ baseUrl: `http://127.0.0.1:${port}` }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('phản hồi sai dạng', () => {
  const withServer = withServerOnce;
  const page = (items: unknown[]) => JSON.stringify({ code: '00', data: { totalCount: items.length, items } });

  it.each([
    ['data rỗng', 200, JSON.stringify({ code: '00', data: {} })],
    ['items không phải mảng', 200, JSON.stringify({ code: '00', data: { items: 'x' } })],
    ['body không phải JSON', 200, '<html>lỗi</html>'],
    ['HTTP 502 dù code 00', 502, page([fakeAccount()])],
  ])('%s → PAYMENT_PROVIDER_UNAVAILABLE', async (_name, status, body) => {
    await withServer(status, body, async (c) => {
      expect((await errorOf(c.listAccounts(A))).code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
    });
  });

  it('mã key sai đi kèm HTTP 401 vẫn là TINGEE_CREDENTIAL_INVALID', async () => {
    await withServer(401, JSON.stringify({ code: '92', message: 'x' }), async (c) => {
      expect((await errorOf(c.listAccounts(A))).code).toBe(ErrorCode.TINGEE_CREDENTIAL_INVALID);
    });
  });

  it('dòng sai dạng bị bỏ và log số dòng bị bỏ (không log nội dung); số dạng số đổi sang chuỗi', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const good: FakeAccount = fakeAccount({ vaAccountNumber: 9600000001, bankBin: 970422, shopId: 'khong-phai-so' });
    const missingVa = fakeAccount({ vaAccountNumber: null });
    const emptyName = fakeAccount({ accountName: '' });
    await withServer(200, page([good, missingVa, emptyName, 'rac']), async (c) => {
      const accounts = await c.listAccounts(A);
      expect(accounts).toEqual([
        expect.objectContaining({ vaAccountNumber: '9600000001', bankBin: '970422', shopId: null }),
      ]);
    });
    expect(warn).toHaveBeenCalledWith({ path: '/v1/get-va-paging', skipped: 3 }, expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(String(missingVa.accountNumber));
  });
});

describe('HttpTingeeClient.createPaymentLink (Story 3.4)', () => {
  const input = (overrides: Partial<PaymentLinkInput> = {}): PaymentLinkInput => ({
    orderId: 'TK8F3Q2AXM',
    amount: 600_000,
    vaAccountNumber: String(mb.vaAccountNumber),
    expireInMinute: 15,
    returnUrl: 'http://web.tickee.test/orders/TK8F3Q2AXM',
    description: 'Thanh toán Đơn TK8F3Q2AXM',
    ...overrides,
  });

  async function linkErrorOf(promise: Promise<unknown>): Promise<CreateLinkError> {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CreateLinkError);
    return err as CreateLinkError;
  }

  beforeEach(() => {
    fake.merchant(A.clientId).linkReplies = [];
  });

  it('đúng đường dẫn và body (requestId uuid v4 mới mỗi lần, không merchantId/customerEmail); UNIX ms; ký đúng', async () => {
    expect(TINGEE_CREATE_LINK_PATH).toBe(CREATE_LINK_PATH);
    const before = Date.now();
    const url = await client.createPaymentLink(A, input());
    await client.createPaymentLink(A, input());
    const [first, second] = fake.calls(CREATE_LINK_PATH);
    expect(first).toMatchObject({ clientId: A.clientId, signatureValid: true });
    expect(first!.timestamp).toMatch(/^\d{13}$/);
    const sentAt = parseGatewayTimestamp(first!.timestamp!)!.getTime();
    expect(sentAt).toBeGreaterThanOrEqual(before);
    expect(sentAt).toBeLessThanOrEqual(Date.now());
    expect(first!.body).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      orderId: 'TK8F3Q2AXM',
      amount: 600_000,
      vaAccountNumber: String(mb.vaAccountNumber),
      expireInMinute: 15,
      returnUrl: 'http://web.tickee.test/orders/TK8F3Q2AXM',
      description: 'Thanh toán Đơn TK8F3Q2AXM',
    });
    expect(Object.keys(first!.body)).toEqual([
      'requestId',
      'orderId',
      'amount',
      'vaAccountNumber',
      'expireInMinute',
      'returnUrl',
      'description',
    ]);
    expect(second!.body.requestId).not.toBe(first!.body.requestId);
    expect(url).toBe(`${fake.url}/checkout/TK8F3Q2AXM?r=${String(first!.body.requestId)}`);
  });

  it('fake: checkout URL mở trang thanh toán giả có link quay về returnUrl (dev local)', async () => {
    const url = await client.createPaymentLink(A, input({ returnUrl: 'http://web.tickee.test/orders/TK8F3Q2AXM?a=1&b=2' }));
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Mã Đơn TK8F3Q2AXM');
    expect(html).toContain('href="http://web.tickee.test/orders/TK8F3Q2AXM?a=1&amp;b=2"');
    expect((await fetch(`${fake.url}/checkout/TKKHONGCO00`)).status).toBe(404);
  });

  it('timeout riêng 5 giây (mặc định), tách khỏi timeout 15 giây của API Tài khoản', () => {
    expect(TINGEE_PAYMENT_LINK_TIMEOUT_MS).toBe(5_000);
    expect(TINGEE_TIMEOUT_MS).toBe(15_000);
  });

  it.each([
    ['92', 'TINGEE_CREDENTIAL_INVALID'],
    ['97', 'TINGEE_CREDENTIAL_INVALID'],
    ['1009', 'TINGEE_CREDENTIAL_INVALID'],
    ['1133', 'TINGEE_CREDENTIAL_INVALID'],
    ['1007', 'MERCHANT_SUSPENDED'],
    ['1033', 'MERCHANT_SUSPENDED'],
    ['1034', 'MERCHANT_SUSPENDED'],
    ['2023', 'PAYMENT_ACCOUNT_NOT_ALLOWED'],
    ['1023', 'PAYMENT_ACCOUNT_NOT_ALLOWED'],
    ['1045', 'PAYMENT_ACCOUNT_NOT_ALLOWED'],
    ['1024', 'PAYMENT_ACCOUNT_NOT_ALLOWED'],
    ['1072', 'PAYMENT_ACCOUNT_NOT_ALLOWED'],
    ['1006', 'PAYMENT_PROVIDER_UNAVAILABLE'],
    ['90', 'PAYMENT_PROVIDER_UNAVAILABLE'],
  ])('HTTP 200 + mã %s → rejected, %s, kèm mã Tingee', async (code, domain) => {
    fake.merchant(A.clientId).linkReplies = [{ code }];
    const err = await linkErrorOf(client.createPaymentLink(A, input()));
    expect(err).toMatchObject({ outcome: 'rejected', code: domain, tingeeCode: code, reason: null, httpStatus: 200 });
    expect(err).toBeInstanceOf(AppError);
  });

  it('key thật sai (fake tự kiểm) → rejected 92 / 97; VA không phải tài khoản active của merchant → rejected 2023', async () => {
    expect(await linkErrorOf(client.createPaymentLink({ ...A, clientId: 'khong-co' }, input()))).toMatchObject({
      outcome: 'rejected',
      tingeeCode: '92',
    });
    expect(await linkErrorOf(client.createPaymentLink({ ...A, secretToken: 'sai' }, input()))).toMatchObject({
      outcome: 'rejected',
      tingeeCode: '97',
    });
    const notAllowed = await linkErrorOf(
      client.createPaymentLink(A, input({ vaAccountNumber: String(inactive.vaAccountNumber) })),
    );
    expect(notAllowed).toMatchObject({ outcome: 'rejected', code: 'PAYMENT_ACCOUNT_NOT_ALLOWED', tingeeCode: '2023' });
  });

  it('merchant bị khóa / thiếu quyền (behavior của fake) → rejected', async () => {
    expect(await linkErrorOf(client.createPaymentLink(SUSPENDED, input()))).toMatchObject({
      outcome: 'rejected',
      code: 'MERCHANT_SUSPENDED',
    });
    expect(await linkErrorOf(client.createPaymentLink(FORBIDDEN, input()))).toMatchObject({
      outcome: 'rejected',
      code: 'TINGEE_CREDENTIAL_INVALID',
      tingeeCode: '1133',
    });
  });

  it.each([
    ['HTTP 500', { code: '500', httpStatus: 500 }, 'http_status', 500, '500'],
    ['HTTP 401 dù có mã key sai', { code: '92', httpStatus: 401 }, 'http_status', 401, '92'],
    ['HTTP 201 dù code 00', { code: '00', httpStatus: 201, data: 'https://pay.tingee.vn/x' }, 'http_status', 201, '00'],
    ['00 mà data rỗng', { code: '00' }, 'invalid_response', 200, '00'],
    ['00 mà data không phải URL', { code: '00', data: 'khong-phai-url' }, 'invalid_response', 200, '00'],
    ['00 mà data là javascript:', { code: '00', data: 'javascript:alert(1)' }, 'invalid_response', 200, '00'],
    ['00 mà data là object', { code: '00', data: { url: 'https://pay.tingee.vn/x' } }, 'invalid_response', 200, '00'],
  ])('%s → ambiguous (%s), kèm HTTP status và mã gốc để log', async (_name, reply, reason, httpStatus, tingeeCode) => {
    fake.merchant(A.clientId).linkReplies = [reply];
    const err = await linkErrorOf(client.createPaymentLink(A, input()));
    expect(err).toMatchObject({ outcome: 'ambiguous', code: 'PAYMENT_PROVIDER_UNAVAILABLE', reason, httpStatus, tingeeCode });
  });

  it.each([
    ['code null', { code: null, message: 'x' }],
    ['thiếu code', { message: 'x', data: 'https://pay.tingee.vn/x' }],
    ['code rỗng', { code: '', message: 'x' }],
    ['code là object', { code: { value: '1006' } }],
    ['code là boolean', { code: false }],
    ['body là mảng', [{ code: '1006' }]],
  ])('HTTP 200 mà %s → ambiguous invalid_response (không bao giờ là từ chối rõ ràng để trả lượt)', async (_name, body) => {
    await withServerOnce(200, JSON.stringify(body), async (c) => {
      const err = await linkErrorOf(c.createPaymentLink(A, input()));
      expect(err).toMatchObject({ outcome: 'ambiguous', reason: 'invalid_response', httpStatus: 200, tingeeCode: null });
    });
  });

  it('code dạng số → so như chuỗi (1006 → rejected; 0 khác "00" → rejected)', async () => {
    await withServerOnce(200, JSON.stringify({ code: 1006 }), async (c) => {
      expect(await linkErrorOf(c.createPaymentLink(A, input()))).toMatchObject({ outcome: 'rejected', tingeeCode: '1006' });
    });
  });

  it('treo → ambiguous timeout theo timeout của create-link (không phải 15 giây)', async () => {
    const quick = new HttpTingeeClient({ baseUrl: fake.url, timeoutMs: 60_000, paymentLinkTimeoutMs: 300 });
    fake.merchant(A.clientId).linkReplies = ['hang'];
    const started = Date.now();
    const err = await linkErrorOf(quick.createPaymentLink(A, input()));
    expect(err).toMatchObject({ outcome: 'ambiguous', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await linkErrorOf(quick.createPaymentLink(HANGING, input()))).toMatchObject({ reason: 'timeout' });
  });

  it('lỗi mạng, JSON hỏng → ambiguous', async () => {
    const down = new HttpTingeeClient({ baseUrl: 'http://127.0.0.1:1' });
    expect(await linkErrorOf(down.createPaymentLink(A, input()))).toMatchObject({
      outcome: 'ambiguous',
      reason: 'network',
      httpStatus: null,
      tingeeCode: null,
    });
    await withServerOnce(200, '<html>lỗi</html>', async (c) => {
      expect(await linkErrorOf(c.createPaymentLink(A, input()))).toMatchObject({ reason: 'invalid_json', httpStatus: 200 });
    });
  });

  it('timestamp sai định dạng của nhóm API → fake trả 90 (create-link cần UNIX ms, get-va-paging cần yyyyMMdd…)', async () => {
    // Gửi tay để kiểm luật của fake: create-link với timestamp kiểu API Tài khoản.
    const res = await fetch(new URL(CREATE_LINK_PATH, fake.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': A.clientId, 'x-request-timestamp': '20261110080000000' },
      body: '{}',
    });
    expect(((await res.json()) as { code: string }).code).toBe('90');
  });
});

describe('tingeePortalUrl', () => {
  it('UAT → portal UAT; còn lại (kể cả fake) → portal thật', () => {
    expect(tingeePortalUrl('https://uat-open-api.tingee.vn')).toBe('https://uat-baas-portal.tingee.vn');
    expect(tingeePortalUrl('https://open-api.tingee.vn')).toBe('https://baas.tingee.vn');
    expect(tingeePortalUrl('http://localhost:4010')).toBe('https://baas.tingee.vn');
  });
});
