import { randomBytes, randomUUID } from 'node:crypto';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { ErrorResponse, GOOGLE_START_PER_IP_PER_HOUR, Me } from '@tickee/contracts';
import { APIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rewriteUnverifiedLinkError } from '../../src/modules/identity/auth.js';
import { OtpRateLimiter } from '../../src/modules/identity/otp-rate-limit.js';
import { redactUrlQuery } from '../../src/platform/logging/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, newEmail, sessionCookie, sessionSetCookie, type Harness } from './harness.js';

/**
 * Đăng nhập Google (Story 1.4) với Postgres thật. Không gọi Google: `fetch` tới token endpoint bị chặn và trả về
 * một `id_token` không ký — Better Auth chỉ giải mã `id_token` lấy từ lần đổi code (không kiểm chữ ký ở luồng này).
 */

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const LOGIN_URL = `${TEST_WEB_ORIGIN}/dang-nhap`;
const INTERSTITIAL_URL = `${TEST_WEB_ORIGIN}/dang-nhap/google`;

interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

/** Hành vi của token endpoint giả cho lần đổi code kế tiếp. */
let tokenEndpoint: { status: number; profile: GoogleProfile | null } = { status: 200, profile: null };
/** Mọi giá trị bí mật đã cấp ra trong test (code, token): không được xuất hiện trong log. */
const issuedSecrets: string[] = [];

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const secret = (prefix: string): string => {
  const value = `${prefix}${randomBytes(12).toString('hex')}`;
  issuedSecrets.push(value);
  return value;
};

function unsignedIdToken(profile: GoogleProfile): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: 'test', iat: now, exp: now + 3600, ...profile };
  return `${b64url({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${b64url(payload)}.${secret('sig')}`;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const realFetch = globalThis.fetch;
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  // Mọi request test đến từ cùng một IP: xóa bộ đếm để giới hạn theo IP không lan sang test khác.
  await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
  await h.db.orm.execute(sql`DELETE FROM google_start_events`);
  tokenEndpoint = { status: 200, profile: null };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!requestUrl(input).startsWith(GOOGLE_TOKEN_ENDPOINT)) return realFetch(input, init);
    if (tokenEndpoint.status !== 200 || !tokenEndpoint.profile) {
      return Response.json({ error: 'invalid_grant' }, { status: tokenEndpoint.status === 200 ? 400 : tokenEndpoint.status });
    }
    return Response.json({
      access_token: secret('ya29.'),
      refresh_token: secret('1//'),
      id_token: unsignedIdToken(tokenEndpoint.profile),
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const setCookies = (res: { headers: Record<string, unknown> }): string[] =>
  ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);

const profileFor = (email: string, overrides: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub: `google-${randomUUID()}`,
  email,
  email_verified: true,
  name: 'Nguyễn Văn An',
  picture: 'https://lh3.googleusercontent.com/a/anh-dai-dien',
  ...overrides,
});

interface Started {
  location: URL;
  state: string;
  /** Cặp `tên=giá trị` của cookie state để gửi lại ở callback. */
  stateCookie: string;
  stateSetCookie: string;
}

/** `GET /v1/identity/google` → 302 sang Google kèm cookie state. */
async function startGoogle(query: Record<string, string | string[]> = {}): Promise<Started> {
  const res = await h.http.get('/v1/identity/google').query(query);
  expect(res.status).toBe(302);
  expect(res.headers['cache-control']).toBe('no-store');
  const location = new URL(res.headers.location as string);
  const stateSetCookie = setCookies(res).find((c) => c.startsWith('tickee.state='));
  if (!stateSetCookie) throw new Error('Không có cookie state');
  return { location, state: location.searchParams.get('state') ?? '', stateCookie: stateSetCookie.split(';')[0]!, stateSetCookie };
}

/** Google điều hướng trình duyệt về callback (điều hướng GET top-level, kèm cookie state). */
function callback(started: Started, query: Record<string, string>, cookie = started.stateCookie) {
  const req = h.http.get('/v1/auth/callback/google').query({ state: started.state, ...query });
  return cookie ? req.set('cookie', cookie) : req;
}

/** Đi trọn start → Google (giả) → callback với hồ sơ cho trước. */
async function googleSignIn(profile: GoogleProfile, returnTo?: string) {
  const started = await startGoogle(returnTo === undefined ? {} : { returnTo });
  tokenEndpoint = { status: 200, profile };
  const res = await callback(started, { code: secret('4/0A') });
  expect(res.status).toBe(302);
  return { res, location: res.headers.location as string, started };
}

async function otpSignIn(email: string): Promise<string> {
  await h.http.post('/v1/identity/otp').send({ email }).expect(200);
  const res = await h.http.post('/v1/identity/otp/verify').send({ email, otp: h.email.lastCodeFor(email) }).expect(200);
  return sessionCookie(res.headers['set-cookie']);
}

interface UserRow {
  id: string;
  name: string;
  image: string | null;
  email_verified: boolean;
  consented_at: Date | null;
}
async function usersFor(email: string): Promise<UserRow[]> {
  const { rows } = await h.db.orm.execute<UserRow & Record<string, unknown>>(
    sql`SELECT id, name, image, email_verified, consented_at FROM users WHERE email = ${email}`,
  );
  return rows;
}

interface AccountRow {
  provider_id: string;
  account_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
}
async function accountsFor(email: string): Promise<AccountRow[]> {
  const { rows } = await h.db.orm.execute<AccountRow & Record<string, unknown>>(
    sql`SELECT a.provider_id, a.account_id, a.access_token, a.refresh_token, a.id_token
        FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = ${email} ORDER BY a.created_at`,
  );
  return rows;
}

async function sessionCount(email: string): Promise<number> {
  const { rows } = await h.db.orm.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
  );
  return rows[0]!.n;
}

async function totalRows(): Promise<{ users: number; accounts: number; sessions: number }> {
  const { rows } = await h.db.orm.execute<{ users: number; accounts: number; sessions: number }>(
    sql`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM accounts) AS accounts,
               (SELECT count(*)::int FROM sessions) AS sessions`,
  );
  return rows[0]!;
}

const me = (cookie: string) => h.http.get('/v1/identity/me').set('cookie', cookie);

describe('GET /v1/identity/google — bắt đầu', () => {
  it('302 tới accounts.google.com, chỉ scope openid email profile, Set-Cookie state HttpOnly + SameSite=Lax', async () => {
    const started = await startGoogle({ returnTo: '/su-kien/a' });
    const { location } = started;
    expect(`${location.origin}${location.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
    expect(location.searchParams.get('redirect_uri')).toBe('http://api.tickee.test/v1/auth/callback/google');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(location.searchParams.has('include_granted_scopes')).toBe(false);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(started.state).toMatch(/^[A-Za-z0-9_-]{16,}$/);

    expect(started.stateSetCookie).toMatch(/;\s*HttpOnly/i);
    expect(started.stateSetCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(started.stateSetCookie).toMatch(/Max-Age=300/i);

    // State lưu ở `verifications` (`auth-state:<state>`), kèm URL quay về do server dựng.
    const { rows } = await h.db.orm.execute<{ value: string }>(
      sql`SELECT value FROM verifications WHERE identifier = ${`auth-state:${started.state}`}`,
    );
    expect(rows).toHaveLength(1);
    const stored = JSON.parse(rows[0]!.value) as Record<string, unknown>;
    expect(stored).toMatchObject({
      callbackURL: `${INTERSTITIAL_URL}?returnTo=%2Fsu-kien%2Fa`,
      newUserURL: `${INTERSTITIAL_URL}?returnTo=%2Fsu-kien%2Fa`,
      errorURL: `${LOGIN_URL}?returnTo=%2Fsu-kien%2Fa`,
    });
  });

  it.each([
    [{ returnTo: '//evil.com' }],
    [{ returnTo: 'https://evil.com/x' }],
    [{ returnTo: '/\\evil.com' }],
    [{ returnTo: '/..//evil.com' }],
    [{ returnTo: '/dang-nhap/google' }],
    [{ returnTo: ['/a', '/b'] }],
    [{}],
  ])('returnTo sai hoặc thiếu %j → quay về `/` (URL do server dựng trên WEB_ORIGIN)', async (query) => {
    const started = await startGoogle(query);
    const { rows } = await h.db.orm.execute<{ value: string }>(
      sql`SELECT value FROM verifications WHERE identifier = ${`auth-state:${started.state}`}`,
    );
    expect(JSON.parse(rows[0]!.value)).toMatchObject({ callbackURL: INTERSTITIAL_URL, errorURL: LOGIN_URL });
  });

  it('`returnTo` độc hại → sau callback về trang trung gian không kèm returnTo', async () => {
    const { location } = await googleSignIn(profileFor(newEmail()), '//evil.com');
    expect(location).toBe(INTERSTITIAL_URL);
  });

  it('người đã đăng nhập nhưng chưa đồng ý vẫn bắt đầu được (không trả CONSENT_REQUIRED)', async () => {
    const cookie = await otpSignIn(newEmail());
    const res = await h.http.get('/v1/identity/google').set('cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
  });
});

describe('GET /v1/identity/google — giới hạn theo IP và lỗi khi bắt đầu', () => {
  const START_LOG = 'Không bắt đầu được đăng nhập Google';

  async function verificationCount(): Promise<number> {
    const { rows } = await h.db.orm.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM verifications`);
    return rows[0]!.n;
  }

  async function startEventCount(ipHmac: string): Promise<number> {
    const { rows } = await h.db.orm.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM google_start_events WHERE ip_hmac = ${ipHmac}`,
    );
    return rows[0]!.n;
  }

  /** Ghi sẵn `n` lần bắt đầu cho IP, lùi `minutesAgo` phút. */
  async function seedStarts(ipHmac: string, n: number, minutesAgo: number): Promise<void> {
    await h.db.orm.execute(sql`INSERT INTO google_start_events (ip_hmac, created_at)
      SELECT ${ipHmac}, now() - make_interval(mins => ${minutesAgo}) FROM generate_series(1, ${n})`);
  }

  /** Mọi 302 lỗi: về màn đăng nhập trên WEB_ORIGIN, không JSON, không cookie state, không cache. */
  function expectLoginRedirect(res: { status: number; headers: Record<string, unknown>; text?: string }, error: string) {
    expect(res.status).toBe(302);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['content-type'] ?? '')).not.toMatch(/json/);
    expect(setCookies(res).some((c) => c.startsWith('tickee.state='))).toBe(false);
    expect(res.headers.location).toBe(`${LOGIN_URL}?error=${error}&returnTo=%2Fsu-kien%2Fa`);
  }

  it('ghi một dòng google_start_events (chỉ HMAC của IP) cho mỗi lần bắt đầu', async () => {
    const ipHmac = h.app.get(OtpRateLimiter).ipHmac('::ffff:127.0.0.1');
    await startGoogle({ returnTo: '/su-kien/a' });
    const { rows } = await h.db.orm.execute<Record<string, unknown>>(sql`SELECT * FROM google_start_events`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
    // Request của supertest đi qua IPv4-mapped IPv6 hoặc IPv4 tùy máy.
    expect([ipHmac, h.app.get(OtpRateLimiter).ipHmac('127.0.0.1')]).toContain(rows[0]!.ip_hmac);
  });

  it(`lần thứ ${GOOGLE_START_PER_IP_PER_HOUR} trong giờ vẫn qua; lần kế → rate_limited, không ghi verifications, IP khác vẫn qua`, async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: 1 });
    try {
      const ipA = '203.0.113.21';
      const hmacA = proxied.app.get(OtpRateLimiter).ipHmac(ipA);
      await seedStarts(hmacA, GOOGLE_START_PER_IP_PER_HOUR - 1, 10);
      const start = (ip: string) =>
        proxied.http.get('/v1/identity/google').query({ returnTo: '/su-kien/a' }).set('x-forwarded-for', ip);

      const last = await start(ipA);
      expect(last.status).toBe(302);
      expect(last.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect(await startEventCount(hmacA)).toBe(GOOGLE_START_PER_IP_PER_HOUR);

      const before = await verificationCount();
      const limited = await start(ipA);
      expectLoginRedirect(limited, 'rate_limited');
      expect(await verificationCount()).toBe(before);
      // Lần bị chặn không được ghi.
      expect(await startEventCount(hmacA)).toBe(GOOGLE_START_PER_IP_PER_HOUR);
      // Bị chặn là đường bình thường: không log lỗi.
      expect(proxied.logs.lines.some((l) => l.msg === START_LOG || l.level === 50)).toBe(false);

      const other = await start('198.51.100.22');
      expect(other.status).toBe(302);
      expect(other.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    } finally {
      await proxied.close();
    }
  });

  it('cửa sổ trượt một giờ: lần bắt đầu cũ hơn một giờ không tính', async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: 1 });
    try {
      const ip = '203.0.113.23';
      await seedStarts(proxied.app.get(OtpRateLimiter).ipHmac(ip), GOOGLE_START_PER_IP_PER_HOUR, 61);
      const res = await proxied.http.get('/v1/identity/google').set('x-forwarded-for', ip);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    } finally {
      await proxied.close();
    }
  });

  it('returnTo mặc định `/` → bỏ khỏi URL lỗi', async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: 1 });
    try {
      const ip = '203.0.113.24';
      await seedStarts(proxied.app.get(OtpRateLimiter).ipHmac(ip), GOOGLE_START_PER_IP_PER_HOUR, 5);
      const res = await proxied.http.get('/v1/identity/google').query({ returnTo: '//evil.com' }).set('x-forwarded-for', ip);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${LOGIN_URL}?error=rate_limited`);
    } finally {
      await proxied.close();
    }
  });

  it('song song từ cùng IP khi còn một lượt → đúng một lần qua, còn lại rate_limited (khóa advisory theo IP)', async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: 1 });
    try {
      const ip = '203.0.113.25';
      const ipHmac = proxied.app.get(OtpRateLimiter).ipHmac(ip);
      await seedStarts(ipHmac, GOOGLE_START_PER_IP_PER_HOUR - 1, 10);
      const results = await Promise.all(
        [0, 1, 2, 3].map(() =>
          proxied.http.get('/v1/identity/google').query({ returnTo: '/su-kien/a' }).set('x-forwarded-for', ip),
        ),
      );
      const locations = results.map((r) => {
        expect(r.status).toBe(302);
        return r.headers.location as string;
      });
      expect(locations.filter((l) => l.startsWith('https://accounts.google.com/'))).toHaveLength(1);
      expect(locations.filter((l) => l === `${LOGIN_URL}?error=rate_limited&returnTo=%2Fsu-kien%2Fa`)).toHaveLength(3);
      expect(await startEventCount(ipHmac)).toBe(GOOGLE_START_PER_IP_PER_HOUR);
    } finally {
      await proxied.close();
    }
  });

  it('DB lỗi khi đếm → 302 start_failed (không JSON 500); log chỉ có tên lớp lỗi và SQLSTATE, không query/params', async () => {
    const leakedParam = newEmail();
    const leakedQuery = `select "ip_hmac" from "google_start_events" where bi_mat_${randomUUID().replaceAll('-', '')}`;
    const cause = Object.assign(new Error(`terminating connection ${leakedParam}`), { code: '57P01' });
    const spy = vi
      .spyOn(h.app.get(OtpRateLimiter), 'consumeGoogleStart')
      .mockRejectedValue(new DrizzleQueryError(leakedQuery, [leakedParam], cause));
    try {
      const res = await h.http.get('/v1/identity/google').query({ returnTo: '/su-kien/a' });
      expectLoginRedirect(res, 'start_failed');
    } finally {
      spy.mockRestore();
    }
    const line = h.logs.lines.findLast((l) => l.msg === START_LOG);
    expect(line).toMatchObject({ level: 50, errName: 'DrizzleQueryError', code: '57P01' });
    expect(h.logs.text).not.toContain(leakedParam);
    expect(h.logs.text).not.toContain(leakedQuery);
    expect(h.logs.text).not.toContain('terminating connection');
    expect(h.logs.text).not.toContain('Lỗi không bắt được');
  });

  it('signInSocial lỗi → 302 start_failed giữ returnTo, không cookie state, không còn dòng google_start_events', async () => {
    const leaked = `bi-mat-${randomUUID()}`;
    const api = h.app.get(AuthService).api as { signInSocial: (...args: unknown[]) => Promise<unknown> };
    const spy = vi
      .spyOn(api, 'signInSocial')
      .mockRejectedValue(new APIError('INTERNAL_SERVER_ERROR', { message: leaked, code: 'FAILED_TO_CREATE_VERIFICATION' }));
    try {
      const res = await h.http.get('/v1/identity/google').query({ returnTo: '/su-kien/a' });
      expectLoginRedirect(res, 'start_failed');
    } finally {
      spy.mockRestore();
    }
    // Lần bắt đầu thất bại không tính vào giới hạn của IP.
    const { rows } = await h.db.orm.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM google_start_events`);
    expect(rows[0]!.n).toBe(0);
    const line = h.logs.lines.findLast((l) => l.msg === START_LOG);
    expect(line).toMatchObject({ level: 50, errName: 'APIError', code: 'FAILED_TO_CREATE_VERIFICATION' });
    expect(h.logs.text).not.toContain(leaked);
  });
});

describe('GET /v1/auth/callback/google — kết quả', () => {
  it('email mới, đã xác minh → tạo user + account google (không token), cookie session, về trang trung gian', async () => {
    const email = newEmail();
    const before = await totalRows();
    const { res, location } = await googleSignIn(profileFor(email.toUpperCase()), '/su-kien/a');

    expect(location).toBe(`${INTERSTITIAL_URL}?returnTo=%2Fsu-kien%2Fa`);
    const cookie = sessionSetCookie(res.headers['set-cookie']);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    // Cookie state bị xóa sau khi dùng.
    expect(setCookies(res).find((c) => c.startsWith('tickee.state='))).toMatch(/Max-Age=0/i);

    const users = await usersFor(email);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: 'Nguyễn Văn An', image: null, email_verified: true, consented_at: null });
    const accounts = await accountsFor(email);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ provider_id: 'google', access_token: null, refresh_token: null, id_token: null });
    expect(await totalRows()).toEqual({
      users: before.users + 1,
      accounts: before.accounts + 1,
      sessions: before.sessions + 1,
    });

    // Session dùng được; tài khoản mới chưa đồng ý (web chuyển sang /dong-y).
    const body = Me.parse((await me(sessionCookie(res.headers['set-cookie'])).expect(200)).body);
    expect(body).toMatchObject({ email, consentedAt: null });
  });

  it('email đã có từ OTP → nối account google vào user cũ, không tạo user mới; đã đồng ý thì me có consentedAt', async () => {
    const email = newEmail();
    const otpCookie = await otpSignIn(email);
    await h.http.post('/v1/identity/consent').set('cookie', otpCookie).expect(200);
    const [otpUser] = await usersFor(email);
    const otpAccounts = await accountsFor(email);

    const { res, location } = await googleSignIn(profileFor(email), '/su-kien/a');
    expect(location).toBe(`${INTERSTITIAL_URL}?returnTo=%2Fsu-kien%2Fa`);

    const users = await usersFor(email);
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(otpUser!.id);
    expect(users[0]!.name).toBe('Nguyễn Văn An');
    expect(users[0]!.image).toBeNull();
    const accounts = await accountsFor(email);
    expect(accounts).toHaveLength(otpAccounts.length + 1);
    expect(accounts.filter((a) => a.provider_id === 'google')).toHaveLength(1);
    expect(accounts.every((a) => a.access_token === null && a.refresh_token === null && a.id_token === null)).toBe(true);

    const body = Me.parse((await me(sessionCookie(res.headers['set-cookie'])).expect(200)).body);
    expect(body.id).toBe(otpUser!.id);
    expect(body.consentedAt).not.toBeNull();
  });

  it('Google trước, OTP sau với cùng email → vẫn là user đó', async () => {
    const email = newEmail();
    const { res } = await googleSignIn(profileFor(email));
    const googleMe = Me.parse((await me(sessionCookie(res.headers['set-cookie'])).expect(200)).body);

    const otpCookie = await otpSignIn(email);
    const otpMe = Me.parse((await me(otpCookie).expect(200)).body);
    expect(otpMe.id).toBe(googleMe.id);
    expect(await usersFor(email)).toHaveLength(1);
  });

  it('đăng nhập Google lần hai (account đã nối) → cùng user, vẫn không lưu token', async () => {
    const email = newEmail();
    const profile = profileFor(email);
    await googleSignIn(profile);
    const { location } = await googleSignIn(profile, '/su-kien/b');
    expect(location).toBe(`${INTERSTITIAL_URL}?returnTo=%2Fsu-kien%2Fb`);
    expect(await usersFor(email)).toHaveLength(1);
    const accounts = await accountsFor(email);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ access_token: null, refresh_token: null, id_token: null });
    expect(await sessionCount(email)).toBe(2);
  });

  it('email_verified = false, email mới → /dang-nhap?error=email_not_verified&returnTo=…, DB không đổi', async () => {
    const email = newEmail();
    const before = await totalRows();
    const { res, location } = await googleSignIn(profileFor(email, { email_verified: false }), '/su-kien/a');

    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(LOGIN_URL);
    expect(url.searchParams.get('error')).toBe('email_not_verified');
    expect(url.searchParams.get('returnTo')).toBe('/su-kien/a');
    expect(setCookies(res).some((c) => /^(__Secure-)?tickee\.session_token=[^;]/.test(c))).toBe(false);
    expect(await usersFor(email)).toHaveLength(0);
    expect(await totalRows()).toEqual(before);
  });

  it('email_verified = false, email đã có từ OTP → cũng là email_not_verified, không nối account, không session', async () => {
    const email = newEmail();
    await otpSignIn(email);
    const accountsBefore = await accountsFor(email);
    const sessionsBefore = await sessionCount(email);

    const { location } = await googleSignIn(profileFor(email, { email_verified: false }), '/su-kien/a');
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(LOGIN_URL);
    expect(url.searchParams.get('error')).toBe('email_not_verified');
    expect(url.searchParams.get('returnTo')).toBe('/su-kien/a');
    expect(await accountsFor(email)).toEqual(accountsBefore);
    expect(await sessionCount(email)).toBe(sessionsBefore);
    const [user] = await usersFor(email);
    expect(user!.name).toBe('');
  });

  it('account google đã nối nhưng Google báo email chưa xác minh → từ chối, không tạo session', async () => {
    const email = newEmail();
    const profile = profileFor(email);
    await googleSignIn(profile);
    const sessionsBefore = await sessionCount(email);
    const { location } = await googleSignIn({ ...profile, email_verified: false });
    expect(new URL(location).searchParams.get('error')).toBe('email_not_verified');
    expect(await sessionCount(email)).toBe(sessionsBefore);
  });

  it('hủy trên Google (error=access_denied) → /dang-nhap giữ returnTo, không đổi code', async () => {
    const before = await totalRows();
    const started = await startGoogle({ returnTo: '/su-kien/a' });
    const res = await callback(started, { error: 'access_denied' });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(`${url.origin}${url.pathname}`).toBe(LOGIN_URL);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('returnTo')).toBe('/su-kien/a');
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => requestUrl(input).startsWith(GOOGLE_TOKEN_ENDPOINT))).toBe(
      false,
    );
    expect(await totalRows()).toEqual(before);
  });

  it('state không tồn tại → /dang-nhap?error=state_mismatch (không về /v1/auth/error)', async () => {
    const started = await startGoogle({ returnTo: '/su-kien/a' });
    const res = await callback({ ...started, state: 'state-khong-ton-tai-0123456789' }, { code: secret('4/0A') });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(`${url.origin}${url.pathname}`).toBe(LOGIN_URL);
    expect(url.searchParams.get('error')).toBe('state_mismatch');
  });

  it('thiếu cookie state (callback từ trình duyệt khác) → error=state_mismatch, không tạo user', async () => {
    const email = newEmail();
    const started = await startGoogle({ returnTo: '/su-kien/a' });
    tokenEndpoint = { status: 200, profile: profileFor(email) };
    const res = await callback(started, { code: secret('4/0A') }, '');
    const url = new URL(res.headers.location as string);
    expect(`${url.origin}${url.pathname}`).toBe(LOGIN_URL);
    expect(url.searchParams.get('error')).toBe('state_mismatch');
    expect(url.searchParams.get('returnTo')).toBe('/su-kien/a');
    expect(await usersFor(email)).toHaveLength(0);
  });

  it('state chỉ dùng được một lần', async () => {
    const email = newEmail();
    const started = await startGoogle();
    tokenEndpoint = { status: 200, profile: profileFor(email) };
    await callback(started, { code: secret('4/0A') }).expect(302);
    const again = await callback(started, { code: secret('4/0A') });
    expect(new URL(again.headers.location as string).searchParams.get('error')).toBe('state_mismatch');
    expect(await sessionCount(email)).toBe(1);
  });

  it('Google từ chối code (token endpoint 400) → error=invalid_code, DB không đổi', async () => {
    const before = await totalRows();
    const started = await startGoogle({ returnTo: '/su-kien/a' });
    tokenEndpoint = { status: 400, profile: null };
    const res = await callback(started, { code: secret('4/0A') });
    const url = new URL(res.headers.location as string);
    expect(`${url.origin}${url.pathname}`).toBe(LOGIN_URL);
    expect(url.searchParams.get('error')).toBe('invalid_code');
    expect(url.searchParams.get('returnTo')).toBe('/su-kien/a');
    expect(await totalRows()).toEqual(before);
  });
});

describe('ranh giới HTTP của luồng Google', () => {
  it('chỉ GET /v1/auth/callback/google mở; sign-in/social, get-session, POST callback, provider khác → 404', async () => {
    const cases = {
      'POST sign-in/social': () =>
        h.http.post('/v1/auth/sign-in/social').set('origin', TEST_WEB_ORIGIN).send({ provider: 'google' }),
      'GET get-session': () => h.http.get('/v1/auth/get-session'),
      'POST callback/google': () => h.http.post('/v1/auth/callback/google').send({ code: 'x', state: 'y' }),
      'GET callback/github': () => h.http.get('/v1/auth/callback/github?code=x&state=y'),
      'GET callback/google/': () => h.http.get('/v1/auth/callback/google/?code=x&state=y'),
      'GET error': () => h.http.get('/v1/auth/error'),
    };
    for (const [name, send] of Object.entries(cases)) {
      const res = await send();
      expect(res.status, name).toBe(404);
      expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_FOUND');
    }
  });

  it('đổi mã lỗi chỉ áp cho account_not_linked', () => {
    expect(rewriteUnverifiedLinkError(`${LOGIN_URL}?returnTo=%2Fa&error=account_not_linked`)).toBe(
      `${LOGIN_URL}?returnTo=%2Fa&error=email_not_verified`,
    );
    expect(rewriteUnverifiedLinkError(`${LOGIN_URL}?error=state_mismatch`)).toBeNull();
    expect(rewriteUnverifiedLinkError(`${INTERSTITIAL_URL}?returnTo=%2Fa`)).toBeNull();
    expect(rewriteUnverifiedLinkError('khong-phai-url')).toBeNull();
  });

  it('log của toàn luồng không chứa email, code, state hay token', async () => {
    const email = newEmail();
    await otpSignIn(email);
    const { res, started } = await googleSignIn(profileFor(email), '/su-kien/a');
    await me(sessionCookie(res.headers['set-cookie'])).expect(200);
    await googleSignIn(profileFor(newEmail(), { email_verified: false }));
    const denied = await startGoogle();
    await callback(denied, { error: 'access_denied' }).expect(302);
    const bad = await startGoogle();
    tokenEndpoint = { status: 400, profile: null };
    await callback(bad, { code: secret('4/0A') }).expect(302);
    await callback({ ...bad, state: 'state-khong-ton-tai-0123456789' }, { code: secret('4/0A') }).expect(302);

    const raw = h.logs.text;
    // Request log của `/v1/identity/google` (query bị che); lỗi của Better Auth trong callback cũng đi qua pino.
    expect(raw).toContain('/v1/identity/google?returnTo=[REDACTED]');
    expect(raw).toContain('Failed to parse state');
    expect(raw).not.toContain(email);
    for (const value of [started.state, denied.state, bad.state, ...issuedSecrets]) expect(raw).not.toContain(value);
    const token = decodeURIComponent(sessionCookie(res.headers['set-cookie']).split('=')[1]!).split('.')[0]!;
    expect(raw).not.toContain(token);
  });

  it('redactUrlQuery giữ tên tham số, che giá trị', () => {
    expect(redactUrlQuery('/v1/auth/callback/google?code=4%2F0A&state=abc&state=x')).toBe(
      '/v1/auth/callback/google?code=[REDACTED]&state=[REDACTED]',
    );
    expect(redactUrlQuery('/v1/identity/me')).toBe('/v1/identity/me');
    expect(redactUrlQuery('/a?')).toBe('/a');
  });
});
