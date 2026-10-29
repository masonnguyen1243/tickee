import { AllowAnonymous, AuthService } from '@thallesp/nestjs-better-auth';
import { ErrorResponse, Me, OTP_MAX_ATTEMPTS, SendOtpResponse, VerifyOtpResponse } from '@tickee/contracts';
import { APIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthHttpPathAllowed } from '../../src/modules/identity/auth.js';
import { OtpRateLimiter } from '../../src/modules/identity/otp-rate-limit.js';
import { PUBLIC_ROUTE_KEY } from '../../src/platform/http/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, newEmail, sessionCookie, sessionSetCookie, type Harness } from './harness.js';

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
  h.email.failWith = null;
});

const sendOtp = (email: string) => h.http.post('/v1/identity/otp').send({ email });
const verifyOtp = (email: string, otp: string) => h.http.post('/v1/identity/otp/verify').send({ email, otp });
const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

/** Đổi `n` thành mã sai chắc chắn khác mã thật. */
const wrongCode = (code: string, n = 1): string => String((Number(code) + n) % 1_000_000).padStart(6, '0');

async function countRows(table: 'users' | 'sessions', email: string): Promise<number> {
  const query =
    table === 'users'
      ? sql`SELECT count(*)::int AS n FROM users WHERE email = ${email}`
      : sql`SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`;
  const { rows } = await h.db.orm.execute<{ n: number }>(query);
  return rows[0]!.n;
}

/** Lùi các lần gửi của mọi email `seconds` giây để vượt cửa sổ 60 giây mà không phải chờ. */
async function ageSendEvents(seconds: number): Promise<void> {
  await h.db.orm.execute(sql`UPDATE otp_send_events SET created_at = created_at - make_interval(secs => ${seconds})`);
}

/** Gửi mã + xác minh đúng → cookie session. */
async function signIn(email: string): Promise<{ cookie: string; consentRequired: boolean }> {
  await sendOtp(email).expect(200);
  const res = await verifyOtp(email, h.email.lastCodeFor(email)).expect(200);
  return { cookie: sessionCookie(res.headers['set-cookie']), consentRequired: res.body.consentRequired };
}

describe('POST /v1/identity/otp — gửi mã', () => {
  it('email hợp lệ → 200 resendAfterSeconds 60, email chứa 6 số; chưa tạo user; OTP trong DB đã hash', async () => {
    const email = newEmail();
    const res = await sendOtp(`  ${email.toUpperCase()} `);
    expect(res.status).toBe(200);
    expect(SendOtpResponse.parse(res.body)).toEqual({ resendAfterSeconds: 60 });

    const code = h.email.lastCodeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    const message = h.email.sent.at(-1)!;
    expect(message.subject).toBe('Mã đăng nhập Tickee của bạn');
    expect(message.html).toContain(code);
    expect(message.text).toContain('trong 5 phút');
    expect(message.html).toContain('trong 5 phút');
    expect(await countRows('users', email)).toBe(0);

    const { rows } = await h.db.orm.execute<{ value: string }>(
      sql`SELECT value FROM verifications WHERE identifier = ${`sign-in-otp-${email}`}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).not.toContain(code);
    expect(rows[0]!.value).not.toMatch(/^\d{6}(:|$)/);
    expect(rows[0]!.value).toMatch(/:0$/);
  });

  it.each([{ email: 'khong-phai-email' }, { email: '' }, {}, { email: 123 }])(
    'body sai %j → 400 VALIDATION_FAILED, không gửi email',
    async (body) => {
      const before = h.email.sent.length;
      const res = await h.http.post('/v1/identity/otp').send(body);
      expect(res.status).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
      expect(h.email.sent.length).toBe(before);
    },
  );

  it('form urlencoded (CSRF qua form HTML) không được nhận → 400', async () => {
    const res = await h.http.post('/v1/identity/otp').type('form').send({ email: newEmail() });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
  });

  it('gửi lại trong 60 giây → 429 OTP_RATE_LIMITED kèm retryAfterSeconds', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const res = await sendOtp(email);
    expect(res.status).toBe(429);
    const error = errorOf(res.body);
    expect(error.code).toBe('OTP_RATE_LIMITED');
    const { retryAfterSeconds } = error.details as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('lần thứ 6 trong một giờ → 429, chờ tới khi lần cũ nhất ra khỏi cửa sổ', async () => {
    const email = newEmail();
    for (let i = 0; i < 5; i++) {
      await sendOtp(email).expect(200);
      await ageSendEvents(600); // mỗi lần cách nhau 10 phút
    }
    // Lần cũ nhất đã cách 50 phút → còn khoảng 10 phút.
    const res = await sendOtp(email);
    expect(res.status).toBe(429);
    const { retryAfterSeconds } = errorOf(res.body).details as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(500);
    expect(retryAfterSeconds).toBeLessThanOrEqual(600);

    // Lần cũ nhất ra khỏi cửa sổ một giờ → gửi lại được.
    await ageSendEvents(601);
    await sendOtp(email).expect(200);
  });

  it('một IP quá 20 lần mỗi giờ → 429 dù email khác nhau', async () => {
    for (let i = 0; i < 20; i++) await sendOtp(newEmail()).expect(200);
    const res = await sendOtp(newEmail());
    expect(res.status).toBe(429);
    expect(errorOf(res.body).code).toBe('OTP_RATE_LIMITED');
  });

  it('hai request song song cho cùng email → đúng một 200 và một 429, chỉ một email được gửi', async () => {
    const email = newEmail();
    const results = await Promise.all([sendOtp(email), sendOtp(email)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(h.email.sent.filter((m) => m.to === email)).toHaveLength(1);
  });

  it('gửi mã không dọn rác: bản ghi hết hạn còn nguyên (job identity.purge-expired của worker lo)', async () => {
    const stale = newEmail();
    const owner = await h.db.orm.execute<{ id: string }>(sql`INSERT INTO users (email) VALUES (${newEmail()}) RETURNING id`);
    const userId = owner.rows[0]!.id;
    await h.db.orm.execute(sql`INSERT INTO sessions (user_id, token, expires_at) VALUES
      (${userId}, ${`cu-${stale}`}, now() - interval '25 hours')`);
    await h.db.orm.execute(sql`INSERT INTO otp_verify_failures (email_hmac, created_at) VALUES ('khong-don', now() - interval '25 hours')`);
    await h.db.orm.execute(
      sql`INSERT INTO otp_send_events (email_hmac, ip_hmac, created_at) VALUES ('khong-don', 'khong-don', now() - interval '61 minutes')`,
    );
    await h.db.orm.execute(sql`INSERT INTO verifications (identifier, value, expires_at) VALUES
      (${`sign-in-otp-${stale}`}, 'x:0', now() - interval '25 hours')`);

    await sendOtp(newEmail()).expect(200);

    const counts = await h.db.orm.execute<Record<string, number>>(sql`SELECT
      (SELECT count(*)::int FROM otp_send_events WHERE email_hmac = 'khong-don') AS sends,
      (SELECT count(*)::int FROM otp_verify_failures WHERE email_hmac = 'khong-don') AS failures,
      (SELECT count(*)::int FROM verifications WHERE identifier = ${`sign-in-otp-${stale}`}) AS verifications,
      (SELECT count(*)::int FROM sessions WHERE user_id = ${userId}) AS sessions`);
    expect(counts.rows[0]).toEqual({ sends: 1, failures: 1, verifications: 1, sessions: 1 });
    await h.db.orm.execute(sql`DELETE FROM otp_verify_failures WHERE email_hmac = 'khong-don'`);
    await h.db.orm.execute(sql`DELETE FROM verifications WHERE identifier = ${`sign-in-otp-${stale}`}`);
  });

  it('bảng đếm chỉ có HMAC, không có email hay IP dạng rõ', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const { rows } = await h.db.orm.execute<Record<string, string>>(sql`SELECT * FROM otp_send_events`);
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(email);
    expect(raw).not.toContain('127.0.0.1');
    expect(rows[0]!.email_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SMTP lỗi → 503 SERVICE_UNAVAILABLE và không tính vào giới hạn gửi', async () => {
    const email = newEmail();
    h.email.failWith = new Error(`SMTP từ chối ${email}`);
    const res = await sendOtp(email);
    expect(res.status).toBe(503);
    expect(errorOf(res.body).code).toBe('SERVICE_UNAVAILABLE');
    const { rows } = await h.db.orm.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM otp_send_events`);
    expect(rows[0]!.n).toBe(0);
    // Mã Better Auth vừa tạo (email không đi) bị xóa: không đoán được mã nào.
    const stored = await h.db.orm.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM verifications WHERE identifier = ${`sign-in-otp-${email}`}`,
    );
    expect(stored.rows[0]!.n).toBe(0);
    for (const otp of ['000000', '123456']) expect((await verifyOtp(email, otp)).status).toBe(400);
    expect(await countRows('users', email)).toBe(0);

    h.email.failWith = null;
    await sendOtp(email).expect(200);
    expect(h.logs.text).not.toContain(email);
  });

  it('auth.api.sendVerificationOTP lỗi → 5xx, không tính lượt gửi; thử lại ngay được', async () => {
    const email = newEmail();
    const api = h.app.get(AuthService).api as { sendVerificationOTP: (...args: unknown[]) => Promise<unknown> };
    const spy = vi.spyOn(api, 'sendVerificationOTP').mockRejectedValue(new APIError('INTERNAL_SERVER_ERROR'));
    try {
      const res = await sendOtp(email);
      expect(res.status).toBeGreaterThanOrEqual(500);
      const { rows } = await h.db.orm.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM otp_send_events`);
      expect(rows[0]!.n).toBe(0);
    } finally {
      spy.mockRestore();
    }
    await sendOtp(email).expect(200);
  });

  it('TRUST_PROXY_HOPS=1: giới hạn theo IP lấy từ X-Forwarded-For', async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: 1 });
    try {
      const send = (ip: string) =>
        proxied.http.post('/v1/identity/otp').set('x-forwarded-for', ip).send({ email: newEmail() });
      for (let i = 0; i < 20; i++) await send('203.0.113.1').expect(200);
      await send('203.0.113.2').expect(200);
      const blocked = await send('203.0.113.1');
      expect(blocked.status).toBe(429);
      expect(errorOf(blocked.body).code).toBe('OTP_RATE_LIMITED');
    } finally {
      await proxied.close();
    }
  });

  it('TRUST_PROXY_HOPS=0 (mặc định): X-Forwarded-For do client gửi bị bỏ qua', async () => {
    for (let i = 0; i < 20; i++) {
      await h.http
        .post('/v1/identity/otp')
        .set('x-forwarded-for', `203.0.113.${i + 1}`)
        .send({ email: newEmail() })
        .expect(200);
    }
    const res = await h.http.post('/v1/identity/otp').set('x-forwarded-for', '198.51.100.7').send({ email: newEmail() });
    expect(res.status).toBe(429);
  });

  it('gửi song song cho các email khác nhau từ cùng IP không vượt 20 lần mỗi giờ', async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: 1 });
    try {
      const ipHmac = proxied.app.get(OtpRateLimiter).ipHmac('203.0.113.9');
      for (let i = 0; i < 19; i++) {
        await proxied.db.orm.execute(
          sql`INSERT INTO otp_send_events (email_hmac, ip_hmac, created_at) VALUES (${`hat-giong-${i}`}, ${ipHmac}, now() - interval '10 minutes')`,
        );
      }
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          proxied.http.post('/v1/identity/otp').set('x-forwarded-for', '203.0.113.9').send({ email: newEmail() }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    } finally {
      await proxied.close();
    }
  });
});

describe('POST /v1/identity/otp/verify — xác minh mã', () => {
  it('mã đúng, email mới → tạo user, set cookie HttpOnly + SameSite=Lax, consentRequired true', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const res = await verifyOtp(email, h.email.lastCodeFor(email));
    expect(res.status).toBe(200);
    expect(VerifyOtpResponse.parse(res.body)).toEqual({ consentRequired: true });

    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = setCookie.find((c) => c.startsWith('tickee.session_token='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    // API_PUBLIC_URL là http (local): chưa bật Secure, không có Domain.
    expect(cookie).not.toMatch(/;\s*Secure/i);
    expect(cookie).not.toMatch(/;\s*Domain=/i);

    const { rows } = await h.db.orm.execute<{ email_verified: boolean; consented_at: string | null; name: string }>(
      sql`SELECT email_verified, consented_at, name FROM users WHERE email = ${email}`,
    );
    expect(rows).toEqual([{ email_verified: true, consented_at: null, name: '' }]);
    expect(await countRows('sessions', email)).toBe(1);
  });

  it('mã đúng, tài khoản đã đồng ý → consentRequired false', async () => {
    const email = newEmail();
    const first = await signIn(email);
    await h.http.post('/v1/identity/consent').set('cookie', first.cookie).expect(200);

    await ageSendEvents(61);
    const second = await signIn(email);
    expect(second.consentRequired).toBe(false);
  });

  it('mã sai lần k < 5 → OTP_INVALID còn 5 − k lần; lần 5 và sau đó → OTP_ATTEMPTS_EXCEEDED', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const code = h.email.lastCodeFor(email);

    for (let k = 1; k < OTP_MAX_ATTEMPTS; k++) {
      const res = await verifyOtp(email, wrongCode(code, k));
      expect(res.status).toBe(400);
      const error = errorOf(res.body);
      expect(error.code).toBe('OTP_INVALID');
      expect(error.details).toEqual({ remainingAttempts: OTP_MAX_ATTEMPTS - k });
    }

    const fifth = await verifyOtp(email, wrongCode(code, OTP_MAX_ATTEMPTS));
    expect(fifth.status).toBe(400);
    expect(errorOf(fifth.body).code).toBe('OTP_ATTEMPTS_EXCEEDED');

    // Hết lượt: kể cả mã đúng cũng không dùng được nữa, và không tạo user.
    for (let i = 0; i < 2; i++) {
      const after = await verifyOtp(email, code);
      expect(after.status).toBe(400);
      expect(errorOf(after.body).code).toBe('OTP_ATTEMPTS_EXCEEDED');
    }
    expect(await countRows('users', email)).toBe(0);
  });

  it('mã đúng chỉ dùng được một lần: lần hai → 400, không tạo session mới', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const code = h.email.lastCodeFor(email);
    await verifyOtp(email, code).expect(200);
    const again = await verifyOtp(email, code);
    expect(again.status).toBe(400);
    expect(await countRows('sessions', email)).toBe(1);
  });

  it('quá 15 lần sai trong 24 giờ (qua nhiều mã) → khóa xác minh và gửi bằng OTP_LOCKED; hết cửa sổ thì mở', async () => {
    const email = newEmail();
    // 3 mã × 5 lần sai = 15 lần sai: chưa khóa.
    for (let round = 0; round < 3; round++) {
      await ageSendEvents(61);
      await sendOtp(email).expect(200);
      const code = h.email.lastCodeFor(email);
      for (let k = 1; k <= OTP_MAX_ATTEMPTS; k++) {
        const res = await verifyOtp(email, wrongCode(code, k));
        expect(res.status).toBe(400);
        expect(['OTP_INVALID', 'OTP_ATTEMPTS_EXCEEDED']).toContain(errorOf(res.body).code);
      }
    }
    await ageSendEvents(61);
    await sendOtp(email).expect(200);
    const code = h.email.lastCodeFor(email);

    // Lần sai thứ 16 → khóa.
    const locked = await verifyOtp(email, wrongCode(code));
    expect(locked.status).toBe(429);
    const error = errorOf(locked.body);
    expect(error.code).toBe('OTP_LOCKED');
    const { retryAfterSeconds } = error.details as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(24 * 3600 - 300);
    expect(retryAfterSeconds).toBeLessThanOrEqual(24 * 3600);

    // Khóa cả mã đúng và cả gửi mã.
    const right = await verifyOtp(email, code);
    expect(right.status).toBe(429);
    expect(errorOf(right.body).code).toBe('OTP_LOCKED');
    await ageSendEvents(61);
    const send = await sendOtp(email);
    expect(send.status).toBe(429);
    expect(errorOf(send.body)).toMatchObject({ code: 'OTP_LOCKED', details: { retryAfterSeconds: expect.any(Number) } });
    expect(await countRows('users', email)).toBe(0);

    // Các lần sai rời cửa sổ 24 giờ → gửi và xác minh lại được.
    await h.db.orm.execute(sql`UPDATE otp_verify_failures SET created_at = created_at - interval '25 hours'`);
    await ageSendEvents(61);
    await sendOtp(email).expect(200);
    await verifyOtp(email, h.email.lastCodeFor(email)).expect(200);
  });

  it('verify khi email không có mã nào không bị tính là lần sai: người lạ không khóa được email', async () => {
    const email = newEmail();
    const failures = async () =>
      (await h.db.orm.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM otp_verify_failures`)).rows[0]!.n;
    const before = await failures();
    for (let i = 0; i < 20; i++) {
      const res = await verifyOtp(email, '000000');
      expect(res.status).toBe(400);
    }
    expect(await failures()).toBe(before);
    await sendOtp(email).expect(200);
    await verifyOtp(email, h.email.lastCodeFor(email)).expect(200);
  });

  it('mã hết hạn (quá 300 giây) → OTP_EXPIRED', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const code = h.email.lastCodeFor(email);
    await h.db.orm.execute(
      sql`UPDATE verifications SET expires_at = now() - interval '1 second' WHERE identifier = ${`sign-in-otp-${email}`}`,
    );
    // Bản ghi hết hạn của người khác không bị xóa khi có ai đó tra verification.
    await sendOtp(newEmail()).expect(200);

    const res = await verifyOtp(email, code);
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('OTP_EXPIRED');
    expect(await countRows('users', email)).toBe(0);
  });

  it('dùng mã cũ sau khi gửi lại → OTP_INVALID; mã mới vẫn đúng', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const oldCode = h.email.lastCodeFor(email);
    await ageSendEvents(61);
    await sendOtp(email).expect(200);
    const newCode = h.email.lastCodeFor(email);
    expect(h.email.sent.filter((m) => m.to === email)).toHaveLength(2);

    if (oldCode !== newCode) {
      const res = await verifyOtp(email, oldCode);
      expect(res.status).toBe(400);
      expect(errorOf(res.body)).toMatchObject({ code: 'OTP_INVALID', details: { remainingAttempts: 4 } });
    }
    await verifyOtp(email, newCode).expect(200);
  });

  it.each([
    { email: 'a@b.vn', otp: '12345' },
    { email: 'a@b.vn', otp: 'abcdef' },
    { email: 'sai', otp: '123456' },
  ])('body sai %j → 400 VALIDATION_FAILED', async (body) => {
    const res = await h.http.post('/v1/identity/otp/verify').send(body);
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('session, đồng ý NĐ 13 và đăng xuất', () => {
  it('chưa đăng nhập → me và endpoint cần đăng nhập trả 401 UNAUTHENTICATED', async () => {
    for (const path of ['/v1/identity/me', '/v1/test-protected']) {
      const res = await h.http.get(path);
      expect(res.status).toBe(401);
      expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
    }
    const res = await h.http.post('/v1/identity/consent');
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
  });

  it('chưa đồng ý → endpoint khác 403 CONSENT_REQUIRED; me/consent dùng được; đồng ý xong thì qua', async () => {
    const email = newEmail();
    const { cookie, consentRequired } = await signIn(email);
    expect(consentRequired).toBe(true);

    const blocked = await h.http.get('/v1/test-protected').set('cookie', cookie);
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked.body).code).toBe('CONSENT_REQUIRED');

    const me = await h.http.get('/v1/identity/me').set('cookie', cookie).expect(200);
    expect(Me.parse(me.body)).toMatchObject({ email, consentedAt: null });

    const consent = await h.http.post('/v1/identity/consent').set('cookie', cookie).expect(200);
    const consented = Me.parse(consent.body);
    expect(consented.consentedAt).not.toBeNull();
    const { rows } = await h.db.orm.execute<{ consented_at: string | null }>(
      sql`SELECT consented_at FROM users WHERE email = ${email}`,
    );
    expect(new Date(rows[0]!.consented_at!).toISOString()).toBe(consented.consentedAt);

    // Đồng ý lần nữa giữ nguyên thời điểm đầu.
    const again = await h.http.post('/v1/identity/consent').set('cookie', cookie).expect(200);
    expect(again.body.consentedAt).toBe(consented.consentedAt);

    await h.http.get('/v1/test-protected').set('cookie', cookie).expect(200);
    const meAfter = await h.http.get('/v1/identity/me').set('cookie', cookie).expect(200);
    expect(meAfter.body.consentedAt).toBe(consented.consentedAt);
  });

  it('session được gia hạn khi dùng: cookie mới được chuyển tiếp cho trình duyệt', async () => {
    const email = newEmail();
    const { cookie } = await signIn(email);
    const fresh = await h.http.get('/v1/identity/me').set('cookie', cookie).expect(200);
    expect(fresh.headers['set-cookie']).toBeUndefined();

    // Session 7 ngày đã qua hơn 1 ngày (updateAge) → Better Auth gia hạn và set lại cookie.
    await h.db.orm.execute(
      sql`UPDATE sessions SET expires_at = now() + interval '5 days' FROM users WHERE users.id = sessions.user_id AND users.email = ${email}`,
    );
    const refreshed = await h.http.get('/v1/identity/me').set('cookie', cookie).expect(200);
    const setCookie = ([] as string[]).concat(refreshed.headers['set-cookie'] ?? []);
    expect(setCookie.find((c) => c.startsWith('tickee.session_token='))).toMatch(/Max-Age=604800/);
    const { rows } = await h.db.orm.execute<{ days: number }>(
      sql`SELECT extract(epoch FROM s.expires_at - now()) / 86400 AS days FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`,
    );
    expect(Number(rows[0]!.days)).toBeGreaterThan(6.9);
  });

  it('Better Auth lỗi khi tra session → coi như chưa đăng nhập (401, @OptionalAuth vẫn qua), không phải 500', async () => {
    const { cookie } = await signIn(newEmail());
    await h.http.post('/v1/identity/consent').set('cookie', cookie).expect(200);
    const api = h.app.get(AuthService).api as { getSession: (...args: unknown[]) => Promise<unknown> };
    const failing = () => Promise.reject(new APIError('UNAUTHORIZED', { message: 'Failed to get session' }));
    const spy = vi.spyOn(api, 'getSession').mockImplementation(failing);
    try {
      const me = await h.http.get('/v1/identity/me').set('cookie', cookie);
      expect(me.status).toBe(401);
      expect(errorOf(me.body).code).toBe('UNAUTHENTICATED');
      const optional = await h.http.get('/v1/test-protected/optional').set('cookie', cookie).expect(200);
      expect(optional.body).toEqual({ signedIn: false });
    } finally {
      spy.mockRestore();
    }
    const optional = await h.http.get('/v1/test-protected/optional').set('cookie', cookie).expect(200);
    expect(optional.body).toEqual({ signedIn: true });
  });

  it('API_PUBLIC_URL https + AUTH_COOKIE_DOMAIN → cookie __Secure-, Secure, Domain cha', async () => {
    const secure = await createHarness({ API_PUBLIC_URL: 'https://api.tickee.test', AUTH_COOKIE_DOMAIN: 'tickee.test' });
    try {
      const email = newEmail();
      await secure.http.post('/v1/identity/otp').send({ email }).expect(200);
      const res = await secure.http
        .post('/v1/identity/otp/verify')
        .send({ email, otp: secure.email.lastCodeFor(email) })
        .expect(200);
      const cookie = sessionSetCookie(res.headers['set-cookie']);
      expect(cookie).toMatch(/^__Secure-tickee\.session_token=/);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*Domain=\.?tickee\.test(;|$)/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    } finally {
      await secure.close();
    }
  });

  it('chưa đồng ý vẫn đăng xuất được; sign-out xóa dòng session và trả cookie hết hạn', async () => {
    const email = newEmail();
    const { cookie } = await signIn(email);
    expect(await countRows('sessions', email)).toBe(1);

    const res = await h.http.post('/v1/identity/sign-out').set('cookie', cookie);
    expect(res.status).toBe(204);
    const expired = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('tickee.session_token='));
    expect(expired).toMatch(/Max-Age=0/i);
    expect(await countRows('sessions', email)).toBe(0);

    const me = await h.http.get('/v1/identity/me').set('cookie', cookie);
    expect(me.status).toBe(401);
  });
});

describe('ranh giới HTTP', () => {
  it('mọi endpoint HTTP của Better Auth dưới /v1/auth (trừ callback Google) trả 404, kể cả khi có session', async () => {
    const { cookie } = await signIn(newEmail());
    const endpoints = Object.values(h.app.get(AuthService).api as Record<string, { path?: unknown }>)
      .map((e) => e.path)
      .filter((p): p is string => typeof p === 'string');
    // Đủ endpoint lõi + emailOTP (gồm hai đường dẫn OTP gốc).
    expect(endpoints).toEqual(expect.arrayContaining(['/email-otp/send-verification-otp', '/sign-in/email-otp']));
    expect(endpoints).toEqual(expect.arrayContaining(['/sign-in/social', '/get-session', '/callback/:id']));
    expect(endpoints.length).toBeGreaterThan(20);

    const email = newEmail();
    const sentBefore = h.email.sent.length;
    // `/callback/:id` chỉ mở cho đúng `GET /callback/google` (kiểm riêng trong google-login.test.ts); mọi id khác vẫn 404.
    for (const path of endpoints) {
      const url = `/v1/auth${path.replace(/:[^/]+/g, 'x')}`;
      for (const method of ['get', 'post'] as const) {
        const res = await h.http[method](url)
          .set('origin', TEST_WEB_ORIGIN)
          .set('cookie', cookie)
          .send(method === 'post' ? { email, type: 'sign-in', otp: '123456', name: 'x' } : undefined);
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
        expect(errorOf(res.body).code).toBe('NOT_FOUND');
      }
    }
    expect(h.email.sent.length).toBe(sentBefore);
  });

  it('allowlist so khớp đường dẫn đã chuẩn hóa, chỉ dưới /v1/auth', () => {
    expect(isAuthHttpPathAllowed('/v1/auth/callback/google?code=x&state=y')).toBe(true);
    expect(isAuthHttpPathAllowed('/v1/auth/callback/google/')).toBe(false);
    expect(isAuthHttpPathAllowed('/v1/auth/callback/github')).toBe(false);
    expect(isAuthHttpPathAllowed('/v1/auth/callback/google/../../sign-in/social')).toBe(false);
    expect(isAuthHttpPathAllowed('/v1/auth/sign-in/social')).toBe(false);
    const allow = ['/get-session'];
    expect(isAuthHttpPathAllowed('/v1/auth/get-session?x=1', allow)).toBe(true);
    expect(isAuthHttpPathAllowed('/v1/auth/./get-session', allow)).toBe(true);
    expect(isAuthHttpPathAllowed('/v1/auth/sign-out', allow)).toBe(false);
    expect(isAuthHttpPathAllowed('/v1/auth/x/../sign-out', allow)).toBe(false);
    expect(isAuthHttpPathAllowed('/v1/auth/../auth/get-session', allow)).toBe(true);
    expect(isAuthHttpPathAllowed('/v1/authget-session', allow)).toBe(false);
    expect(isAuthHttpPathAllowed('/v1/auth/get-session')).toBe(false);
  });

  it('CORS chỉ cho WEB_ORIGIN kèm credentials, từ chối origin lạ', async () => {
    const preflight = (origin: string) =>
      h.http
        .options('/v1/identity/otp')
        .set('origin', origin)
        .set('access-control-request-method', 'POST')
        .set('access-control-request-headers', 'content-type');

    const ok = await preflight(TEST_WEB_ORIGIN);
    expect(ok.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await preflight('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();

    const evilAuth = await h.http.get('/v1/auth/get-session').set('origin', 'https://evil.example');
    expect(evilAuth.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('/healthz công khai dù có guard toàn cục; khóa @AllowAnonymous trùng PUBLIC_ROUTE_KEY', async () => {
    await h.http.get('/healthz').expect(200);
    class Marked {}
    AllowAnonymous()(Marked);
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY, Marked)).toBe(true);
  });

  it('log của toàn luồng không chứa email, mã OTP hay token session', async () => {
    const email = newEmail();
    await sendOtp(email).expect(200);
    const code = h.email.lastCodeFor(email);
    await verifyOtp(email, wrongCode(code)).expect(400);
    const res = await verifyOtp(email, code).expect(200);
    const cookie = sessionCookie(res.headers['set-cookie']);
    await h.http.get('/v1/identity/me').set('cookie', cookie).expect(200);
    await h.http.post('/v1/identity/consent').set('cookie', cookie).expect(200);
    await h.http.post('/v1/identity/sign-out').set('cookie', cookie).expect(204);

    const token = decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;
    const raw = h.logs.text;
    expect(raw).toContain('/v1/identity/otp/verify');
    expect(raw).not.toContain(email);
    expect(raw).not.toContain(code);
    expect(raw).not.toContain(token);
  });
});
