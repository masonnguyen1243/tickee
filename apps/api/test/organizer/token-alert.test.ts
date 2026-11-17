import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ErrorResponse,
  JobQueue,
  NOTIFICATION_CATALOG,
  Role,
  StatusNoticeList,
  TOKEN_ALERT_SCAN_CRON,
  TokenAlert,
  TokenAlertEmailPayload,
  TokenOverview,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TokenAlertScanWorker, sendTokenAlertEmail } from '../../src/modules/organizer/token-alert-jobs.js';
import {
  TOKEN_ALERT_EMAIL_QUEUE,
  TokenAlertQueues,
  tokenAlertEmailJobId,
} from '../../src/modules/organizer/token-alert.js';
import { TokenReader } from '../../src/modules/organizer/token.service.js';
import {
  HttpTingeeClient,
  TINGEE_CLIENT,
  type TingeeClient,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { databaseUrl, TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import { linkPayoutAccount, resetPaymentService, type Org, type User } from '../ordering/order-fixtures.js';
import { fakeAccount, startTingeeFake, TOKEN_BALANCE_PATH, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 4.5-b: cảnh báo Token trên Postgres thật và Tingee fake (server HTTP thật, hợp đồng tạm `TOKEN_BALANCE_PATH`).
 * Mỗi dòng của I/O Matrix: lưu ngưỡng (audit, không ghi khi không đổi), ngưỡng sai, Admin đặt, vừa xuống dưới ngưỡng
 * (mốc DB, đúng một job email, `org_status_changed`, banner Owner), vẫn dưới ngưỡng, lên rồi xuống lại, đọc đồng thời,
 * đọc không được, tắt khi đang dưới, đổi ngưỡng khi vẫn dưới, email đến muộn, Tạm ngừng bán vì Token, Admin ở
 * dashboard, ngoài BTC. Job dò mỗi giờ (tuần tự, lỗi một BTC thì đi tiếp, bỏ qua BTC `suspended`) và worker thật. Không
 * số dư, hạn mức hay Token khả dụng trong log, job hay email. Mỗi test một BTC mới.
 */

const MAIN: TingeeCredential = { clientId: 'tg-alert-main-1a2b', secretToken: 'tg-alert-main-secret-Zx9Cv8Bn7' };
/** BTC Tạm ngừng bán của test job dò: key riêng để thấy job không gọi Tingee cho BTC này. */
const PAUSED: TingeeCredential = { clientId: 'tg-alert-paused-3c4d', secretToken: 'tg-alert-paused-Lk6Jh5' };
/** Tingee lỗi (HTTP 500) với key này: đọc `unavailable`. */
const BROKEN: TingeeCredential = { clientId: 'tg-alert-broken-5e6f', secretToken: 'tg-alert-broken-Gf4Ds3' };
/** Lời gọi bằng key này ném lỗi (giả lỗi bất ngờ ở một BTC giữa lượt dò). */
const THROWING: TingeeCredential = { clientId: 'tg-alert-throw-7a8b', secretToken: 'tg-alert-throw-Qw2Er1' };
const PORTAL = 'https://baas.tingee.vn';
const account = fakeAccount({ accountName: 'LE VAN CUONG' });
const payout = {
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
};

type TestOrg = Org & { admin: User };

let fake: TingeeFake;
let h: Harness;
let boss: PgBoss;
let reader: TokenReader;
let scanWorker: TokenAlertScanWorker;
/** Kết nối `LISTEN` riêng: thấy mọi `NOTIFY` của kênh realtime. */
let listener: pg.Client;
const notified: Record<string, unknown>[] = [];
/** BTC tạo trong file này: tắt cảnh báo và đặt lại cờ khi xong (job dò của lần chạy sau không phải đọc chúng). */
const created: string[] = [];
/**
 * Chặn mọi lời gọi đọc Token tới khi đủ `count` lời gọi đang chờ, rồi thả cùng lúc: các lần đọc đều xong trước khi lần
 * đánh giá nào bắt đầu (đọc đồng thời).
 */
let barrier: { count: number; waiting: (() => void)[] } | null = null;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [account] },
      { ...PAUSED, accounts: [account] },
      { ...BROKEN, accounts: [account], behavior: 'error' },
      { ...THROWING, accounts: [account] },
    ],
  });
  // Client HTTP thật trỏ vào fake, bọc thêm rào chặn và lỗi bất ngờ cho đọc Token.
  const http = new HttpTingeeClient({ baseUrl: fake.url });
  const client: TingeeClient = {
    listAccounts: (credential) => http.listAccounts(credential),
    createPaymentLink: (credential, input) => http.createPaymentLink(credential, input),
    getGatewayOrder: (credential, orderId) => http.getGatewayOrder(credential, orderId),
    getMerchantServiceStatus: (credential) => http.getMerchantServiceStatus(credential),
    async getTokenBalance(credential) {
      if (credential.clientId === THROWING.clientId) throw new Error('Lỗi bất ngờ khi đọc Token');
      const result = await http.getTokenBalance(credential);
      const gate = barrier;
      if (gate) {
        await new Promise<void>((resolve) => {
          gate.waiting.push(resolve);
          if (gate.waiting.length >= gate.count) {
            barrier = null;
            for (const release of gate.waiting) release();
          }
        });
      }
      return result;
    },
  };
  h = await createHarness({ TINGEE_BASE_URL: fake.url }, { overrides: [{ provide: TINGEE_CLIENT, useValue: client }] });
  boss = h.app.get<PgBoss>(BOSS);
  reader = h.app.get(TokenReader);
  scanWorker = new TokenAlertScanWorker(h.app.get<Database>(DATABASE), boss, reader);
  await h.app.get(TokenAlertQueues).ready();
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => notified.push(JSON.parse(message.payload ?? '{}') as Record<string, unknown>));
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
});
beforeEach(() => {
  fake.reset();
  const main = fake.merchant(MAIN.clientId);
  main.token = undefined;
  main.tokenReplies = [];
  barrier = null;
});
afterAll(async () => {
  for (const orgId of created) {
    await h.db.orm.execute(
      sql`UPDATE organizations SET token_alert_threshold = NULL, token_below_threshold_since = NULL WHERE id = ${orgId}`,
    );
    await resetPaymentService(h, orgId);
  }
  await listener.end();
  await h.close();
  await fake.close();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * BTC mới (đã duyệt Closed Beta: dải banner chỉ còn thông báo của story này) của một Owner mới, có một Admin;
 * `credential` khác `null` thì có tài khoản nhận tiền mặc định ký bằng key đó.
 */
async function newOrg(credential: TingeeCredential | null = MAIN, name = 'CLB Bơi lội'): Promise<TestOrg> {
  const owner = await signUp(h);
  const orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name }).expect(201)).body.id as string;
  created.push(orgId);
  await h.db.orm.execute(
    sql`UPDATE organizations SET closed_beta_status = 'approved', closed_beta_changed_at = now() WHERE id = ${orgId}`,
  );
  const org = { h, owner, orgId };
  if (credential) await linkPayoutAccount(org, credential, payout);
  const admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return { ...org, admin };
}

/** Token khả dụng của lần đọc kế (mọi BTC ký bằng `MAIN`): số dư `available - 200`, hạn mức 200. */
const setAvailable = (available: number) => {
  fake.merchant(MAIN.clientId).token = { balance: available - 200, creditLimit: 200 };
};

const put = (org: Pick<Org, 'orgId'>, cookie: string, body: unknown) =>
  h.http.put(`/v1/orgs/${org.orgId}/token/alert-threshold`).set('cookie', cookie).send(body as object);

/** Owner đặt ngưỡng → 200 `TokenAlert`. */
async function setThreshold(org: TestOrg, threshold: number | null): Promise<TokenAlert> {
  const res = await put(org, org.owner.cookie, { threshold });
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(TokenAlert.parse(res.body)).toEqual(res.body);
  return res.body as TokenAlert;
}

/** `GET …/token` → 200, body đúng dạng `TokenOverview`. */
async function overviewOf(org: Pick<Org, 'orgId'>, cookie: string): Promise<TokenOverview> {
  const res = await h.http.get(`/v1/orgs/${org.orgId}/token`).set('cookie', cookie);
  expect(res.status, res.text).toBe(200);
  expect(TokenOverview.parse(res.body)).toEqual(res.body);
  return res.body as TokenOverview;
}

/** Trạng thái cảnh báo đọc thẳng DB. */
async function alertRow(orgId: string): Promise<{ threshold: number | null; since: Date | null }> {
  const { rows } = await h.db.pool.query<{ threshold: string | null; since: Date | null }>(
    'SELECT token_alert_threshold AS threshold, token_below_threshold_since AS since FROM organizations WHERE id = $1',
    [orgId],
  );
  const row = rows[0]!;
  return { threshold: row.threshold === null ? null : Number(row.threshold), since: row.since };
}

const emailJobsOf = (orgId: string) => boss.findJobs(JobQueue.TOKEN_ALERT_EMAIL, { data: { organizationId: orgId } });

const statusSignalsOf = (orgId: string) =>
  notified.filter((n) => n.type === 'org_status_changed' && n.organizationId === orgId);

/** Chờ tín hiệu tới (NOTIFY gửi lúc commit, tới kết nối LISTEN không đồng bộ) rồi trả số tín hiệu. */
async function signalsSettled(orgId: string, expected: number): Promise<void> {
  await expect.poll(() => statusSignalsOf(orgId).length, { timeout: 5_000, interval: 50 }).toBe(expected);
  await sleep(150);
  expect(statusSignalsOf(orgId)).toHaveLength(expected);
}

async function noticesOf(org: Pick<Org, 'orgId'>, cookie: string) {
  const res = await h.http.get(`/v1/orgs/${org.orgId}/notices`).set('cookie', cookie).expect(200);
  return StatusNoticeList.parse(res.body);
}

async function auditRows(orgId: string, action: string) {
  const { rows } = await h.db.pool.query<{
    actor_user_id: string | null;
    target_type: string;
    target_id: string;
    changed_fields: string[];
  }>(
    `SELECT actor_user_id, target_type, target_id, changed_fields FROM audit_events
      WHERE organization_id = $1 AND action = $2 ORDER BY created_at, id`,
    [orgId, action],
  );
  return rows;
}

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

describe('đặt ngưỡng cảnh báo (PUT …/token/alert-threshold)', () => {
  it('Owner lưu 500: ngưỡng 500, audit; lưu lại cùng giá trị không ghi gì; không gọi Tingee', async () => {
    const org = await newOrg();
    expect(await setThreshold(org, 500)).toEqual({ threshold: 500, belowThresholdSince: null });
    expect(await alertRow(org.orgId)).toEqual({ threshold: 500, since: null });
    const expected = {
      actor_user_id: org.owner.userId,
      target_type: 'organization',
      target_id: org.orgId,
      changed_fields: ['token_alert_threshold'],
    };
    expect(await auditRows(org.orgId, 'organization.token_alert_threshold_update')).toEqual([expected]);

    const before = await h.db.pool.query('SELECT updated_at FROM organizations WHERE id = $1', [org.orgId]);
    expect(await setThreshold(org, 500)).toEqual({ threshold: 500, belowThresholdSince: null });
    const after = await h.db.pool.query('SELECT updated_at FROM organizations WHERE id = $1', [org.orgId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(await auditRows(org.orgId, 'organization.token_alert_threshold_update')).toHaveLength(1);

    // Ngưỡng lớn nhất được nhận; đổi giá trị thì audit thêm một dòng.
    expect((await setThreshold(org, 10 ** 12)).threshold).toBe(10 ** 12);
    expect(await auditRows(org.orgId, 'organization.token_alert_threshold_update')).toEqual([expected, expected]);
    expect(fake.calls(TOKEN_BALANCE_PATH)).toEqual([]);
    // Đặt hay đổi ngưỡng (khác null) không phát tín hiệu: banner không đổi.
    await signalsSettled(org.orgId, 0);
  });

  it('ngưỡng sai (0, -1, 1.5, "abc", > 10^12, thiếu, chuỗi số) → 400, không đổi', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    for (const body of [
      { threshold: 0 },
      { threshold: -1 },
      { threshold: 1.5 },
      { threshold: 'abc' },
      { threshold: 10 ** 12 + 1 },
      { threshold: '500' },
      {},
    ]) {
      const res = await put(org, org.owner.cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(res.body).code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    expect(await alertRow(org.orgId)).toEqual({ threshold: 500, since: null });
    expect(await auditRows(org.orgId, 'organization.token_alert_threshold_update')).toHaveLength(1);
  });

  it('Admin đặt → 403 FORBIDDEN_ROLE, không đổi; Admin vẫn đọc được ngưỡng qua GET', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    for (const threshold of [800, null]) {
      const res = await put(org, org.admin.cookie, { threshold });
      expect(res.status).toBe(403);
      expect(errorOf(res.body).code).toBe('FORBIDDEN_ROLE');
    }
    expect(await alertRow(org.orgId)).toEqual({ threshold: 500, since: null });
    setAvailable(1_700);
    expect((await overviewOf(org, org.admin.cookie)).alert).toEqual({ threshold: 500, belowThresholdSince: null });
  });

  it('ngoài BTC: Owner/Admin BTC khác, người không phải thành viên (CTV) → 403 NOT_A_MEMBER; chưa đăng nhập → 401', async () => {
    const org = await newOrg();
    const other = await newOrg();
    const stranger = await signUp(h);
    for (const cookie of [other.owner.cookie, other.admin.cookie, stranger.cookie]) {
      const res = await put(org, cookie, { threshold: 500 });
      expect(res.status).toBe(403);
      expect(errorOf(res.body).code).toBe('NOT_A_MEMBER');
    }
    const anonymous = await h.http.put(`/v1/orgs/${org.orgId}/token/alert-threshold`).send({ threshold: 500 });
    expect(anonymous.status).toBe(401);
    expect(await alertRow(org.orgId)).toEqual({ threshold: null, since: null });
  });

  it('DB chặn ngưỡng ngoài 1…10^12 và mốc dưới ngưỡng khi không có ngưỡng (CHECK)', async () => {
    const org = await newOrg();
    for (const statement of [
      sql`UPDATE organizations SET token_alert_threshold = 0 WHERE id = ${org.orgId}`,
      sql`UPDATE organizations SET token_alert_threshold = 1000000000001 WHERE id = ${org.orgId}`,
      sql`UPDATE organizations SET token_below_threshold_since = now() WHERE id = ${org.orgId}`,
    ]) {
      await expect(h.db.orm.execute(statement)).rejects.toSatisfy(
        (err: { cause?: { code?: string }; code?: string }) => (err.cause?.code ?? err.code) === '23514',
      );
    }
  });
});

describe('đánh giá ngưỡng sau mỗi lần đọc Token', () => {
  it('vừa xuống dưới ngưỡng (500, khả dụng 300): mốc = now() của DB; đúng 1 job email; org_status_changed; banner Owner; GET trả mốc', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    const started = Date.now();
    const body = await overviewOf(org, org.owner.cookie);
    expect(body.reading).toMatchObject({ status: 'ok', available: 300 });
    const row = await alertRow(org.orgId);
    expect(row.since).toBeInstanceOf(Date);
    expect(Math.abs(row.since!.getTime() - started)).toBeLessThan(10_000);
    expect(body.alert).toEqual({ threshold: 500, belowThresholdSince: row.since!.toISOString() });

    const jobs = await emailJobsOf(org.orgId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(tokenAlertEmailJobId(org.orgId, row.since!));
    expect(jobs[0]!.data).toEqual({ organizationId: org.orgId, belowThresholdSince: row.since!.toISOString() });
    await signalsSettled(org.orgId, 1);

    const notices = await noticesOf(org, org.owner.cookie);
    expect(notices).toEqual([
      {
        code: 'token_below_threshold',
        severity: 'warning',
        blocking: false,
        dismissible: true,
        scope: 'organization',
        audience: ['owner'],
        data: { tingeePortalUrl: PORTAL },
        version: row.since!.toISOString(),
      },
    ]);
    expect(NOTIFICATION_CATALOG.token_below_threshold.recipients).toEqual(['owner']);
    // Admin ở dashboard: không có banner (danh mục chỉ gửi Owner); Admin vẫn thấy cảnh báo trên trang Token.
    expect(await noticesOf(org, org.admin.cookie)).toEqual([]);
    setAvailable(300);
    expect((await overviewOf(org, org.admin.cookie)).alert.belowThresholdSince).toBe(row.since!.toISOString());
  });

  it('vẫn dưới ngưỡng (khả dụng 200): không email thêm, mốc giữ nguyên, không tín hiệu thêm', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    const first = await alertRow(org.orgId);
    await signalsSettled(org.orgId, 1);

    setAvailable(200);
    expect((await overviewOf(org, org.owner.cookie)).alert.belowThresholdSince).toBe(first.since!.toISOString());
    expect((await overviewOf(org, org.admin.cookie)).alert.belowThresholdSince).toBe(first.since!.toISOString());
    expect((await reader.readAndEvaluate(org.orgId)).transition).toBe('unchanged');
    expect(await alertRow(org.orgId)).toEqual(first);
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);
    await signalsSettled(org.orgId, 1);
  });

  it('lên rồi xuống lại (300 → 900 → 300): mốc null rồi mốc mới; email thứ hai; banner version mới', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    const first = (await alertRow(org.orgId)).since!;
    const firstVersion = (await noticesOf(org, org.owner.cookie))[0]!.version;
    expect(firstVersion).toBe(first.toISOString());

    // Đúng bằng ngưỡng là không dưới ngưỡng.
    setAvailable(500);
    expect((await overviewOf(org, org.owner.cookie)).alert).toEqual({ threshold: 500, belowThresholdSince: null });
    expect(await alertRow(org.orgId)).toEqual({ threshold: 500, since: null });
    expect(await noticesOf(org, org.owner.cookie)).toEqual([]);
    await signalsSettled(org.orgId, 2);
    setAvailable(900);
    await overviewOf(org, org.owner.cookie);
    await signalsSettled(org.orgId, 2);

    setAvailable(300);
    const again = await overviewOf(org, org.owner.cookie);
    const second = (await alertRow(org.orgId)).since!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(again.alert.belowThresholdSince).toBe(second.toISOString());
    await signalsSettled(org.orgId, 3);

    const jobs = await emailJobsOf(org.orgId);
    expect(jobs.map((j) => j.id).sort()).toEqual(
      [tokenAlertEmailJobId(org.orgId, first), tokenAlertEmailJobId(org.orgId, second)].sort(),
    );
    const notices = await noticesOf(org, org.owner.cookie);
    expect(notices.map((n) => n.code)).toEqual(['token_below_threshold']);
    expect(notices[0]!.version).toBe(second.toISOString());
    expect(notices[0]!.version).not.toBe(firstVersion);
  });

  it('đọc đồng thời: job dò (TokenReader) và trang (Owner, Admin) cùng thấy dưới ngưỡng → đúng 1 job email, 1 tín hiệu, cùng mốc', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    barrier = { count: 4, waiting: [] };
    const [job, owner, admin, again] = await Promise.all([
      reader.readAndEvaluate(org.orgId),
      overviewOf(org, org.owner.cookie),
      overviewOf(org, org.admin.cookie),
      reader.readAndEvaluate(org.orgId),
    ]);
    expect(barrier).toBeNull();
    expect([job.transition, again.transition].filter((t) => t === 'crossed').length).toBeLessThanOrEqual(1);
    const since = (await alertRow(org.orgId)).since!;
    for (const alert of [owner.alert, admin.alert]) expect(alert.belowThresholdSince).toBe(since.toISOString());
    expect(job.alert?.since?.getTime()).toBe(since.getTime());
    expect(again.alert?.since?.getTime()).toBe(since.getTime());
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);
    await signalsSettled(org.orgId, 1);

    // Enqueue lặp cho cùng lần vượt (id cố định) không tạo job thứ hai.
    await h.db.transaction((tx) =>
      TOKEN_ALERT_EMAIL_QUEUE.enqueue(
        boss,
        tx,
        { organizationId: org.orgId, belowThresholdSince: since.toISOString() },
        { id: tokenAlertEmailJobId(org.orgId, since) },
      ),
    );
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);
  });

  it('đọc không được (Tingee lỗi, mã lạ, chưa có tài khoản nhận tiền mặc định) → không đổi gì, kể cả khi đang dưới ngưỡng', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    const audits = await auditRows(org.orgId, 'organization.token_alert_threshold_update');
    fake.merchant(MAIN.clientId).tokenReplies = [{ code: '1006' }, { code: '00', httpStatus: 500, data: {} }];
    for (let i = 0; i < 2; i += 1) {
      const body = await overviewOf(org, org.owner.cookie);
      expect(body.reading).toEqual({ status: 'unavailable' });
      expect(body.alert).toEqual({ threshold: 500, belowThresholdSince: null });
    }
    expect(await alertRow(org.orgId)).toEqual({ threshold: 500, since: null });
    expect(await emailJobsOf(org.orgId)).toEqual([]);

    // Đang dưới ngưỡng: đọc không được thì giữ mốc (không coi là về trên ngưỡng).
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    const since = (await alertRow(org.orgId)).since!;
    fake.merchant(MAIN.clientId).tokenReplies = [{ code: '97', httpStatus: 401 }];
    expect((await overviewOf(org, org.owner.cookie)).alert.belowThresholdSince).toBe(since.toISOString());
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${org.orgId}`,
    );
    const noAccount = await overviewOf(org, org.owner.cookie);
    expect(noAccount.reading).toEqual({ status: 'no_payout_account' });
    expect(noAccount.alert.belowThresholdSince).toBe(since.toISOString());
    expect(await alertRow(org.orgId)).toEqual({ threshold: 500, since });
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);
    await signalsSettled(org.orgId, 1);
    expect(await auditRows(org.orgId, 'organization.token_alert_threshold_update')).toEqual(audits);

    // Chưa có tài khoản ngay từ đầu, có ngưỡng: không gọi Tingee, không đổi.
    const never = await newOrg(null);
    await setThreshold(never, 500);
    fake.reset();
    expect((await overviewOf(never, never.owner.cookie)).alert).toEqual({ threshold: 500, belowThresholdSince: null });
    expect(fake.calls(TOKEN_BALANCE_PATH)).toEqual([]);
  });

  it('tắt khi đang dưới (PUT null): mốc null, banner tắt, audit kèm mốc, org_status_changed; lần đọc sau không email', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    await signalsSettled(org.orgId, 1);
    expect((await noticesOf(org, org.owner.cookie)).map((n) => n.code)).toEqual(['token_below_threshold']);

    expect(await setThreshold(org, null)).toEqual({ threshold: null, belowThresholdSince: null });
    expect(await alertRow(org.orgId)).toEqual({ threshold: null, since: null });
    expect(await noticesOf(org, org.owner.cookie)).toEqual([]);
    await signalsSettled(org.orgId, 2);
    expect(await auditRows(org.orgId, 'organization.token_alert_threshold_update')).toEqual([
      {
        actor_user_id: org.owner.userId,
        target_type: 'organization',
        target_id: org.orgId,
        changed_fields: ['token_alert_threshold'],
      },
      {
        actor_user_id: org.owner.userId,
        target_type: 'organization',
        target_id: org.orgId,
        changed_fields: ['token_alert_threshold', 'token_below_threshold_since'],
      },
    ]);

    // Không còn ngưỡng: đọc Token không ghi gì, không email.
    const before = await h.db.pool.query('SELECT * FROM organizations WHERE id = $1', [org.orgId]);
    setAvailable(100);
    expect((await overviewOf(org, org.owner.cookie)).alert).toEqual({ threshold: null, belowThresholdSince: null });
    expect((await h.db.pool.query('SELECT * FROM organizations WHERE id = $1', [org.orgId])).rows).toEqual(before.rows);
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);

    // Tắt khi không dưới ngưỡng: audit chỉ ngưỡng (mốc vốn null), vẫn phát tín hiệu.
    const other = await newOrg();
    await setThreshold(other, 500);
    await setThreshold(other, null);
    expect((await auditRows(other.orgId, 'organization.token_alert_threshold_update')).at(-1)?.changed_fields).toEqual([
      'token_alert_threshold',
    ]);
    await signalsSettled(other.orgId, 1);
  });

  it('đổi ngưỡng khi vẫn dưới (500 → 400, khả dụng 300): không email, mốc giữ nguyên, audit chỉ ngưỡng', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    const since = (await alertRow(org.orgId)).since!;

    expect(await setThreshold(org, 400)).toEqual({ threshold: 400, belowThresholdSince: since.toISOString() });
    expect((await auditRows(org.orgId, 'organization.token_alert_threshold_update')).at(-1)?.changed_fields).toEqual([
      'token_alert_threshold',
    ]);
    setAvailable(300);
    expect((await overviewOf(org, org.owner.cookie)).alert).toEqual({
      threshold: 400,
      belowThresholdSince: since.toISOString(),
    });
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);
    await signalsSettled(org.orgId, 1);

    // Đổi sang ngưỡng thấp hơn khả dụng: PUT không đụng mốc; lần đọc kế đánh giá lại → về trên ngưỡng.
    expect((await setThreshold(org, 250)).belowThresholdSince).toBe(since.toISOString());
    expect((await overviewOf(org, org.owner.cookie)).alert).toEqual({ threshold: 250, belowThresholdSince: null });
    await signalsSettled(org.orgId, 2);
  });

  it('Tạm ngừng bán vì Token: không có banner 4.5-b (chỉ banner 4.2); lý do khác thì banner warning xếp sau', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    await h.db.orm.execute(sql`
      UPDATE organizations
         SET payment_service_status = 'suspended', payment_service_reason = 'token', payment_service_since = now()
       WHERE id = ${org.orgId}`);
    expect((await noticesOf(org, org.owner.cookie)).map((n) => n.code)).toEqual(['PAYMENT_SERVICE_SUSPENDED_TOKEN']);

    await h.db.orm.execute(
      sql`UPDATE organizations SET payment_service_reason = 'tingee_disabled' WHERE id = ${org.orgId}`,
    );
    expect((await noticesOf(org, org.owner.cookie)).map((n) => n.code)).toEqual([
      'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
      'token_below_threshold',
    ]);
    expect((await noticesOf(org, org.admin.cookie)).map((n) => n.code)).toEqual([
      'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
    ]);
  });

  it('không có số dư, hạn mức hay Token khả dụng trong log, job hay DB', async () => {
    const org = await newOrg();
    const balance = 7_350_291;
    const creditLimit = 4_816_073;
    const numbers = [balance, creditLimit, balance + creditLimit].map(String);
    await setThreshold(org, 98_765_432_109);
    fake.merchant(MAIN.clientId).token = { balance, creditLimit };
    const firstLine = h.logs.lines.length;

    expect((await overviewOf(org, org.owner.cookie)).reading).toMatchObject({ available: balance + creditLimit });
    await overviewOf(org, org.admin.cookie);
    await scanWorker.scan();
    fake.merchant(MAIN.clientId).token = { balance: 98_765_432_109, creditLimit };
    await overviewOf(org, org.owner.cookie);

    const lines = h.logs.lines.slice(firstLine);
    const logged = JSON.stringify(lines);
    for (const value of [...numbers, MAIN.secretToken]) expect(logged, value).not.toContain(value);
    expect(lines.find((l) => l.organizationId === org.orgId && l.transition === 'crossed')).toBeDefined();
    expect(lines.find((l) => l.organizationId === org.orgId && l.transition === 'recovered')).toBeDefined();

    const jobs = await emailJobsOf(org.orgId);
    expect(jobs).toHaveLength(1);
    expect(Object.keys(jobs[0]!.data as object).sort()).toEqual(['belowThresholdSince', 'organizationId']);
    for (const value of numbers) expect(JSON.stringify(jobs[0]!.data), value).not.toContain(value);
    const row = JSON.stringify((await h.db.pool.query('SELECT * FROM organizations WHERE id = $1', [org.orgId])).rows);
    for (const value of numbers) expect(row, value).not.toContain(value);
  });
});

describe('email cảnh báo Token', () => {
  const notifierFor = (email: FakeEmailTransport) => ({
    db: h.db,
    email,
    webOrigin: TEST_WEB_ORIGIN,
    tingeePortalUrl: PORTAL,
  });

  it('gửi đúng Owner hiện tại: tên BTC, ngưỡng, link trang Token và portal Tingee; không số dư; không gửi Admin', async () => {
    const org = await newOrg(MAIN, 'CLB <Bơi> & "Lặn"');
    await setThreshold(org, 9_000_000);
    fake.merchant(MAIN.clientId).token = { balance: 7_350_291, creditLimit: 1_234_567 };
    const body = await overviewOf(org, org.owner.cookie);
    expect(body.reading).toMatchObject({ available: 8_584_858 });
    const [job] = await emailJobsOf(org.orgId);
    const payload = TokenAlertEmailPayload.parse(job!.data);
    const email = new FakeEmailTransport();
    expect(await sendTokenAlertEmail(notifierFor(email), payload)).toBe('sent');

    expect(email.sent).toHaveLength(1);
    const message = email.sent[0]!;
    expect(message.to).toBe(org.owner.email);
    expect(message.subject).toBe('Token của CLB <Bơi> & "Lặn" dưới ngưỡng cảnh báo');
    const tokenPage = `${TEST_WEB_ORIGIN}/btc/${org.orgId}/token`;
    for (const part of ['CLB <Bơi> & "Lặn"', '9.000.000 Token', tokenPage, PORTAL, 'Tạm ngừng bán']) {
      expect(message.text, part).toContain(part);
    }
    expect(message.html).toContain('CLB &lt;Bơi&gt; &amp; &quot;Lặn&quot;');
    expect(message.html).toContain(`href="${tokenPage}"`);
    expect(message.html).toContain(`href="${PORTAL}"`);
    for (const value of ['7350291', '7.350.291', '1234567', '1.234.567', '8584858', '8.584.858']) {
      expect(`${message.subject}${message.text}${message.html}`, value).not.toContain(value);
    }

    // Owner chuyển quyền: gửi Owner hiện tại (không gửi Owner cũ, nay là Admin).
    await h.db.orm.execute(
      sql`UPDATE members SET role = 'admin' WHERE organization_id = ${org.orgId} AND user_id = ${org.owner.userId}`,
    );
    await h.db.orm.execute(
      sql`UPDATE members SET role = 'owner' WHERE organization_id = ${org.orgId} AND user_id = ${org.admin.userId}`,
    );
    const next = new FakeEmailTransport();
    expect(await sendTokenAlertEmail(notifierFor(next), payload)).toBe('sent');
    expect(next.sent.map((m) => m.to)).toEqual([org.admin.email]);
  });

  it('email đến muộn: mốc đã đổi (về trên ngưỡng, Owner tắt, vượt lần mới) trước khi job chạy → hoàn tất, không gửi', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    const [firstJob] = await emailJobsOf(org.orgId);
    const first = TokenAlertEmailPayload.parse(firstJob!.data);
    const email = new FakeEmailTransport();

    // Về trên ngưỡng.
    setAvailable(900);
    await overviewOf(org, org.owner.cookie);
    expect(await sendTokenAlertEmail(notifierFor(email), first)).toBe('skipped');
    // Vượt lần mới: job của lần đầu vẫn bỏ qua, job lần mới gửi.
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    expect(await sendTokenAlertEmail(notifierFor(email), first)).toBe('skipped');
    const second = TokenAlertEmailPayload.parse((await emailJobsOf(org.orgId)).find((j) => j.id !== firstJob!.id)!.data);
    expect(await sendTokenAlertEmail(notifierFor(email), second)).toBe('sent');
    // Owner tắt cảnh báo.
    await setThreshold(org, null);
    expect(await sendTokenAlertEmail(notifierFor(email), second)).toBe('skipped');
    expect(email.sent).toHaveLength(1);
  });

  it('cấu hình queue: có retry (backoff) và dead-letter', async () => {
    expect((await boss.getQueue(JobQueue.TOKEN_ALERT_EMAIL_DEAD_LETTER))?.name).toBe(
      JobQueue.TOKEN_ALERT_EMAIL_DEAD_LETTER,
    );
    const queue = await boss.getQueue(JobQueue.TOKEN_ALERT_EMAIL);
    expect(queue).toMatchObject({
      name: JobQueue.TOKEN_ALERT_EMAIL,
      deadLetter: JobQueue.TOKEN_ALERT_EMAIL_DEAD_LETTER,
      retryLimit: TOKEN_ALERT_EMAIL_QUEUE.queueOptions.retryLimit,
      retryBackoff: true,
    });
    expect(queue?.retryLimit).toBeGreaterThan(0);
  });

  it('gửi lỗi → ném lỗi chỉ mang tên lớp (không địa chỉ email)', async () => {
    const org = await newOrg();
    await setThreshold(org, 500);
    setAvailable(300);
    await overviewOf(org, org.owner.cookie);
    const [job] = await emailJobsOf(org.orgId);
    const email = new FakeEmailTransport();
    email.failWith = new Error(`SMTP tạm hỏng ${org.owner.email}`);
    const failure = await sendTokenAlertEmail(notifierFor(email), TokenAlertEmailPayload.parse(job!.data)).catch(
      (err: Error) => err,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Không gửi được email cảnh báo Token (Error)');
  });
});

describe('job dò Token mỗi giờ', () => {
  it('tuần tự các BTC có ngưỡng và active: vượt ngưỡng, Tingee lỗi, chưa có tài khoản, lỗi một BTC thì đi tiếp; bỏ qua BTC suspended và BTC chưa đặt ngưỡng', async () => {
    const below = await newOrg(MAIN, 'CLB Dò 1');
    const throwing = await newOrg(THROWING, 'CLB Dò 2');
    const noAccount = await newOrg(null, 'CLB Dò 3');
    const broken = await newOrg(BROKEN, 'CLB Dò 4');
    const paused = await newOrg(PAUSED, 'CLB Dò 5');
    const unset = await newOrg(MAIN, 'CLB Dò 6');
    for (const org of [below, throwing, noAccount, broken, paused]) await setThreshold(org, 500);
    // Tạm ngừng bán vì Token, đang dưới ngưỡng từ trước.
    await h.db.orm.execute(sql`
      UPDATE organizations
         SET payment_service_status = 'suspended', payment_service_reason = 'token', payment_service_since = now(),
             token_below_threshold_since = now()
       WHERE id = ${paused.orgId}`);
    const pausedBefore = await alertRow(paused.orgId);
    setAvailable(300);
    const firstLine = h.logs.lines.length;

    const outcomes = await scanWorker.scan();
    expect(outcomes.get(below.orgId)).toBe('crossed');
    expect(outcomes.get(throwing.orgId)).toBe('error');
    expect(outcomes.get(noAccount.orgId)).toBe('no_payout_account');
    expect(outcomes.get(broken.orgId)).toBe('unavailable');
    expect(outcomes.has(paused.orgId)).toBe(false);
    expect(outcomes.has(unset.orgId)).toBe(false);
    // BTC lỗi xếp trước các BTC sau nó (tạo trước), nên lượt dò đã đi tiếp.
    expect([...outcomes.keys()].indexOf(throwing.orgId)).toBeLessThan([...outcomes.keys()].indexOf(broken.orgId));
    expect(
      h.logs.lines
        .slice(firstLine)
        .find((l) => l.organizationId === throwing.orgId && l.error === 'Error' && l.msg === 'Dò Token lỗi; lần chạy sau dò lại'),
    ).toBeDefined();
    expect(fake.calls(TOKEN_BALANCE_PATH).filter((c) => c.clientId === PAUSED.clientId)).toEqual([]);
    expect(await alertRow(paused.orgId)).toEqual(pausedBefore);
    expect(await emailJobsOf(paused.orgId)).toEqual([]);
    expect(await alertRow(below.orgId)).toMatchObject({ threshold: 500, since: expect.any(Date) });
    expect(await emailJobsOf(below.orgId)).toHaveLength(1);
    expect(await alertRow(unset.orgId)).toEqual({ threshold: null, since: null });
    for (const org of [throwing, noAccount, broken]) {
      expect(await alertRow(org.orgId), org.orgId).toEqual({ threshold: 500, since: null });
      expect(await emailJobsOf(org.orgId)).toEqual([]);
    }
    await signalsSettled(below.orgId, 1);

    // Lần chạy kế: vẫn dưới ngưỡng → không email thêm.
    const again = await scanWorker.scan();
    expect(again.get(below.orgId)).toBe('unchanged');
    expect(await emailJobsOf(below.orgId)).toHaveLength(1);
  });
});

describe('worker thật (pg-boss)', () => {
  let app: INestApplicationContext;
  let workerEmail: FakeEmailTransport;

  beforeAll(async () => {
    // Job email còn chờ của các test trên không được chen vào.
    await boss.deleteQueuedJobs(JobQueue.TOKEN_ALERT_EMAIL);
    workerEmail = new FakeEmailTransport();
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(workerConfig({ TINGEE_BASE_URL: fake.url }))],
    })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(workerEmail)
      .compile();
    app = await moduleRef.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lịch dò mỗi giờ; job dò thấy dưới ngưỡng → mốc → đúng một email cho Owner; lần dò sau không gửi lại', async () => {
    const schedules = await boss.getSchedules();
    expect(schedules.find((s) => s.name === JobQueue.TOKEN_ALERT_SCAN)).toMatchObject({ cron: TOKEN_ALERT_SCAN_CRON });

    const org = await newOrg(MAIN, 'CLB Lướt sóng');
    await setThreshold(org, 500);
    setAvailable(300);
    const toOwner = () => workerEmail.sent.filter((m) => m.to === org.owner.email);

    const scanCompleted = async (jobId: string | null) =>
      expect
        .poll(async () => (await boss.getJobById(JobQueue.TOKEN_ALERT_SCAN, jobId!))?.state, {
          timeout: 20_000,
          interval: 200,
        })
        .toBe('completed');

    await scanCompleted(await boss.send(JobQueue.TOKEN_ALERT_SCAN, null));
    expect((await alertRow(org.orgId)).since).toBeInstanceOf(Date);
    await expect.poll(() => toOwner().length, { timeout: 20_000, interval: 200 }).toBe(1);
    const delivered = toOwner()[0]!;
    expect(delivered.subject).toBe('Token của CLB Lướt sóng dưới ngưỡng cảnh báo');
    // Cấu hình email của vai worker (`TOKEN_ALERT_EMAIL_SETTINGS`): link trang Token theo `WEB_ORIGIN`, portal Tingee.
    const tokenPage = `${TEST_WEB_ORIGIN}/btc/${org.orgId}/token`;
    for (const part of [tokenPage, PORTAL]) {
      expect(delivered.text, part).toContain(part);
      expect(delivered.html, part).toContain(`href="${part}"`);
    }
    const [job] = await emailJobsOf(org.orgId);
    await expect
      .poll(async () => (await boss.getJobById(JobQueue.TOKEN_ALERT_EMAIL, job!.id))?.state, { timeout: 10_000 })
      .toBe('completed');

    await scanCompleted(await boss.send(JobQueue.TOKEN_ALERT_SCAN, null));
    await sleep(2_500);
    expect(toOwner()).toHaveLength(1);
    expect(await emailJobsOf(org.orgId)).toHaveLength(1);
    expect(workerEmail.sent.filter((m) => m.to === org.admin.email)).toEqual([]);
  });
});
