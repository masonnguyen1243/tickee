import {
  ErrorResponse,
  PayoutAccount,
  PayoutAccountOverview,
  Role,
  StatusNoticeList,
  type LinkPayoutAccountRequest,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpTingeeClient, TINGEE_CLIENT } from '../../src/modules/tingee/index.js';
import { apiConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 2.6: liên kết tài khoản nhận tiền trên Tingee fake (server HTTP thật) và Postgres thật. Tingee luôn được gọi
 * ngoài transaction; mỗi lần ghi trạng thái là một transaction riêng có audit; tối đa một dòng `linked` mỗi BTC.
 * Không bao giờ gọi Tingee thật.
 */

const { TINGEE_CLIENT_ID, TINGEE_SECRET_TOKEN } = apiConfig();
const PHONE = '0912345678';
const CCCD = '079203001234';
/** Timeout ngắn để kịch bản "treo" không làm test chậm (mặc định thật là 15 giây). */
const TIMEOUT_MS = 1_500;

let fake: TingeeFake;
let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let seq = 0;

/** Số tài khoản duy nhất cho mỗi lần gọi, đuôi chọn kịch bản của fake (`0000`, `1111`, `4343`, `8181`, `5000`). */
const account = (suffix: string) => `88${String(Date.now() % 1e6).padStart(6, '0')}${String(++seq).padStart(2, '0')}${suffix}`;
const usedAccounts: string[] = [];

const form = (suffix: string, overrides: Partial<LinkPayoutAccountRequest> = {}): LinkPayoutAccountRequest => {
  const accountNumber = account(suffix);
  usedAccounts.push(accountNumber);
  return {
    bankBin: '970422',
    accountNumber,
    accountName: 'Nguyễn Văn Đạt',
    identityNumber: CCCD,
    phone: PHONE,
    ...overrides,
  };
};

beforeAll(async () => {
  fake = await startTingeeFake({ clientId: TINGEE_CLIENT_ID, secretToken: TINGEE_SECRET_TOKEN });
  h = await createHarness(
    { TINGEE_BASE_URL: fake.url },
    {
      overrides: [
        {
          provide: TINGEE_CLIENT,
          useValue: new HttpTingeeClient({
            baseUrl: fake.url,
            clientId: TINGEE_CLIENT_ID,
            secretToken: TINGEE_SECRET_TOKEN,
            timeoutMs: TIMEOUT_MS,
          }),
        },
      ],
    },
  );
  owner = await signUp(h);
  admin = await signUp(h);
});
beforeEach(async () => {
  fake.reset();
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

const link = (body: unknown, cookie = owner.cookie, org = orgId) =>
  h.http.post(`/v1/orgs/${org}/payout-account`).set('cookie', cookie).send(body as object);
const confirm = (attemptId: string, otp: string, cookie = owner.cookie) =>
  h.http.post(`/v1/orgs/${orgId}/payout-account/otp`).set('cookie', cookie).send({ attemptId, otp });
const overview = async () =>
  PayoutAccountOverview.parse((await h.http.get(`/v1/orgs/${orgId}/payout-account`).set('cookie', owner.cookie).expect(200)).body);

function expectError(res: Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const { error } = ErrorResponse.parse(res.body);
  expect(error.code).toBe(code);
  return error;
}

async function noticeCodes(cookie: string): Promise<string[]> {
  const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', cookie).expect(200);
  return StatusNoticeList.parse(res.body).map((n) => n.code);
}

async function rows() {
  const result = await h.db.orm.execute<{ id: string; status: string; failure_code: string | null }>(
    sql`SELECT id, status, failure_code FROM payout_accounts WHERE organization_id = ${orgId} ORDER BY created_at`,
  );
  return result.rows;
}

async function auditActions(): Promise<string[]> {
  const result = await h.db.orm.execute<{ action: string }>(
    sql`SELECT action FROM audit_events WHERE organization_id = ${orgId} AND action LIKE 'payout_account.%' ORDER BY id`,
  );
  return result.rows.map((r) => r.action);
}

describe('liên kết tài khoản nhận tiền', () => {
  it('chưa liên kết: GET trả null; Owner và Admin cùng thấy PAYOUT_ACCOUNT_NOT_LINKED (danger, không đóng được)', async () => {
    expect(await overview()).toEqual({ current: null });
    const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', admin.cookie).expect(200);
    const notice = StatusNoticeList.parse(res.body).find((n) => n.code === 'PAYOUT_ACCOUNT_NOT_LINKED');
    expect(notice).toMatchObject({ severity: 'danger', dismissible: false, audience: ['owner', 'admin'] });
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
  });

  it('liên kết ngay: 200 linked, chỉ lưu 4 số cuối; Merchant con tạo một lần; banner biến mất; gửi lại → 409', async () => {
    const body = form('0000');
    const res = await link(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const linked = PayoutAccount.parse(res.body);
    expect(linked).toMatchObject({
      status: 'linked',
      bankBin: '970422',
      accountType: 'personal-account',
      accountLast4: '0000',
      accountName: 'NGUYEN VAN DAT',
      failureCode: null,
    });
    expect(linked.vaAccountNumber).toMatch(/^\d+$/);
    expect(linked.linkedAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(body.accountNumber);

    // Tingee: merchant/create rồi create-va với merchantId; mọi request ký đúng.
    expect(fake.requests.map((r) => r.path)).toEqual(['/v1/merchant/create', '/v1/create-va']);
    expect(fake.requests.every((r) => r.signatureValid && r.clientId === TINGEE_CLIENT_ID)).toBe(true);
    const merchantId = (fake.calls('/v1/create-va')[0]?.body as { merchantId: number }).merchantId;
    const org = await h.db.orm.execute<{ tingee_merchant_id: string }>(
      sql`SELECT tingee_merchant_id FROM organizations WHERE id = ${orgId}`,
    );
    expect(Number(org.rows[0]?.tingee_merchant_id)).toBe(merchantId);

    // DB không có số tài khoản đầy đủ hay CCCD ở bất kỳ cột nào.
    const stored = await h.db.orm.execute(sql`SELECT * FROM payout_accounts WHERE organization_id = ${orgId}`);
    expect(JSON.stringify(stored.rows)).not.toContain(body.accountNumber);
    expect(JSON.stringify(stored.rows)).not.toContain(CCCD);

    expect((await overview()).current).toMatchObject({ id: linked.id, status: 'linked' });
    expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(await noticeCodes(admin.cookie)).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(await auditActions()).toEqual(['payout_account.link_started', 'payout_account.linked']);

    fake.reset();
    expectError(await link(form('0000')), 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    expect(fake.requests).toHaveLength(0);
  });

  it('cần OTP: awaiting_otp + banner "Đang liên kết"; OTP sai → BANK_OTP_INVALID, vẫn chờ; OTP đúng → linked', async () => {
    const started = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    expect(started.status).toBe('awaiting_otp');
    expect((await overview()).current).toMatchObject({ id: started.id, status: 'awaiting_otp' });
    const codes = await noticeCodes(admin.cookie);
    expect(codes).toContain('PAYOUT_ACCOUNT_LINKING');
    expect(codes).not.toContain('PAYOUT_ACCOUNT_NOT_LINKED');

    const wrong = expectError(await confirm(started.id, '999999'), 422, 'BANK_OTP_INVALID');
    expect(wrong.details).toEqual({ field: 'otp' });
    expect((await overview()).current?.status).toBe('awaiting_otp');

    const done = PayoutAccount.parse((await confirm(started.id, '123456').expect(200)).body);
    expect(done).toMatchObject({ id: started.id, status: 'linked', accountLast4: '1111' });
    expect(fake.calls('/v1/confirm-va').every((r) => r.signatureValid)).toBe(true);
    expect(await noticeCodes(owner.cookie)).not.toContain('PAYOUT_ACCOUNT_LINKING');
    // Bấm xác nhận lần nữa: trả lại kết quả, không gọi Tingee.
    const before = fake.calls('/v1/confirm-va').length;
    expect(PayoutAccount.parse((await confirm(started.id, '123456').expect(200)).body).status).toBe('linked');
    expect(fake.calls('/v1/confirm-va')).toHaveLength(before);
    expect(await auditActions()).toEqual([
      'payout_account.link_started',
      'payout_account.otp_requested',
      'payout_account.linked',
    ]);
  });

  it('OTP hết hạn (1065): failed, xác nhận lại → BANK_OTP_EXPIRED; "Gửi lại" tạo lần thử mới, không tạo Merchant con lần nữa', async () => {
    const started = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    expectError(await confirm(started.id, '000000'), 409, 'BANK_OTP_EXPIRED');
    expect((await overview()).current).toMatchObject({ id: started.id, status: 'failed', failureCode: 'BANK_OTP_EXPIRED' });
    expectError(await confirm(started.id, '123456'), 409, 'BANK_OTP_EXPIRED');
    expect(await noticeCodes(owner.cookie)).toContain('PAYOUT_ACCOUNT_NOT_LINKED');

    const again = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    expect(again.id).not.toBe(started.id);
    expect(fake.calls('/v1/merchant/create')).toHaveLength(1);
    await confirm(again.id, '123456').expect(200);
    expect(await auditActions()).toEqual([
      'payout_account.link_started',
      'payout_account.otp_requested',
      'payout_account.failed',
      'payout_account.link_started',
      'payout_account.otp_requested',
      'payout_account.linked',
    ]);
  });

  it('Tingee lỗi lúc xác nhận OTP: lần thử vẫn chờ OTP (giữ confirm_id, không audit failed); mã đúng sau đó → linked', async () => {
    const started = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    expectError(await confirm(started.id, '555555'), 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
    const pending = await h.db.orm.execute<{ status: string; confirm_id: string | null }>(
      sql`SELECT status, confirm_id FROM payout_accounts WHERE id = ${started.id}`,
    );
    expect(pending.rows[0]?.status).toBe('awaiting_otp');
    expect(pending.rows[0]?.confirm_id).toEqual(expect.any(String));
    expect(await auditActions()).not.toContain('payout_account.failed');

    await confirm(started.id, '123456').expect(200);
    expect((await rows()).map((r) => r.status)).toEqual(['linked']);
  });

  it('chờ OTP quá 15 phút: đọc là failed (BANK_OTP_EXPIRED), banner về NOT_LINKED, xác nhận không gọi Tingee, lần thử mới thay thế', async () => {
    const started = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET updated_at = now() - interval '16 minutes' WHERE id = ${started.id}`,
    );
    expect((await overview()).current).toMatchObject({
      id: started.id,
      status: 'failed',
      failureCode: 'BANK_OTP_EXPIRED',
    });
    const codes = await noticeCodes(owner.cookie);
    expect(codes).toContain('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(codes).not.toContain('PAYOUT_ACCOUNT_LINKING');

    const confirmCalls = fake.calls('/v1/confirm-va').length;
    expectError(await confirm(started.id, '123456'), 409, 'BANK_OTP_EXPIRED');
    expect(fake.calls('/v1/confirm-va')).toHaveLength(confirmCalls);

    await link(form('0000')).expect(200);
    expect((await rows()).map((r) => r.status)).toEqual(['failed', 'linked']);
  });

  it('lần thử mới thay lần thử đang chờ OTP: lần cũ failed, xác nhận lần cũ → BANK_OTP_EXPIRED', async () => {
    const first = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    const second = PayoutAccount.parse((await link(form('1111')).expect(200)).body);
    expect((await rows()).map((r) => r.status)).toEqual(['failed', 'awaiting_otp']);
    expectError(await confirm(first.id, '123456'), 409, 'BANK_OTP_EXPIRED');
    await confirm(second.id, '123456').expect(200);
  });

  it('VietinBank 970415 và BIN không hỗ trợ → 422 BANK_NOT_SUPPORTED tại ô ngân hàng, không gọi Tingee, không có dòng', async () => {
    for (const bankBin of ['970415', '970436']) {
      const error = expectError(await link(form('0000', { bankBin })), 422, 'BANK_NOT_SUPPORTED');
      expect(error.details).toEqual({ field: 'bankBin' });
    }
    expect(fake.requests).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it('Tingee từ chối: 1043 → 422 PAYOUT_ACCOUNT_INVALID, 1081 → 409 PAYOUT_ACCOUNT_IN_USE; dòng failed kèm mã', async () => {
    expectError(await link(form('4343')), 422, 'PAYOUT_ACCOUNT_INVALID');
    expectError(await link(form('8181')), 409, 'PAYOUT_ACCOUNT_IN_USE');
    expect(await rows()).toEqual([
      expect.objectContaining({ status: 'failed', failure_code: 'PAYOUT_ACCOUNT_INVALID' }),
      expect.objectContaining({ status: 'failed', failure_code: 'PAYOUT_ACCOUNT_IN_USE' }),
    ]);
    // Merchant con lưu từ lần đầu, lần sau không tạo lại.
    expect(fake.calls('/v1/merchant/create')).toHaveLength(1);
    expect(await auditActions()).toEqual([
      'payout_account.link_started',
      'payout_account.failed',
      'payout_account.link_started',
      'payout_account.failed',
    ]);
  });

  it('Tingee treo: gọi ngoài transaction (dòng linking đã commit, DB vẫn ghi được) → 503 PAYMENT_PROVIDER_UNAVAILABLE, failed', async () => {
    // Merchant con có sẵn để request treo ngay ở create-va.
    await h.db.orm.execute(sql`UPDATE organizations SET tingee_merchant_id = 424242 WHERE id = ${orgId}`);
    const pending = link(form('5000')).then((r) => r);
    await fake.waitFor('/v1/create-va');

    // Trong lúc Tingee treo: dòng `linking` và audit đã commit (thấy từ kết nối khác); dòng BTC và bảng payout không bị
    // khóa (UPDATE với lock_timeout ngắn vẫn chạy).
    expect((await rows()).map((r) => r.status)).toEqual(['linking']);
    expect(await auditActions()).toEqual(['payout_account.link_started']);
    const client = await h.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '500ms'`);
      await client.query('UPDATE organizations SET name = name WHERE id = $1', [orgId]);
      await client.query('UPDATE payout_accounts SET updated_at = updated_at WHERE organization_id = $1', [orgId]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const res = await pending;
    const error = expectError(res, 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
    expect(error.message).toBe('Tingee tạm lỗi, thử lại sau ít phút.');
    expect(await rows()).toEqual([
      expect.objectContaining({ status: 'failed', failure_code: 'PAYMENT_PROVIDER_UNAVAILABLE' }),
    ]);
  });

  it('dòng linking mồ côi quá 5 phút được đọc là failed', async () => {
    await h.db.orm.execute(sql`
      INSERT INTO payout_accounts (organization_id, status, bank_bin, account_type, account_last4, account_name, created_by, updated_at)
      VALUES (${orgId}, 'linking', '970422', 'personal-account', '0000', 'NGUYEN VAN A', ${owner.userId}, now() - interval '10 minutes')`);
    expect((await overview()).current).toMatchObject({ status: 'failed', failureCode: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    // Lần thử mới vẫn chạy và đóng dòng mồ côi.
    await link(form('0000')).expect(200);
    expect((await rows()).map((r) => r.status)).toEqual(['failed', 'linked']);
  });

  it('hai tab gửi cùng lúc: tối đa một dòng linked, lần còn lại 409', async () => {
    const results = await Promise.all([link(form('0000')), link(form('0000')), link(form('0000'))]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    for (const res of results.filter((r) => r.status !== 200)) {
      expectError(res, 409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
    }
    const all = await rows();
    expect(all.filter((r) => r.status === 'linked')).toHaveLength(1);
    // Không dòng nào bị bỏ lại `linking`: lần thua đều `failed`.
    expect(all.filter((r) => r.status !== 'linked').every((r) => r.status === 'failed')).toBe(true);
    // Mọi create-va dùng cùng một Merchant con, đúng id đã lưu.
    const stored = await h.db.orm.execute<{ tingee_merchant_id: string }>(
      sql`SELECT tingee_merchant_id FROM organizations WHERE id = ${orgId}`,
    );
    const merchantIds = fake.calls('/v1/create-va').map((r) => (r.body as { merchantId: number }).merchantId);
    expect(merchantIds.length).toBeGreaterThan(0);
    expect(new Set(merchantIds)).toEqual(new Set([Number(stored.rows[0]?.tingee_merchant_id)]));
  });

  it('Admin gọi API → 403 FORBIDDEN_ROLE; body sai → 400 VALIDATION_FAILED', async () => {
    expectError(await h.http.get(`/v1/orgs/${orgId}/payout-account`).set('cookie', admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await link(form('0000'), admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await confirm('019a3b2c-5678-7abc-8def-0123456789ab', '123456', admin.cookie), 403, 'FORBIDDEN_ROLE');
    expectError(await link({ ...form('0000'), identityNumber: '123' }), 400, 'VALIDATION_FAILED');
    expectError(await confirm('khong-phai-uuid', '123456'), 400, 'VALIDATION_FAILED');
    expectError(await confirm('019a3b2c-5678-7abc-8def-0123456789ab', '123456'), 404, 'NOT_FOUND');
    expect(fake.requests).toHaveLength(0);
  });

  it('log api không có số tài khoản đầy đủ, CCCD, SĐT hay secret Tingee', () => {
    const text = h.logs.text;
    expect(usedAccounts.length).toBeGreaterThan(5);
    for (const accountNumber of usedAccounts) expect(text).not.toContain(accountNumber);
    expect(text).not.toContain(CCCD);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(TINGEE_SECRET_TOKEN);
    // Tingee từ chối thì log có mã Tingee.
    expect(text).toContain('"tingeeCode":"1043"');
  });
});
