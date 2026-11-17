import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { ErrorResponse, JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IPN_FAILURE_ALERT_SETTINGS,
  IPN_FAILURE_WINDOW_MS,
  IpnFailureMonitor,
  type IpnFailureAlertSettings,
} from '../../src/modules/payment/ipn-failure-alert.js';
import { TingeeIpnController } from '../../src/modules/payment/ipn.controller.js';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import {
  OPS_ALERT_SETTINGS,
  OPS_ALERT_SYSTEM_SUBJECT,
  OpsAlertEmailWorker,
  OpsAlertKind,
  OpsAlertPayload,
  OpsAlertQueue,
  OpsAlerts,
  type OpsAlertSettings,
} from '../../src/platform/alerts/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { migrationDatabaseUrl } from '../helpers.js';
import { createHarness, FakeEmailTransport, type Harness } from '../identity/harness.js';
import { ipnKeyOf, linkPayoutAccount, paidReadyOrg, type Org } from '../ordering/order-fixtures.js';
import { fakeIpnPayload, signIpn, type SignedIpn } from '../tingee-fake/server.js';
import { postIpn } from './ipn-fixtures.js';

/*
 * Story 4.6-e, luật `ipn_failures`: endpoint IPN thật (harness api, Postgres thật, pg-boss producer) ghi nhận IPN lỗi vào
 * cửa sổ 5 phút trong bộ nhớ của instance; đạt ngưỡng (5) thì báo kênh `platform/alerts`. Mỗi dòng của I/O Matrix. Đồng
 * hồ của cửa sổ và của bộ nhớ chống lặp do test tự tiến (`clock`); dấu chống lặp trong DB theo đồng hồ DB, nên mỗi test
 * xóa dấu `ipn_failures` trước. IPN không gọi Tingee: credential ghi thẳng vào DB.
 */

const MAIN: TingeeCredential = { clientId: 'tg-ipnfail-main-7a2c', secretToken: 'tg-ipnfail-main-secret-Hs4Jd6Kf8' };
const NEXT: TingeeCredential = { clientId: 'tg-ipnfail-next-1b9e', secretToken: 'tg-ipnfail-next-secret-Lp2Mn3Bv5' };
const THRESHOLD = 5;
const MIN = 60_000;
const WARN_RAISE_FAILED = 'Không ghi được cảnh báo vận hành; bỏ qua lần báo này';
const unknownCode = () => `TK${randomUUID().replace(/[^0-9]/g, '').slice(0, 8).padEnd(8, '3')}`;

/** Đồng hồ (ms) của cửa sổ IPN lỗi và của bộ nhớ chống lặp của kênh trong harness này. */
let clock = Date.now();
let h: Harness;
let boss: PgBoss;
let monitor: IpnFailureMonitor;
/** BTC nhận IPN (credential hiện hành `MAIN`). */
let org: Org;
let ipnKey: string;
/** BTC đã đổi key `MAIN` → `NEXT`: IPN ký bằng `MAIN` cho Đơn không có → 401 `retired_key_order_not_found`. */
let rotatedKey: string;
/** BTC có credential không giải mã được: mọi IPN → 500. */
let brokenKey: string;
/** Job `ipn_failures` đã có trước test (của test khác, lần chạy khác). */
let seen = new Set<string>();

beforeAll(async () => {
  h = await createHarness(
    {},
    {
      overrides: [
        { provide: OPS_ALERT_SETTINGS, useValue: { cooldownMinutes: 30, now: () => clock } satisfies OpsAlertSettings },
        {
          provide: IPN_FAILURE_ALERT_SETTINGS,
          useValue: { threshold: THRESHOLD, now: () => clock } satisfies IpnFailureAlertSettings,
        },
      ],
    },
  );
  boss = h.app.get<PgBoss>(BOSS);
  monitor = h.app.get(IpnFailureMonitor);
  org = await paidReadyOrg(h, { name: 'CLB Bóng rổ Tân Bình', credential: MAIN });
  ipnKey = await ipnKeyOf(h, org.orgId);

  const rotated = await paidReadyOrg(h, { name: 'CLB Bơi lội Quận 3', credential: MAIN });
  rotatedKey = await ipnKeyOf(h, rotated.orgId);
  await h.db.orm.execute(sql`
    UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${rotated.orgId}`);
  await h.db.orm.execute(sql`
    UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${rotated.orgId} AND retired_at IS NULL`);
  await linkPayoutAccount(rotated, NEXT);

  const broken = await paidReadyOrg(h, { name: 'CLB Cờ tướng Phú Nhuận', credential: MAIN });
  brokenKey = await ipnKeyOf(h, broken.orgId);
  // Ciphertext mã bằng phiên bản khóa không còn trong TINGEE_CREDENTIAL_KEYS.
  await h.db.orm.execute(sql`
    UPDATE tingee_credentials SET secret_token_ciphertext = 'v9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
     WHERE organization_id = ${broken.orgId}`);
});
beforeEach(async () => {
  // Quá cửa sổ 5 phút và cooldown 30 phút trong bộ nhớ: mỗi test bắt đầu với cửa sổ rỗng.
  clock += 2 * 60 * MIN;
  await h.db.pool.query('DELETE FROM ops_alert_marks WHERE kind = $1', [OpsAlertKind.IPN_FAILURES]);
  seen = new Set((await ipnFailureJobs(true)).map((job) => job.id));
  expect(monitor.counts().failures).toBe(0);
});
afterAll(async () => {
  await h?.close();
});

/** Job email `ipn_failures` mới của test (bỏ job có trước test; `all`: mọi job). */
async function ipnFailureJobs(all = false) {
  const jobs = await boss.findJobs(JobQueue.OPS_ALERT, { data: { kind: OpsAlertKind.IPN_FAILURES } });
  return jobs
    .filter((job) => all || !seen.has(job.id))
    .map((job) => ({ id: job.id, data: OpsAlertPayload.parse(job.data) }));
}

/** IPN `success` ký đúng bằng `MAIN` cho một mã Đơn không có (chỉ để có body hợp lệ). */
const signedIpn = (): SignedIpn => signIpn(MAIN.secretToken, fakeIpnPayload(unknownCode(), 100_000));

/** IPN ký sai (chữ ký không khớp secret nào) → 401 `signature_mismatch`. */
const badSignature = (): SignedIpn => {
  const good = signedIpn();
  return { ...good, headers: { ...good.headers, 'x-signature': 'ab'.repeat(64) } };
};

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

/** Gửi `ipn` tới `key`, chờ đúng `status` như trước Story 4.6-e; rồi tiến đồng hồ `stepMs`. */
async function send(ipn: SignedIpn, status: number, key = ipnKey, stepMs = 30_000) {
  const res = await postIpn(h, key, ipn);
  expect(res.status).toBe(status);
  clock += stepMs;
  return res;
}

/** Một IPN ký sai tới BTC `org` → 401 như trước Story 4.6-e. */
const signatureFailure = async () => {
  const res = await send(badSignature(), 401);
  expect(errorOf(res.body).code).toBe('IPN_SIGNATURE_INVALID');
};

/** Thu/cấp lại INSERT của `tickee_app` trên bảng dấu: giả DB lỗi chỉ cho `raise`. */
async function withMarksInsertRevoked<T>(fn: () => Promise<T>): Promise<T> {
  const migrator = new pg.Client({ connectionString: migrationDatabaseUrl() });
  await migrator.connect();
  try {
    await migrator.query('REVOKE INSERT ON TABLE ops_alert_marks FROM tickee_app');
    return await fn();
  } finally {
    await migrator.query('GRANT INSERT ON TABLE ops_alert_marks TO tickee_app');
    await migrator.end();
  }
}

const markExists = async () =>
  (
    await h.db.pool.query('SELECT 1 FROM ops_alert_marks WHERE kind = $1 AND subject = $2', [
      OpsAlertKind.IPN_FAILURES,
      OPS_ALERT_SYSTEM_SUBJECT,
    ])
  ).rows.length > 0;

describe('luật ipn_failures (I/O Matrix)', () => {
  it('IPN sai chữ ký: 5 IPN 401 trong 5 phút (gồm key cũ không ràng được Đơn) → một email ipn_failures, signature: 5; IPN vẫn 401, log cũ giữ nguyên', async () => {
    for (let i = 0; i < 4; i++) await signatureFailure();
    expect(monitor.counts()).toEqual({ failures: 4, signature: 4, invalid_body: 0, server_error: 0 });
    expect(await ipnFailureJobs()).toEqual([]);

    // Lần thứ 5: ký đúng bằng key cũ của BTC đã đổi key, Đơn không có → 401, đếm như `signature`.
    const retired = await send(signedIpn(), 401, rotatedKey);
    expect(errorOf(retired.body).code).toBe('IPN_SIGNATURE_INVALID');
    expect(h.logs.lines.findLast((l) => l.reason === 'retired_key_order_not_found')).toMatchObject({ level: 40 });
    const jobs = await ipnFailureJobs();
    expect(jobs.map((job) => job.data)).toEqual([
      {
        kind: OpsAlertKind.IPN_FAILURES,
        count: 1,
        subjects: [OPS_ALERT_SYSTEM_SUBJECT],
        details: { failures: 5, signature: 5, invalid_body: 0, server_error: 0, windowMinutes: 5, threshold: THRESHOLD },
      },
    ]);
    expect(
      h.logs.lines.filter((l) => l.context === 'OpsAlerts' && l.alert === OpsAlertKind.IPN_FAILURES).at(-1),
    ).toMatchObject({ level: 50, subjects: [OPS_ALERT_SYSTEM_SUBJECT], details: { signature: 5 } });
    // Log từ chối của IPN giữ nguyên (warn kèm lý do).
    expect(h.logs.lines.filter((l) => l.organizationId === org.orgId && l.reason === 'signature_mismatch').length).toBeGreaterThanOrEqual(4);

    const email = new FakeEmailTransport();
    await new OpsAlertEmailWorker(boss, email, { recipients: ['van-hanh@tickee.test'] }).deliver(jobs[0]!.data);
    const message = email.sent[0]!;
    expect(message.subject).toBe('[Tickee vận hành] IPN lỗi tăng');
    for (const part of ['Loại: ipn_failures', 'signature: 5', 'invalid_body: 0', 'server_error: 0', OPS_ALERT_SYSTEM_SUBJECT]) {
      expect(message.text, part).toContain(part);
    }
    for (const secret of [MAIN.secretToken, ipnKey, rotatedKey]) expect(`${message.text}${message.html}`).not.toContain(secret);
  });

  it('Dưới ngưỡng: 4 IPN 401, rồi 1 IPN 401 sau 6 phút → không báo', async () => {
    for (let i = 0; i < 4; i++) await signatureFailure();
    clock += 6 * MIN;
    await signatureFailure();
    expect(monitor.counts()).toEqual({ failures: 1, signature: 1, invalid_body: 0, server_error: 0 });
    expect(await ipnFailureJobs()).toEqual([]);
    expect(await markExists()).toBe(false);
  });

  it('Gộp lý do: 2 lần 401, 2 lần 400 body hỏng, 1 lần 500 → một email nêu số theo từng lý do', async () => {
    await signatureFailure();
    await send(signIpn(MAIN.secretToken, `{"orderId": "${unknownCode()}",`), 400);
    await signatureFailure();
    const invalid = await send(signIpn(MAIN.secretToken, '[]'), 400);
    expect(errorOf(invalid.body).code).toBe('VALIDATION_FAILED');
    expect(await ipnFailureJobs()).toEqual([]);
    // Credential của BTC không giải mã được: lỗi xử lý → 500.
    await send(signedIpn(), 500, brokenKey);
    expect((await ipnFailureJobs()).map((job) => job.data.details)).toEqual([
      { failures: 5, signature: 2, invalid_body: 2, server_error: 1, windowMinutes: 5, threshold: THRESHOLD },
    ]);
  });

  it('ipnKey lạ: 10 IPN 404 → không báo; body quá lớn (413) cũng không đếm', async () => {
    for (let i = 0; i < 10; i++) {
      await send(signedIpn(), 404, i % 2 === 0 ? `khong-co-btc-${i}-${randomUUID()}` : 'x'.repeat(200));
    }
    await send(signIpn(MAIN.secretToken, JSON.stringify({ pad: 'x'.repeat(70 * 1024) })), 413);
    expect(monitor.counts().failures).toBe(0);
    expect(await ipnFailureJobs()).toEqual([]);
    expect(await markExists()).toBe(false);
  });

  it('client ngắt kết nối khi đang gửi body (lỗi stream, request chưa nhận đủ) → không đếm; body đã bị đọc trước handler (5xx cấu hình) → server_error', async () => {
    const controller = h.app.get(TingeeIpnController);
    const request = (complete: boolean) =>
      Object.assign(new Readable({ read() {} }), {
        headers: { 'content-type': 'application/json', 'content-length': '1000' },
        complete,
      }) as unknown as IncomingMessage & Readable;

    const aborted = request(false);
    const pending = controller.receive(ipnKey, aborted);
    aborted.push('{');
    await expect.poll(() => aborted.listenerCount('error'), { timeout: 5_000, interval: 10 }).toBeGreaterThan(0);
    aborted.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
    await expect(pending).rejects.toThrow('aborted');
    expect(monitor.counts().failures).toBe(0);

    const consumed = request(true);
    consumed.push(null);
    consumed.resume();
    await new Promise((resolve) => consumed.once('end', resolve));
    await expect(controller.receive(ipnKey, consumed)).rejects.toThrow('Body IPN đã bị đọc trước handler');
    expect(monitor.counts()).toEqual({ failures: 1, signature: 0, invalid_body: 0, server_error: 1 });
  });

  it('Còn lỗi sau khi báo: thêm IPN 401 trong cooldown → không gửi thêm (cả instance khác); hết cooldown mà vẫn lỗi → báo lại', async () => {
    for (let i = 0; i < THRESHOLD; i++) await signatureFailure();
    expect(await ipnFailureJobs()).toHaveLength(1);
    for (let i = 0; i < 3; i++) await signatureFailure();
    expect(monitor.counts().failures).toBe(8);
    expect(await ipnFailureJobs()).toHaveLength(1);

    // Instance api khác (bộ đếm và bộ nhớ chống lặp riêng) đạt ngưỡng trong cooldown: dấu DB chặn.
    const other = new IpnFailureMonitor(
      new OpsAlerts(h.db, boss, h.app.get(OpsAlertQueue), { cooldownMinutes: 30, now: () => clock }),
      { threshold: THRESHOLD, now: () => clock },
    );
    for (let i = 0; i < THRESHOLD; i++) await other.record('server_error');
    expect(await ipnFailureJobs()).toHaveLength(1);

    // 31 phút sau (dấu và bộ nhớ quá cooldown), IPN vẫn lỗi: báo lại với số của cửa sổ mới.
    clock += 31 * MIN;
    await h.db.pool.query(
      "UPDATE ops_alert_marks SET raised_at = raised_at - interval '31 minutes' WHERE kind = $1 AND subject = $2",
      [OpsAlertKind.IPN_FAILURES, OPS_ALERT_SYSTEM_SUBJECT],
    );
    for (let i = 0; i < THRESHOLD; i++) await signatureFailure();
    const jobs = await ipnFailureJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[1]!.data.details).toMatchObject({ failures: 5, signature: 5 });
  });

  it('IPN lỗi tới cùng lúc khi đã quá ngưỡng → đúng một email', async () => {
    for (let i = 0; i < THRESHOLD - 1; i++) await signatureFailure();
    const results = await Promise.all(Array.from({ length: 6 }, () => postIpn(h, ipnKey, badSignature())));
    expect(results.map((res) => res.status)).toEqual(Array(6).fill(401));
    expect(monitor.counts().failures).toBe(10);
    expect(await ipnFailureJobs()).toHaveLength(1);
  });

  it('Kênh lỗi: DB lỗi khi raise từ IPN → IPN trả như cũ (401), raise chỉ log warn; không dấu, không email', async () => {
    const warnsBefore = h.logs.lines.filter((l) => l.msg === WARN_RAISE_FAILED && l.kind === OpsAlertKind.IPN_FAILURES).length;
    await withMarksInsertRevoked(async () => {
      for (let i = 0; i < THRESHOLD; i++) await signatureFailure();
    });
    const warns = h.logs.lines.filter((l) => l.msg === WARN_RAISE_FAILED && l.kind === OpsAlertKind.IPN_FAILURES);
    expect(warns).toHaveLength(warnsBefore + 1);
    expect(warns.at(-1)).toMatchObject({ level: 40, error: { code: '42501' } });
    expect(await markExists()).toBe(false);
    expect(await ipnFailureJobs()).toEqual([]);
  });

  it('cửa sổ 5 phút; ghi nhận không bao giờ ném (cửa sổ hay kênh lỗi → log warn)', async () => {
    expect(IPN_FAILURE_WINDOW_MS).toBe(5 * MIN);
    const broken = new IpnFailureMonitor(
      {
        raise: () => {
          throw new Error('kênh hỏng');
        },
      } as unknown as OpsAlerts,
      { threshold: 1, now: () => clock },
    );
    const warns = () =>
      h.logs.lines.filter(
        (l) => l.context === 'IpnFailureMonitor' && l.msg === 'Không ghi nhận được IPN lỗi cho cảnh báo vận hành',
      );
    const before = warns().length;
    // Ngưỡng 1: lần ghi nhận nào cũng xét luật; kênh ném → vẫn resolve, log warn (chỉ tên lớp lỗi).
    await expect(broken.record('signature')).resolves.toBeUndefined();
    await expect(broken.record('invalid_body')).resolves.toBeUndefined();
    expect(warns().slice(before)).toEqual([
      expect.objectContaining({ level: 40, reason: 'signature', error: { type: 'Error' } }),
      expect.objectContaining({ level: 40, reason: 'invalid_body', error: { type: 'Error' } }),
    ]);
    expect(broken.counts()).toEqual({ failures: 2, signature: 1, invalid_body: 1, server_error: 0 });
  });

  it('IPN xử lý được (200) không đếm', async () => {
    const res = await postIpn(h, ipnKey, signedIpn());
    expect(res.status).toBe(200);
    expect(monitor.counts().failures).toBe(0);
  });
});
