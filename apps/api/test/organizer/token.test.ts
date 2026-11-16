import { ErrorResponse, Role, TokenOverview } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TINGEE_TOKEN_BALANCE_TIMEOUT_MS, type TingeeCredential } from '../../src/modules/tingee/index.js';
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
 * Không lưu số ở đâu, log không có số. Mỗi test một BTC mới.
 */

const MAIN: TingeeCredential = { clientId: 'tg-token-main-3c5d', secretToken: 'tg-token-main-secret-Qa1Ws2Ed3' };
const FORBIDDEN: TingeeCredential = { clientId: 'tg-token-forbidden-7e1f', secretToken: 'tg-token-forbidden-Rf4Tg5' };
const BROKEN: TingeeCredential = { clientId: 'tg-token-broken-9a2b', secretToken: 'tg-token-broken-Yh6Uj7' };
const HANGING: TingeeCredential = { clientId: 'tg-token-hang-4d6e', secretToken: 'tg-token-hang-Ik8Ol9' };
const PORTAL = 'https://baas.tingee.vn';
const account = fakeAccount({ accountName: 'TRAN VAN BINH' });
const payout = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};

type TestOrg = Org & { admin: User };

let fake: TingeeFake;
let h: Harness;
/** BTC tạo trong file này: đặt lại cờ dịch vụ thanh toán khi xong (job dò của file khác không phải dò chúng). */
const created: string[] = [];

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [account] },
      { ...FORBIDDEN, accounts: [account], behavior: 'forbidden' },
      { ...BROKEN, accounts: [account], behavior: 'error' },
      { ...HANGING, accounts: [account], behavior: 'hang' },
    ],
  });
  // Adapter thật (`TingeeModule`), không bọc: đúng timeout và cách nối của production.
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
});
beforeEach(() => {
  fake.reset();
  const main = fake.merchant(MAIN.clientId);
  main.token = undefined;
  main.tokenReplies = [];
});
afterAll(async () => {
  for (const orgId of created) await resetPaymentService(h, orgId);
  await h.close();
  await fake.close();
});

/** BTC mới của một Owner mới, có một Admin; `credential` khác `null` thì có tài khoản nhận tiền mặc định ký bằng key đó. */
async function newOrg(credential: TingeeCredential | null = MAIN): Promise<TestOrg> {
  const owner = await signUp(h);
  const orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Bóng bàn' }).expect(201))
    .body.id as string;
  created.push(orgId);
  const org = { h, owner, orgId };
  if (credential) await linkPayoutAccount(org, credential, payout);
  const admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return { ...org, admin };
}

const tokenOf = (org: Pick<Org, 'orgId'>, cookie: string) => h.http.get(`/v1/orgs/${org.orgId}/token`).set('cookie', cookie);

/** `GET …/token` → 200, body đúng dạng `TokenOverview` (kiểm cả dạng thô: không có trường thừa). */
async function overviewOf(org: Pick<Org, 'orgId'>, cookie: string) {
  const res = await tokenOf(org, cookie);
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(TokenOverview.parse(res.body)).toEqual(res.body);
  return res.body as TokenOverview;
}

const unavailable = { status: 'unavailable' };

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
    });
    const readAt = Date.parse(body.reading.status === 'ok' ? body.reading.readAt : '');
    expect(readAt).toBeGreaterThanOrEqual(before - 1_000);
    expect(readAt).toBeLessThanOrEqual(after + 1_000);

    const calls = fake.calls(TOKEN_BALANCE_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ clientId: MAIN.clientId, signatureValid: true, body: {} });

    // Mỗi lần xem một lần đọc mới (không cache): Tingee đổi số thì lần xem sau thấy ngay.
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
    });
    expect(body).not.toHaveProperty('tingeePortalUrl');
  });

  it('timeout: Tingee treo → unavailable sau khoảng 3 giây; không retry', async () => {
    expect(TINGEE_TOKEN_BALANCE_TIMEOUT_MS).toBe(3_000);
    const org = await newOrg(HANGING);
    const started = Date.now();
    const body = await overviewOf(org, org.owner.cookie);
    const elapsed = Date.now() - started;
    expect(body).toEqual({ reading: unavailable, tingeePortalUrl: PORTAL });
    expect(elapsed).toBeGreaterThanOrEqual(2_900);
    expect(elapsed).toBeLessThan(6_000);
    expect(fake.calls(TOKEN_BALANCE_PATH)).toHaveLength(1);
  });

  it('Tingee lỗi hoặc sai dạng (HTTP 500, code ≠ 00, thiếu trường, số lẻ, hạn mức âm) → unavailable; mỗi lần xem đúng một lời gọi', async () => {
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
    expect(await overviewOf(broken, broken.admin.cookie)).toEqual({ reading: unavailable });
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
    expect(await overviewOf(org, org.owner.cookie)).toEqual({ reading: unavailable, tingeePortalUrl: PORTAL });
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
    });
    expect(await overviewOf(never, never.admin.cookie)).toEqual({ reading: { status: 'no_payout_account' } });

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
    expect(await overviewOf(org, org.owner.cookie)).toEqual({ reading: unavailable, tingeePortalUrl: PORTAL });
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
