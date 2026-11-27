import { createHash, randomUUID } from 'node:crypto';
import {
  ErrorResponse,
  eventGoogleSheetsApiPath,
  eventGoogleSheetsConnectApiPath,
  EventSheetConnectionResponse,
  GOOGLE_SHEETS_SCOPE,
  JobQueue,
  Role,
  SheetConnectStartResponse,
} from '@tickee/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { TEST_GOOGLE_SHEETS_TOKEN_KEYS, TEST_WEB_ORIGIN, testCredentialKey } from '../helpers.js';
import { startGoogleFake, type GoogleFake } from '../google-fake/server.js';
import { createHarness, signIn, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 6.4: kết nối Google Sheets — `GET`/`POST …/connect`/`DELETE …/google-sheets` (Owner, Admin) và callback OAuth
 * `GET /v1/integrations/google-sheets/callback` (luôn 302 về web). Postgres thật, Google fake (`test/google-fake`); mọi dòng
 * I/O Matrix phía api. Lần đẩy đầu của worker ở `sheet-initial-sync.test.ts`.
 */

const CLIENT_ID = 'test-sheets-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-only-google-sheets-client-secret';
const API_PUBLIC_URL = 'http://api.tickee.test';
const REDIRECT_URI = `${API_PUBLIC_URL}/v1/integrations/google-sheets/callback`;
const tokenBox = new SecretBox(parseCredentialKeys(TEST_GOOGLE_SHEETS_TOKEN_KEYS));

type User = Awaited<ReturnType<typeof signUp>>;

let fake: GoogleFake;
let h: Harness;
let owner: User;
let admin: User;
let orgId: string;

const draft = {
  name: 'Giải cờ tướng mùa đông',
  startsAt: '2099-12-01T07:00:00+07:00',
  endsAt: '2099-12-01T17:00:00+07:00',
  refundPolicy: 'Không hoàn vé.',
};

beforeAll(async () => {
  fake = await startGoogleFake({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  h = await createHarness({
    API_PUBLIC_URL,
    GOOGLE_SHEETS_CLIENT_ID: CLIENT_ID,
    GOOGLE_SHEETS_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_OAUTH_AUTHORIZE_URL: fake.authorizeUrl,
    GOOGLE_OAUTH_TOKEN_URL: fake.tokenUrl,
    GOOGLE_SHEETS_API_URL: fake.url,
  });
  owner = await signUp(h);
  admin = await signUp(h);
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Cờ Tướng' }).expect(201)).body.id;
  await h.db.pool.query('INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3)', [
    orgId,
    admin.userId,
    Role.ADMIN,
  ]);
});
beforeEach(() => {
  fake.reset();
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

async function newEvent(org = orgId, cookie = owner.cookie): Promise<string> {
  return (await h.http.post(`/v1/orgs/${org}/events`).set('cookie', cookie).send(draft).expect(201)).body.id as string;
}

const statusPath = (eventId: string, org = orgId) => `/v1${eventGoogleSheetsApiPath(org, eventId)}`;
const connectPath = (eventId: string, org = orgId) => `/v1${eventGoogleSheetsConnectApiPath(org, eventId)}`;
const settingsUrl = (eventId: string, notice: string) =>
  `${TEST_WEB_ORIGIN}/btc/${orgId}/su-kien/${eventId}?tab=cai-dat&notice=${notice}`;
const rootUrl = (notice: string) => `${TEST_WEB_ORIGIN}/?notice=${notice}`;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function startConnect(eventId: string, cookie = owner.cookie): Promise<URL> {
  const res = await h.http.post(connectPath(eventId)).set('cookie', cookie).send();
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return new URL(SheetConnectStartResponse.parse(res.body).authorizationUrl);
}

/** Callback như Google điều hướng trình duyệt: trả `Location` của 302. */
async function callback(location: string, cookie: string | null = owner.cookie): Promise<string> {
  const url = new URL(location);
  const req = h.http.get(`${url.pathname}${url.search}`);
  if (cookie) req.set('cookie', cookie);
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(302);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['content-type'] ?? '').not.toContain('application/json');
  return res.headers.location as string;
}

/** Bấm "Kết nối", đồng ý trên Google fake, quay về callback: `Location` cuối cùng. */
async function connectFlow(eventId: string, cookie = owner.cookie): Promise<string> {
  const authorizationUrl = await startConnect(eventId, cookie);
  return callback(await fake.authorize(authorizationUrl.toString()), cookie);
}

interface ConnectionRow {
  id: string;
  organization_id: string;
  event_id: string;
  granted_by_user_id: string;
  status: string;
  spreadsheet_id: string | null;
  refresh_token: string;
  last_synced_at: Date | null;
  last_error_code: string | null;
}

async function connectionsOf(eventId: string): Promise<ConnectionRow[]> {
  const { rows } = await h.db.pool.query<ConnectionRow>('SELECT * FROM sheet_connections WHERE event_id = $1', [eventId]);
  return rows;
}

async function statesOf(eventId: string) {
  const { rows } = await h.db.pool.query<{ state_hash: string; code_verifier: string; user_id: string; ttl: number }>(
    `SELECT state_hash, code_verifier, user_id, extract(epoch FROM expires_at - now())::float AS ttl
       FROM sheet_oauth_states WHERE event_id = $1`,
    [eventId],
  );
  return rows;
}

async function auditOf(action: string, eventId: string) {
  const { rows } = await h.db.pool.query<{ actor_user_id: string; organization_id: string; target_type: string }>(
    'SELECT actor_user_id, organization_id, target_type FROM audit_events WHERE action = $1 AND target_id = $2',
    [action, eventId],
  );
  return rows;
}

const tokenCalls = () => fake.calls('POST', '/token');
const errorCode = (body: unknown) => ErrorResponse.parse(body).error.code;

describe('bắt đầu kết nối', () => {
  it('chưa kết nối: GET → { connection: null } (no-store); POST connect → authorizationUrl đủ tham số OAuth + PKCE', async () => {
    const eventId = await newEvent();
    const status = await h.http.get(statusPath(eventId)).set('cookie', owner.cookie).expect(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(EventSheetConnectionResponse.parse(status.body)).toEqual({ connection: null });

    const url = await startConnect(eventId);
    expect(`${url.origin}${url.pathname}`).toBe(fake.authorizeUrl);
    const q = url.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe(GOOGLE_SHEETS_SCOPE);
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = q.get('state')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(state, 'base64url')).toHaveLength(32);

    // DB chỉ giữ hash của state; code_verifier mã hóa; hạn 10 phút theo đồng hồ DB.
    const [row] = await statesOf(eventId);
    expect(row!.state_hash).toBe(sha256(state));
    expect(row!.user_id).toBe(owner.userId);
    expect(row!.code_verifier).toMatch(/^v1:/);
    const verifier = tokenBox.open(row!.code_verifier);
    expect(createHash('sha256').update(verifier, 'ascii').digest('base64url')).toBe(q.get('code_challenge'));
    expect(row!.ttl).toBeGreaterThan(590);
    expect(row!.ttl).toBeLessThanOrEqual(600);
    // Chưa gọi Google lần nào.
    expect(fake.requests).toEqual([]);
  });

  it('bấm "Kết nối": xóa mọi lượt đã hết hạn (của bất kỳ ai, Sự kiện nào), giữ lượt còn hạn', async () => {
    const eventId = await newEvent();
    const otherEventId = await newEvent();
    await startConnect(eventId);
    // Lượt bỏ dở của người khác, ở Sự kiện khác.
    await startConnect(otherEventId, admin.cookie);
    await h.db.pool.query(
      `UPDATE sheet_oauth_states SET expires_at = now() - interval '1 second' WHERE event_id IN ($1, $2)`,
      [eventId, otherEventId],
    );
    await startConnect(eventId);
    await startConnect(eventId);
    expect(await statesOf(eventId)).toHaveLength(2);
    expect(await statesOf(otherEventId)).toEqual([]);
    const { rows } = await h.db.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sheet_oauth_states WHERE expires_at <= now()',
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('Sự kiện của BTC khác qua đường BTC mình → 404 EVENT_NOT_FOUND; BTC không phải của mình → 403 NOT_A_MEMBER', async () => {
    const other = await signUp(h);
    const otherOrg = (await h.http.post('/v1/orgs').set('cookie', other.cookie).send({ name: 'BTC khác' }).expect(201)).body
      .id as string;
    const otherEvent = await newEvent(otherOrg, other.cookie);
    for (const [method, path] of [
      ['get', statusPath(otherEvent)],
      ['post', connectPath(otherEvent)],
      ['delete', statusPath(otherEvent)],
    ] as const) {
      const res = await h.http[method](path).set('cookie', owner.cookie);
      expect(res.status, path).toBe(404);
      expect(errorCode(res.body)).toBe('EVENT_NOT_FOUND');
    }
    const res = await h.http.get(statusPath(otherEvent, otherOrg)).set('cookie', owner.cookie);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('NOT_A_MEMBER');
    expect(await statesOf(otherEvent)).toEqual([]);
  });

  it('CTV của chính Sự kiện (không là thành viên BTC) gọi ba route → 403 NOT_A_MEMBER', async () => {
    const eventId = await newEvent();
    const checker = await signUp(h);
    await h.db.pool.query(
      `INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES ($1, $2, $3, 'active')`,
      [orgId, eventId, checker.userId],
    );
    for (const [method, path] of [
      ['get', statusPath(eventId)],
      ['post', connectPath(eventId)],
      ['delete', statusPath(eventId)],
    ] as const) {
      const res = await h.http[method](path).set('cookie', checker.cookie);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(errorCode(res.body)).toBe('NOT_A_MEMBER');
    }
    expect(await statesOf(eventId)).toEqual([]);
  });
});

describe('callback', () => {
  it('thành công: kết nối syncing + audit + job trong một tx, 302 về Cài đặt; refresh token chỉ ở dạng v1:…, không có trong response hay log', async () => {
    const eventId = await newEvent();
    await h.db.pool.query('UPDATE users SET name = $1 WHERE id = $2', ['Trần Thu Hà', owner.userId]);
    const authorizationUrl = await startConnect(eventId);
    const googleLocation = await fake.authorize(authorizationUrl.toString());
    expect(googleLocation.startsWith(`${REDIRECT_URI}?`)).toBe(true);

    expect(await callback(googleLocation)).toBe(settingsUrl(eventId, 'sheets-connected'));

    const [connection, ...more] = await connectionsOf(eventId);
    expect(more).toEqual([]);
    expect(connection).toMatchObject({
      organization_id: orgId,
      granted_by_user_id: owner.userId,
      status: 'syncing',
      spreadsheet_id: null,
      last_synced_at: null,
      last_error_code: null,
    });
    const refreshToken = fake.issued.refreshTokens.at(-1)!;
    expect(connection!.refresh_token).toMatch(/^v1:/);
    expect(connection!.refresh_token).not.toContain(refreshToken);
    expect(tokenBox.open(connection!.refresh_token)).toBe(refreshToken);
    // state dùng một lần: đã xóa.
    expect(await statesOf(eventId)).toEqual([]);
    // PKCE: fake đã kiểm code_verifier khớp code_challenge (sai thì invalid_grant).
    expect(tokenCalls()).toHaveLength(1);
    expect(tokenCalls()[0]!.body).toMatchObject({ grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });

    expect(await auditOf('sheet_connection.created', eventId)).toEqual([
      { actor_user_id: owner.userId, organization_id: orgId, target_type: 'event' },
    ]);
    const { rows: jobs } = await h.db.pool.query<{ data: unknown }>(
      `SELECT data FROM pgboss.job WHERE name = $1 AND data->>'connectionId' = $2`,
      [JobQueue.INTEGRATION_SHEET_INITIAL_SYNC, connection!.id],
    );
    expect(jobs).toEqual([{ data: { connectionId: connection!.id } }]);

    const status = await h.http.get(statusPath(eventId)).set('cookie', admin.cookie).expect(200);
    const body = EventSheetConnectionResponse.parse(status.body);
    expect(body.connection).toEqual({
      status: 'syncing',
      spreadsheetUrl: null,
      lastSyncedAt: null,
      lastErrorCode: null,
      connectedByName: 'Trần Thu Hà',
      createdAt: expect.any(String),
    });
    expect(Object.keys(status.body.connection as object).sort()).toEqual(
      ['connectedByName', 'createdAt', 'lastErrorCode', 'lastSyncedAt', 'spreadsheetUrl', 'status'].sort(),
    );

    // Không token, code, state hay code_verifier nào trong response và log của cả lượt.
    const code = new URL(googleLocation).searchParams.get('code')!;
    const state = authorizationUrl.searchParams.get('state')!;
    const secrets = [refreshToken, ...fake.issued.accessTokens, code, state, CLIENT_SECRET];
    const logs = h.logs.text;
    for (const secret of secrets) {
      expect(JSON.stringify(status.body)).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
  });

  it('đã có kết nối: POST connect → 409 SHEETS_ALREADY_CONNECTED, không tạo lượt OAuth', async () => {
    const eventId = await newEvent();
    expect(await connectFlow(eventId)).toBe(settingsUrl(eventId, 'sheets-connected'));
    const res = await h.http.post(connectPath(eventId)).set('cookie', admin.cookie).send();
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('SHEETS_ALREADY_CONNECTED');
    expect(await statesOf(eventId)).toEqual([]);
  });

  it('người cấp (Admin có tên) bị xóa khỏi BTC → GET của Owner vẫn trả kết nối, connectedByName null', async () => {
    const eventId = await newEvent();
    const granter = await signUp(h);
    await h.db.pool.query('INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3)', [
      orgId,
      granter.userId,
      Role.ADMIN,
    ]);
    await h.db.pool.query('UPDATE users SET name = $1 WHERE id = $2', ['Lê Văn Bình', granter.userId]);
    expect(await connectFlow(eventId, granter.cookie)).toBe(settingsUrl(eventId, 'sheets-connected'));
    const named = EventSheetConnectionResponse.parse(
      (await h.http.get(statusPath(eventId)).set('cookie', owner.cookie).expect(200)).body,
    );
    expect(named.connection?.connectedByName).toBe('Lê Văn Bình');

    await h.db.pool.query('DELETE FROM members WHERE organization_id = $1 AND user_id = $2', [orgId, granter.userId]);
    const body = EventSheetConnectionResponse.parse(
      (await h.http.get(statusPath(eventId)).set('cookie', owner.cookie).expect(200)).body,
    );
    expect(body.connection).toMatchObject({ status: 'syncing', connectedByName: null });
  });

  it('Admin kết nối được; tên người cấp null khi người đó không có tên', async () => {
    const eventId = await newEvent();
    expect(await connectFlow(eventId, admin.cookie)).toBe(settingsUrl(eventId, 'sheets-connected'));
    const [connection] = await connectionsOf(eventId);
    expect(connection!.granted_by_user_id).toBe(admin.userId);
    const body = EventSheetConnectionResponse.parse(
      (await h.http.get(statusPath(eventId)).set('cookie', owner.cookie).expect(200)).body,
    );
    expect(body.connection?.connectedByName).toBeNull();
  });

  it('người dùng từ chối (error=access_denied): xóa state, không tạo gì, notice=sheets-denied', async () => {
    const eventId = await newEvent();
    const url = await startConnect(eventId);
    fake.consent = 'deny';
    const location = await fake.authorize(url.toString());
    expect(new URL(location).searchParams.get('error')).toBe('access_denied');
    expect(await callback(location)).toBe(settingsUrl(eventId, 'sheets-denied'));
    expect(await connectionsOf(eventId)).toEqual([]);
    expect(await statesOf(eventId)).toEqual([]);
    expect(tokenCalls()).toEqual([]);
  });

  it.each([
    ['server_error', 'server_error'],
    ['admin_policy_enforced', 'admin_policy_enforced'],
    ['khong-biet<script>', 'other'],
  ])('state hợp lệ kèm error=%s (không code) → sheets-failed, xóa state, không đổi code; log mã lỗi đã lọc', async (error, logged) => {
    const eventId = await newEvent();
    const state = (await startConnect(eventId)).searchParams.get('state')!;
    const before = h.logs.lines.length;
    expect(await callback(`${REDIRECT_URI}?error=${encodeURIComponent(error)}&state=${state}`)).toBe(
      settingsUrl(eventId, 'sheets-failed'),
    );
    expect(await statesOf(eventId)).toEqual([]);
    expect(tokenCalls()).toEqual([]);
    const line = h.logs.lines.slice(before).find((l) => l.reason === 'google_error');
    expect(line).toMatchObject({ eventId, googleError: logged });
    if (logged === 'other') expect(JSON.stringify(h.logs.lines.slice(before))).not.toContain('<script>');
  });

  it('state hợp lệ, không có code lẫn error → sheets-failed (code_missing), xóa state, không đổi code', async () => {
    const eventId = await newEvent();
    const state = (await startConnect(eventId)).searchParams.get('state')!;
    expect(await callback(`${REDIRECT_URI}?state=${state}`)).toBe(settingsUrl(eventId, 'sheets-failed'));
    expect(await statesOf(eventId)).toEqual([]);
    expect(tokenCalls()).toEqual([]);
    expect(await connectionsOf(eventId)).toEqual([]);
  });

  it('code_verifier mã hóa bằng khóa api không có → sheets-failed (verifier_unreadable), không đổi code', async () => {
    const eventId = await newEvent();
    const location = await fake.authorize((await startConnect(eventId)).toString());
    const foreignBox = new SecretBox(parseCredentialKeys(testCredentialKey(7, 77)));
    await h.db.pool.query('UPDATE sheet_oauth_states SET code_verifier = $1 WHERE event_id = $2', [
      foreignBox.seal('verifier-cua-khoa-khac'),
      eventId,
    ]);
    expect(await callback(location)).toBe(settingsUrl(eventId, 'sheets-failed'));
    expect(await statesOf(eventId)).toEqual([]);
    expect(tokenCalls()).toEqual([]);
    expect(await connectionsOf(eventId)).toEqual([]);
  });

  it('state lạ, sai dạng hoặc thiếu → 302 trang gốc web notice=sheets-failed, không đổi code', async () => {
    for (const query of [
      `code=abc&state=${'A'.repeat(43)}`,
      'code=abc&state=ngan',
      'code=abc',
      'error=access_denied',
      'state[]=x&code=abc',
    ]) {
      expect(await callback(`${REDIRECT_URI}?${query}`), query).toBe(rootUrl('sheets-failed'));
    }
    expect(tokenCalls()).toEqual([]);
  });

  it('state đã dùng: lần hai → trang gốc notice=sheets-failed; vẫn đúng một kết nối', async () => {
    const eventId = await newEvent();
    const location = await fake.authorize((await startConnect(eventId)).toString());
    expect(await callback(location)).toBe(settingsUrl(eventId, 'sheets-connected'));
    expect(await callback(location)).toBe(rootUrl('sheets-failed'));
    expect(await connectionsOf(eventId)).toHaveLength(1);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('state hết hạn → về Cài đặt notice=sheets-failed, không đổi code, xóa state', async () => {
    const eventId = await newEvent();
    const location = await fake.authorize((await startConnect(eventId)).toString());
    await h.db.pool.query(`UPDATE sheet_oauth_states SET expires_at = now() - interval '1 second' WHERE event_id = $1`, [
      eventId,
    ]);
    expect(await callback(location)).toBe(settingsUrl(eventId, 'sheets-failed'));
    expect(await connectionsOf(eventId)).toEqual([]);
    expect(await statesOf(eventId)).toEqual([]);
    expect(tokenCalls()).toEqual([]);
  });

  it('khác người dùng, không session, hoặc người tạo state đã mất quyền → sheets-failed, không đổi code', async () => {
    const eventId = await newEvent();
    // Người khác mở callback (vd. link bị chuyển tiếp).
    const stranger = await signUp(h);
    let location = await fake.authorize((await startConnect(eventId)).toString());
    expect(await callback(location, stranger.cookie)).toBe(settingsUrl(eventId, 'sheets-failed'));
    // Không có session.
    location = await fake.authorize((await startConnect(eventId)).toString());
    expect(await callback(location, null)).toBe(settingsUrl(eventId, 'sheets-failed'));
    // Admin bị xóa khỏi BTC giữa lúc bấm và lúc quay về.
    const leaving = await signUp(h);
    await h.db.pool.query('INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3)', [
      orgId,
      leaving.userId,
      Role.ADMIN,
    ]);
    location = await fake.authorize((await startConnect(eventId, leaving.cookie)).toString());
    await h.db.pool.query('DELETE FROM members WHERE organization_id = $1 AND user_id = $2', [orgId, leaving.userId]);
    expect(await callback(location, leaving.cookie)).toBe(settingsUrl(eventId, 'sheets-failed'));

    expect(await connectionsOf(eventId)).toEqual([]);
    expect(await statesOf(eventId)).toEqual([]);
    expect(tokenCalls()).toEqual([]);
  });

  it('session chưa đồng ý NĐ 13 (guard chặn trước handler) → vẫn 302 về web, không bao giờ JSON', async () => {
    const eventId = await newEvent();
    const location = await fake.authorize((await startConnect(eventId)).toString());
    const unconsented = await signIn(h, `chua-dong-y-${randomUUID()}@vidu.vn`);
    expect(await callback(location, unconsented)).toBe(rootUrl('sheets-failed'));
    expect(await connectionsOf(eventId)).toEqual([]);
  });

  it.each([
    ['invalid_grant', 'invalid_grant'],
    ['token endpoint 500', 'server_error'],
    ['thiếu refresh_token', 'no_refresh_token'],
    ['invalid_client (OAuth client sai cấu hình)', 'invalid_client'],
  ] as const)('đổi token thất bại (%s) → sheets-failed, không tạo kết nối', async (_name, reply) => {
    const eventId = await newEvent();
    const location = await fake.authorize((await startConnect(eventId)).toString());
    fake.tokenReplies.push(reply);
    expect(await callback(location)).toBe(settingsUrl(eventId, 'sheets-failed'));
    expect(await connectionsOf(eventId)).toEqual([]);
    expect(await auditOf('sheet_connection.created', eventId)).toEqual([]);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('Google cấp refresh token nhưng thiếu scope drive.file → sheets-failed, không tạo kết nối', async () => {
    const eventId = await newEvent();
    const location = await fake.authorize((await startConnect(eventId)).toString());
    fake.tokenReplies.push({
      status: 200,
      body: { access_token: 'ya29.chi-openid', refresh_token: '1//chi-openid', scope: 'openid', token_type: 'Bearer' },
    });
    expect(await callback(location)).toBe(settingsUrl(eventId, 'sheets-failed'));
    expect(await connectionsOf(eventId)).toEqual([]);
    expect(await auditOf('sheet_connection.created', eventId)).toEqual([]);
  });

  it('hai callback song song cho cùng Sự kiện → đúng một kết nối; bên thua notice=sheets-already-connected', async () => {
    const eventId = await newEvent();
    const first = await fake.authorize((await startConnect(eventId)).toString());
    const second = await fake.authorize((await startConnect(eventId, admin.cookie)).toString());
    const [byOwner, byAdmin] = await Promise.all([callback(first, owner.cookie), callback(second, admin.cookie)]);
    expect([byOwner, byAdmin].sort()).toEqual(
      [settingsUrl(eventId, 'sheets-already-connected'), settingsUrl(eventId, 'sheets-connected')].sort(),
    );
    const connections = await connectionsOf(eventId);
    expect(connections).toHaveLength(1);
    expect(await auditOf('sheet_connection.created', eventId)).toHaveLength(1);
    // Kết nối có sẵn không bị ghi đè: vẫn là của bên thắng.
    const winner = byOwner === settingsUrl(eventId, 'sheets-connected') ? owner : admin;
    expect(connections[0]!.granted_by_user_id).toBe(winner.userId);
  });

  it('Sự kiện vừa được kết nối ở tab khác trước khi quay về → sheets-already-connected, không đổi code', async () => {
    const eventId = await newEvent();
    const late = await fake.authorize((await startConnect(eventId, admin.cookie)).toString());
    expect(await connectFlow(eventId)).toBe(settingsUrl(eventId, 'sheets-connected'));
    fake.reset();
    expect(await callback(late, admin.cookie)).toBe(settingsUrl(eventId, 'sheets-already-connected'));
    expect(tokenCalls()).toEqual([]);
    expect(await connectionsOf(eventId)).toHaveLength(1);
  });
});

describe('ngắt kết nối', () => {
  it('DELETE → 204: xóa dòng (token đi theo), audit sheet_connection.deleted, không request nào tới Google; lần hai → 404', async () => {
    const eventId = await newEvent();
    expect(await connectFlow(eventId)).toBe(settingsUrl(eventId, 'sheets-connected'));
    fake.reset();

    await h.http.delete(statusPath(eventId)).set('cookie', admin.cookie).expect(204);
    expect(await connectionsOf(eventId)).toEqual([]);
    expect(await auditOf('sheet_connection.deleted', eventId)).toEqual([
      { actor_user_id: admin.userId, organization_id: orgId, target_type: 'event' },
    ]);
    expect(fake.requests).toEqual([]);
    expect(EventSheetConnectionResponse.parse((await h.http.get(statusPath(eventId)).set('cookie', owner.cookie)).body)).toEqual({
      connection: null,
    });

    const again = await h.http.delete(statusPath(eventId)).set('cookie', owner.cookie);
    expect(again.status).toBe(404);
    expect(errorCode(again.body)).toBe('SHEETS_NOT_CONNECTED');
    expect(await auditOf('sheet_connection.deleted', eventId)).toHaveLength(1);
  });

  it('DELETE với id Sự kiện viết hoa → audit ghi id chữ thường', async () => {
    const eventId = await newEvent();
    expect(await connectFlow(eventId)).toBe(settingsUrl(eventId, 'sheets-connected'));
    await h.http.delete(statusPath(eventId.toUpperCase())).set('cookie', owner.cookie).expect(204);
    expect(await auditOf('sheet_connection.deleted', eventId)).toHaveLength(1);
  });

  it('ngắt rồi kết nối lại được (kết nối mới)', async () => {
    const eventId = await newEvent();
    expect(await connectFlow(eventId)).toBe(settingsUrl(eventId, 'sheets-connected'));
    const [before] = await connectionsOf(eventId);
    await h.http.delete(statusPath(eventId)).set('cookie', owner.cookie).expect(204);
    expect(await connectFlow(eventId)).toBe(settingsUrl(eventId, 'sheets-connected'));
    const [after] = await connectionsOf(eventId);
    expect(after!.id).not.toBe(before!.id);
  });
});
