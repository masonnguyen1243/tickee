import { ErrorResponse, Role, TokenOverview } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { TokenAlertQueues } from '../../src/modules/organizer/token-alert.js';
import {
  TOKEN_READ_COOLDOWN_SECONDS,
  TOKEN_SETTINGS,
  TokenReader,
  tokenSettings,
  type TokenSettings,
} from '../../src/modules/organizer/token.service.js';
import {
  TINGEE_CLIENT,
  TINGEE_TOKEN_BALANCE_TIMEOUT_MS,
  type TingeeClient,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { apiConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  linkPayoutAccount,
  paymentServiceOf,
  resetPaymentService,
  type Org,
  type User,
} from '../ordering/order-fixtures.js';
import {
  FAKE_TOKEN_BALANCE,
  fakeAccount,
  startTingeeFake,
  TOKEN_BALANCE_PATH,
  type TingeeFake,
} from '../tingee-fake/server.js';

/*
 * Story 4.5-a: `GET /v1/orgs/:orgId/token` trên Postgres thật và Tingee fake (server HTTP thật, hợp đồng tạm
 * `TOKEN_BALANCE_PATH`). Harness dùng adapter thật của `TingeeModule` (timeout đọc Token 3 giây mặc định). Mỗi dòng của
 * I/O Matrix: đọc được (Owner có link portal, Admin không), số dư âm, treo (≈ 3 giây), Tingee lỗi hay sai dạng, key hỏng
 * (không đổi cờ dịch vụ thanh toán), không giải mã được key, chưa có tài khoản mặc định (không gọi Tingee), ngoài BTC.
 * Không lưu số ở đâu, log không có số. Mỗi test một BTC mới. Harness chính `h` đặt cooldown đọc Token về 0 (các test này
 * đọc lại cùng BTC và mong số mới); các lời gọi đồng thời vẫn được gộp.
 *
 * E4-3 phần B (gộp lời gọi và cooldown): harness thứ hai `real` cấu hình như production (cooldown 5 giây). Mỗi dòng của
 * I/O Matrix: nhiều tab cùng lúc, tải lại trong cooldown, hết cooldown, Tingee lỗi hay treo, đổi key, hai BTC, lỗi bất
 * ngờ; thêm cooldown tính từ lúc lời gọi xong (giả `Date`), bản ghi bị xóa khi hết cooldown mà không cần lần đọc kế
 * (timer của bản ghi cũ không xóa bản ghi mới), mỗi request vẫn tự đánh giá ngưỡng, log không có số kể cả khi dùng lại,
 * lần đọc không gọi Tingee không tạo bản ghi.
 */

const MAIN: TingeeCredential = { clientId: 'tg-token-main-3c5d', secretToken: 'tg-token-main-secret-Qa1Ws2Ed3' };
const FORBIDDEN: TingeeCredential = { clientId: 'tg-token-forbidden-7e1f', secretToken: 'tg-token-forbidden-Rf4Tg5' };
const BROKEN: TingeeCredential = { clientId: 'tg-token-broken-9a2b', secretToken: 'tg-token-broken-Yh6Uj7' };
const HANGING: TingeeCredential = { clientId: 'tg-token-hang-4d6e', secretToken: 'tg-token-hang-Ik8Ol9' };
/** Key mới của BTC sau khi đổi key (2.13-b) trong cooldown. */
const NEXT: TingeeCredential = { clientId: 'tg-token-next-8f0a', secretToken: 'tg-token-next-secret-Pl0Ok9Ij8' };
const PORTAL = 'https://baas.tingee.vn';
const account = fakeAccount({ accountName: 'TRAN VAN BINH' });
const payout = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};

type TestOrg = Org & { admin: User };

let fake: TingeeFake;
/** Harness chính: cooldown đọc Token 0 (chỉ gộp lời gọi đồng thời). */
let h: Harness;
/** Harness cấu hình như production (cooldown `TOKEN_READ_COOLDOWN_SECONDS`), cho các test gộp lời gọi và cooldown. */
let real: Harness;
/** BTC tạo trong file này: đặt lại cờ dịch vụ thanh toán khi xong (job dò của file khác không phải dò chúng). */
const created: string[] = [];
/** Cổng đang giữ lời gọi đọc Token (`holdTokenReads`): `afterEach` mở, để test đỏ giữa chừng không để lời gọi treo. */
let held: (() => void) | null = null;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [account] },
      { ...FORBIDDEN, accounts: [account], behavior: 'forbidden' },
      { ...BROKEN, accounts: [account], behavior: 'error' },
      { ...HANGING, accounts: [account], behavior: 'hang' },
      { ...NEXT, accounts: [account] },
    ],
  });
  // Adapter thật (`TingeeModule`), không bọc: đúng timeout và cách nối của production.
  const settings: TokenSettings = { ...tokenSettings(apiConfig({ TINGEE_BASE_URL: fake.url })), readCooldownMs: 0 };
  h = await createHarness({ TINGEE_BASE_URL: fake.url }, { overrides: [{ provide: TOKEN_SETTINGS, useValue: settings }] });
  real = await createHarness({ TINGEE_BASE_URL: fake.url });
});
beforeEach(() => {
  fake.reset();
  for (const clientId of [MAIN.clientId, NEXT.clientId]) {
    const merchant = fake.merchant(clientId);
    merchant.token = undefined;
    merchant.tokenReplies = [];
  }
});
afterEach(() => {
  held?.();
  held = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(async () => {
  for (const orgId of created) {
    await h.db.orm.execute(
      sql`UPDATE organizations SET token_alert_threshold = NULL, token_below_threshold_since = NULL WHERE id = ${orgId}`,
    );
    await resetPaymentService(h, orgId);
  }
  await real.close();
  await h.close();
  await fake.close();
});

/**
 * BTC mới của một Owner mới trên `harness`, có một Admin; `credential` khác `null` thì có tài khoản nhận tiền mặc định
 * ký bằng key đó.
 */
async function newOrg(credential: TingeeCredential | null = MAIN, harness: Harness = h): Promise<TestOrg> {
  const owner = await signUp(harness);
  const orgId = (
    await harness.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Bóng bàn' }).expect(201)
  ).body.id as string;
  created.push(orgId);
  const org = { h: harness, owner, orgId };
  if (credential) await linkPayoutAccount(org, credential, payout);
  const admin = await signUp(harness);
  await harness.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return { ...org, admin };
}

/** `GET …/token` trên harness của BTC (`org.h`). */
const tokenOf = (org: Pick<Org, 'h' | 'orgId'>, cookie: string) =>
  org.h.http.get(`/v1/orgs/${org.orgId}/token`).set('cookie', cookie);

/** `GET …/token` → 200, body đúng dạng `TokenOverview` (kiểm cả dạng thô: không có trường thừa). */
async function overviewOf(org: Pick<Org, 'h' | 'orgId'>, cookie: string) {
  const res = await tokenOf(org, cookie);
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(TokenOverview.parse(res.body)).toEqual(res.body);
  return res.body as TokenOverview;
}

const unavailable = { status: 'unavailable' };
/** BTC chưa đặt ngưỡng cảnh báo (Story 4.5-b): `GET …/token` luôn trả `alert`, đọc Token không ghi DB. */
const NO_ALERT = { threshold: null, belowThresholdSince: null };

/** Dòng audit của BTC (đọc Token không ghi audit). */
async function auditCount(orgId: string): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_events WHERE organization_id = $1',
    [orgId],
  );
  return rows[0]!.n;
}

/** Dòng `organizations` của BTC (đọc Token không ghi gì vào đây, kể cả cờ dịch vụ thanh toán). */
async function organizationRow(orgId: string) {
  const { rows } = await h.db.pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  return rows[0] as Record<string, unknown>;
}

describe('Trang Token: đọc số dư và hạn mức (Story 4.5-a)', () => {
  it('đọc được (Owner): fake 1.200 / 500 → khả dụng 1.700, readAt theo đồng hồ server, link portal; một lời gọi ký bằng key của BTC, body {}', async () => {
    const org = await newOrg();
    const before = Date.now();
    const body = await overviewOf(org, org.owner.cookie);
    const after = Date.now();
    expect(FAKE_TOKEN_BALANCE).toEqual({ balance: 1_200, creditLimit: 500 });
    expect(body).toEqual({
      reading: { status: 'ok', balance: 1_200, creditLimit: 500, available: 1_700, readAt: expect.any(String) },
      tingeePortalUrl: PORTAL,
      alert: NO_ALERT,
    });
    const readAt = Date.parse(body.reading.status === 'ok' ? body.reading.readAt : '');
    expect(readAt).toBeGreaterThanOrEqual(before - 1_000);
    expect(readAt).toBeLessThanOrEqual(after + 1_000);

    const calls = fake.calls(TOKEN_BALANCE_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ clientId: MAIN.clientId, signatureValid: true, body: {} });

    // Cooldown 0 (harness `h`): lần xem sau là một lần đọc mới, Tingee đổi số thì thấy ngay.
    fake.merchant(MAIN.clientId).token = { balance: 900, creditLimit: 500 };
    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ balance: 900, available: 1_400 });
    expect(fake.calls(TOKEN_BALANCE_PATH)).toHaveLength(2);
  });

  it('số dư âm: -200 / 500 → khả dụng 300', async () => {
    const org = await newOrg();
    fake.merchant(MAIN.clientId).token = { balance: -200, creditLimit: 500 };
    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({
      status: 'ok',
      balance: -200,
      creditLimit: 500,
      available: 300,
    });
  });

  it('Admin xem: đủ số; không có tingeePortalUrl', async () => {
    const org = await newOrg();
    const body = await overviewOf(org, org.admin.cookie);
    expect(body).toEqual({
      reading: { status: 'ok', balance: 1_200, creditLimit: 500, available: 1_700, readAt: expect.any(String) },
      alert: NO_ALERT,
    });
    expect(body).not.toHaveProperty('tingeePortalUrl');
  });

  it('timeout: Tingee treo → unavailable sau khoảng 3 giây; không retry', async () => {
    expect(TINGEE_TOKEN_BALANCE_TIMEOUT_MS).toBe(3_000);
    const org = await newOrg(HANGING);
    const started = Date.now();
    const body = await overviewOf(org, org.owner.cookie);
    const elapsed = Date.now() - started;
    expect(body).toEqual({ reading: unavailable, tingeePortalUrl: PORTAL, alert: NO_ALERT });
    expect(elapsed).toBeGreaterThanOrEqual(2_900);
    expect(elapsed).toBeLessThan(6_000);
    expect(fake.calls(TOKEN_BALANCE_PATH)).toHaveLength(1);
  });

  it('Tingee lỗi hoặc sai dạng (HTTP 500, code ≠ 00, thiếu trường, số lẻ, hạn mức âm) → unavailable; với cooldown 0, mỗi lần xem đúng một lời gọi', async () => {
    const org = await newOrg();
    const ok = { balance: 1_200, creditLimit: 500 };
    const replies = [
      { code: '00', httpStatus: 500, data: ok },
      { code: '1006' },
      { code: '00', data: { balance: 1_200 } },
      { code: '00', data: { balance: 1_200.5, creditLimit: 500 } },
      { code: '00', data: { balance: 1_200, creditLimit: -500 } },
    ];
    fake.merchant(MAIN.clientId).tokenReplies = [...replies];
    for (const [i, reply] of replies.entries()) {
      expect((await overviewOf(org, org.owner.cookie)).reading, JSON.stringify(reply)).toEqual(unavailable);
      expect(fake.calls(TOKEN_BALANCE_PATH)).toHaveLength(i + 1);
    }

    const broken = await newOrg(BROKEN);
    fake.reset();
    expect(await overviewOf(broken, broken.admin.cookie)).toEqual({ reading: unavailable, alert: NO_ALERT });
    expect(fake.calls(TOKEN_BALANCE_PATH)).toHaveLength(1);
  });

  it('key hỏng (forbidden 1133, mọi mã key sai) → unavailable; cờ dịch vụ thanh toán không đổi, không audit', async () => {
    const forbidden = await newOrg(FORBIDDEN);
    const before = await organizationRow(forbidden.orgId);
    const audits = await auditCount(forbidden.orgId);
    expect((await overviewOf(forbidden, forbidden.owner.cookie)).reading).toEqual(unavailable);
    expect(await organizationRow(forbidden.orgId)).toEqual(before);
    expect(await paymentServiceOf(h, forbidden.orgId)).toMatchObject({ status: 'active', reason: null });
    expect(await auditCount(forbidden.orgId)).toBe(audits);

    const org = await newOrg();
    for (const code of ['92', '97', '1009', '1133']) {
      fake.merchant(MAIN.clientId).tokenReplies = [{ code, httpStatus: 401 }];
      expect((await overviewOf(org, org.owner.cookie)).reading, code).toEqual(unavailable);
      expect(await paymentServiceOf(h, org.orgId), code).toMatchObject({ status: 'active', reason: null, since: null });
    }

    // BTC đang Tạm ngừng bán: đọc Token (kể cả đọc được hay key bị từ chối) không tắt, không đổi lý do hay mốc.
    await h.db.orm.execute(sql`
      UPDATE organizations
         SET payment_service_status = 'suspended', payment_service_reason = 'token', payment_service_since = now(),
             payment_service_checked_at = NULL
       WHERE id = ${org.orgId}`);
    const suspended = await organizationRow(org.orgId);
    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ status: 'ok' });
    fake.merchant(MAIN.clientId).tokenReplies = [{ code: '97' }];
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual(unavailable);
    expect(await organizationRow(org.orgId)).toEqual(suspended);
  });

  it('không giải mã được key → unavailable, không gọi Tingee; log có kết quả, không có ciphertext', async () => {
    const org = await newOrg();
    const broken = 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    await h.db.orm.execute(
      sql`UPDATE tingee_credentials SET secret_token_ciphertext = ${broken} WHERE organization_id = ${org.orgId}`,
    );
    expect(await overviewOf(org, org.owner.cookie)).toEqual({
      reading: unavailable,
      tingeePortalUrl: PORTAL,
      alert: NO_ALERT,
    });
    expect(fake.calls(TOKEN_BALANCE_PATH)).toEqual([]);
    expect(
      h.logs.lines.find((l) => l.organizationId === org.orgId && l.status === 'unavailable' && l.error === 'SecretBoxError'),
    ).toBeDefined();
    expect(h.logs.text).not.toContain(broken);
  });

  it('chưa có tài khoản nhận tiền mặc định → no_payout_account theo vai; không gọi Tingee', async () => {
    const never = await newOrg(null);
    expect(await overviewOf(never, never.owner.cookie)).toEqual({
      reading: { status: 'no_payout_account' },
      tingeePortalUrl: PORTAL,
      alert: NO_ALERT,
    });
    expect(await overviewOf(never, never.admin.cookie)).toEqual({
      reading: { status: 'no_payout_account' },
      alert: NO_ALERT,
    });

    // Có key nhưng không còn tài khoản mặc định (vd. đã hủy liên kết hết).
    const unlinked = await newOrg();
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${unlinked.orgId}`,
    );
    expect((await overviewOf(unlinked, unlinked.owner.cookie)).reading).toEqual({ status: 'no_payout_account' });
    expect(fake.calls(TOKEN_BALANCE_PATH)).toEqual([]);
  });

  it('ngoài BTC: Owner BTC khác, người không phải thành viên (CTV) → 403 NOT_A_MEMBER; chưa đăng nhập → 401; không gọi Tingee', async () => {
    const org = await newOrg();
    const other = await newOrg();
    const stranger = await signUp(h);
    for (const cookie of [other.owner.cookie, other.admin.cookie, stranger.cookie]) {
      const res = await tokenOf(org, cookie);
      expect(res.status).toBe(403);
      expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
    }
    const anonymous = await h.http.get(`/v1/orgs/${org.orgId}/token`);
    expect(anonymous.status).toBe(401);
    expect(fake.calls(TOKEN_BALANCE_PATH)).toEqual([]);
  });

  it('số quá lớn để cộng chính xác (số dư MAX_SAFE_INTEGER, hạn mức 1) → unavailable; log có kết quả, không có số', async () => {
    const org = await newOrg();
    fake.merchant(MAIN.clientId).token = { balance: Number.MAX_SAFE_INTEGER, creditLimit: 1 };
    const firstLine = h.logs.lines.length;
    expect(await overviewOf(org, org.owner.cookie)).toEqual({
      reading: unavailable,
      tingeePortalUrl: PORTAL,
      alert: NO_ALERT,
    });
    expect(fake.calls(TOKEN_BALANCE_PATH)).toHaveLength(1);

    const lines = h.logs.lines.slice(firstLine);
    // Adapter nhận số (số nguyên an toàn); service từ chối tổng.
    expect(
      lines.find(
        (l) => l.organizationId === org.orgId && l.status === 'unavailable' && l.msg === 'Đọc Token: số Tingee trả quá lớn',
      ),
    ).toBeDefined();
    const logged = JSON.stringify(lines);
    for (const value of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(String)) {
      expect(logged, value).not.toContain(value);
    }
  });

  it('không lưu số: DB không đổi, log chỉ ghi kết quả đọc, không có số dư, hạn mức hay Token khả dụng', async () => {
    const org = await newOrg();
    const balance = 7_350_291;
    const creditLimit = 4_816_073;
    const numbers = [balance, creditLimit, balance + creditLimit].map(String);
    fake.merchant(MAIN.clientId).token = { balance, creditLimit };
    const row = await organizationRow(org.orgId);
    const audits = await auditCount(org.orgId);
    const firstLine = h.logs.lines.length;

    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ balance, creditLimit });
    expect((await overviewOf(org, org.admin.cookie)).reading).toMatchObject({ available: balance + creditLimit });
    fake.merchant(MAIN.clientId).tokenReplies = [{ code: '00', data: { balance: balance + 0.5, creditLimit } }];
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual(unavailable);

    const lines = h.logs.lines.slice(firstLine);
    const logged = JSON.stringify(lines);
    for (const value of [...numbers, MAIN.secretToken]) expect(logged, value).not.toContain(value);
    expect(lines.find((l) => l.organizationId === org.orgId && l.status === 'unavailable')).toBeDefined();
    expect(await organizationRow(org.orgId)).toEqual(row);
    expect(await auditCount(org.orgId)).toBe(audits);
  });
});

/** Phương thức private `sharedRead` của `TokenReader`: mỗi request tới bước gọi Tingee là một lần gọi. */
type SharedReadTarget = { sharedRead(...args: unknown[]): Promise<unknown> };

/** Spy `sharedRead` của `TokenReader` mà harness dùng cho cả `GET …/token` lẫn `readAndEvaluate` (gọi xuyên). */
const spySharedRead = (harness: Harness) =>
  vi.spyOn(harness.app.get(TokenReader) as unknown as SharedReadTarget, 'sharedRead');

/**
 * Chờ đủ `count` request nhập vào `sharedRead` (tức đã dùng chung lời gọi đang chạy) trước khi mở cổng: request đến sau
 * khi lời gọi xong sẽ không còn chung lời gọi đó, nên không chờ bằng `sleep`.
 */
async function enteredSharedRead(spy: MockInstance, count: number): Promise<void> {
  await expect.poll(() => spy.mock.calls.length, { timeout: 5_000, interval: 10 }).toBe(count);
}

/**
 * Giữ mọi lời gọi đọc Token của `real` ở cổng sau khi Tingee fake đã phản hồi (spy `getTokenBalance` của client thật);
 * `open()` thả, kèm ném `fail` nếu có. `afterEach` luôn mở cổng.
 */
function holdTokenReads(fail?: Error) {
  const client = real.app.get<TingeeClient>(TINGEE_CLIENT);
  const original = client.getTokenBalance.bind(client);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  held = open;
  const spy = vi.spyOn(client, 'getTokenBalance').mockImplementation(async (credential) => {
    const result = await original(credential);
    await gate;
    if (fail) throw fail;
    return result;
  });
  return { open, spy };
}

/** `TokenReader` mới dựng từ các provider của `harness`, với cooldown riêng (bản ghi riêng, không chung với route). */
const readerWith = (harness: Harness, readCooldownMs: number) =>
  new TokenReader(
    harness.app.get<Database>(DATABASE),
    harness.app.get<PgBoss>(BOSS),
    harness.app.get<TingeeClient>(TINGEE_CLIENT),
    { ...harness.app.get<TokenSettings>(TOKEN_SETTINGS), readCooldownMs },
    harness.app.get(TokenAlertQueues),
  );

const COOLDOWN_MS = TOKEN_READ_COOLDOWN_SECONDS * 1_000;
/** Chờ tới mốc `performance.now()` (đồng hồ thật: test giả `Date` vẫn dùng được). */
const sleepUntil = (at: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, at - performance.now())));
const tokenCalls = () => fake.calls(TOKEN_BALANCE_PATH);

describe('gộp lời gọi đọc Token theo BTC và cooldown (E4-3 phần B)', () => {
  it('cấu hình production: cooldown 5 giây', () => {
    expect(TOKEN_READ_COOLDOWN_SECONDS).toBe(5);
    expect(real.app.get<TokenSettings>(TOKEN_SETTINGS).readCooldownMs).toBe(5_000);
  });

  it('nhiều tab cùng lúc: 2 GET đồng thời cùng BTC → 1 lời gọi Tingee; hai response cùng reading', async () => {
    const org = await newOrg(MAIN, real);
    const { open } = holdTokenReads();
    const entered = spySharedRead(real);
    const pending = Promise.all([overviewOf(org, org.owner.cookie), overviewOf(org, org.admin.cookie)]);
    await enteredSharedRead(entered, 2);
    open();
    const [owner, admin] = await pending;
    expect(owner.reading).toEqual({
      status: 'ok',
      balance: 1_200,
      creditLimit: 500,
      available: 1_700,
      readAt: expect.any(String),
    });
    expect(admin.reading).toEqual(owner.reading);
    expect(tokenCalls()).toHaveLength(1);
    expect(tokenCalls()[0]).toMatchObject({ clientId: MAIN.clientId, signatureValid: true });
  });

  it('tải lại trong cooldown (1 giây sau): 0 lời gọi mới; cùng readAt và cùng số dù Tingee đã đổi', async () => {
    const org = await newOrg(MAIN, real);
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    const first = await overviewOf(org, org.owner.cookie);
    expect(first.reading).toMatchObject({ status: 'ok', available: 1_700, readAt: new Date(t0).toISOString() });

    fake.merchant(MAIN.clientId).token = { balance: 900, creditLimit: 500 };
    vi.setSystemTime(t0 + 1_000);
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual(first.reading);
    expect((await overviewOf(org, org.admin.cookie)).reading).toEqual(first.reading);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('hết cooldown (5 giây sau khi lời gọi xong): 1 lời gọi mới, số mới, readAt mới', async () => {
    const org = await newOrg(MAIN, real);
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    await overviewOf(org, org.owner.cookie);
    fake.merchant(MAIN.clientId).token = { balance: 900, creditLimit: 500 };
    vi.setSystemTime(t0 + COOLDOWN_MS);
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual({
      status: 'ok',
      balance: 900,
      creditLimit: 500,
      available: 1_400,
      readAt: new Date(t0 + COOLDOWN_MS).toISOString(),
    });
    expect(tokenCalls()).toHaveLength(2);
  });

  it('cooldown tính từ lúc lời gọi xong: Tingee chậm 4 giây → dùng lại tới lúc xong + 5 giây − 1 ms, gọi mới ở lúc xong + 5 giây', async () => {
    const org = await newOrg(MAIN, real);
    vi.useFakeTimers({ toFake: ['Date'] });
    const started = Date.now();
    const { open } = holdTokenReads();
    const pending = overviewOf(org, org.owner.cookie);
    // Lời gọi đã bắt đầu (bản ghi tạo lúc `started`); nó chỉ xong sau khi đồng hồ đã tiến 4 giây.
    await fake.waitFor(TOKEN_BALANCE_PATH, 1);
    const done = started + 4_000;
    vi.setSystemTime(done);
    open();
    const first = await pending;
    expect(first.reading).toMatchObject({ status: 'ok', available: 1_700, readAt: new Date(done).toISOString() });

    fake.merchant(MAIN.clientId).token = { balance: 900, creditLimit: 500 };
    vi.setSystemTime(done + COOLDOWN_MS - 1);
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual(first.reading);
    expect(tokenCalls()).toHaveLength(1);

    vi.setSystemTime(done + COOLDOWN_MS);
    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({
      available: 1_400,
      readAt: new Date(done + COOLDOWN_MS).toISOString(),
    });
    expect(tokenCalls()).toHaveLength(2);
  });

  it('bản ghi bị xóa khi hết cooldown mà không cần lần đọc kế (tiến trình rảnh)', async () => {
    const org = await newOrg(MAIN, real);
    const cooldownMs = 1_000;
    const reader = readerWith(real, cooldownMs);
    expect((await reader.readAndEvaluate(org.orgId)).reading).toMatchObject({ status: 'ok' });
    const settledAt = performance.now();
    expect(reader.sharedReadCount).toBe(1);
    await expect.poll(() => reader.sharedReadCount, { timeout: cooldownMs + 1_500, interval: 20 }).toBe(0);
    const elapsed = performance.now() - settledAt;
    expect(elapsed).toBeGreaterThanOrEqual(cooldownMs - 100);
    expect(elapsed).toBeLessThanOrEqual(cooldownMs + 1_500);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('timer của bản ghi cũ không xóa bản ghi mới cùng khóa (đọc lại ngay khi bản ghi cũ vừa hết hạn)', async () => {
    const org = await newOrg(MAIN, real);
    const cooldownMs = 2_000;
    const reader = readerWith(real, cooldownMs);
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    // Bản ghi A: hết hạn ở t0 + 2 giây (đồng hồ giả), timer A xóa sau 2 giây thật.
    await reader.readAndEvaluate(org.orgId);
    const settledA = performance.now();
    await sleepUntil(settledA + 1_000);
    // A đã hết hạn theo đồng hồ: bản ghi B cùng khóa, timer B xóa sau 2 giây thật nữa (khoảng settledA + 3 giây).
    vi.setSystemTime(t0 + cooldownMs);
    await reader.readAndEvaluate(org.orgId);
    expect(tokenCalls()).toHaveLength(2);

    // Sau timer A, trước timer B: B vẫn còn và vẫn được dùng lại.
    await sleepUntil(settledA + 2_500);
    expect(reader.sharedReadCount).toBe(1);
    vi.setSystemTime(t0 + 3_000);
    await reader.readAndEvaluate(org.orgId);
    expect(tokenCalls()).toHaveLength(2);
  });

  it('Tingee lỗi hay treo: unavailable được giữ trong cooldown, tải lại không gọi thêm', async () => {
    const org = await newOrg(MAIN, real);
    // Lần kế tiếp (nếu có) fake trả số đọc được: tải lại mà gọi Tingee sẽ thấy `ok`.
    fake.merchant(MAIN.clientId).tokenReplies = [{ code: '1006' }];
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual(unavailable);
    expect((await overviewOf(org, org.owner.cookie)).reading).toEqual(unavailable);
    expect(tokenCalls()).toHaveLength(1);

    const hanging = await newOrg(HANGING, real);
    fake.reset();
    const started = Date.now();
    expect((await overviewOf(hanging, hanging.owner.cookie)).reading).toEqual(unavailable);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_900);
    expect((await overviewOf(hanging, hanging.admin.cookie)).reading).toEqual(unavailable);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('đổi key trong cooldown: lần xem sau gọi Tingee ngay bằng key mới', async () => {
    const org = await newOrg(MAIN, real);
    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ status: 'ok', available: 1_700 });

    // Đổi key (2.13-b): gỡ mềm tài khoản và credential cũ, lưu key mới với tài khoản mặc định mới.
    await real.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${org.orgId}`,
    );
    await real.db.orm.execute(
      sql`UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${org.orgId} AND retired_at IS NULL`,
    );
    await linkPayoutAccount(org, NEXT, payout);
    fake.merchant(NEXT.clientId).token = { balance: 300, creditLimit: 0 };

    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ status: 'ok', available: 300 });
    expect(tokenCalls().map((c) => c.clientId)).toEqual([MAIN.clientId, NEXT.clientId]);
  });

  it('hai BTC đọc cùng lúc (dùng chung một merchant): mỗi BTC một lời gọi, không dùng kết quả của nhau', async () => {
    const a = await newOrg(MAIN, real);
    const b = await newOrg(MAIN, real);
    const { open } = holdTokenReads();
    const entered = spySharedRead(real);
    const pending = Promise.all([overviewOf(a, a.owner.cookie), overviewOf(b, b.owner.cookie)]);
    await enteredSharedRead(entered, 2);
    open();
    await pending;
    expect(tokenCalls().map((c) => c.clientId)).toEqual([MAIN.clientId, MAIN.clientId]);

    // Trong cooldown, mỗi BTC dùng lại lần đọc của chính mình.
    await overviewOf(a, a.admin.cookie);
    await overviewOf(b, b.admin.cookie);
    expect(tokenCalls()).toHaveLength(2);
  });

  it('lỗi bất ngờ: mọi request đang chờ nhận cùng lỗi (GET → 500); không giữ lại, lần sau gọi lại ngay', async () => {
    const org = await newOrg(MAIN, real);
    const failure = new Error('Lỗi bất ngờ khi đọc Token');
    const { open, spy } = holdTokenReads(failure);
    const entered = spySharedRead(real);
    const reader = real.app.get(TokenReader);
    const settled = Promise.allSettled([
      reader.readAndEvaluate(org.orgId),
      reader.readAndEvaluate(org.orgId),
      tokenOf(org, org.owner.cookie),
    ]);
    await enteredSharedRead(entered, 3);
    open();
    const [job, again, page] = await settled;
    expect((job as PromiseRejectedResult).reason).toBe(failure);
    expect((again as PromiseRejectedResult).reason).toBe(failure);
    if (page.status !== 'fulfilled') throw page.reason;
    expect(page.value.status).toBe(500);
    expect(ErrorResponse.parse(page.value.body).error.code).toBe('INTERNAL_ERROR');
    expect(tokenCalls()).toHaveLength(1);

    spy.mockRestore();
    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ status: 'ok', available: 1_700 });
    expect(tokenCalls()).toHaveLength(2);
  });

  it('mỗi request vẫn tự đánh giá ngưỡng: đặt ngưỡng trong cooldown → lần xem kế (dùng lại lần đọc) thấy dưới ngưỡng; job dò cùng tiến trình dùng chung bản ghi', async () => {
    const org = await newOrg(MAIN, real);
    const first = await overviewOf(org, org.owner.cookie);
    expect(first.alert).toEqual(NO_ALERT);
    await real.http
      .put(`/v1/orgs/${org.orgId}/token/alert-threshold`)
      .set('cookie', org.owner.cookie)
      .send({ threshold: 2_000 })
      .expect(200);

    const again = await overviewOf(org, org.owner.cookie);
    expect(again.reading).toEqual(first.reading);
    expect(again.alert).toEqual({ threshold: 2_000, belowThresholdSince: expect.any(String) });
    const job = await real.app.get(TokenReader).readAndEvaluate(org.orgId);
    expect(job.reading).toEqual(first.reading);
    expect(job.transition).toBe('unchanged');
    expect(tokenCalls()).toHaveLength(1);
  });

  it('log không có số dư, hạn mức hay Token khả dụng, kể cả khi kết quả được dùng lại', async () => {
    const org = await newOrg(MAIN, real);
    const balance = 6_240_917;
    const creditLimit = 3_518_062;
    const numbers = [balance, creditLimit, balance + creditLimit].map(String);
    fake.merchant(MAIN.clientId).token = { balance, creditLimit };
    await real.http
      .put(`/v1/orgs/${org.orgId}/token/alert-threshold`)
      .set('cookie', org.owner.cookie)
      .send({ threshold: 98_765_432_109 })
      .expect(200);
    // Logger của Nest dùng chung trong tiến trình: log của `real` có thể nằm ở capture của `h`, nên đọc cả hai.
    const firstLine = { h: h.logs.lines.length, real: real.logs.lines.length };

    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ available: balance + creditLimit });
    expect((await overviewOf(org, org.admin.cookie)).reading).toMatchObject({ available: balance + creditLimit });
    expect((await real.app.get(TokenReader).readAndEvaluate(org.orgId)).reading).toMatchObject({ balance });
    expect(tokenCalls()).toHaveLength(1);

    const lines = [...h.logs.lines.slice(firstLine.h), ...real.logs.lines.slice(firstLine.real)];
    const logged = JSON.stringify(lines);
    for (const value of [...numbers, MAIN.secretToken]) expect(logged, value).not.toContain(value);
    expect(lines.find((l) => l.organizationId === org.orgId && l.transition === 'crossed')).toBeDefined();
  });

  it('lần đọc không gọi Tingee không tạo bản ghi (chưa có tài khoản, không giải mã được key); DB và giải mã chạy ở mọi request', async () => {
    const never = await newOrg(null, real);
    const broken = await newOrg(MAIN, real);
    const ciphertext = 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    const { rows } = await real.db.pool.query<{ ciphertext: string }>(
      'SELECT secret_token_ciphertext AS ciphertext FROM tingee_credentials WHERE organization_id = $1',
      [broken.orgId],
    );
    const original = rows[0]!.ciphertext;
    const setCiphertext = (value: string) =>
      real.db.orm.execute(
        sql`UPDATE tingee_credentials SET secret_token_ciphertext = ${value} WHERE organization_id = ${broken.orgId}`,
      );
    await setCiphertext(ciphertext);

    const reader = readerWith(real, COOLDOWN_MS);
    expect((await reader.readAndEvaluate(never.orgId)).reading).toEqual({ status: 'no_payout_account' });
    expect((await reader.readAndEvaluate(broken.orgId)).reading).toEqual(unavailable);
    expect(reader.sharedReadCount).toBe(0);
    expect(tokenCalls()).toEqual([]);

    // Không có gì giữ lại: liên kết tài khoản hay sửa key xong thì lần xem kế đọc được ngay.
    await linkPayoutAccount(never, MAIN, payout);
    expect((await overviewOf(never, never.owner.cookie)).reading).toMatchObject({ status: 'ok' });
    await setCiphertext(original);
    expect((await overviewOf(broken, broken.owner.cookie)).reading).toMatchObject({ status: 'ok' });
    expect(tokenCalls()).toHaveLength(2);

    // Có bản ghi còn trong cooldown: request vẫn đọc DB và giải mã trước, nên key hỏng hay hết tài khoản thấy ngay.
    await setCiphertext(ciphertext);
    expect((await overviewOf(broken, broken.owner.cookie)).reading).toEqual(unavailable);
    await setCiphertext(original);
    await real.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${never.orgId}`,
    );
    expect((await overviewOf(never, never.owner.cookie)).reading).toEqual({ status: 'no_payout_account' });
    expect(tokenCalls()).toHaveLength(2);
  });
});
