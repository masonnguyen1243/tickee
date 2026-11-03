import {
  ErrorResponse,
  PayoutAccount,
  PayoutAccountOptions,
  PayoutAccountOverview,
  Role,
  StatusNoticeList,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { payoutAccountSettings } from '../../src/modules/organizer/payout-account.service.js';
import {
  HttpTingeeClient,
  TINGEE_CLIENT,
  type TingeeClient,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { TEST_CREDENTIAL_KEYS, testCredentialKey } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { fakeAccount, startTingeeFake, type FakeAccount, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 2.6: BTC kết nối API key Tingee của mình, thêm một hay nhiều tài khoản nhận tiền, đặt mặc định và hủy liên
 * kết, trên Tingee fake (server HTTP thật, nhiều merchant) và Postgres thật. Tingee luôn được gọi ngoài transaction;
 * mỗi lần ghi là một transaction riêng có audit; tối đa một credential hiện hành mỗi BTC, mỗi VA hiện hành tối đa một
 * lần mỗi BTC, còn tài khoản thì đúng một tài khoản mặc định. Không bao giờ gọi Tingee thật.
 */

const MAIN: TingeeCredential = { clientId: 'tg-client-main-0a1b2c3d', secretToken: 'tg-secret-main-Zx9Yw8Vu7' };
const OTHER: TingeeCredential = { clientId: 'tg-client-other-4e5f6a7b', secretToken: 'tg-secret-other-Ts6Rq5Po4' };
const EMPTY: TingeeCredential = { clientId: 'tg-client-empty-8c9d0e1f', secretToken: 'tg-secret-empty-Nm3Lk2Ji1' };
const SUSPENDED: TingeeCredential = { clientId: 'tg-client-suspended-01', secretToken: 'tg-secret-suspended-Hg0' };
const FORBIDDEN: TingeeCredential = { clientId: 'tg-client-forbidden-02', secretToken: 'tg-secret-forbidden-Fe9' };
const BROKEN: TingeeCredential = { clientId: 'tg-client-broken-03', secretToken: 'tg-secret-broken-Dc8' };
const HANGING: TingeeCredential = { clientId: 'tg-client-hanging-04', secretToken: 'tg-secret-hanging-Ba7' };
const SECRETS = [MAIN, OTHER, EMPTY, SUSPENDED, FORBIDDEN, BROKEN, HANGING].map((c) => c.secretToken);
/** Timeout ngắn để kịch bản "treo" không làm test chậm (mặc định thật là 15 giây). */
const TIMEOUT_MS = 1_500;
const IPN_PREFIX = 'http://api.tickee.test/v1/payments/tingee/ipn/';

let fake: TingeeFake;
let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
/** Danh sách của MAIN ở test hiện tại: MB (chọn được), VietinBank (mờ), BIDV `inactive` (không hiện). */
let mb: FakeAccount;
let vietin: FakeAccount;
let inactive: FakeAccount;
/** Mọi số tài khoản đầy đủ đã cho fake trả về (không được xuất hiện trong log, response hay DB). */
const accountNumbers: string[] = [];
/** Mọi response body của api trong file này. */
const responses: string[] = [];
/** Chữ ký (`x-signature`) của mọi request tới fake trong file này (gom trước mỗi lần `reset`). */
const signatures: string[] = [];
const resetFake = () => {
  signatures.push(...fake.requests.map((r) => r.signature));
  fake.reset();
};

/** Chạy một lần sau lời gọi Tingee kế tiếp (trước khi service đi tiếp): chen thao tác của "tab khác" vào giữa. */
let afterNextList: (() => Promise<void>) | null = null;

function trackedAccount(overrides: FakeAccount = {}): FakeAccount {
  const account = fakeAccount(overrides);
  accountNumbers.push(String(account.accountNumber));
  return account;
}

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [] },
      { ...OTHER, accounts: [] },
      { ...EMPTY, accounts: [] },
      { ...SUSPENDED, accounts: [], behavior: 'suspended' },
      { ...FORBIDDEN, accounts: [], behavior: 'forbidden' },
      { ...BROKEN, accounts: [], behavior: 'error' },
      { ...HANGING, accounts: [], behavior: 'hang' },
    ],
  });
  const http = new HttpTingeeClient({ baseUrl: fake.url, timeoutMs: TIMEOUT_MS });
  const client: TingeeClient = {
    async listAccounts(credential) {
      const accounts = await http.listAccounts(credential);
      const hook = afterNextList;
      afterNextList = null;
      if (hook) await hook();
      return accounts;
    },
  };
  h = await createHarness({ TINGEE_BASE_URL: fake.url }, { overrides: [{ provide: TINGEE_CLIENT, useValue: client }] });
  owner = await signUp(h);
  admin = await signUp(h);
});
beforeEach(async () => {
  resetFake();
  afterNextList = null;
  mb = trackedAccount({ bankName: 'MB Bank', bankBin: '970422', accountName: 'CLB CO VUA QUAN 3' });
  vietin = trackedAccount({ bankName: 'VietinBank', bankBin: '970415', accountName: 'NGUYEN VAN AN' });
  inactive = trackedAccount({ bankName: 'BIDV', bankBin: '970418', status: 'inactive' });
  fake.merchant(MAIN.clientId).accounts = [mb, vietin, inactive];
  fake.merchant(OTHER.clientId).accounts = [trackedAccount({ bankName: 'Vietcombank', bankBin: '970436' })];
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Cờ Vua' }).expect(201)).body
    .id as string;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

async function tracked(req: PromiseLike<Response>): Promise<Response> {
  const res = await req;
  responses.push(res.text);
  return res;
}

const base = (org = orgId) => `/v1/orgs/${org}/payout-account`;
const connect = (credential: TingeeCredential | Record<string, unknown>, cookie = owner.cookie, harness = h) =>
  tracked(harness.http.post(`${base()}/credential`).set('cookie', cookie).send(credential));
const options = (cookie = owner.cookie, harness = h) => tracked(harness.http.get(`${base()}/options`).set('cookie', cookie));
const select = (vaAccountNumber: unknown, cookie = owner.cookie, harness = h) =>
  tracked(harness.http.post(base()).set('cookie', cookie).send({ vaAccountNumber }));
const unlink = (accountId: string, cookie = owner.cookie) =>
  tracked(h.http.delete(`${base()}/${accountId}`).set('cookie', cookie));
const setDefault = (accountId: string, cookie = owner.cookie) =>
  tracked(h.http.post(`${base()}/${accountId}/default`).set('cookie', cookie));
/** Thêm tài khoản `account` (fake) và trả tài khoản đã lưu. */
const link = async (account: FakeAccount) =>
  PayoutAccount.parse(expectOk(await select(String(account.vaAccountNumber))));
const overview = async (harness = h) =>
  PayoutAccountOverview.parse((await tracked(harness.http.get(base()).set('cookie', owner.cookie))).body);

function expectOk(res: Response) {
  expect(res.status, res.text).toBe(200);
  return res.body as unknown;
}

function expectError(res: Response, status: number, code: string) {
  expect(res.status, res.text).toBe(status);
  const { error } = ErrorResponse.parse(res.body);
  expect(error.code).toBe(code);
  return error;
}

async function noticeCodes(cookie: string): Promise<string[]> {
  const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', cookie).expect(200);
  return StatusNoticeList.parse(res.body).map((n) => n.code);
}

async function credentialRows() {
  const result = await h.db.orm.execute<{
    id: string;
    client_id: string;
    secret_token_ciphertext: string;
    retired_at: Date | null;
  }>(
    sql`SELECT id, client_id, secret_token_ciphertext, retired_at FROM tingee_credentials
        WHERE organization_id = ${orgId} ORDER BY created_at, id`,
  );
  return result.rows;
}

async function accountRows() {
  const result = await h.db.orm.execute(
    sql`SELECT * FROM payout_accounts WHERE organization_id = ${orgId} ORDER BY linked_at, id`,
  );
  return result.rows as Record<string, unknown>[];
}

/** Mỗi BTC: còn tài khoản hiện hành thì đúng một tài khoản mặc định; dòng đã hủy không bao giờ là mặc định. */
async function expectOneDefault() {
  const rows = await accountRows();
  const current = rows.filter((r) => r.retired_at === null);
  expect(current.filter((r) => r.is_default === true)).toHaveLength(current.length > 0 ? 1 : 0);
  expect(rows.filter((r) => r.retired_at !== null && r.is_default === true)).toEqual([]);
}

/** `[VA, isDefault]` của các tài khoản trong tổng quan, theo thứ tự trả về. */
const summary = (view: { accounts: { vaAccountNumber: string; isDefault: boolean }[] }) =>
  view.accounts.map((a) => [a.vaAccountNumber, a.isDefault]);

async function ipnKey(): Promise<string | null> {
  const result = await h.db.orm.execute<{ tingee_ipn_key: string | null }>(
    sql`SELECT tingee_ipn_key FROM organizations WHERE id = ${orgId}`,
  );
  return result.rows[0]?.tingee_ipn_key ?? null;
}

async function audits() {
  const result = await h.db.orm.execute<{ action: string; target_type: string; changed_fields: string[] }>(
    sql`SELECT action, target_type, changed_fields FROM audit_events
        WHERE organization_id = ${orgId} AND action NOT IN ('organization.created') ORDER BY id`,
  );
  return result.rows;
}

const box = new SecretBox(parseCredentialKeys(TEST_CREDENTIAL_KEYS));

describe('chưa kết nối Tingee', () => {
  it('overview rỗng, chưa có URL IPN; Owner và Admin cùng thấy PAYOUT_ACCOUNT_NOT_LINKED (danger, không đóng được)', async () => {
    expect(await overview()).toEqual({
      credential: null,
      accounts: [],
      canReplaceKey: true,
      ipnUrl: null,
      tingeePortalUrl: 'https://baas.tingee.vn',
    });
    const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', admin.cookie).expect(200);
    const notice = StatusNoticeList.parse(res.body).find((n) => n.code === 'PAYOUT_ACCOUNT_NOT_LINKED');
    expect(notice).toMatchObject({ severity: 'danger', blocking: true, dismissible: false, audience: ['owner', 'admin'] });
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
  });

  it('đọc danh sách hay chọn tài khoản khi chưa có credential → 404 NOT_FOUND, không gọi Tingee', async () => {
    expectError(await options(), 404, 'NOT_FOUND');
    expectError(await select(String(mb.vaAccountNumber)), 404, 'NOT_FOUND');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('kết nối bằng key', () => {
  it('key đúng (3 tài khoản: 1 VietinBank, 1 inactive) → 200, 2 dòng, VietinBank không chọn được; secret lưu dạng ciphertext', async () => {
    const res = await connect({ clientId: `  ${MAIN.clientId} `, secretToken: MAIN.secretToken });
    const result = PayoutAccountOptions.parse(expectOk(res));
    expect(result.credential.clientIdMasked).toBe('••••2c3d');
    expect(result.accounts).toEqual([
      {
        vaAccountNumber: mb.vaAccountNumber,
        bankBin: '970422',
        bankName: 'MB Bank',
        accountType: 'personal-account',
        accountLast4: String(mb.accountNumber).slice(-4),
        accountName: 'CLB CO VUA QUAN 3',
        selectable: true,
        linked: false,
      },
      expect.objectContaining({
        vaAccountNumber: vietin.vaAccountNumber,
        bankBin: '970415',
        selectable: false,
        linked: false,
      }),
    ]);
    expect(res.text).not.toContain(MAIN.secretToken);
    expect(res.text).not.toContain(MAIN.clientId);

    // Tingee: get-va-paging ký bằng key của BTC, không có merchantId.
    const [req] = fake.calls('/v1/get-va-paging');
    expect(req).toMatchObject({ clientId: MAIN.clientId, signatureValid: true });
    expect(req?.body).toEqual({ skipCount: 0, maxResultCount: 200 });

    // DB: Client ID đã bỏ khoảng trắng, Secret Token chỉ có dạng ciphertext `v1:` giải mã ra đúng secret.
    const [row] = await credentialRows();
    expect(row).toMatchObject({ client_id: MAIN.clientId, retired_at: null });
    expect(row?.secret_token_ciphertext).toMatch(/^v1:/);
    expect(row?.secret_token_ciphertext).not.toContain(MAIN.secretToken);
    expect(box.open(row!.secret_token_ciphertext)).toBe(MAIN.secretToken);

    // `ipnKey` 128 bit base64url; overview có credential và URL IPN, chưa có tài khoản; banner vẫn còn.
    const key = await ipnKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await overview()).toEqual({
      credential: result.credential,
      accounts: [],
      canReplaceKey: true,
      ipnUrl: `${IPN_PREFIX}${key}`,
      tingeePortalUrl: 'https://baas.tingee.vn',
    });
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(await audits()).toEqual([
      {
        action: 'tingee_credential.connected',
        target_type: 'tingee_credential',
        changed_fields: ['client_id', 'secret_token_ciphertext', 'tingee_ipn_key'],
      },
    ]);
    expect(await accountRows()).toEqual([]);
  });

  it('GET options đọc lại danh sách bằng credential đã lưu (giải mã đúng secret)', async () => {
    expectOk(await connect(MAIN));
    resetFake();
    const result = PayoutAccountOptions.parse(expectOk(await options()));
    expect(result.accounts.map((a) => a.vaAccountNumber)).toEqual([mb.vaAccountNumber, vietin.vaAccountNumber]);
    expect(fake.calls('/v1/get-va-paging')).toEqual([expect.objectContaining({ clientId: MAIN.clientId, signatureValid: true })]);
  });

  it.each([
    ['Client ID lạ (92)', { clientId: 'tg-client-khong-co', secretToken: MAIN.secretToken }],
    ['Secret Token sai (97)', { clientId: MAIN.clientId, secretToken: 'tg-secret-sai' }],
    ['key thiếu quyền (1133)', FORBIDDEN],
  ])('key sai: %s → 422 TINGEE_CREDENTIAL_INVALID, không ghi gì', async (_name, credential) => {
    const error = expectError(await connect(credential), 422, 'TINGEE_CREDENTIAL_INVALID');
    expect(error.message).toBe('Client ID hoặc Secret Token không đúng.');
    expect(await credentialRows()).toEqual([]);
    expect(await ipnKey()).toBeNull();
    expect(await audits()).toEqual([]);
  });

  it('merchant bị khóa (1007) → 409 MERCHANT_SUSPENDED; Tingee lỗi HTTP 500 → 503; không ghi gì', async () => {
    expectError(await connect(SUSPENDED), 409, 'MERCHANT_SUSPENDED');
    const error = expectError(await connect(BROKEN), 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
    expect(error.message).toBe('Tingee tạm lỗi, thử lại sau ít phút.');
    expect(await credentialRows()).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it('Tingee treo: gọi ngoài transaction (dòng BTC không bị khóa trong lúc chờ) → 503, không ghi gì', async () => {
    const pending = connect(HANGING);
    await fake.waitFor('/v1/get-va-paging');
    const client = await h.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '500ms'`);
      await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expectError(await pending, 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
    expect(await credentialRows()).toEqual([]);
  });

  it('danh sách rỗng → 200, credential vẫn lưu, accounts []', async () => {
    const result = PayoutAccountOptions.parse(expectOk(await connect(EMPTY)));
    expect(result.accounts).toEqual([]);
    expect(await credentialRows()).toHaveLength(1);
    // BTC liên kết ngân hàng trên Tingee rồi bấm "Tải lại".
    const added = trackedAccount();
    fake.merchant(EMPTY.clientId).accounts = [added];
    const reloaded = PayoutAccountOptions.parse(expectOk(await options()));
    expect(reloaded.accounts.map((a) => a.vaAccountNumber)).toEqual([added.vaAccountNumber]);
    fake.merchant(EMPTY.clientId).accounts = [];
  });

  it('"Dùng key khác": credential cũ chuyển retired_at, ipnKey giữ nguyên; key mới sai thì credential cũ vẫn hiện hành', async () => {
    expectOk(await connect(MAIN));
    const key = await ipnKey();

    expectError(await connect({ clientId: OTHER.clientId, secretToken: 'sai' }), 422, 'TINGEE_CREDENTIAL_INVALID');
    expect((await credentialRows()).map((r) => [r.client_id, r.retired_at])).toEqual([[MAIN.clientId, null]]);

    const switched = PayoutAccountOptions.parse(expectOk(await connect(OTHER)));
    expect(switched.credential.clientIdMasked).toBe('••••6a7b');
    const rows = await credentialRows();
    expect(rows.map((r) => r.client_id)).toEqual([MAIN.clientId, OTHER.clientId]);
    expect(rows[0]?.retired_at).not.toBeNull();
    expect(rows[1]?.retired_at).toBeNull();
    expect(await ipnKey()).toBe(key);
    expect((await overview()).credential?.id).toBe(switched.credential.id);
    expect((await audits()).map((a) => a.changed_fields)).toEqual([
      ['client_id', 'secret_token_ciphertext', 'tingee_ipn_key'],
      ['client_id', 'secret_token_ciphertext', 'retired_at'],
    ]);

    // Tài khoản của key cũ không còn chọn được; tài khoản của key mới thì được.
    expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
    expectOk(await select(switched.accounts[0]!.vaAccountNumber));
  });

  it('body sai → 400 VALIDATION_FAILED, không gọi Tingee', async () => {
    expectError(await connect({ clientId: '  ', secretToken: MAIN.secretToken }), 400, 'VALIDATION_FAILED');
    expectError(await connect({ clientId: MAIN.clientId }), 400, 'VALIDATION_FAILED');
    expectError(await select(''), 400, 'VALIDATION_FAILED');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('chọn tài khoản nhận tiền', () => {
  beforeEach(async () => {
    expectOk(await connect(MAIN));
    resetFake();
  });

  it('VA active, không phải VietinBank → 200, tài khoản đầu tiên thành mặc định; overview có URL IPN; banner NOT_LINKED mất', async () => {
    const res = await select(String(mb.vaAccountNumber));
    const account = PayoutAccount.parse(expectOk(res));
    expect(account).toMatchObject({
      vaAccountNumber: mb.vaAccountNumber,
      bankBin: '970422',
      bankName: 'MB Bank',
      accountType: 'personal-account',
      accountLast4: String(mb.accountNumber).slice(-4),
      accountName: 'CLB CO VUA QUAN 3',
      isDefault: true,
    });
    // Server đọc lại danh sách bằng credential hiện hành trước khi lưu.
    expect(fake.calls('/v1/get-va-paging')).toEqual([expect.objectContaining({ clientId: MAIN.clientId, signatureValid: true })]);

    const view = await overview();
    expect(view.accounts).toEqual([account]);
    expect(view.canReplaceKey).toBe(false);
    expect(view.ipnUrl).toBe(`${IPN_PREFIX}${await ipnKey()}`);
    expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(await noticeCodes(admin.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');

    const [row] = await accountRows();
    expect(row).toMatchObject({
      tingee_credential_id: view.credential?.id,
      va_account_number: mb.vaAccountNumber,
      tingee_shop_id: String(mb.shopId),
      created_by: owner.userId,
      is_default: true,
      retired_at: null,
    });
    expect((await audits()).at(-1)).toEqual({
      action: 'payout_account.linked',
      target_type: 'payout_account',
      changed_fields: [
        'tingee_credential_id',
        'va_account_number',
        'bank_bin',
        'bank_name',
        'account_type',
        'account_last4',
        'account_name',
        'tingee_shop_id',
        'is_default',
        'linked_at',
      ],
    });
  });

  it('VietinBank → 422 BANK_NOT_SUPPORTED, không lưu', async () => {
    const error = expectError(await select(String(vietin.vaAccountNumber)), 422, 'BANK_NOT_SUPPORTED');
    expect(error.message).toContain('VietinBank');
    expect(await accountRows()).toEqual([]);
  });

  it('VA không còn active hoặc không có trong danh sách → 409 PAYOUT_ACCOUNT_UNAVAILABLE, không lưu', async () => {
    expectError(await select(String(inactive.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
    mb.status = 'inactive';
    expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
    expectError(await select('9600000000'), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
    expect(await accountRows()).toEqual([]);
    expect((await audits()).map((a) => a.action)).toEqual(['tingee_credential.connected']);
  });

  it('key bị thu hồi trên Tingee sau khi kết nối → 422 TINGEE_CREDENTIAL_INVALID; Tingee lỗi → 503; không lưu', async () => {
    const merchant = fake.merchant(MAIN.clientId);
    merchant.behavior = 'forbidden';
    try {
      expectError(await select(String(mb.vaAccountNumber)), 422, 'TINGEE_CREDENTIAL_INVALID');
      expectError(await options(), 422, 'TINGEE_CREDENTIAL_INVALID');
      merchant.behavior = 'error';
      expectError(await select(String(mb.vaAccountNumber)), 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
    } finally {
      delete merchant.behavior;
    }
    expect(await accountRows()).toEqual([]);
  });

  it('đã liên kết: chọn lại cùng VA → 409 "Tài khoản này đã được liên kết."; gửi key → 409; không gọi Tingee', async () => {
    expectOk(await select(String(mb.vaAccountNumber)));
    resetFake();
    const duplicate = expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(duplicate.message).toBe('Tài khoản này đã được liên kết.');
    expectError(await connect(OTHER), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(fake.requests).toHaveLength(0);
    expect(await accountRows()).toHaveLength(1);
    expect((await credentialRows()).filter((r) => r.retired_at === null)).toHaveLength(1);
  });

  it('hai tab thêm cùng một VA cùng lúc: đúng một dòng, các tab còn lại 409', async () => {
    const results = await Promise.all([
      select(String(mb.vaAccountNumber)),
      select(String(mb.vaAccountNumber)),
      select(String(mb.vaAccountNumber)),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const res of results.filter((r) => r.status !== 200)) expectError(res, 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(await accountRows()).toHaveLength(1);
    expect((await audits()).filter((a) => a.action === 'payout_account.linked')).toHaveLength(1);
    await expectOneDefault();
  });

  it('hai tab thêm hai VA khác nhau cùng lúc: cả hai được, đúng một tài khoản mặc định', async () => {
    const second = trackedAccount({ bankName: 'ACB', bankBin: '970416' });
    fake.merchant(MAIN.clientId).accounts.push(second);
    const results = await Promise.all([select(String(mb.vaAccountNumber)), select(String(second.vaAccountNumber))]);
    for (const res of results) expectOk(res);
    expect((await overview()).accounts).toHaveLength(2);
    await expectOneDefault();
  });

  it('tab khác chọn xong trong lúc tab này chờ Tingee → tab này 409 ALREADY_LINKED', async () => {
    afterNextList = async () => {
      expectOk(await select(String(mb.vaAccountNumber)));
    };
    expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(await accountRows()).toHaveLength(1);
  });

  it('tab khác chọn tài khoản trong lúc tab này kết nối key khác → 409 ALREADY_LINKED, credential cũ vẫn hiện hành', async () => {
    afterNextList = async () => {
      expectOk(await select(String(mb.vaAccountNumber)));
    };
    expectError(await connect(OTHER), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect((await credentialRows()).map((r) => [r.client_id, r.retired_at])).toEqual([[MAIN.clientId, null]]);
    expect((await audits()).filter((a) => a.action === 'tingee_credential.connected')).toHaveLength(1);
    expect(await accountRows()).toHaveLength(1);
  });

  it('tab khác đổi key trong lúc tab này chờ Tingee → 409 PAYOUT_ACCOUNT_UNAVAILABLE, không lưu', async () => {
    afterNextList = async () => {
      expectOk(await connect(OTHER));
    };
    expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
    expect(await accountRows()).toEqual([]);
  });

  it('tab khác liên kết rồi hủy liên kết trong lúc tab này kết nối key khác → 409 ALREADY_LINKED, credential cũ vẫn hiện hành', async () => {
    afterNextList = async () => {
      const account = await link(mb);
      expectOk(await unlink(account.id));
    };
    // BTC không còn tài khoản hiện hành nhưng đã từng liên kết (Q2): không nhận key nữa.
    expectError(await connect(OTHER), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect((await credentialRows()).map((r) => [r.client_id, r.retired_at])).toEqual([[MAIN.clientId, null]]);
    expect((await audits()).filter((a) => a.action === 'tingee_credential.connected')).toHaveLength(1);
    expect((await overview()).accounts).toEqual([]);
  });
});

describe('nhiều tài khoản: thêm, hủy liên kết, đặt mặc định', () => {
  /** Tài khoản thứ hai, thứ ba của MAIN (chọn được). */
  let acb: FakeAccount;
  let vcb: FakeAccount;
  /** MB đã liên kết (mặc định) ở đầu mỗi test. */
  let mbLinked: PayoutAccount;

  beforeEach(async () => {
    acb = trackedAccount({ bankName: 'ACB', bankBin: '970416', accountName: 'CLB CO VUA QUAN 3' });
    vcb = trackedAccount({ bankName: 'Vietcombank', bankBin: '970436', accountName: 'CLB CO VUA QUAN 3' });
    fake.merchant(MAIN.clientId).accounts.push(acb, vcb);
    expectOk(await connect(MAIN));
    mbLinked = await link(mb);
    resetFake();
  });

  it('thêm tài khoản thứ hai → 200, không phải mặc định; overview có 2 tài khoản theo thứ tự liên kết; danh sách đánh dấu linked', async () => {
    const added = await link(acb);
    expect(added).toMatchObject({ vaAccountNumber: acb.vaAccountNumber, bankName: 'ACB', isDefault: false });

    const view = await overview();
    expect(summary(view)).toEqual([
      [mb.vaAccountNumber, true],
      [acb.vaAccountNumber, false],
    ]);
    expect(view.accounts[1]).toEqual(added);
    expect(view.canReplaceKey).toBe(false);
    expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');

    const listed = PayoutAccountOptions.parse(expectOk(await options()));
    expect(listed.accounts.map((a) => [a.vaAccountNumber, a.linked])).toEqual([
      [mb.vaAccountNumber, true],
      [vietin.vaAccountNumber, false],
      [acb.vaAccountNumber, true],
      [vcb.vaAccountNumber, false],
    ]);

    const linked = (await audits()).filter((a) => a.action === 'payout_account.linked');
    expect(linked).toHaveLength(2);
    expect(linked[0]?.changed_fields).toContain('is_default');
    expect(linked[1]?.changed_fields).not.toContain('is_default');
    await expectOneDefault();
  });

  it('thêm trùng: chọn lại VA MB đang liên kết → 409 "Tài khoản này đã được liên kết.", không gọi Tingee, không lưu', async () => {
    const error = expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(error.message).toBe('Tài khoản này đã được liên kết.');
    expect(fake.requests).toHaveLength(0);
    expect(await accountRows()).toHaveLength(1);
  });

  it('tab khác thêm cùng VA trong lúc tab này chờ Tingee → 409, đúng một dòng', async () => {
    afterNextList = async () => {
      expectOk(await select(String(acb.vaAccountNumber)));
    };
    expectError(await select(String(acb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect((await accountRows()).filter((r) => r.va_account_number === acb.vaAccountNumber)).toHaveLength(1);
  });

  it('hủy một trong hai (không phải mặc định) → 200, còn MB; banner vẫn không có; dòng giữ lại với retired_at', async () => {
    const added = await link(acb);
    resetFake();
    const view = PayoutAccountOverview.parse(expectOk(await unlink(added.id)));
    expect(view.accounts).toEqual([mbLinked]);
    expect(view.canReplaceKey).toBe(false);
    expect(await overview()).toEqual(view);
    expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');

    const rows = await accountRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === added.id)).toMatchObject({ is_default: false, retired_at: expect.anything() });
    expect((await audits()).at(-1)).toEqual({
      action: 'payout_account.unlinked',
      target_type: 'payout_account',
      changed_fields: ['retired_at'],
    });
    // Không gọi Tingee để hủy hay xóa VA.
    expect(fake.requests).toHaveLength(0);
    await expectOneDefault();
  });

  it('hủy tài khoản mặc định → tài khoản liên kết sớm nhất còn lại thành mặc định', async () => {
    const acbLinked = await link(acb);
    const vcbLinked = await link(vcb);
    // VCB (liên kết sau cùng) thành mặc định rồi bị hủy: MB (sớm nhất) thành mặc định, không phải ACB.
    expectOk(await setDefault(vcbLinked.id));
    let view = PayoutAccountOverview.parse(expectOk(await unlink(vcbLinked.id)));
    expect(summary(view)).toEqual([
      [mb.vaAccountNumber, true],
      [acb.vaAccountNumber, false],
    ]);
    await expectOneDefault();

    view = PayoutAccountOverview.parse(expectOk(await unlink(mbLinked.id)));
    expect(summary(view)).toEqual([[acb.vaAccountNumber, true]]);
    expect(view.accounts[0]?.id).toBe(acbLinked.id);
    await expectOneDefault();

    const tail = (await audits()).slice(-2);
    expect(tail).toEqual([
      {
        action: 'payout_account.unlinked',
        target_type: 'payout_account',
        changed_fields: ['retired_at', 'is_default'],
      },
      { action: 'payout_account.default_changed', target_type: 'payout_account', changed_fields: ['is_default'] },
    ]);
  });

  it('hủy cả hai → accounts [], NOT_LINKED hiện lại cho Owner và Admin, audit có hai dòng payout_account.unlinked', async () => {
    const added = await link(acb);
    expectOk(await unlink(mbLinked.id));
    const view = PayoutAccountOverview.parse(expectOk(await unlink(added.id)));
    expect(view).toMatchObject({ accounts: [], canReplaceKey: false });
    expect(view.credential).not.toBeNull();
    expect(view.ipnUrl).toBe(`${IPN_PREFIX}${await ipnKey()}`);
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(await noticeCodes(admin.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect((await audits()).filter((a) => a.action === 'payout_account.unlinked')).toHaveLength(2);
    expect(await accountRows()).toHaveLength(2);
    await expectOneDefault();

    // Danh sách không còn VA nào `linked`.
    const listed = PayoutAccountOptions.parse(expectOk(await options()));
    expect(listed.accounts.some((a) => a.linked)).toBe(false);
  });

  it('hủy lại: id đã hủy, id lạ, id không phải UUID, id của BTC khác → 404 NOT_FOUND (cả đặt mặc định)', async () => {
    expectOk(await unlink(mbLinked.id));
    const auditCount = (await audits()).length;
    for (const id of [mbLinked.id, '019a3b2c-0000-7abc-8def-0123456789ab', 'khong-phai-uuid']) {
      expectError(await unlink(id), 404, 'NOT_FOUND');
      expectError(await setDefault(id), 404, 'NOT_FOUND');
    }

    // Tài khoản của một BTC khác (cùng Owner): không hủy, không đặt mặc định được qua BTC này.
    const otherOrg = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Khác' }).expect(201))
      .body.id as string;
    expectOk(await tracked(h.http.post(`${base(otherOrg)}/credential`).set('cookie', owner.cookie).send(OTHER)));
    const otherVa = String(fake.merchant(OTHER.clientId).accounts[0]!.vaAccountNumber);
    const otherAccount = PayoutAccount.parse(
      expectOk(
        await tracked(h.http.post(base(otherOrg)).set('cookie', owner.cookie).send({ vaAccountNumber: otherVa })),
      ),
    );
    expectError(await unlink(otherAccount.id), 404, 'NOT_FOUND');
    expectError(await setDefault(otherAccount.id), 404, 'NOT_FOUND');
    const otherView = PayoutAccountOverview.parse(
      expectOk(await tracked(h.http.get(base(otherOrg)).set('cookie', owner.cookie))),
    );
    expect(otherView.accounts).toEqual([otherAccount]);
    expect((await audits()).length).toBe(auditCount);
  });

  it('liên kết lại VA đã hủy → 200, tạo dòng mới (dòng cũ giữ nguyên)', async () => {
    expectOk(await unlink(mbLinked.id));
    const relinked = await link(mb);
    expect(relinked.id).not.toBe(mbLinked.id);
    expect(relinked.isDefault).toBe(true);
    const rows = (await accountRows()).filter((r) => r.va_account_number === mb.vaAccountNumber);
    expect(rows.map((r) => [r.id, r.retired_at === null])).toEqual([
      [mbLinked.id, false],
      [relinked.id, true],
    ]);
    expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    await expectOneDefault();
  });

  it('đặt mặc định: ACB khi MB đang là mặc định → ACB mặc định, MB không còn; đặt lại tài khoản đang mặc định → không đổi', async () => {
    const added = await link(acb);
    resetFake();
    const view = PayoutAccountOverview.parse(expectOk(await setDefault(added.id)));
    expect(summary(view)).toEqual([
      [mb.vaAccountNumber, false],
      [acb.vaAccountNumber, true],
    ]);
    expect(await overview()).toEqual(view);
    expect((await audits()).at(-1)).toEqual({
      action: 'payout_account.default_changed',
      target_type: 'payout_account',
      changed_fields: ['is_default'],
    });
    await expectOneDefault();

    const auditCount = (await audits()).length;
    expect(PayoutAccountOverview.parse(expectOk(await setDefault(added.id)))).toEqual(view);
    expect((await audits()).length).toBe(auditCount);
    expect(fake.requests).toHaveLength(0);
  });

  it('đổi key sau khi từng liên kết: hủy hết rồi gửi key mới → 409 ALREADY_LINKED, không gọi Tingee; canReplaceKey false', async () => {
    expectOk(await unlink(mbLinked.id));
    expect((await overview()).canReplaceKey).toBe(false);
    const credentialsBefore = await credentialRows();
    resetFake();
    expectError(await connect(OTHER), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expectError(await connect(MAIN), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(fake.requests).toHaveLength(0);
    expect(await credentialRows()).toEqual(credentialsBefore);
  });

  it('hủy song song: cùng một tài khoản → một 200, một 404; hai tài khoản khác nhau → cả hai 200, không còn tài khoản', async () => {
    const added = await link(acb);
    const same = await Promise.all([unlink(added.id), unlink(added.id)]);
    expect(same.map((r) => r.status).sort()).toEqual([200, 404]);
    await expectOneDefault();

    const again = await link(vcb);
    const both = await Promise.all([unlink(mbLinked.id), unlink(again.id)]);
    for (const res of both) expectOk(res);
    expect((await overview()).accounts).toEqual([]);
    expect((await audits()).filter((a) => a.action === 'payout_account.unlinked')).toHaveLength(3);
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    await expectOneDefault();
  });

  it('đặt mặc định và hủy song song: luôn đúng một tài khoản mặc định', async () => {
    const acbLinked = await link(acb);
    const vcbLinked = await link(vcb);
    const results = await Promise.all([setDefault(acbLinked.id), setDefault(vcbLinked.id), unlink(mbLinked.id)]);
    for (const res of results) expectOk(res);
    await expectOneDefault();
    expect((await overview()).accounts).toHaveLength(2);

    const next = await Promise.all([unlink(acbLinked.id), setDefault(vcbLinked.id), setDefault(acbLinked.id)]);
    expect(next[0]?.status).toBe(200);
    await expectOneDefault();
    expect(summary(await overview())).toEqual([[vcb.vaAccountNumber, true]]);
  });
});

describe('ràng buộc DB', () => {
  const violation = (err: unknown) => {
    const { code, constraint } = err as { code?: string; constraint?: string };
    return { code, constraint };
  };
  let credentialId: string;

  beforeEach(async () => {
    expectOk(await connect(MAIN));
    credentialId = (await credentialRows())[0]!.id;
  });

  /** Chèn thẳng một dòng `payout_accounts` (bỏ qua service và khóa dòng BTC). */
  const insert = (va: string, { isDefault = false, retired = false } = {}) =>
    h.db.pool.query(
      `INSERT INTO payout_accounts (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name,
         account_type, account_last4, account_name, created_by, is_default, retired_at)
       VALUES ($1, $2, $3, '970422', 'MB Bank', 'personal-account', '1234', 'CLB', $4, $5,
         CASE WHEN $6::boolean THEN now() END)`,
      [orgId, credentialId, va, owner.userId, isDefault, retired],
    );

  it('mỗi VA hiện hành một lần và tối đa một tài khoản mặc định hiện hành mỗi BTC; dòng đã hủy không tính', async () => {
    await insert('9600000101', { isDefault: true });
    // Cùng VA hiện hành lần hai → unique index của VA.
    await expect(insert('9600000101')).rejects.toSatisfy(
      (err) =>
        violation(err).code === '23505' &&
        violation(err).constraint === 'payout_accounts_current_va_per_organization_key',
    );
    // Mặc định hiện hành thứ hai → unique index của mặc định.
    await expect(insert('9600000102', { isDefault: true })).rejects.toSatisfy(
      (err) =>
        violation(err).code === '23505' &&
        violation(err).constraint === 'payout_accounts_one_default_per_organization_key',
    );
    // Cùng VA nhưng dòng đã hủy, và dòng mặc định đã hủy: được nhận.
    await insert('9600000101', { retired: true });
    await insert('9600000103', { isDefault: true, retired: true });
    await insert('9600000102');
    expect(await accountRows()).toHaveLength(4);
  });
});

describe('quyền', () => {
  it('Admin gọi mọi route → 403 FORBIDDEN_ROLE, không gọi Tingee', async () => {
    expectError(await tracked(h.http.get(base()).set('cookie', admin.cookie)), 403, 'FORBIDDEN_ROLE');
    expectError(await connect(MAIN, admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await options(admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await select(String(mb.vaAccountNumber), admin.cookie), 403, 'FORBIDDEN_ROLE');
    expect(fake.requests).toHaveLength(0);
    // Hủy liên kết và đặt mặc định trên tài khoản có thật.
    expectOk(await connect(MAIN));
    const account = PayoutAccount.parse(expectOk(await select(String(mb.vaAccountNumber))));
    resetFake();
    expectError(await unlink(account.id, admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await setDefault(account.id, admin.cookie), 403, 'FORBIDDEN_ROLE');
    expect(fake.requests).toHaveLength(0);
    expect((await overview()).accounts).toEqual([account]);
  });
});

describe('cấu hình từ env (payoutAccountSettings)', () => {
  it('TINGEE_BASE_URL UAT → link portal UAT; khóa từ TINGEE_CREDENTIAL_KEYS', () => {
    const settings = payoutAccountSettings({
      API_PUBLIC_URL: 'https://api.tickee.vn',
      TINGEE_BASE_URL: 'https://uat-open-api.tingee.vn',
      TINGEE_CREDENTIAL_KEYS: TEST_CREDENTIAL_KEYS,
    });
    expect(settings.tingeePortalUrl).toBe('https://uat-baas-portal.tingee.vn');
    expect(settings.apiPublicUrl).toBe('https://api.tickee.vn');
    expect(box.open(settings.secretBox.seal(MAIN.secretToken))).toBe(MAIN.secretToken);
  });
});

describe('xoay khóa mã hóa (TINGEE_CREDENTIAL_KEYS)', () => {
  it('credential lưu bằng v1 vẫn giải mã được khi env thêm v2; credential mới lưu bằng v2', async () => {
    expectOk(await connect(MAIN));
    expect((await credentialRows())[0]?.secret_token_ciphertext).toMatch(/^v1:/);

    const keys = `${TEST_CREDENTIAL_KEYS},${testCredentialKey(2, 9)}`;
    const http = new HttpTingeeClient({ baseUrl: fake.url, timeoutMs: TIMEOUT_MS });
    const rotated = await createHarness(
      { TINGEE_BASE_URL: fake.url, TINGEE_CREDENTIAL_KEYS: keys },
      { overrides: [{ provide: TINGEE_CLIENT, useValue: http }] },
    );
    try {
      // Credential cũ (v1) vẫn dùng được: đọc danh sách ký đúng bằng secret cũ.
      resetFake();
      PayoutAccountOptions.parse(expectOk(await options(owner.cookie, rotated)));
      expect(fake.calls('/v1/get-va-paging')).toEqual([expect.objectContaining({ clientId: MAIN.clientId, signatureValid: true })]);

      expectOk(await connect(OTHER, owner.cookie, rotated));
      const current = (await credentialRows()).find((r) => r.retired_at === null)!;
      expect(current.secret_token_ciphertext).toMatch(/^v2:/);
      expect(new SecretBox(parseCredentialKeys(keys)).open(current.secret_token_ciphertext)).toBe(OTHER.secretToken);
      expectOk(await select(String(fake.merchant(OTHER.clientId).accounts[0]!.vaAccountNumber), owner.cookie, rotated));
    } finally {
      await rotated.close();
    }
  });
});

describe('không lộ bí mật', () => {
  it('log api, response và audit không có Secret Token, chữ ký hay số tài khoản đầy đủ', async () => {
    expectError(await connect({ clientId: MAIN.clientId, secretToken: 'tg-secret-sai' }), 422, 'TINGEE_CREDENTIAL_INVALID');
    expectOk(await connect(MAIN));
    expectOk(await select(String(mb.vaAccountNumber)));
    resetFake();
    expect(signatures.length).toBeGreaterThan(10);

    const logs = h.logs.text;
    const all = responses.join('\n');
    const audit = JSON.stringify(
      (await h.db.orm.execute(sql`SELECT * FROM audit_events WHERE action LIKE 'tingee_credential.%' OR action LIKE 'payout_account.%'`)).rows,
    );
    expect(accountNumbers.length).toBeGreaterThan(5);
    for (const text of [logs, all, audit]) {
      for (const secret of SECRETS) expect(text).not.toContain(secret);
      for (const signature of signatures) expect(text).not.toContain(signature);
      for (const accountNumber of accountNumbers) expect(text).not.toContain(accountNumber);
    }
    expect(audit).not.toContain(MAIN.clientId);
    // DB không có số tài khoản đầy đủ ở bất kỳ cột nào.
    const stored = JSON.stringify(await accountRows());
    for (const accountNumber of accountNumbers) expect(stored).not.toContain(accountNumber);
    // Tingee từ chối thì log có mã Tingee (không có message của Tingee).
    expect(logs).toContain('"tingeeCode":"97"');
  });
});
