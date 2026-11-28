import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  eventGoogleSheetsConnectApiPath,
  googleSheetsReturnPath,
  JobQueue,
  Role,
  SheetConnectStartResponse,
  SHEETS_KEPT_CHANGES_NOTE,
  SheetsAuthRevokedEmailPayload,
  StatusNoticeList,
  type SheetsNotice,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleApiError, GoogleSheetsClient, type SpreadsheetTab } from '../../src/modules/integration/google-client.js';
import { GOOGLE_SHEETS_CLIENT } from '../../src/modules/integration/integration.config.js';
import { markSheetRowChanged, runSheetFlush } from '../../src/modules/integration/sheet-flush-jobs.js';
import {
  sendSheetsAuthRevokedEmail,
  sheetsAuthRevokedRecipients,
} from '../../src/modules/integration/sheet-revoked-email-jobs.js';
import {
  revokedSheetConnectionsOf,
  revokeSheetConnection,
  sheetsAuthRevokedEmailJobId,
} from '../../src/modules/integration/sheet-revocation.js';
import {
  recordGoogleFailure,
  runSheetInitialSync,
  sheetInitialSyncJobId,
  sheetReconnectSyncJobId,
} from '../../src/modules/integration/sheet-sync-jobs.js';
import { EMAIL_TRANSPORT, type EmailMessage } from '../../src/platform/email/index.js';
import { BOSS, childJobId } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { startGoogleFake, type GoogleFake } from '../google-fake/server.js';
import { databaseUrl, TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import { paidReadyOrg, rejectingTingee, resetOrderRateLimit, type Org, type User } from '../ordering/order-fixtures.js';
import { sleep } from '../platform/sse-client.js';
import {
  connectAndSync,
  connectionStateOf,
  connectSheet,
  dirtyOf,
  disconnectSheet,
  discardPendingSheetJobs,
  flushJobsOf,
  freeSheetEvent,
  googleUrlsOf,
  initialSyncJobsOf,
  placeFreeOrder,
  prepareSheetQueues,
  seedOrders,
  SHEETS_CLIENT_ID,
  SHEETS_CLIENT_SECRET,
  sheetDeps,
  sheetsSecretBox,
  type SheetEnv,
} from './sheet-fixtures.js';

/*
 * Story 6.6: mất quyền Google Sheets và kết nối lại, theo từng dòng phía api của I/O Matrix, với Google fake và Postgres
 * thật. Mất quyền (flush hay lần đẩy đầu nhận `invalid_grant`/401/403): `auth_revoked` + mốc, đúng một job email theo
 * (kết nối, mốc), `org_status_changed`, banner cho Owner và Admin; lỗi lặp không đổi mốc, không email thứ hai. Email: job
 * gốc chốt Owner rồi mọi Admin, job con gửi một email; email trễ (đã kết nối lại, đã ngắt) bỏ qua. Kết nối lại: cùng tài
 * khoản Google dùng lại Sheet (flush dòng bẩn rồi `active`), grant không mở được Sheet cũ (404, 403, mất tab) → Sheet mới,
 * mất quyền trước khi lần đẩy đầu xong → lần đẩy đầu chạy lại với id job mới, dò Sheet lỗi tạm thời → `sheets-failed`,
 * CAS hai người, kết nối bị xóa giữa chừng, từ chối trên Google. Banner: mỗi kết nối một thông báo, thứ tự ưu tiên. Ca
 * cuối chạy worker thật qua pg-boss (job gốc → job con → email).
 *
 * Google fake: mặc định mỗi grant là một tài khoản riêng (grant mới nhận 404 với Sheet của grant cũ); `fake.account` đặt
 * trước lần đồng ý thì các grant cùng tài khoản thấy Sheet của nhau (kết nối lại bằng cùng tài khoản Google).
 */

/** Tài khoản Google của người cấp ở các ca "cùng tài khoản". */
const ACCOUNT = 'ha.tran@clb-bongban.vn';
const EMAIL_QUEUE = JobQueue.INTEGRATION_SHEETS_AUTH_REVOKED_EMAIL;

let fake: GoogleFake;
let h: Harness;
let boss: PgBoss;
let org: Org;
let admin: User;
let admin2: User;
let env: SheetEnv;
let listener: pg.Client;
const notified: Record<string, unknown>[] = [];
/**
 * Chạy ngay trước lời dò Sheet cũ của callback (một lần): giả một thay đổi đến giữa lúc dò và transaction kết nối lại
 * (ngắt kết nối, người khác vừa kết nối lại, mất quyền lần mới).
 */
let beforeProbe: (() => Promise<void>) | null = null;

/** Client Google của vai api: như client thật trỏ vào fake, thêm móc `beforeProbe`. */
class HookedSheetsClient extends GoogleSheetsClient {
  override async spreadsheetInfo(accessToken: string, spreadsheetId: string): Promise<SpreadsheetTab[]> {
    const hook = beforeProbe;
    beforeProbe = null;
    if (hook) await hook();
    return super.spreadsheetInfo(accessToken, spreadsheetId);
  }
}

beforeAll(async () => {
  fake = await startGoogleFake({ clientId: SHEETS_CLIENT_ID, clientSecret: SHEETS_CLIENT_SECRET });
  const hooked = new HookedSheetsClient({
    clientId: SHEETS_CLIENT_ID,
    clientSecret: SHEETS_CLIENT_SECRET,
    authorizeUrl: fake.authorizeUrl,
    tokenUrl: fake.tokenUrl,
    sheetsApiUrl: fake.url,
  });
  h = await createHarness(googleUrlsOf(fake), {
    overrides: [rejectingTingee, { provide: GOOGLE_SHEETS_CLIENT, useValue: hooked }],
  });
  boss = h.app.get<PgBoss>(BOSS);
  org = await paidReadyOrg(h, { name: 'CLB Bóng bàn Quận 7' });
  admin = await addAdmin(org);
  admin2 = await addAdmin(org);
  env = { h, fake, org };
  await prepareSheetQueues(h);
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => notified.push(JSON.parse(message.payload ?? '{}') as Record<string, unknown>));
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
});
beforeEach(async () => {
  fake.reset();
  beforeProbe = null;
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await listener.end();
  await h.close();
  await fake.close();
});

/** Admin mới của BTC (chèn thẳng `members`). */
async function addAdmin(target: Org): Promise<User> {
  const user = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${target.orgId}, ${user.userId}, ${Role.ADMIN})`,
  );
  return user;
}

const deps = () => sheetDeps(env);
const returnUrl = (eventId: string, notice: SheetsNotice, target: Org = org) =>
  `${TEST_WEB_ORIGIN}${googleSheetsReturnPath(notice, { organizationId: target.orgId, eventId })}`;

/** `POST …/google-sheets/connect` bằng tài khoản `user`. */
const startConnect = (eventId: string, user: User = org.owner, target: Org = org) =>
  h.http.post(`/v1${eventGoogleSheetsConnectApiPath(target.orgId, eventId)}`).set('cookie', user.cookie).send();

/** Đồng ý trên Google fake (tài khoản `account`) cho lượt `start`: trả `Location` Google 302 về callback. */
async function consent(start: Response, account: string | null): Promise<URL> {
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  fake.account = account;
  return new URL(await fake.authorize(SheetConnectStartResponse.parse(start.body).authorizationUrl));
}

/** Callback như trình duyệt quay về: trả đích 302 về web. */
async function callback(location: URL, user: User): Promise<string> {
  const res = await h.http.get(`${location.pathname}${location.search}`).set('cookie', user.cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(302);
  return res.headers.location as string;
}

/** "Kết nối lại" trọn luồng (bấm, đồng ý bằng tài khoản `account`, callback): đích 302 về web. */
async function reconnect(eventId: string, options: { user?: User; account?: string | null } = {}): Promise<string> {
  const user = options.user ?? org.owner;
  return callback(await consent(await startConnect(eventId, user), options.account ?? null), user);
}

/** Dòng kết nối đọc thẳng DB, kể cả refresh token đã mã hóa (so "giữ nguyên"). */
async function rawConnection(connectionId: string) {
  const { rows } = await h.db.pool.query<Record<string, unknown>>('SELECT * FROM sheet_connections WHERE id = $1', [
    connectionId,
  ]);
  return rows[0];
}

/** Job email mất quyền của kết nối: job gốc (không `recipientUserId`) và job con. */
async function emailJobsOf(connectionId: string) {
  const jobs = await boss.findJobs(EMAIL_QUEUE, { data: { connectionId } });
  const isChild = (job: (typeof jobs)[number]) =>
    (job.data as { recipientUserId?: string }).recipientUserId !== undefined;
  return { roots: jobs.filter((job) => !isChild(job)), children: jobs.filter(isChild) };
}

const notifier = () => ({ db: h.db, email: h.email, webOrigin: TEST_WEB_ORIGIN });
const handledRoots = new Set<string>();

/**
 * Như worker chạy các job gốc chưa chạy của kết nối: chốt người nhận rồi gửi từng người (job con). Trả email vừa gửi và
 * số job gốc bị bỏ qua.
 */
async function deliverRevokedEmails(connectionId: string): Promise<{ sent: EmailMessage[]; skipped: number }> {
  const before = h.email.sent.length;
  let skipped = 0;
  for (const job of (await emailJobsOf(connectionId)).roots) {
    if (handledRoots.has(job.id)) continue;
    handledRoots.add(job.id);
    const payload = SheetsAuthRevokedEmailPayload.parse(job.data);
    const recipients = await sheetsAuthRevokedRecipients(h.db, payload);
    if (recipients === 'skipped') {
      skipped += 1;
      continue;
    }
    for (const userId of recipients) await sendSheetsAuthRevokedEmail(notifier(), payload, userId);
  }
  return { sent: h.email.sent.slice(before), skipped };
}

const statusSignalsOf = (orgId: string) =>
  notified.filter((n) => n.type === 'org_status_changed' && n.organizationId === orgId);

/** Chờ số tín hiệu `org_status_changed` của BTC đạt `expected` (NOTIFY tới không đồng bộ) rồi kiểm không thêm. */
async function signalsSettled(orgId: string, expected: number): Promise<void> {
  await expect.poll(() => statusSignalsOf(orgId).length, { timeout: 5_000, interval: 50 }).toBe(expected);
  await sleep(150);
  expect(statusSignalsOf(orgId)).toHaveLength(expected);
}

async function noticesOf(user: User, target: Org = org) {
  const res = await h.http.get(`/v1/orgs/${target.orgId}/notices`).set('cookie', user.cookie).expect(200);
  return StatusNoticeList.parse(res.body);
}

const sheetsNoticesOf = async (user: User, target: Org = org) =>
  (await noticesOf(user, target)).filter((n) => n.code === 'SHEETS_AUTH_REVOKED');

async function auditRows(action: string, eventId: string) {
  const { rows } = await h.db.pool.query<{ actor_user_id: string; changed_fields: string[] }>(
    `SELECT actor_user_id, changed_fields FROM audit_events
      WHERE organization_id = $1 AND action = $2 AND target_type = 'event' AND target_id = $3 ORDER BY created_at, id`,
    [org.orgId, action, eventId],
  );
  return rows;
}

/** Mã Đơn (bỏ tiêu đề) của tab đầu, theo cột Mã Đơn. */
const codesOn = (spreadsheetId: string): string[] => {
  const column = fake.columnOf(spreadsheetId, 'order_code') ?? 0;
  return fake
    .values(spreadsheetId)
    .slice(1)
    .map((row) => String(row[column] ?? ''))
    .filter((code) => code !== '');
};

/**
 * Sự kiện đã kết nối (bằng tài khoản Google `account`) và đẩy xong `orders` Đơn, rồi Google thu hồi quyền: một Đơn đổi
 * (dòng bẩn), flush nhận `invalid_grant` → `auth_revoked`. Trả Sự kiện, Đơn, id kết nối và Sheet.
 */
async function syncedThenRevoked(options: { account?: string | null; orders?: number } = {}) {
  const sale = await freeSheetEvent(org);
  const orders = await seedOrders(
    env,
    sale.event.id,
    Array.from({ length: options.orders ?? 2 }, () => ({ status: 'paid' as const })),
  );
  fake.account = options.account === undefined ? ACCOUNT : options.account;
  const { connectionId, spreadsheetId } = await connectAndSync(env, sale.event.id);
  fake.reset();
  expect(await markSheetRowChanged(deps(), { eventId: sale.event.id, orderId: orders[0]!.id })).toBe('scheduled');
  fake.revokeAll();
  expect(await runSheetFlush(deps(), connectionId)).toEqual({ result: 'auth_revoked', code: 'invalid_grant' });
  fake.reset();
  const state = await connectionStateOf(h, connectionId);
  return { sale, eventId: sale.event.id, orders, connectionId, spreadsheetId, revokedAt: state!.auth_revoked_at! };
}

// ---------------------------------------------------------------------------------------------------------------

describe('mất quyền', () => {
  it('flush nhận invalid_grant → auth_revoked + mốc, đúng một job email theo (kết nối, mốc), org_status_changed, banner cho Owner và Admin; không retry, giữ dòng bẩn', async () => {
    const sale = await freeSheetEvent(org);
    const [order] = await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    fake.account = ACCOUNT;
    const { connectionId } = await connectAndSync(env, sale.event.id);
    expect(await markSheetRowChanged(deps(), { eventId: sale.event.id, orderId: order!.id })).toBe('scheduled');
    const signals = statusSignalsOf(org.orgId).length;
    fake.revokeAll();
    fake.requests.length = 0;

    expect(await runSheetFlush(deps(), connectionId)).toEqual({ result: 'auth_revoked', code: 'invalid_grant' });
    const state = (await connectionStateOf(h, connectionId))!;
    expect(state).toMatchObject({ status: 'auth_revoked', last_error_code: 'invalid_grant' });
    expect(state.auth_revoked_at).toBeInstanceOf(Date);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[order!.id, 1]]));
    // Không retry: lượt sau không gọi Google.
    fake.requests.length = 0;
    expect(await runSheetFlush(deps(), connectionId)).toEqual({ result: 'skipped', reason: 'auth_revoked' });
    expect(fake.requests).toEqual([]);

    const { roots } = await emailJobsOf(connectionId);
    expect(roots.map((job) => job.id)).toEqual([sheetsAuthRevokedEmailJobId(connectionId, state.auth_revoked_at!)]);
    expect(roots[0]!.data).toEqual({ connectionId, authRevokedAt: state.auth_revoked_at!.toISOString() });
    await signalsSettled(org.orgId, signals + 1);

    // Banner: Owner và Admin cùng thấy, data chỉ id và tên Sự kiện, version = mốc.
    for (const user of [org.owner, admin]) {
      const mine = (await sheetsNoticesOf(user)).filter((n) => n.data.eventId === sale.event.id);
      expect(mine).toEqual([
        {
          code: 'SHEETS_AUTH_REVOKED',
          severity: 'warning',
          blocking: false,
          dismissible: true,
          scope: 'event',
          audience: ['owner', 'admin'],
          data: { eventId: sale.event.id, eventName: sale.event.name },
          version: state.auth_revoked_at!.toISOString(),
        },
      ]);
    }
  });

  it('lần đẩy đầu nhận 403 → auth_revoked qua cùng đường (mốc, job email, tín hiệu)', async () => {
    const sale = await freeSheetEvent(org);
    await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    const connectionId = await connectSheet(env, sale.event.id);
    const signals = statusSignalsOf(org.orgId).length;
    fake.sheetsReplies.push({ status: 403 });
    expect(await runSheetInitialSync(deps(), connectionId)).toEqual({ result: 'auth_revoked', code: 'forbidden' });
    const state = (await connectionStateOf(h, connectionId))!;
    expect(state).toMatchObject({ status: 'auth_revoked', last_error_code: 'forbidden', spreadsheet_id: null });
    expect((await emailJobsOf(connectionId)).roots.map((job) => job.id)).toEqual([
      sheetsAuthRevokedEmailJobId(connectionId, state.auth_revoked_at!),
    ]);
    await signalsSettled(org.orgId, signals + 1);
  });

  it('lỗi lặp: kết nối đã auth_revoked, job khác nhận 401 → không đổi mã và mốc, không email thứ hai, không tín hiệu', async () => {
    const { connectionId } = await syncedThenRevoked();
    const before = await rawConnection(connectionId);
    const signals = statusSignalsOf(org.orgId).length;

    const unauthorized = new GoogleApiError('spreadsheet_info', 'auth_revoked', 'unauthorized', 401);
    expect(await recordGoogleFailure(deps(), connectionId, unauthorized)).toEqual({ result: 'disconnected' });
    expect(await h.db.transaction((tx) => revokeSheetConnection(tx, boss, connectionId, 'forbidden'))).toBe(false);

    expect(await rawConnection(connectionId)).toEqual(before);
    expect((await emailJobsOf(connectionId)).roots).toHaveLength(1);
    await signalsSettled(org.orgId, signals);
  });

  it('kết nối đã auth_revoked: lỗi tạm thời của job cũ không đổi trạng thái (giữ mất quyền)', async () => {
    const { connectionId } = await syncedThenRevoked();
    const before = await rawConnection(connectionId);
    const transient = new GoogleApiError('write_values', 'transient', 'server_error', 503);
    expect(await recordGoogleFailure(deps(), connectionId, transient)).toEqual({ result: 'disconnected' });
    expect(await rawConnection(connectionId)).toEqual(before);
  });
});

describe('email mất quyền', () => {
  it('job gốc chốt Owner rồi mọi Admin; mỗi người đúng một email: tên Sự kiện, lý do, câu giữ dòng bẩn, link tab Cài đặt; không token, không dữ liệu người mua', async () => {
    const { eventId, connectionId, spreadsheetId } = await syncedThenRevoked();
    await h.db.pool.query(`UPDATE events SET name = 'Giải <bơi> & "mùa đông"' WHERE id = $1`, [eventId]);
    const [root] = (await emailJobsOf(connectionId)).roots;
    expect(await sheetsAuthRevokedRecipients(h.db, SheetsAuthRevokedEmailPayload.parse(root!.data))).toEqual([
      org.owner.userId,
      admin.userId,
      admin2.userId,
    ]);

    const { sent } = await deliverRevokedEmails(connectionId);
    expect(sent.map((m) => m.to).sort()).toEqual([org.owner.email, admin.email, admin2.email].sort());
    const settings = `${TEST_WEB_ORIGIN}/btc/${org.orgId}/su-kien/${eventId}?tab=cai-dat`;
    for (const message of sent) {
      expect(message.subject).toBe('Mất quyền ghi Google Sheets: Giải <bơi> & "mùa đông"');
      expect(message.text).toContain('Tickee không còn ghi được lên Google Sheet của Sự kiện Giải <bơi> & "mùa đông".');
      expect(message.text).toContain('Lý do: Quyền truy cập Google Drive đã bị thu hồi.');
      expect(message.text).toContain(SHEETS_KEPT_CHANGES_NOTE);
      expect(message.text).toContain(settings);
      expect(message.html).toContain('Giải &lt;bơi&gt; &amp; &quot;mùa đông&quot;');
      expect(message.html).not.toContain('<bơi>');
      expect(message.html).toContain(`href="${settings}"`);
      for (const secret of [
        'chen-tay@vidu.vn',
        '+84987654321',
        '0987654321',
        spreadsheetId,
        ...fake.issued.refreshTokens,
        ...fake.issued.accessTokens,
      ]) {
        expect(message.text, secret).not.toContain(secret);
        expect(message.html, secret).not.toContain(secret);
      }
    }
  });

  it('email trễ: kết nối lại trước khi job gốc chạy → bỏ qua, không gửi; job con đã tạo trước khi kết nối lại cũng bỏ qua', async () => {
    const late = await syncedThenRevoked();
    expect(await reconnect(late.eventId, { account: ACCOUNT })).toBe(returnUrl(late.eventId, 'sheets-reconnected'));
    expect(await deliverRevokedEmails(late.connectionId)).toEqual({ sent: [], skipped: 1 });

    const fanned = await syncedThenRevoked();
    const [root] = (await emailJobsOf(fanned.connectionId)).roots;
    const payload = SheetsAuthRevokedEmailPayload.parse(root!.data);
    expect(await sheetsAuthRevokedRecipients(h.db, payload)).toHaveLength(3);
    expect(await reconnect(fanned.eventId, { account: ACCOUNT })).toBe(returnUrl(fanned.eventId, 'sheets-reconnected'));
    expect(await sendSheetsAuthRevokedEmail(notifier(), payload, org.owner.userId)).toBe('skipped');
  });

  it('ngắt kết nối trước khi job chạy, hay người nhận không còn trong BTC → bỏ qua', async () => {
    const gone = await syncedThenRevoked();
    await disconnectSheet(env, gone.eventId);
    expect(await deliverRevokedEmails(gone.connectionId)).toEqual({ sent: [], skipped: 1 });

    const left = await syncedThenRevoked();
    const outsider = await signUp(h);
    const [root] = (await emailJobsOf(left.connectionId)).roots;
    const payload = SheetsAuthRevokedEmailPayload.parse(root!.data);
    expect(await sendSheetsAuthRevokedEmail(notifier(), payload, outsider.userId)).toBe('skipped');
  });

  it('SMTP lỗi → job con ném lỗi (pg-boss retry), lỗi chỉ có tên lớp, không chứa địa chỉ email; người khác vẫn nhận', async () => {
    const { connectionId } = await syncedThenRevoked();
    const [root] = (await emailJobsOf(connectionId)).roots;
    const payload = SheetsAuthRevokedEmailPayload.parse(root!.data);
    h.email.failFor.set(admin.email, new Error(`SMTP từ chối ${admin.email}`));
    try {
      const err = await sendSheetsAuthRevokedEmail(notifier(), payload, admin.userId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Không gửi được email mất quyền Google Sheets (Error)');
      const before = h.email.sent.length;
      expect(await sendSheetsAuthRevokedEmail(notifier(), payload, admin2.userId)).toBe('sent');
      expect(h.email.sent.slice(before).map((m) => m.to)).toEqual([admin2.email]);
    } finally {
      h.email.failFor.delete(admin.email);
    }
  });
});

describe('kết nối lại', () => {
  it('POST connect khi auth_revoked → 200 (lượt OAuth mới); khi đang hoạt động → 409 SHEETS_ALREADY_CONNECTED', async () => {
    const { eventId } = await syncedThenRevoked();
    expect((await startConnect(eventId)).status).toBe(200);
    expect((await startConnect(eventId, admin)).status).toBe(200);

    const sale = await freeSheetEvent(org);
    await connectAndSync(env, sale.event.id);
    const res = await startConnect(sale.event.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHEETS_ALREADY_CONNECTED');
  });

  it('cùng tài khoản Google, có dòng bẩn: dùng lại Sheet, syncing → flush ghi thay đổi lúc mất quyền → active; banner mất; audit; tín hiệu', async () => {
    const { sale, eventId, orders, connectionId, spreadsheetId } = await syncedThenRevoked();
    // Thay đổi trong lúc mất quyền: chỉ đánh dấu, không hẹn flush.
    const placed = await placeFreeOrder(h, sale);
    expect(await markSheetRowChanged(deps(), { eventId, orderId: placed.id })).toBe('marked');
    const signals = statusSignalsOf(org.orgId).length;
    expect(await flushJobsOf(h, connectionId)).toHaveLength(1);

    expect(await reconnect(eventId, { account: ACCOUNT })).toBe(returnUrl(eventId, 'sheets-reconnected'));
    // Dò Sheet cũ bằng token mới (một lời đọc tab).
    expect(fake.calls('GET', `/v4/spreadsheets/${spreadsheetId}`)).toHaveLength(1);
    const row = (await rawConnection(connectionId))!;
    expect(row).toMatchObject({
      status: 'syncing',
      spreadsheet_id: spreadsheetId,
      auth_revoked_at: null,
      last_error_code: null,
      granted_by_user_id: org.owner.userId,
    });
    // Refresh token mới, mã hóa; không bao giờ trong log.
    expect(sheetsSecretBox.open(row.refresh_token as string)).toBe(fake.issued.refreshTokens.at(-1));
    for (const token of fake.issued.refreshTokens) expect(h.logs.text).not.toContain(token);
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[orders[0]!.id, 1], [placed.id, 1]]));
    expect(await flushJobsOf(h, connectionId)).toHaveLength(2);
    expect(await auditRows('sheet_connection.reconnected', eventId)).toEqual([
      { actor_user_id: org.owner.userId, changed_fields: ['granted_by_user_id', 'refresh_token', 'status'] },
    ]);
    await signalsSettled(org.orgId, signals + 1);
    expect((await sheetsNoticesOf(org.owner)).filter((n) => n.data.eventId === eventId)).toEqual([]);

    expect(await runSheetFlush(deps(), connectionId)).toMatchObject({ result: 'flushed', updated: 1, appended: 1 });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'active', spreadsheet_id: spreadsheetId });
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
    expect(codesOn(spreadsheetId)).toEqual([...orders.map((o) => o.code), placed.code]);
  });

  it('dùng lại Sheet, không dòng bẩn → active ngay, không hẹn flush; flush lỗi tạm thời sau khi dùng lại → retrying như 6.5', async () => {
    const { eventId, connectionId, spreadsheetId } = await syncedThenRevoked();
    await h.db.pool.query('DELETE FROM sheet_dirty_rows WHERE connection_id = $1', [connectionId]);
    const flushes = (await flushJobsOf(h, connectionId)).length;
    expect(await reconnect(eventId, { account: ACCOUNT })).toBe(returnUrl(eventId, 'sheets-reconnected'));
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'active', spreadsheet_id: spreadsheetId });
    expect(await flushJobsOf(h, connectionId)).toHaveLength(flushes);

    const again = await syncedThenRevoked();
    expect(await reconnect(again.eventId, { account: ACCOUNT })).toBe(returnUrl(again.eventId, 'sheets-reconnected'));
    fake.sheetsReplies.push({ status: 503 });
    expect(await runSheetFlush(deps(), again.connectionId)).toEqual({ result: 'retry', code: 'server_error' });
    expect(await connectionStateOf(h, again.connectionId)).toMatchObject({
      status: 'retrying',
      last_error_code: 'server_error',
      auth_revoked_at: null,
    });
  });

  const unreachable: [string, string | null, (spreadsheetId: string) => void][] = [
    ['Admin khác, grant mới không mở được Sheet cũ (404)', null, () => undefined],
    ['403 khi dò Sheet cũ', ACCOUNT, () => void fake.sheetsReplies.push({ status: 403 })],
    [
      'Sheet cũ mất tab Đơn',
      ACCOUNT,
      (spreadsheetId) => {
        fake.addTab(spreadsheetId, 'Khác');
        fake.deleteTab(spreadsheetId, 0);
      },
    ],
  ];
  it.each(unreachable)('%s → Sheet mới: đặt lại Sheet, syncing, lần đẩy đầu với id job mới, đẩy lại toàn bộ Đơn rồi flush dòng bẩn', async (_name, account, script) => {
    const { sale, eventId, orders, connectionId, spreadsheetId, revokedAt } = await syncedThenRevoked();
    const placed = await placeFreeOrder(h, sale);
    expect(await markSheetRowChanged(deps(), { eventId, orderId: placed.id })).toBe('marked');
    script(spreadsheetId);

    expect(await reconnect(eventId, { user: admin, account })).toBe(returnUrl(eventId, 'sheets-reconnected'));
    expect(await connectionStateOf(h, connectionId)).toMatchObject({
      status: 'syncing',
      spreadsheet_id: null,
      spreadsheet_url: null,
      last_synced_at: null,
      sheet_tab_id: 0,
      auth_revoked_at: null,
      last_error_code: null,
      granted_by_user_id: admin.userId,
    });
    expect((await initialSyncJobsOf(h, connectionId)).map((job) => job.id)).toEqual([
      sheetInitialSyncJobId(connectionId),
      sheetReconnectSyncJobId(connectionId, revokedAt),
    ]);
    expect(sheetReconnectSyncJobId(connectionId, revokedAt)).not.toBe(sheetInitialSyncJobId(connectionId));
    expect(await auditRows('sheet_connection.reconnected', eventId)).toEqual([
      { actor_user_id: admin.userId, changed_fields: ['granted_by_user_id', 'refresh_token', 'status', 'spreadsheet_id'] },
    ]);
    // Dòng bẩn giữ tới khi flush.
    expect(await dirtyOf(h, connectionId)).toEqual(new Map([[orders[0]!.id, 1], [placed.id, 1]]));

    const synced = await runSheetInitialSync(deps(), connectionId);
    expect(synced).toMatchObject({ result: 'synced', orders: 3 });
    const fresh = (synced as { spreadsheetId: string }).spreadsheetId;
    expect(fresh).not.toBe(spreadsheetId);
    expect(codesOn(fresh)).toEqual([...orders.map((o) => o.code), placed.code]);
    expect(await runSheetFlush(deps(), connectionId)).toMatchObject({ result: 'flushed', updated: 2, appended: 0 });
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'active', spreadsheet_id: fresh });
    expect(await dirtyOf(h, connectionId)).toEqual(new Map());
  });

  it('mất quyền trước khi lần đẩy đầu xong (chưa có Sheet, hay Sheet dở) → không dò, lần đẩy đầu chạy lại với id job mới', async () => {
    // Chưa có Sheet.
    const sale = await freeSheetEvent(org);
    const orders = await seedOrders(env, sale.event.id, [{ status: 'paid' }, { status: 'refunded' }]);
    const connectionId = await connectSheet(env, sale.event.id);
    fake.revokeAll();
    expect(await runSheetInitialSync(deps(), connectionId)).toEqual({ result: 'auth_revoked', code: 'invalid_grant' });
    const revokedAt = (await connectionStateOf(h, connectionId))!.auth_revoked_at!;
    fake.reset();
    expect(await reconnect(sale.event.id)).toBe(returnUrl(sale.event.id, 'sheets-reconnected'));
    expect(fake.calls('GET', '/v4/spreadsheets')).toEqual([]);
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'syncing', spreadsheet_id: null });
    expect((await initialSyncJobsOf(h, connectionId)).map((job) => job.id)).toEqual([
      sheetInitialSyncJobId(connectionId),
      sheetReconnectSyncJobId(connectionId, revokedAt),
    ]);
    const synced = await runSheetInitialSync(deps(), connectionId);
    expect(synced).toMatchObject({ result: 'synced', orders: 2 });
    expect(codesOn((synced as { spreadsheetId: string }).spreadsheetId)).toEqual(orders.map((o) => o.code));
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'active' });

    // Sheet đã tạo nhưng lần đẩy đầu dở: cùng tài khoản vẫn không dò, Sheet mới.
    const half = await freeSheetEvent(org);
    await seedOrders(env, half.event.id, [{ status: 'paid' }]);
    fake.account = ACCOUNT;
    const halfId = await connectSheet(env, half.event.id);
    fake.reset();
    fake.sheetsReplies.push('pass', { status: 401 });
    expect(await runSheetInitialSync(deps(), halfId)).toEqual({ result: 'auth_revoked', code: 'unauthorized' });
    const halfState = (await connectionStateOf(h, halfId))!;
    expect(halfState).toMatchObject({ status: 'auth_revoked', last_synced_at: null });
    expect(halfState.spreadsheet_id).not.toBeNull();
    fake.reset();
    expect(await reconnect(half.event.id, { account: ACCOUNT })).toBe(returnUrl(half.event.id, 'sheets-reconnected'));
    expect(fake.calls('GET', '/v4/spreadsheets')).toEqual([]);
    expect(await connectionStateOf(h, halfId)).toMatchObject({ status: 'syncing', spreadsheet_id: null });
    const resynced = await runSheetInitialSync(deps(), halfId);
    expect(resynced).toMatchObject({ result: 'synced', orders: 1 });
    expect((resynced as { spreadsheetId: string }).spreadsheetId).not.toBe(halfState.spreadsheet_id);
  });

  it.each([
    ['5xx', { status: 503 }, 'probe_server_error'],
    ['429', { status: 429 }, 'probe_rate_limited'],
  ] as const)('dò Sheet cũ lỗi tạm thời (%s) → sheets-failed, kết nối giữ nguyên; bấm lại thì kết nối lại được', async (_name, reply, reason) => {
    const { eventId, connectionId } = await syncedThenRevoked();
    const before = await rawConnection(connectionId);
    const logged = h.logs.lines.length;
    fake.sheetsReplies.push(reply);
    expect(await reconnect(eventId, { account: ACCOUNT })).toBe(returnUrl(eventId, 'sheets-failed'));
    expect(await rawConnection(connectionId)).toEqual(before);
    expect(h.logs.lines.slice(logged).some((line) => line.reason === reason)).toBe(true);
    expect(await auditRows('sheet_connection.reconnected', eventId)).toEqual([]);

    expect(await reconnect(eventId, { account: ACCOUNT })).toBe(returnUrl(eventId, 'sheets-reconnected'));
    expect(await connectionStateOf(h, connectionId)).toMatchObject({ status: 'syncing', auth_revoked_at: null });
  });

  it('hai người cùng kết nối lại: một thắng, người sau sheets-already-connected; một audit', async () => {
    const { eventId, connectionId } = await syncedThenRevoked();
    const first = await consent(await startConnect(eventId, org.owner), ACCOUNT);
    const second = await consent(await startConnect(eventId, admin), ACCOUNT);
    const results = await Promise.all([callback(first, org.owner), callback(second, admin)]);
    expect(results.sort()).toEqual(
      [returnUrl(eventId, 'sheets-already-connected'), returnUrl(eventId, 'sheets-reconnected')].sort(),
    );
    const state = (await connectionStateOf(h, connectionId))!;
    expect(state.status).toBe('syncing');
    expect([org.owner.userId, admin.userId]).toContain(state.granted_by_user_id);
    expect(await auditRows('sheet_connection.reconnected', eventId)).toHaveLength(1);
  });

  it('CAS trượt giữa lúc dò và transaction: người khác vừa kết nối lại → already-connected; mất quyền lần mới → failed; kết nối bị xóa → đường tạo kết nối của 6.4', async () => {
    const changed = await syncedThenRevoked();
    beforeProbe = async () => {
      await h.db.pool.query(
        "UPDATE sheet_connections SET status = 'active', auth_revoked_at = NULL, last_error_code = NULL WHERE id = $1",
        [changed.connectionId],
      );
    };
    expect(await reconnect(changed.eventId, { account: ACCOUNT })).toBe(returnUrl(changed.eventId, 'sheets-already-connected'));
    expect(await connectionStateOf(h, changed.connectionId)).toMatchObject({ status: 'active' });

    const again = await syncedThenRevoked();
    beforeProbe = async () => {
      await h.db.pool.query(
        "UPDATE sheet_connections SET auth_revoked_at = now() + interval '1 second' WHERE id = $1",
        [again.connectionId],
      );
    };
    expect(await reconnect(again.eventId, { account: ACCOUNT })).toBe(returnUrl(again.eventId, 'sheets-failed'));
    expect(await connectionStateOf(h, again.connectionId)).toMatchObject({ status: 'auth_revoked' });

    const gone = await syncedThenRevoked();
    beforeProbe = async () => {
      await h.db.pool.query('DELETE FROM sheet_connections WHERE id = $1', [gone.connectionId]);
    };
    expect(await reconnect(gone.eventId, { account: ACCOUNT })).toBe(returnUrl(gone.eventId, 'sheets-connected'));
    const { rows } = await h.db.pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM sheet_connections WHERE event_id = $1',
      [gone.eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(gone.connectionId);
    expect(rows[0]!.status).toBe('syncing');
    expect(await auditRows('sheet_connection.created', gone.eventId)).toHaveLength(2);
  });

  it('kết nối bị ngắt trước khi quay về từ Google → đường tạo kết nối của 6.4 (sheets-connected)', async () => {
    const { eventId, connectionId } = await syncedThenRevoked();
    const start = await startConnect(eventId);
    await disconnectSheet(env, eventId);
    expect(await callback(await consent(start, ACCOUNT), org.owner)).toBe(returnUrl(eventId, 'sheets-connected'));
    const { rows } = await h.db.pool.query<{ id: string }>('SELECT id FROM sheet_connections WHERE event_id = $1', [eventId]);
    expect(rows.map((r) => r.id)).not.toContain(connectionId);
    expect(rows).toHaveLength(1);
  });

  it('người kết nối lại bị xóa khỏi BTC giữa lúc dò và transaction → sheets-failed (forbidden), kết nối giữ nguyên người cấp cũ; đường tạo kết nối cũng kiểm lại', async () => {
    const { eventId, connectionId } = await syncedThenRevoked();
    const leaving = await addAdmin(org);
    const before = await rawConnection(connectionId);
    const removeLeaving = async () => {
      await h.db.pool.query('DELETE FROM members WHERE organization_id = $1 AND user_id = $2', [org.orgId, leaving.userId]);
    };
    beforeProbe = removeLeaving;
    const logged = h.logs.lines.length;
    expect(await reconnect(eventId, { user: leaving, account: ACCOUNT })).toBe(returnUrl(eventId, 'sheets-failed'));
    expect(h.logs.lines.slice(logged).some((line) => line.reason === 'forbidden')).toBe(true);
    expect(await rawConnection(connectionId)).toEqual(before);
    expect(await connectionStateOf(h, connectionId)).toMatchObject({
      status: 'auth_revoked',
      granted_by_user_id: org.owner.userId,
    });
    expect(await auditRows('sheet_connection.reconnected', eventId)).toEqual([]);

    // Kết nối bị xóa giữa chừng nên rơi vào đường tạo kết nối của 6.4: vẫn kiểm lại vai, không tạo kết nối nào.
    const gone = await syncedThenRevoked();
    const leaving2 = await addAdmin(org);
    beforeProbe = async () => {
      await h.db.pool.query('DELETE FROM sheet_connections WHERE id = $1', [gone.connectionId]);
      await h.db.pool.query('DELETE FROM members WHERE organization_id = $1 AND user_id = $2', [
        org.orgId,
        leaving2.userId,
      ]);
    };
    expect(await reconnect(gone.eventId, { user: leaving2, account: ACCOUNT })).toBe(returnUrl(gone.eventId, 'sheets-failed'));
    const { rows } = await h.db.pool.query('SELECT id FROM sheet_connections WHERE event_id = $1', [gone.eventId]);
    expect(rows).toEqual([]);
  });

  it('ngắt kết nối mất quyền → org_status_changed cùng transaction, banner mất', async () => {
    const { eventId, connectionId } = await syncedThenRevoked();
    expect((await sheetsNoticesOf(org.owner)).some((n) => n.data.eventId === eventId)).toBe(true);
    const signals = statusSignalsOf(org.orgId).length;
    await disconnectSheet(env, eventId);
    expect(await connectionStateOf(h, connectionId)).toBeUndefined();
    await signalsSettled(org.orgId, signals + 1);
    expect((await sheetsNoticesOf(org.owner)).some((n) => n.data.eventId === eventId)).toBe(false);
  });

  it('từ chối trên Google khi kết nối lại → sheets-denied, kết nối giữ nguyên', async () => {
    const { eventId, connectionId } = await syncedThenRevoked();
    const before = await rawConnection(connectionId);
    const start = await startConnect(eventId);
    fake.consent = 'deny';
    expect(await callback(await consent(start, ACCOUNT), org.owner)).toBe(returnUrl(eventId, 'sheets-denied'));
    expect(await rawConnection(connectionId)).toEqual(before);
  });

  it('mất quyền lần hai sau khi đã kết nối lại → mốc mới, job email mới, banner hiện lại với version mới', async () => {
    const first = await syncedThenRevoked();
    expect(await reconnect(first.eventId, { account: ACCOUNT })).toBe(returnUrl(first.eventId, 'sheets-reconnected'));
    expect(await runSheetFlush(deps(), first.connectionId)).toMatchObject({ result: 'flushed' });
    expect(await sheetsNoticesOf(org.owner).then((n) => n.filter((x) => x.data.eventId === first.eventId))).toEqual([]);

    expect(await markSheetRowChanged(deps(), { eventId: first.eventId, orderId: first.orders[1]!.id })).toBe('scheduled');
    fake.revokeAll();
    expect(await runSheetFlush(deps(), first.connectionId)).toEqual({ result: 'auth_revoked', code: 'invalid_grant' });
    const second = (await connectionStateOf(h, first.connectionId))!.auth_revoked_at!;
    expect(second.getTime()).toBeGreaterThan(first.revokedAt.getTime());
    expect((await emailJobsOf(first.connectionId)).roots.map((job) => job.id).sort()).toEqual(
      [
        sheetsAuthRevokedEmailJobId(first.connectionId, first.revokedAt),
        sheetsAuthRevokedEmailJobId(first.connectionId, second),
      ].sort(),
    );
    const [notice] = (await sheetsNoticesOf(org.owner)).filter((n) => n.data.eventId === first.eventId);
    expect(notice?.version).toBe(second.toISOString());
  });
});

describe('banner mất quyền (reporting.notices)', () => {
  it('mỗi kết nối auth_revoked một banner theo lúc mất quyền, xếp sau chặn bán và trước Token dưới ngưỡng; Admin thấy, không thấy Token', async () => {
    const other = await paidReadyOrg(h, { name: 'CLB Cầu lông Thủ Đức' });
    const otherAdmin = await addAdmin(other);
    const otherEnv: SheetEnv = { h, fake, org: other };
    expect(await noticesOf(other.owner, other)).toEqual([]);

    const revokeEvent = async () => {
      const sale = await freeSheetEvent(other);
      const { connectionId } = await connectAndSync(otherEnv, sale.event.id);
      await h.db.transaction((tx) => revokeSheetConnection(tx, boss, connectionId, 'invalid_grant'));
      return { eventId: sale.event.id, name: sale.event.name, connectionId };
    };
    const a = await revokeEvent();
    await sleep(5);
    const b = await revokeEvent();
    await h.db.orm.execute(
      sql`UPDATE organizations SET token_alert_threshold = 100, token_below_threshold_since = now() WHERE id = ${other.orgId}`,
    );
    try {
      const owner = await noticesOf(other.owner, other);
      expect(owner.map((n) => n.code)).toEqual(['SHEETS_AUTH_REVOKED', 'SHEETS_AUTH_REVOKED', 'token_below_threshold']);
      expect(owner.slice(0, 2).map((n) => n.data)).toEqual([
        { eventId: a.eventId, eventName: a.name },
        { eventId: b.eventId, eventName: b.name },
      ]);
      const versions = await revokedSheetConnectionsOf(h.db.orm, { organizationId: other.orgId });
      expect(owner.slice(0, 2).map((n) => n.version)).toEqual(versions.map((v) => v.authRevokedAt.toISOString()));
      expect((await noticesOf(otherAdmin, other)).map((n) => n.code)).toEqual(['SHEETS_AUTH_REVOKED', 'SHEETS_AUTH_REVOKED']);

      // Chặn bán (chưa liên kết tài khoản nhận tiền giả bằng Closed Beta chờ duyệt) đứng trước.
      await h.db.orm.execute(sql`UPDATE organizations SET closed_beta_status = 'pending' WHERE id = ${other.orgId}`);
      expect((await noticesOf(other.owner, other)).map((n) => n.code)).toEqual([
        'CLOSED_BETA_PENDING',
        'SHEETS_AUTH_REVOKED',
        'SHEETS_AUTH_REVOKED',
        'token_below_threshold',
      ]);
      // BTC khác không thấy kết nối của BTC này.
      expect((await sheetsNoticesOf(org.owner)).some((n) => n.data.eventId === a.eventId)).toBe(false);
    } finally {
      await h.db.orm.execute(
        sql`UPDATE organizations SET token_alert_threshold = NULL, token_below_threshold_since = NULL,
              closed_beta_status = 'approved' WHERE id = ${other.orgId}`,
      );
    }
  });
});

describe('worker thật', () => {
  let worker: INestApplicationContext;
  let workerEmail: FakeEmailTransport;

  beforeAll(async () => {
    // Job tồn đọng (flush, lần đẩy đầu, email) của các ca trên không được chạy trước job của ca này.
    await discardPendingSheetJobs(h);
    workerEmail = new FakeEmailTransport();
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig(googleUrlsOf(fake)))] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(workerEmail)
      .compile();
    worker = await moduleRef.init();
  }, 120_000);
  afterAll(async () => {
    await worker?.close();
  });

  it('mất quyền khi flush → job gốc tạo mỗi người nhận một job con (id cố định), mỗi người đúng một email; job completed', async () => {
    const sale = await freeSheetEvent(org);
    await seedOrders(env, sale.event.id, [{ status: 'paid' }]);
    const { connectionId } = await connectAndSync(env, sale.event.id);
    const unauthorized = new GoogleApiError('write_values', 'auth_revoked', 'unauthorized', 401);
    expect(await recordGoogleFailure(deps(), connectionId, unauthorized)).toEqual({ result: 'auth_revoked', code: 'unauthorized' });

    const forEvent = () => workerEmail.sent.filter((m) => m.text.includes(sale.event.id));
    await expect.poll(() => forEvent().length, { timeout: 20_000, interval: 100 }).toBe(3);
    expect(forEvent().map((m) => m.to).sort()).toEqual([org.owner.email, admin.email, admin2.email].sort());
    for (const m of forEvent()) expect(m.text).toContain('Lý do: Quyền truy cập Google Drive không còn hiệu lực.');

    const workerBoss = worker.get<PgBoss>(BOSS);
    const { roots, children } = await emailJobsOf(connectionId);
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    expect(children.map((job) => job.id).sort()).toEqual(
      [org.owner, admin, admin2].map((u) => childJobId(root.id, u.userId)).sort(),
    );
    for (const job of [root, ...children]) {
      await expect
        .poll(async () => (await workerBoss.getJobById(EMAIL_QUEUE, job.id))?.state, { timeout: 10_000 })
        .toBe('completed');
    }
  });
});
