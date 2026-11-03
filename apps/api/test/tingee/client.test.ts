import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  domainErrorOf,
  HttpTingeeClient,
  TINGEE_ACCOUNT_PAGE_SIZE,
  TINGEE_TIMEOUT_MS,
  tingeePortalUrl,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { AppError } from '../../src/platform/http/index.js';
import { fakeAccount, startTingeeFake, type FakeAccount, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Adapter Tingee trên Tingee fake (server HTTP thật, nhiều merchant): ký bằng credential của từng BTC, timeout, đổi mã
 * lỗi, lọc danh sách tài khoản. Không bao giờ gọi Tingee thật.
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

  it('bảng mã đúng spec; mã lạ → PAYMENT_PROVIDER_UNAVAILABLE', () => {
    const expected: Record<string, string[]> = {
      TINGEE_CREDENTIAL_INVALID: ['92', '97', '1133'],
      MERCHANT_SUSPENDED: ['1007', '1034'],
      PAYMENT_PROVIDER_UNAVAILABLE: ['90', '91', '400', '500', '1001', '1043', '9999'],
    };
    for (const [domain, codes] of Object.entries(expected)) {
      for (const code of codes) expect(domainErrorOf(code), code).toBe(domain);
    }
  });
});

describe('phản hồi sai dạng', () => {
  /** Server một lần: trả đúng `status` + `body` thô cho mọi request. */
  async function withServer(status: number, body: string, run: (c: HttpTingeeClient) => Promise<void>) {
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

describe('tingeePortalUrl', () => {
  it('UAT → portal UAT; còn lại (kể cả fake) → portal thật', () => {
    expect(tingeePortalUrl('https://uat-open-api.tingee.vn')).toBe('https://uat-baas-portal.tingee.vn');
    expect(tingeePortalUrl('https://open-api.tingee.vn')).toBe('https://baas.tingee.vn');
    expect(tingeePortalUrl('http://localhost:4010')).toBe('https://baas.tingee.vn');
  });
});
