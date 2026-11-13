import { createHash, randomUUID } from 'node:crypto';
import {
  ErrorResponse,
  JobQueue,
  PayoutAccount,
  PayoutAccountOptions,
  PayoutAccountOverview,
  REAUTH_HEADER,
  Role,
  StatusNoticeList,
  TingeeKeyPreview,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
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
import { BOSS } from '../../src/platform/jobs/index.js';
import { TEST_CREDENTIAL_KEYS, TEST_WEB_ORIGIN, testCredentialKey } from '../helpers.js';
import {
  createHarness,
  reauthToken,
  signIn,
  signUp,
  signUpWithTotp,
  type Harness,
} from '../identity/harness.js';
import { fakeAccount, startTingeeFake, type FakeAccount, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 2.6: BTC kết nối API key Tingee của mình, thêm một hay nhiều tài khoản nhận tiền, đặt mặc định và hủy liên
 * kết, trên Tingee fake (server HTTP thật, nhiều merchant) và Postgres thật. Tingee luôn được gọi ngoài transaction;
 * mỗi lần ghi là một transaction riêng có audit; tối đa một credential hiện hành mỗi BTC, mỗi VA hiện hành tối đa một
 * lần mỗi BTC, còn tài khoản thì đúng một tài khoản mặc định. Không bao giờ gọi Tingee thật.
 *
 * Story 2.13-a: hủy liên kết và đặt mặc định đòi một lần xác nhận lại (header `REAUTH_HEADER`), tiêu trong chính
 * transaction của thao tác; mỗi lần tài khoản mặc định đổi thì cùng transaction enqueue email cảnh báo.
 *
 * Story 2.13-b: "Đổi key Tingee" (BTC đã từng liên kết): begin và xem trước chỉ kiểm lần xác nhận (không tiêu), lưu đọc
 * lại danh sách bằng key mới rồi trong một transaction tiêu lần xác nhận, retire credential cũ, gỡ mềm mọi tài khoản
 * hiện hành và chèn credential + tài khoản mặc định mới.
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
    createPaymentLink: (credential, input) => http.createPaymentLink(credential, input),
    getGatewayOrder: (credential, orderId) => http.getGatewayOrder(credential, orderId),
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
/**
 * Lần xác nhận lại cho thao tác nhạy cảm: `token` bỏ trống thì Owner xác nhận lại ngay trước lời gọi (gọi tuần tự; lời
 * gọi song song phải lấy token trước); `null` thì không gửi header.
 */
type ReauthOption = { cookie?: string; token?: string | null };
/** `request` dựng request SAU khi có token (supertest đóng server dùng chung khi các request xác nhận lại xong). */
async function withReauth(request: () => ReturnType<Harness['http']['post']>, { cookie = owner.cookie, token }: ReauthOption) {
  const proof = token === undefined && cookie === owner.cookie ? await reauthToken(h, owner) : (token ?? null);
  const req = request().set('cookie', cookie);
  return tracked(proof ? req.set(REAUTH_HEADER, proof) : req);
}
const unlink = (accountId: string, options: ReauthOption = {}) =>
  withReauth(() => h.http.delete(`${base()}/${accountId}`), options);
const setDefault = (accountId: string, options: ReauthOption = {}) =>
  withReauth(() => h.http.post(`${base()}/${accountId}/default`), options);
/** Token xác nhận lại của Owner, lấy trước cho các lời gọi song song. */
const ownerTokens = async (n: number) => {
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) tokens.push(await reauthToken(h, owner));
  return tokens;
};
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

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Lần xác nhận `token` đã bị tiêu chưa. */
async function grantUsed(token: string): Promise<boolean> {
  const { rows } = await h.db.pool.query<{ used_at: Date | null }>(
    'SELECT used_at FROM reauth_grants WHERE token_hash = $1',
    [sha256(token)],
  );
  if (!rows[0]) throw new Error('Không có lần xác nhận này');
  return rows[0].used_at !== null;
}

/** Payload các job cảnh báo đổi tài khoản mặc định của BTC, theo thứ tự tạo (api không chạy worker nên job còn đó). */
async function warningJobs(org = orgId) {
  const boss = h.app.get<PgBoss>(BOSS);
  const jobs = await boss.findJobs(JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED, { data: { organizationId: org } });
  return jobs
    .sort((a, b) => a.createdOn.getTime() - b.createdOn.getTime() || a.id.localeCompare(b.id))
    .map((job) => job.data as Record<string, unknown>);
}

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
    // Thao tác 404 rollback nên một lần xác nhận dùng được cho mọi lời gọi bên dưới.
    const token = await reauthToken(h, owner);
    for (const id of [mbLinked.id, '019a3b2c-0000-7abc-8def-0123456789ab', 'khong-phai-uuid']) {
      expectError(await unlink(id, { token }), 404, 'NOT_FOUND');
      expectError(await setDefault(id, { token }), 404, 'NOT_FOUND');
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
    expectError(await unlink(otherAccount.id, { token }), 404, 'NOT_FOUND');
    expectError(await setDefault(otherAccount.id, { token }), 404, 'NOT_FOUND');
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
    const [t1, t2, t3, t4] = await ownerTokens(4);
    const same = await Promise.all([unlink(added.id, { token: t1 }), unlink(added.id, { token: t2 })]);
    expect(same.map((r) => r.status).sort()).toEqual([200, 404]);
    await expectOneDefault();

    const again = await link(vcb);
    const both = await Promise.all([unlink(mbLinked.id, { token: t3 }), unlink(again.id, { token: t4 })]);
    for (const res of both) expectOk(res);
    expect((await overview()).accounts).toEqual([]);
    expect((await audits()).filter((a) => a.action === 'payout_account.unlinked')).toHaveLength(3);
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    await expectOneDefault();
  });

  it('đặt mặc định và hủy song song: luôn đúng một tài khoản mặc định', async () => {
    const acbLinked = await link(acb);
    const vcbLinked = await link(vcb);
    const [t1, t2, t3, t4, t5, t6] = await ownerTokens(6);
    const results = await Promise.all([
      setDefault(acbLinked.id, { token: t1 }),
      setDefault(vcbLinked.id, { token: t2 }),
      unlink(mbLinked.id, { token: t3 }),
    ]);
    for (const res of results) expectOk(res);
    await expectOneDefault();
    expect((await overview()).accounts).toHaveLength(2);

    const next = await Promise.all([
      unlink(acbLinked.id, { token: t4 }),
      setDefault(vcbLinked.id, { token: t5 }),
      setDefault(acbLinked.id, { token: t6 }),
    ]);
    expect(next[0]?.status).toBe(200);
    await expectOneDefault();
    expect(summary(await overview())).toEqual([[vcb.vaAccountNumber, true]]);
  });
});

describe('xác nhận lại và email cảnh báo (Story 2.13-a)', () => {
  let acb: FakeAccount;
  let vcb: FakeAccount;
  /** MB đã liên kết (mặc định) và ACB (không mặc định) ở đầu mỗi test. */
  let mbLinked: PayoutAccount;
  let acbLinked: PayoutAccount;

  beforeEach(async () => {
    acb = trackedAccount({ bankName: 'ACB', bankBin: '970416', accountName: 'CLB CO VUA QUAN 3' });
    vcb = trackedAccount({ bankName: 'Vietcombank', bankBin: '970436', accountName: 'CLB CO VUA QUAN 3' });
    fake.merchant(MAIN.clientId).accounts.push(acb, vcb);
    expectOk(await connect(MAIN));
    mbLinked = await link(mb);
    acbLinked = await link(acb);
    resetFake();
  });

  it('CORS: preflight từ WEB_ORIGIN cho phép header x-reauth-token ở hủy liên kết, đặt mặc định và đổi key', async () => {
    for (const [method, path] of [
      ['DELETE', `${base()}/${mbLinked.id}`],
      ['POST', `${base()}/${mbLinked.id}/default`],
      ['POST', `${base()}/credential/replacement/begin`],
      ['POST', `${base()}/credential/replacement/preview`],
      ['POST', `${base()}/credential/replacement`],
    ] as const) {
      const res = await h.http
        .options(path)
        .set('origin', TEST_WEB_ORIGIN)
        .set('access-control-request-method', method)
        .set('access-control-request-headers', REAUTH_HEADER);
      expect(res.status, res.text).toBeLessThan(300);
      expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      const allowed = String(res.headers['access-control-allow-headers'] ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase());
      expect(allowed).toContain(REAUTH_HEADER);
      expect(String(res.headers['access-control-allow-methods'])).toContain(method);
    }
  });

  it('thiếu xác nhận → 403 REAUTH_REQUIRED {method: email_otp} (kể cả id lạ), không đổi gì, không có job', async () => {
    const before = await overview();
    const auditCount = (await audits()).length;
    for (const res of [
      await setDefault(acbLinked.id, { token: null }),
      await unlink(mbLinked.id, { token: null }),
      await unlink(acbLinked.id, { token: 'khong-phai-token' }),
      await setDefault(randomUUID(), { token: null }),
      await unlink(randomUUID(), { token: null }),
    ]) {
      const error = expectError(res, 403, 'REAUTH_REQUIRED');
      expect(error.details).toEqual({ method: 'email_otp' });
    }
    expect(await overview()).toEqual(before);
    expect((await audits()).length).toBe(auditCount);
    expect(await warningJobs()).toEqual([]);
  });

  it('lần xác nhận dùng một lần; của session khác hay đã hết hạn → REAUTH_REQUIRED', async () => {
    const token = await reauthToken(h, owner);
    expectOk(await setDefault(acbLinked.id, { token }));
    expect(await grantUsed(token)).toBe(true);
    expectError(await setDefault(mbLinked.id, { token }), 403, 'REAUTH_REQUIRED');
    expectError(await unlink(mbLinked.id, { token }), 403, 'REAUTH_REQUIRED');

    // Owner đăng nhập ở máy khác: lần xác nhận của session kia chỉ dùng được ở session kia.
    const otherCookie = await signIn(h, owner.email);
    const otherToken = await reauthToken(h, { cookie: otherCookie, email: owner.email });
    expectError(await setDefault(mbLinked.id, { token: otherToken }), 403, 'REAUTH_REQUIRED');
    expect(await grantUsed(otherToken)).toBe(false);
    expectOk(await setDefault(mbLinked.id, { cookie: otherCookie, token: otherToken }));

    const expired = await reauthToken(h, owner);
    await h.db.pool.query(`UPDATE reauth_grants SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [
      sha256(expired),
    ]);
    expectError(await setDefault(acbLinked.id, { token: expired }), 403, 'REAUTH_REQUIRED');
    expect(summary(await overview())).toEqual([
      [mb.vaAccountNumber, true],
      [acb.vaAccountNumber, false],
    ]);
  });

  it('thao tác lỗi (404) rollback: lần xác nhận không bị tiêu, dùng tiếp được', async () => {
    const token = await reauthToken(h, owner);
    expectError(await unlink(randomUUID(), { token }), 404, 'NOT_FOUND');
    expectError(await setDefault(randomUUID(), { token }), 404, 'NOT_FOUND');
    expect(await grantUsed(token)).toBe(false);
    expectOk(await setDefault(acbLinked.id, { token }));
    expect(await grantUsed(token)).toBe(true);
  });

  it('job cảnh báo khi mặc định đổi: đặt mặc định khác, hủy mặc định (kể cả tài khoản cuối); không job khi mặc định giữ nguyên', async () => {
    const event = (previous: string, next: string | null) => ({
      organizationId: orgId,
      previousAccountId: previous,
      nextAccountId: next,
      actorUserId: owner.userId,
      changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      reason: 'default_changed',
    });

    // Đặt ACB làm mặc định (MB đang mặc định): MB → ACB.
    expectOk(await setDefault(acbLinked.id));
    expect(await warningJobs()).toEqual([event(mbLinked.id, acbLinked.id)]);

    // Đặt lại tài khoản đang mặc định: vẫn đòi (và tiêu) lần xác nhận, không đổi gì, không gửi email.
    const token = await reauthToken(h, owner);
    expectOk(await setDefault(acbLinked.id, { token }));
    expect(await grantUsed(token)).toBe(true);
    // Hủy tài khoản không mặc định: không email.
    expectOk(await unlink(mbLinked.id));
    expect(await warningJobs()).toHaveLength(1);

    // Hủy tài khoản mặc định khi còn tài khoản khác: ACB → VCB (liên kết sớm nhất còn lại).
    const vcbLinked = await link(vcb);
    expectOk(await unlink(acbLinked.id));
    // Hủy tài khoản cuối cùng: VCB → không còn tài khoản.
    expectOk(await unlink(vcbLinked.id));
    const jobs = await warningJobs();
    expect(jobs).toEqual([
      event(mbLinked.id, acbLinked.id),
      event(acbLinked.id, vcbLinked.id),
      event(vcbLinked.id, null),
    ]);
    // Payload không có PII: chỉ id và mốc giờ.
    const payloads = JSON.stringify(jobs);
    expect(payloads).not.toContain(owner.email);
    for (const accountNumber of accountNumbers) expect(payloads).not.toContain(accountNumber);
  });

  it('Owner đã bật 2FA: thiếu xác nhận → REAUTH_REQUIRED {method: totp}; xác nhận bằng TOTP → hủy được', async () => {
    const totpOwner = await signUpWithTotp(h);
    const org = (await h.http.post('/v1/orgs').set('cookie', totpOwner.cookie).send({ name: 'CLB 2FA' }).expect(201))
      .body.id as string;
    expectOk(await tracked(h.http.post(`${base(org)}/credential`).set('cookie', totpOwner.cookie).send(MAIN)));
    const account = PayoutAccount.parse(
      expectOk(
        await tracked(
          h.http.post(base(org)).set('cookie', totpOwner.cookie).send({ vaAccountNumber: String(mb.vaAccountNumber) }),
        ),
      ),
    );
    const remove = (token?: string) => {
      const req = h.http.delete(`${base(org)}/${account.id}`).set('cookie', totpOwner.cookie);
      return tracked(token ? req.set(REAUTH_HEADER, token) : req);
    };
    const error = expectError(await remove(), 403, 'REAUTH_REQUIRED');
    expect(error.details).toEqual({ method: 'totp' });
    // Lần xác nhận của Owner BTC khác (session khác) không dùng được ở đây.
    expectError(await remove(await reauthToken(h, owner)), 403, 'REAUTH_REQUIRED');

    const view = PayoutAccountOverview.parse(expectOk(await remove(await reauthToken(h, totpOwner))));
    expect(view.accounts).toEqual([]);
    expect(await warningJobs(org)).toEqual([
      expect.objectContaining({ previousAccountId: account.id, nextAccountId: null, actorUserId: totpOwner.userId }),
    ]);
  });
});

describe('đổi key Tingee (Story 2.13-b)', () => {
  /** Tài khoản thứ hai của MAIN. */
  let acb: FakeAccount;
  /** Danh sách của OTHER (key mới): VCB, ACB (chọn được), VietinBank (mờ), BIDV `inactive` (không hiện). */
  let otherVcb: FakeAccount;
  let otherAcb: FakeAccount;
  let otherVietin: FakeAccount;
  let otherInactive: FakeAccount;

  const replacementPath = (step: '' | '/begin' | '/preview') => `${base()}/credential/replacement${step}`;
  const begin = (options: ReauthOption = {}) => withReauth(() => h.http.post(replacementPath('/begin')), options);
  const preview = (key: TingeeCredential | Record<string, unknown>, options: ReauthOption = {}) =>
    withReauth(() => h.http.post(replacementPath('/preview')).send(key), options);
  const replace = (key: TingeeCredential, account: FakeAccount | string, options: ReauthOption = {}) =>
    withReauth(
      () =>
        h.http
          .post(replacementPath(''))
          .send({ ...key, vaAccountNumber: typeof account === 'string' ? account : String(account.vaAccountNumber) }),
      options,
    );
  /** `[action, target_id]` của audit sau `skip` dòng đầu. */
  async function auditTargets(skip: number) {
    const { rows } = await h.db.pool.query<{ action: string; target_id: string; changed_fields: string[] }>(
      `SELECT action, target_id, changed_fields FROM audit_events
        WHERE organization_id = $1 AND action <> 'organization.created' ORDER BY id`,
      [orgId],
    );
    return rows.slice(skip);
  }
  /** Ảnh chụp những gì đổi key được phép đổi: không đổi gì thì hai lần chụp bằng nhau. */
  const snapshot = async () => ({
    overview: await overview(),
    credentials: await credentialRows(),
    accounts: await accountRows(),
    audits: await audits(),
    jobs: await warningJobs(),
    ipnKey: await ipnKey(),
  });

  beforeEach(async () => {
    acb = trackedAccount({ bankName: 'ACB', bankBin: '970416', accountName: 'CLB CO VUA QUAN 3' });
    fake.merchant(MAIN.clientId).accounts.push(acb);
    otherVcb = trackedAccount({ bankName: 'Vietcombank', bankBin: '970436', accountName: 'CLB CO VUA MOI' });
    otherAcb = trackedAccount({ bankName: 'ACB', bankBin: '970416', accountName: 'CLB CO VUA MOI' });
    otherVietin = trackedAccount({ bankName: 'VietinBank', bankBin: '970415', accountName: 'CLB CO VUA MOI' });
    otherInactive = trackedAccount({ bankName: 'BIDV', bankBin: '970418', status: 'inactive' });
    fake.merchant(OTHER.clientId).accounts = [otherVcb, otherVietin, otherInactive, otherAcb];
    expectOk(await connect(MAIN));
    resetFake();
  });

  it('BTC chưa từng liên kết: ba bước → 409 PAYOUT_ACCOUNT_NOT_LINKED_YET (kể cả có xác nhận), không gọi Tingee; connect vẫn nhận key', async () => {
    const token = await reauthToken(h, owner);
    for (const options of [{ token }, { token: null }]) {
      expectError(await begin(options), 409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
      expectError(await preview(OTHER, options), 409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
      expectError(await replace(OTHER, otherVcb, options), 409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
    }
    expect(fake.requests).toHaveLength(0);
    expect(await grantUsed(token)).toBe(false);
    expect((await overview()).canReplaceKey).toBe(true);
    // Luồng kết nối lần đầu ("Dùng key khác") giữ nguyên: không cần xác nhận lại.
    expectOk(await connect(OTHER));
  });

  describe('đã liên kết MB (mặc định) và ACB', () => {
    let mbLinked: PayoutAccount;
    let acbLinked: PayoutAccount;

    beforeEach(async () => {
      mbLinked = await link(mb);
      acbLinked = await link(acb);
      resetFake();
    });

    it('begin → xem trước → lưu: credential mới hiện hành, cũ retired_at (giữ ciphertext), MB/ACB gỡ mềm, VCB mặc định; ipnKey giữ nguyên; audit + job ••••MB → ••••VCB', async () => {
      const before = await snapshot();
      const [oldCredential] = before.credentials;
      const auditCount = before.audits.length;

      // Bước 1: lần xác nhận còn hiệu lực → 204, không tiêu, không gọi Tingee, không ghi gì.
      const token = await reauthToken(h, owner);
      const begun = await begin({ token });
      expect(begun.status, begun.text).toBe(204);
      expect(begun.text).toBe('');
      expect(await grantUsed(token)).toBe(false);
      expect(fake.requests).toHaveLength(0);

      // Bước 2: danh sách của key mới (VietinBank mờ, inactive không hiện, không dòng nào `linked`); không ghi gì.
      const listed = TingeeKeyPreview.parse(expectOk(await preview({ ...OTHER, clientId: ` ${OTHER.clientId} ` }, { token })));
      expect(listed.clientIdMasked).toBe('••••6a7b');
      expect(listed.accounts.map((a) => [a.vaAccountNumber, a.selectable, a.linked])).toEqual([
        [otherVcb.vaAccountNumber, true, false],
        [otherVietin.vaAccountNumber, false, false],
        [otherAcb.vaAccountNumber, true, false],
      ]);
      expect(fake.calls('/v1/get-va-paging')).toEqual([
        expect.objectContaining({ clientId: OTHER.clientId, signatureValid: true }),
      ]);
      expect(await grantUsed(token)).toBe(false);
      expect(await snapshot()).toEqual(before);
      resetFake();

      // Bước 3: lưu (đọc lại danh sách bằng key mới), tiêu lần xác nhận, trả tổng quan mới.
      const res = await replace(OTHER, otherVcb, { token });
      const view = PayoutAccountOverview.parse(expectOk(res));
      expect(res.text).not.toContain(OTHER.secretToken);
      expect(res.text).not.toContain(OTHER.clientId);
      expect(fake.calls('/v1/get-va-paging')).toEqual([
        expect.objectContaining({ clientId: OTHER.clientId, signatureValid: true }),
      ]);
      expect(await grantUsed(token)).toBe(true);
      expect(view.credential?.clientIdMasked).toBe('••••6a7b');
      expect(view.credential?.id).not.toBe(oldCredential?.id);
      expect(view.accounts).toEqual([
        expect.objectContaining({ vaAccountNumber: otherVcb.vaAccountNumber, bankName: 'Vietcombank', isDefault: true }),
      ]);
      expect(view).toMatchObject({ canReplaceKey: false, ipnUrl: before.overview.ipnUrl });
      expect(await overview()).toEqual(view);
      expect(await ipnKey()).toBe(before.ipnKey);
      const newAccountId = view.accounts[0]!.id;

      // Credential: cũ giữ nguyên ciphertext (vẫn giải mã được), chỉ thêm retired_at; mới chỉ có ciphertext.
      const credentials = await credentialRows();
      expect(credentials).toHaveLength(2);
      expect(credentials[0]).toMatchObject({
        id: oldCredential?.id,
        client_id: MAIN.clientId,
        secret_token_ciphertext: oldCredential?.secret_token_ciphertext,
      });
      expect(credentials[0]?.retired_at).not.toBeNull();
      expect(box.open(credentials[0]!.secret_token_ciphertext)).toBe(MAIN.secretToken);
      expect(credentials[1]).toMatchObject({ id: view.credential?.id, client_id: OTHER.clientId, retired_at: null });
      expect(credentials[1]?.secret_token_ciphertext).not.toContain(OTHER.secretToken);
      expect(box.open(credentials[1]!.secret_token_ciphertext)).toBe(OTHER.secretToken);

      // Tài khoản: MB, ACB gỡ mềm (không xóa dòng); VCB của credential mới là mặc định.
      const rows = await accountRows();
      expect(rows.map((r) => [r.id, r.retired_at !== null, r.is_default])).toEqual([
        [mbLinked.id, true, false],
        [acbLinked.id, true, false],
        [newAccountId, false, true],
      ]);
      expect(rows[2]).toMatchObject({
        tingee_credential_id: view.credential?.id,
        va_account_number: otherVcb.vaAccountNumber,
        bank_bin: '970436',
        bank_name: 'Vietcombank',
        account_type: 'personal-account',
        account_last4: String(otherVcb.accountNumber).slice(-4),
        account_name: 'CLB CO VUA MOI',
        tingee_shop_id: String(otherVcb.shopId),
        created_by: owner.userId,
      });
      await expectOneDefault();
      expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');

      // Audit: không PII; 4 số cuối cũ/mới truy được qua id các dòng payout_accounts.
      expect(await auditTargets(auditCount)).toEqual([
        {
          action: 'tingee_credential.replaced',
          target_id: view.credential?.id,
          changed_fields: ['client_id', 'secret_token_ciphertext', 'retired_at'],
        },
        { action: 'payout_account.unlinked', target_id: mbLinked.id, changed_fields: ['retired_at', 'is_default'] },
        { action: 'payout_account.unlinked', target_id: acbLinked.id, changed_fields: ['retired_at'] },
        {
          action: 'payout_account.linked',
          target_id: newAccountId,
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
        },
        { action: 'payout_account.default_changed', target_id: newAccountId, changed_fields: ['is_default'] },
      ]);

      // Email cảnh báo: mặc định cũ (MB) → VCB, chỉ id và mốc giờ.
      const jobs = await warningJobs();
      expect(jobs).toEqual([
        {
          organizationId: orgId,
          previousAccountId: mbLinked.id,
          nextAccountId: newAccountId,
          actorUserId: owner.userId,
          changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          reason: 'tingee_key_replaced',
        },
      ]);
      expect(JSON.stringify(jobs)).not.toContain(OTHER.secretToken);

      // Lần xác nhận đã tiêu: không dùng lại được ở bước nào.
      expectError(await begin({ token }), 403, 'REAUTH_REQUIRED');
      expectError(await replace(OTHER, otherAcb, { token }), 403, 'REAUTH_REQUIRED');

      // Sau đó: danh sách đọc bằng key mới; thêm tài khoản khác đi đường `select` (không thành mặc định); key cũ không
      // còn dùng được qua `connect`.
      resetFake();
      const relisted = PayoutAccountOptions.parse(expectOk(await options()));
      expect(relisted.accounts.map((a) => [a.vaAccountNumber, a.linked])).toEqual([
        [otherVcb.vaAccountNumber, true],
        [otherVietin.vaAccountNumber, false],
        [otherAcb.vaAccountNumber, false],
      ]);
      expect(fake.calls('/v1/get-va-paging')).toEqual([expect.objectContaining({ clientId: OTHER.clientId })]);
      expect(await link(otherAcb)).toMatchObject({ isDefault: false });
      expectError(await select(String(mb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      expectError(await connect(MAIN), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    });

    it('đổi key khi đã hủy hết tài khoản: tài khoản mới mặc định, job cảnh báo "chưa có" (previousAccountId null) → mới', async () => {
      expectOk(await unlink(mbLinked.id));
      expectOk(await unlink(acbLinked.id));
      expect((await overview()).accounts).toEqual([]);
      const jobsBefore = (await warningJobs()).length;

      const view = PayoutAccountOverview.parse(expectOk(await replace(OTHER, otherAcb)));
      expect(summary(view)).toEqual([[otherAcb.vaAccountNumber, true]]);
      await expectOneDefault();
      const jobs = await warningJobs();
      expect(jobs).toHaveLength(jobsBefore + 1);
      expect(jobs.at(-1)).toMatchObject({
        previousAccountId: null,
        nextAccountId: view.accounts[0]?.id,
        reason: 'tingee_key_replaced',
      });
      // Không còn tài khoản hiện hành cũ nên không có dòng `payout_account.unlinked` mới.
      expect((await audits()).slice(-3).map((a) => a.action)).toEqual([
        'tingee_credential.replaced',
        'payout_account.linked',
        'payout_account.default_changed',
      ]);
      expect(await noticeCodes(admin.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    });

    it('key mới của cùng merchant (thay key, cùng VA): MB cũ gỡ mềm, MB dòng mới gắn credential mới', async () => {
      fake.merchant(OTHER.clientId).accounts = [mb];
      const view = PayoutAccountOverview.parse(expectOk(await replace(OTHER, mb)));
      expect(summary(view)).toEqual([[mb.vaAccountNumber, true]]);
      expect(view.accounts[0]?.id).not.toBe(mbLinked.id);
      const rows = (await accountRows()).filter((r) => r.va_account_number === mb.vaAccountNumber);
      expect(rows.map((r) => [r.id, r.retired_at === null])).toEqual([
        [mbLinked.id, false],
        [view.accounts[0]?.id, true],
      ]);
      expect(await warningJobs()).toEqual([
        expect.objectContaining({ previousAccountId: mbLinked.id, nextAccountId: view.accounts[0]?.id }),
      ]);
    });

    it('thiếu xác nhận ở mọi bước (không header, sai, đã dùng, hết hạn, của session khác) → 403 REAUTH_REQUIRED, không gọi Tingee, không đổi gì', async () => {
      const used = await reauthToken(h, owner);
      expectOk(await setDefault(acbLinked.id, { token: used }));
      const expired = await reauthToken(h, owner);
      await h.db.pool.query(`UPDATE reauth_grants SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [
        sha256(expired),
      ]);
      const otherCookie = await signIn(h, owner.email);
      const otherSession = await reauthToken(h, { cookie: otherCookie, email: owner.email });
      resetFake();
      const before = await snapshot();

      for (const token of [null, 'khong-phai-token', used, expired, otherSession]) {
        for (const res of [await begin({ token }), await preview(OTHER, { token }), await replace(OTHER, otherVcb, { token })]) {
          const error = expectError(res, 403, 'REAUTH_REQUIRED');
          expect(error.details).toEqual({ method: 'email_otp' });
        }
      }
      expect(fake.requests).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
      expect(await grantUsed(otherSession)).toBe(false);
    });

    it('xem trước: key sai, key thiếu quyền, merchant bị khóa, Tingee lỗi → lỗi tại chỗ; không ghi gì, lần xác nhận không bị tiêu', async () => {
      const token = await reauthToken(h, owner);
      const before = await snapshot();
      const invalid = expectError(
        await preview({ clientId: OTHER.clientId, secretToken: 'tg-secret-sai' }, { token }),
        422,
        'TINGEE_CREDENTIAL_INVALID',
      );
      expect(invalid.message).toBe('Client ID hoặc Secret Token không đúng.');
      expectError(await preview(FORBIDDEN, { token }), 422, 'TINGEE_CREDENTIAL_INVALID');
      expectError(await preview(SUSPENDED, { token }), 409, 'MERCHANT_SUSPENDED');
      expectError(await preview(BROKEN, { token }), 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
      expectError(await preview({ clientId: OTHER.clientId }, { token }), 400, 'VALIDATION_FAILED');
      // Danh sách rỗng không phải lỗi.
      expect(TingeeKeyPreview.parse(expectOk(await preview(EMPTY, { token }))).accounts).toEqual([]);
      expect(await grantUsed(token)).toBe(false);
      expect(await snapshot()).toEqual(before);
    });

    it('lưu thất bại (key bị thu hồi sau xem trước, Tingee lỗi, VA không còn/không có, VietinBank) → không đổi gì, lần xác nhận dùng tiếp được', async () => {
      const token = await reauthToken(h, owner);
      expectOk(await preview(OTHER, { token }));
      const before = await snapshot();

      const merchant = fake.merchant(OTHER.clientId);
      merchant.behavior = 'forbidden';
      try {
        expectError(await replace(OTHER, otherVcb, { token }), 422, 'TINGEE_CREDENTIAL_INVALID');
        merchant.behavior = 'error';
        expectError(await replace(OTHER, otherVcb, { token }), 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
      } finally {
        delete merchant.behavior;
      }
      expectError(await replace({ ...OTHER, secretToken: 'tg-secret-sai' }, otherVcb, { token }), 422, 'TINGEE_CREDENTIAL_INVALID');
      expectError(await replace(OTHER, otherInactive, { token }), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      expectError(await replace(OTHER, '9600000000', { token }), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      const vietinError = expectError(await replace(OTHER, otherVietin, { token }), 422, 'BANK_NOT_SUPPORTED');
      expect(vietinError.message).toContain('VietinBank');
      // VCB không còn active giữa lúc xem trước và lúc lưu.
      otherVcb.status = 'inactive';
      expectError(await replace(OTHER, otherVcb, { token }), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      otherVcb.status = 'active';
      expectError(await replace(OTHER, '', { token }), 400, 'VALIDATION_FAILED');

      // Key, tài khoản và tài khoản mặc định cũ không đổi; không audit, không job.
      expect(await snapshot()).toEqual(before);
      expect(await grantUsed(token)).toBe(false);
      expect(summary(await overview())).toEqual([
        [mb.vaAccountNumber, true],
        [acb.vaAccountNumber, false],
      ]);
      expectOk(await replace(OTHER, otherVcb, { token }));
      expect(await grantUsed(token)).toBe(true);
    });

    it('lỗi trong transaction sau khi tiêu lần xác nhận → rollback: không đổi gì, lần xác nhận còn dùng được', async () => {
      const token = await reauthToken(h, owner);
      // Dữ liệu lệch giữa lúc kiểm (trước Tingee) và lúc ghi: giả lập bằng xóa thẳng các dòng tài khoản (service không
      // bao giờ xóa), nên transaction thấy BTC "chưa từng liên kết" ngay sau khi tiêu lần xác nhận.
      let removed: Record<string, unknown>[] = [];
      afterNextList = async () => {
        removed = (await h.db.pool.query('DELETE FROM payout_accounts WHERE organization_id = $1 RETURNING *', [orgId])).rows;
      };
      const before = await snapshot();
      expectError(await replace(OTHER, otherVcb, { token }), 409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
      expect(await grantUsed(token)).toBe(false);
      expect(await credentialRows()).toEqual(before.credentials);
      expect(await audits()).toEqual(before.audits);
      expect(await warningJobs()).toEqual([]);

      // Trả lại các dòng: lần xác nhận vẫn dùng được.
      for (const row of removed) {
        const columns = Object.keys(row);
        await h.db.pool.query(
          `INSERT INTO payout_accounts (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
          columns.map((c) => row[c]),
        );
      }
      expectOk(await replace(OTHER, otherVcb, { token }));
      expect(await grantUsed(token)).toBe(true);
    });

    it('hai tab: cùng một lần xác nhận → một 200, một REAUTH_REQUIRED; hai lần xác nhận → cả hai lưu lần lượt, đúng một credential hiện hành và một mặc định', async () => {
      const token = await reauthToken(h, owner);
      const same = await Promise.all([replace(OTHER, otherVcb, { token }), replace(OTHER, otherAcb, { token })]);
      expect(same.map((r) => r.status).sort()).toEqual([200, 403]);
      expect((await credentialRows()).filter((r) => r.retired_at === null)).toHaveLength(1);
      expect((await overview()).accounts).toHaveLength(1);
      expect((await audits()).filter((a) => a.action === 'tingee_credential.replaced')).toHaveLength(1);

      const [t1, t2] = await ownerTokens(2);
      const both = await Promise.all([replace(OTHER, otherVcb, { token: t1 }), replace(OTHER, otherAcb, { token: t2 })]);
      for (const res of both) expectOk(res);
      expect((await credentialRows()).filter((r) => r.retired_at === null)).toHaveLength(1);
      expect((await overview()).accounts).toHaveLength(1);
      await expectOneDefault();
      expect(await warningJobs()).toHaveLength(3);
    });

    it('tab khác thêm tài khoản bằng key cũ trong lúc lưu đổi key: tab kia thấy credential đã đổi → PAYOUT_ACCOUNT_UNAVAILABLE', async () => {
      const vcb = trackedAccount({ bankName: 'Vietcombank', bankBin: '970436' });
      fake.merchant(MAIN.clientId).accounts.push(vcb);
      afterNextList = async () => {
        expectOk(await replace(OTHER, otherVcb));
      };
      expectError(await select(String(vcb.vaAccountNumber)), 409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      expect(summary(await overview())).toEqual([[otherVcb.vaAccountNumber, true]]);
      await expectOneDefault();
    });
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
  it('Admin gọi mọi route (kể cả đổi key Tingee) → 403 FORBIDDEN_ROLE, không gọi Tingee', async () => {
    expectError(await tracked(h.http.get(base()).set('cookie', admin.cookie)), 403, 'FORBIDDEN_ROLE');
    expectError(await connect(MAIN, admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await options(admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await select(String(mb.vaAccountNumber), admin.cookie), 403, 'FORBIDDEN_ROLE');
    expect(fake.requests).toHaveLength(0);
    // Hủy liên kết và đặt mặc định trên tài khoản có thật.
    expectOk(await connect(MAIN));
    const account = PayoutAccount.parse(expectOk(await select(String(mb.vaAccountNumber))));
    resetFake();
    expectError(await unlink(account.id, { cookie: admin.cookie }), 403, 'FORBIDDEN_ROLE');
    expectError(await setDefault(account.id, { cookie: admin.cookie }), 403, 'FORBIDDEN_ROLE');
    // Kiểm quyền trước xác nhận lại: Admin có lần xác nhận hợp lệ của chính mình vẫn FORBIDDEN_ROLE, và lần xác nhận đó
    // không bị tiêu.
    const adminToken = await reauthToken(h, admin);
    expectError(await unlink(account.id, { cookie: admin.cookie, token: adminToken }), 403, 'FORBIDDEN_ROLE');
    expectError(await setDefault(account.id, { cookie: admin.cookie, token: adminToken }), 403, 'FORBIDDEN_ROLE');
    // Đổi key Tingee (2.13-b): ba bước, có hay không có lần xác nhận.
    for (const token of [adminToken, null]) {
      const replacement = (step: string, body: object = {}) =>
        withReauth(() => h.http.post(`${base()}/credential/replacement${step}`).send(body), {
          cookie: admin.cookie,
          token,
        });
      expectError(await replacement('/begin'), 403, 'FORBIDDEN_ROLE');
      expectError(await replacement('/preview', OTHER), 403, 'FORBIDDEN_ROLE');
      expectError(await replacement('', { ...OTHER, vaAccountNumber: '9600000000' }), 403, 'FORBIDDEN_ROLE');
    }
    expect(await grantUsed(adminToken)).toBe(false);
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
