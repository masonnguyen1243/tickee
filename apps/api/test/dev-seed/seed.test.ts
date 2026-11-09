import { randomUUID } from 'node:crypto';
import { isBlockedBankBin } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paidSalesAllowed } from '../../src/modules/event/index.js';
import { HttpTingeeClient } from '../../src/modules/tingee/index.js';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { Database } from '../../src/platform/db/index.js';
import { migrationDatabaseUrl, TEST_CREDENTIAL_KEYS } from '../helpers.js';
import { DEMO_MERCHANTS, SEED_MERCHANT, SEED_PAYOUT_ACCOUNT } from '../tingee-fake/demo-merchants.js';
import { startTingeeFake } from '../tingee-fake/server.js';
import { DEFAULT_SEED_EMAIL, DEMO_ORGANIZATION_NAME, runDevSeed, seedDevData, type DevSeedIo } from './seed.js';

/*
 * E2-7: seed dev (`pnpm db:seed`) trên Postgres thật (DB `tickee_test`, role `tickee_migrator` như CLI). DB test không
 * bị xóa giữa các lần chạy, nên mỗi test dùng email mới.
 */

let db: Database;
const secretBox = new SecretBox(parseCredentialKeys(TEST_CREDENTIAL_KEYS));
const newEmail = () => `seed-${randomUUID()}@tickee.test`;

beforeAll(() => {
  db = new Database({ connectionString: migrationDatabaseUrl(), max: 2, applicationName: 'tickee-test-dev-seed' });
});
afterAll(async () => {
  await db.close();
});

/** Số dòng của các bảng seed ghi (và `audit_events`: seed không ghi audit). */
async function rowCounts(): Promise<Record<string, number>> {
  const result = await db.orm.execute<Record<string, string>>(sql`
    SELECT (SELECT count(*) FROM users) AS users,
           (SELECT count(*) FROM organizations) AS organizations,
           (SELECT count(*) FROM members) AS members,
           (SELECT count(*) FROM tingee_credentials) AS tingee_credentials,
           (SELECT count(*) FROM payout_accounts) AS payout_accounts,
           (SELECT count(*) FROM audit_events) AS audit_events`);
  return Object.fromEntries(Object.entries(result.rows[0]!).map(([k, v]) => [k, Number(v)]));
}

const cliEnv = (overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  NODE_ENV: 'test',
  MIGRATION_DATABASE_URL: migrationDatabaseUrl(),
  TINGEE_CREDENTIAL_KEYS: TEST_CREDENTIAL_KEYS,
  ...overrides,
});

function captureIo(): DevSeedIo & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

async function demoOrganizationsOf(userId: string) {
  const result = await db.orm.execute<{ id: string; closed_beta_status: string; tingee_ipn_key: string | null }>(sql`
    SELECT o.id, o.closed_beta_status, o.tingee_ipn_key
    FROM organizations o JOIN members m ON m.organization_id = o.id
    WHERE m.user_id = ${userId} AND m.role = 'owner' AND o.name = ${DEMO_ORGANIZATION_NAME}`);
  return result.rows;
}

describe('seedDevData', () => {
  it('lần đầu: tài khoản đã đồng ý NĐ 13, BTC đã duyệt, key demo, một tài khoản nhận tiền mặc định; không audit', async () => {
    const email = newEmail();
    const before = await rowCounts();

    const result = await seedDevData(db, { secretBox, email });

    expect(result.changes.length).toBeGreaterThan(0);
    const after = await rowCounts();
    expect(after).toEqual({
      ...before,
      users: before.users! + 1,
      organizations: before.organizations! + 1,
      members: before.members! + 1,
      tingee_credentials: before.tingee_credentials! + 1,
      payout_accounts: before.payout_accounts! + 1,
    });

    const user = (
      await db.orm.execute<{ id: string; email_verified: boolean; consented_at: Date | null; platform_admin: boolean }>(
        sql`SELECT id, email_verified, consented_at, platform_admin FROM users WHERE email = ${email}`,
      )
    ).rows[0]!;
    expect(user.id).toBe(result.userId);
    expect(user.email_verified).toBe(true);
    expect(user.consented_at).not.toBeNull();
    expect(user.platform_admin).toBe(false);

    const [org] = await demoOrganizationsOf(result.userId);
    expect(org?.id).toBe(result.organizationId);
    expect(org?.closed_beta_status).toBe('approved');
    expect(org?.tingee_ipn_key).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const credential = (
      await db.orm.execute<{ id: string; client_id: string; secret_token_ciphertext: string; created_by: string }>(sql`
        SELECT id, client_id, secret_token_ciphertext, created_by FROM tingee_credentials
        WHERE organization_id = ${result.organizationId} AND retired_at IS NULL`)
    ).rows;
    expect(credential).toHaveLength(1);
    expect(credential[0]!.client_id).toBe(SEED_MERCHANT.clientId);
    expect(credential[0]!.created_by).toBe(result.userId);
    // Mã hóa bằng khóa của api (không lưu plaintext), giải mã ra đúng Secret Token của merchant demo.
    expect(credential[0]!.secret_token_ciphertext).not.toContain(SEED_MERCHANT.secretToken);
    expect(secretBox.open(credential[0]!.secret_token_ciphertext)).toBe(SEED_MERCHANT.secretToken);

    const accounts = (
      await db.orm.execute<{
        tingee_credential_id: string;
        va_account_number: string;
        account_last4: string;
        is_default: boolean;
      }>(sql`
        SELECT tingee_credential_id, va_account_number, account_last4, is_default FROM payout_accounts
        WHERE organization_id = ${result.organizationId} AND retired_at IS NULL`)
    ).rows;
    expect(accounts).toEqual([
      {
        tingee_credential_id: credential[0]!.id,
        va_account_number: SEED_PAYOUT_ACCOUNT.vaAccountNumber,
        account_last4: SEED_PAYOUT_ACCOUNT.accountNumber.slice(-4),
        is_default: true,
      },
    ]);

    // Cùng luật với mở bán: BTC demo bán được Vé có phí.
    expect(await paidSalesAllowed(db.orm, { organizationId: result.organizationId })).toEqual({
      closedBetaApproved: true,
      payoutLinked: true,
    });
  });

  it('lần hai: không thêm hay đổi dòng nào, báo không đổi', async () => {
    const email = newEmail();
    const first = await seedDevData(db, { secretBox, email });
    const before = await rowCounts();

    const second = await seedDevData(db, { secretBox, email });

    expect(second).toEqual({ userId: first.userId, organizationId: first.organizationId, changes: [] });
    expect(await rowCounts()).toEqual(before);
  });

  it('chỉ thêm phần thiếu: tài khoản nhận tiền đã hủy liên kết, Closed Beta bị thu hồi → khôi phục, không tạo BTC mới', async () => {
    const email = newEmail();
    const first = await seedDevData(db, { secretBox, email });
    const orgId = first.organizationId;
    await db.orm.execute(sql`
      UPDATE payout_accounts SET retired_at = now(), is_default = false WHERE organization_id = ${orgId}`);
    await db.orm.execute(sql`UPDATE organizations SET closed_beta_status = 'revoked' WHERE id = ${orgId}`);

    const second = await seedDevData(db, { secretBox, email });

    expect(second.organizationId).toBe(first.organizationId);
    expect(second.changes).toHaveLength(2);
    expect(await demoOrganizationsOf(first.userId)).toHaveLength(1);
    expect(await paidSalesAllowed(db.orm, { organizationId: first.organizationId })).toEqual({
      closedBetaApproved: true,
      payoutLinked: true,
    });
  });
});

describe('dữ liệu demo dùng chung với Tingee fake', () => {
  it('VA seed liên kết là một tài khoản fake trả về cho key demo và chọn được (ngân hàng không bị chặn)', async () => {
    const fake = await startTingeeFake({ merchants: DEMO_MERCHANTS });
    try {
      const client = new HttpTingeeClient({ baseUrl: fake.url, timeoutMs: 2_000 });
      const accounts = await client.listAccounts({
        clientId: SEED_MERCHANT.clientId,
        secretToken: SEED_MERCHANT.secretToken,
      });
      const seeded = accounts.find((a) => a.vaAccountNumber === SEED_PAYOUT_ACCOUNT.vaAccountNumber);
      expect(seeded).toBeDefined();
      expect(isBlockedBankBin(seeded!.bankBin)).toBe(false);
      expect(seeded!.accountLast4).toBe(SEED_PAYOUT_ACCOUNT.accountNumber.slice(-4));
    } finally {
      await fake.close();
    }
  });
});

describe('runDevSeed (CLI)', () => {
  it('mặc định: BTC demo của btc.demo@tickee.local, in email đăng nhập; chạy lại báo không đổi', async () => {
    const io = captureIo();
    expect(await runDevSeed([], cliEnv(), io), io.errors.join('\n')).toBe(0);
    expect(io.lines.join('\n')).toContain(DEFAULT_SEED_EMAIL);

    const again = captureIo();
    const before = await rowCounts();
    expect(await runDevSeed([], cliEnv(), again)).toBe(0);
    expect(again.lines[0]).toMatch(/^Không đổi/);
    expect(again.lines.join('\n')).toContain(DEFAULT_SEED_EMAIL);
    expect(await rowCounts()).toEqual(before);
  });

  it('--email tài khoản có sẵn: tài khoản đó làm Owner của BTC demo, không tạo tài khoản mới, không đổi tài khoản', async () => {
    const email = newEmail();
    const existing = (
      await db.orm.execute<{ id: string }>(sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`)
    ).rows[0]!;
    const before = await rowCounts();

    const io = captureIo();
    // Email viết hoa, có `--` của pnpm phía trước: vẫn là tài khoản đó.
    expect(await runDevSeed(['--', '--email', email.toUpperCase()], cliEnv(), io), io.errors.join('\n')).toBe(0);

    expect((await rowCounts()).users).toBe(before.users);
    const orgs = await demoOrganizationsOf(existing.id);
    expect(orgs).toHaveLength(1);
    expect(await paidSalesAllowed(db.orm, { organizationId: orgs[0]!.id })).toEqual({
      closedBetaApproved: true,
      payoutLinked: true,
    });
    // Tài khoản có sẵn giữ nguyên: chưa đồng ý NĐ 13 thì vẫn qua màn đồng ý như bình thường.
    const user = (
      await db.orm.execute<{ consented_at: Date | null }>(sql`SELECT consented_at FROM users WHERE id = ${existing.id}`)
    ).rows[0]!;
    expect(user.consented_at).toBeNull();
    expect(io.lines.join('\n')).toContain(email);
  });

  it('NODE_ENV=production → từ chối, mã ≠ 0, không ghi gì', async () => {
    const email = newEmail();
    const before = await rowCounts();
    const io = captureIo();

    expect(await runDevSeed(['--email', email], cliEnv({ NODE_ENV: 'production' }), io)).not.toBe(0);

    expect(io.errors.join('\n')).toContain('NODE_ENV=production');
    expect(await rowCounts()).toEqual(before);
  });

  it.each([
    ['email sai dạng', ['--email', 'khong-phai-email']],
    ['--email thiếu giá trị', ['--email']],
    ['tham số lạ', ['--force']],
  ])('%s → mã ≠ 0, không ghi gì', async (_name, argv) => {
    const before = await rowCounts();
    const io = captureIo();

    expect(await runDevSeed(argv, cliEnv(), io)).not.toBe(0);

    expect(io.errors.join('\n')).toContain('Cách dùng');
    expect(await rowCounts()).toEqual(before);
  });

  it('DB không tới được → mã ≠ 0, nêu ECONNREFUSED, không in mật khẩu', async () => {
    const secret = 's3cret-Gi4-tri-seed';
    const io = captureIo();

    const code = await runDevSeed(
      ['--email', newEmail()],
      cliEnv({ MIGRATION_DATABASE_URL: `postgresql://tickee_migrator:${secret}@127.0.0.1:1/tickee_test` }),
      io,
    );

    expect(code).not.toBe(0);
    const output = [...io.lines, ...io.errors].join('\n');
    expect(output).toContain('ECONNREFUSED');
    expect(output).not.toContain(secret);
  });

  it('thiếu TINGEE_CREDENTIAL_KEYS → mã ≠ 0, nêu tên biến, không ghi gì', async () => {
    const before = await rowCounts();
    const io = captureIo();

    expect(await runDevSeed(['--email', newEmail()], cliEnv({ TINGEE_CREDENTIAL_KEYS: undefined }), io)).not.toBe(0);

    expect(io.errors.join('\n')).toContain('TINGEE_CREDENTIAL_KEYS');
    expect(await rowCounts()).toEqual(before);
  });
});
