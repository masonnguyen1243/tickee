import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ErrorCode } from '@tickee/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { domainErrorOf, HttpTingeeClient, TINGEE_TIMEOUT_MS } from '../../src/modules/tingee/index.js';
import { AppError } from '../../src/platform/http/index.js';
import { startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';

/* Adapter Tingee trên Tingee fake (server HTTP thật): ký, timeout, đổi mã lỗi. Không bao giờ gọi Tingee thật. */

const CLIENT_ID = 'client-test';
const SECRET = 'secret-test-tingee';

let fake: TingeeFake;
let client: HttpTingeeClient;

beforeAll(async () => {
  fake = await startTingeeFake({ clientId: CLIENT_ID, secretToken: SECRET });
  client = new HttpTingeeClient({ baseUrl: fake.url, clientId: CLIENT_ID, secretToken: SECRET, timeoutMs: 500 });
});
beforeEach(() => fake.reset());
afterAll(async () => {
  await fake.close();
});

const va = (accountNumber: string) => ({
  merchantId: 1001,
  bankBin: '970422',
  accountType: 'personal-account' as const,
  accountNumber,
  accountName: 'NGUYEN VAN AN',
  identityNumber: '079203001234',
  phone: '0901234567',
});

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('HttpTingeeClient', () => {
  it('gửi đúng header ký và body; fake xác nhận chữ ký', async () => {
    const { merchantId } = await client.createMerchant({ name: 'CLB Cờ Vua', phone: '0901234567' });
    expect(merchantId).toBeGreaterThan(0);
    const [req] = fake.calls('/v1/merchant/create');
    expect(req).toMatchObject({ clientId: CLIENT_ID, signatureValid: true });
    expect(req?.timestamp).toMatch(/^\d{17}$/);
    // Tên trường theo developers.tingee.vn (Master Merchant → Tạo Merchant).
    expect(req?.body).toEqual({ name: 'CLB Cờ Vua', phoneNumber: '0901234567' });
  });

  it('create-va gửi đúng tên trường của Tingee', async () => {
    await client.createVa(va('0123450000'));
    expect(fake.calls('/v1/create-va')[0]?.body).toEqual({
      merchantId: 1001,
      accountType: 'personal-account',
      bankBin: '970422',
      accountNumber: '0123450000',
      accountName: expect.any(String),
      identity: expect.stringMatching(/^\d{12}$/),
      mobile: expect.stringMatching(/^0\d{9}$/),
      isNotifyAccountNumber: false,
      appType: 'baas',
    });
  });

  it('create-va: liên kết ngay hoặc cần OTP; confirm-va', async () => {
    const linked = await client.createVa(va('0123450000'));
    expect(linked).toMatchObject({ kind: 'linked', vaAccountNumber: expect.any(String) });
    expect(fake.calls('/v1/create-va')[0]?.body).toMatchObject({ isNotifyAccountNumber: false, merchantId: 1001 });

    const otp = await client.createVa(va('0123451111'));
    expect(otp.kind).toBe('otp_required');
    if (otp.kind !== 'otp_required') return;
    const wrong = await errorOf(client.confirmVa({ merchantId: 1001, bankBin: '970422', confirmId: otp.confirmId, otp: '999999' }));
    expect(wrong.code).toBe(ErrorCode.BANK_OTP_INVALID);
    expect(wrong.status).toBe(422);
    const done = await client.confirmVa({ merchantId: 1001, bankBin: '970422', confirmId: otp.confirmId, otp: '123456' });
    expect(done.vaAccountNumber).toMatch(/^\d+$/);
  });

  it('mã lỗi Tingee → lỗi miền', async () => {
    expect((await errorOf(client.createVa(va('0123454343')))).code).toBe(ErrorCode.PAYOUT_ACCOUNT_INVALID);
    const inUse = await errorOf(client.createVa(va('0123458181')));
    expect(inUse.code).toBe(ErrorCode.PAYOUT_ACCOUNT_IN_USE);
    expect(inUse.status).toBe(409);
  });

  it('bảng mã đúng spec; mã lạ → PAYMENT_PROVIDER_UNAVAILABLE', () => {
    const expected: Record<string, string[]> = {
      PAYOUT_ACCOUNT_INVALID: ['400', '1043', '1057', '1083', '1084', '1130', '1011'],
      BANK_NOT_SUPPORTED: ['1021', '1041', '1051', '1059', '1063'],
      PAYOUT_ACCOUNT_IN_USE: ['1022', '1048', '1049', '1081'],
      BANK_OTP_INVALID: ['1078', '1134'],
      BANK_OTP_EXPIRED: ['1065', '1080', '1098'],
      MERCHANT_SUSPENDED: ['1007', '1034'],
      PAYMENT_PROVIDER_UNAVAILABLE: ['500', '1001', '1102', '1131', '9999', '97', '92'],
    };
    for (const [domain, codes] of Object.entries(expected)) {
      for (const code of codes) expect(domainErrorOf(code), code).toBe(domain);
    }
  });

  it('timeout → PAYMENT_PROVIDER_UNAVAILABLE (503); mặc định 15 giây', async () => {
    expect(TINGEE_TIMEOUT_MS).toBe(15_000);
    const started = Date.now();
    const err = await errorOf(client.createVa(va('0123455000')));
    expect(err.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
    expect(err.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('sai secret → fake từ chối → PAYMENT_PROVIDER_UNAVAILABLE; lỗi mạng cũng vậy', async () => {
    const wrongSecret = new HttpTingeeClient({ baseUrl: fake.url, clientId: CLIENT_ID, secretToken: 'sai' });
    expect((await errorOf(wrongSecret.createMerchant({ name: 'A', phone: '0901234567' }))).code).toBe(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    );
    expect(fake.requests.at(-1)?.signatureValid).toBe(false);
    const down = new HttpTingeeClient({ baseUrl: 'http://127.0.0.1:1', clientId: CLIENT_ID, secretToken: SECRET });
    expect((await errorOf(down.createMerchant({ name: 'A', phone: '0901234567' }))).code).toBe(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    );
  });

  it('timestamp quá cũ bị fake từ chối', async () => {
    const old = new HttpTingeeClient({
      baseUrl: fake.url,
      clientId: CLIENT_ID,
      secretToken: SECRET,
      now: () => new Date(Date.now() - 11 * 60 * 1000),
    });
    expect((await errorOf(old.createMerchant({ name: 'A', phone: '0901234567' }))).code).toBe(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    );
  });
});

describe('phản hồi sai dạng → PAYMENT_PROVIDER_UNAVAILABLE', () => {
  /** Server một lần: trả đúng `status` + `body` thô cho mọi request. */
  async function withServer(status: number, body: string, run: (c: HttpTingeeClient) => Promise<void>) {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(new HttpTingeeClient({ baseUrl: `http://127.0.0.1:${port}`, clientId: CLIENT_ID, secretToken: SECRET }));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  const confirmInput = { merchantId: 1001, bankBin: '970422', confirmId: 'c-1', otp: '123456' };
  const unavailable = async (promise: Promise<unknown>) =>
    expect((await errorOf(promise)).code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);

  it.each([
    ['create-va {code:00, data:{}}', 200, JSON.stringify({ code: '00', data: {} })],
    ['create-va {code:00, data:{confirmId:null}}', 200, JSON.stringify({ code: '00', data: { confirmId: null } })],
    ['create-va VA null', 200, JSON.stringify({ code: '00', data: { vaAccountNumber: null } })],
    ['body không phải JSON', 200, '<html>lỗi</html>'],
    ['HTTP 502', 502, JSON.stringify({ code: '00', data: { vaAccountNumber: '9600000001' } })],
  ])('%s', async (_name, status, body) => {
    await withServer(status, body, (c) => unavailable(c.createVa(va('0123450000'))));
  });

  it('confirm-va {code:00, data:{}}', async () => {
    await withServer(200, JSON.stringify({ code: '00', data: {} }), (c) => unavailable(c.confirmVa(confirmInput)));
  });

  it('số VA dạng số được nhận và đổi sang chuỗi', async () => {
    await withServer(200, JSON.stringify({ code: '00', data: { vaAccountNumber: 9600000001 } }), async (c) => {
      expect(await c.confirmVa(confirmInput)).toEqual({ vaAccountNumber: '9600000001', shopId: null });
    });
  });
});
