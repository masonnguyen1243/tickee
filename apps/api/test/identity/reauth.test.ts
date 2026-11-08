import { createHash } from 'node:crypto';
import {
  ErrorResponse,
  OTP_DAILY_FAILURE_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_AFTER_SECONDS,
  REAUTH_TTL_SECONDS,
  ReauthEmailCodeResponse,
  ReauthGrant,
  TOTP_MAX_FAILURES,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeReauth } from '../../src/modules/identity/index.js';
import { OtpRateLimiter } from '../../src/modules/identity/otp-rate-limit.js';
import { TotpStore } from '../../src/modules/identity/totp-store.js';
import { AppError } from '../../src/platform/http/index.js';
import {
  createHarness,
  enrollTotp,
  reauthToken,
  signIn,
  signUp,
  signUpWithTotp,
  totpCode,
  wrongTotpCode,
  type Harness,
} from './harness.js';

/*
 * Xác nhận lại trước thao tác nhạy cảm (Story 2.13-a), phần `identity`: TOTP (đã bật 2FA) hoặc mã qua email (chưa bật)
 * → một lần xác nhận gắn user + session, hết hạn sau 5 phút, dùng một lần (`consumeReauth` trong transaction của thao
 * tác). Phần thao tác (đặt mặc định, hủy liên kết) ở `test/organizer/payout-account.test.ts`.
 */

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  h.email.failWith = null;
  await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
});

const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;
function expectError(res: Response, status: number, code: string) {
  expect(res.status, res.text).toBe(status);
  const error = errorOf(res);
  expect(error.code).toBe(code);
  return error;
}

const sendCode = (cookie: string) => h.http.post('/v1/identity/reauth/email-code').set('cookie', cookie);
/**
 * Xin mã email, chờ 200. Xóa bộ đếm gửi trước: tài khoản vừa đăng nhập bằng OTP còn trong cooldown 60 giây của chính
 * email đó (mã đăng nhập và mã xác nhận dùng chung giới hạn gửi).
 */
async function sendCodeOk(cookie: string): Promise<Response> {
  await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
  const res = await sendCode(cookie);
  expect(res.status, res.text).toBe(200);
  return res;
}
const confirm = (cookie: string, code: unknown) => h.http.post('/v1/identity/reauth').set('cookie', cookie).send({ code });
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const tokenOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;

async function sessionIdOf(cookie: string): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>('SELECT id FROM sessions WHERE token = $1', [tokenOf(cookie)]);
  return rows[0]!.id;
}

async function grantRow(token: string) {
  const { rows } = await h.db.pool.query<{
    user_id: string;
    session_id: string;
    expires_at: Date;
    used_at: Date | null;
    created_at: Date;
  }>('SELECT user_id, session_id, expires_at, used_at, created_at FROM reauth_grants WHERE token_hash = $1', [
    sha256(token),
  ]);
  return rows[0];
}

async function codeRow(userId: string) {
  const { rows } = await h.db.pool.query<{ code_hash: string; attempts: number; expires_at: Date }>(
    'SELECT code_hash, attempts, expires_at FROM reauth_codes WHERE user_id = $1',
    [userId],
  );
  return rows[0];
}

/** Tiêu token như thao tác nhạy cảm (trong transaction riêng); trả mã lỗi hoặc `ok`. */
async function consume(userId: string, sessionId: string, token: string | undefined): Promise<string> {
  try {
    await h.db.transaction((tx) => consumeReauth(tx, { userId, sessionId, token }));
    return 'ok';
  } catch (err) {
    if (err instanceof AppError) return `${err.code}:${(err.details as { method: string }).method}`;
    throw err;
  }
}

/** Số lần nhập sai mã OTP email đang ghi cho `email` (khóa theo ngày dùng chung với đăng nhập). */
async function verifyFailures(email: string): Promise<number> {
  const hmac = h.app.get(OtpRateLimiter).emailHmac(email);
  const { rows } = await h.db.pool.query('SELECT 1 FROM otp_verify_failures WHERE email_hmac = $1', [hmac]);
  return rows.length;
}

describe('xác nhận bằng TOTP (đã bật 2FA)', () => {
  it('mã đúng → 200 {reauthToken, expiresAt +5 phút}, no-store; DB chỉ giữ hash, gắn user + session hiện tại', async () => {
    const user = await signUpWithTotp(h);
    const before = Date.now();
    const res = await confirm(user.cookie, totpCode(user.manualKey));
    expect(res.status, res.text).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const grant = ReauthGrant.parse(res.body);
    expect(grant.reauthToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expiresIn = new Date(grant.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan((REAUTH_TTL_SECONDS - 10) * 1000);
    expect(expiresIn).toBeLessThanOrEqual((REAUTH_TTL_SECONDS + 10) * 1000);

    const row = await grantRow(grant.reauthToken);
    expect(row).toMatchObject({ user_id: user.userId, session_id: await sessionIdOf(user.cookie), used_at: null });
    expect(row!.expires_at.toISOString()).toBe(grant.expiresAt);
    const dump = JSON.stringify((await h.db.pool.query('SELECT * FROM reauth_grants WHERE user_id = $1', [user.userId])).rows);
    expect(dump).not.toContain(grant.reauthToken);
    // Không động tới `step_up_at` hay bảng mã email.
    expect(await codeRow(user.userId)).toBeUndefined();
  });

  it('mã sai → TOTP_INVALID; dùng chung bộ đếm với step-up: đủ ngưỡng → TOTP_LOCKED, kể cả mã đúng', async () => {
    const user = await signUpWithTotp(h);
    const wrong = wrongTotpCode(user.manualKey);
    for (let i = 1; i < TOTP_MAX_FAILURES; i++) {
      const error = expectError(await confirm(user.cookie, wrong), 400, 'TOTP_INVALID');
      expect(error.details).toEqual({ remainingAttempts: TOTP_MAX_FAILURES - i });
    }
    // Lần sai cuối qua step-up: cùng một bộ đếm.
    expectError(
      await h.http.post('/v1/identity/totp/step-up').set('cookie', user.cookie).send({ code: wrong }),
      429,
      'TOTP_LOCKED',
    );
    expectError(await confirm(user.cookie, totpCode(user.manualKey)), 429, 'TOTP_LOCKED');
    expect((await h.db.pool.query('SELECT 1 FROM reauth_grants WHERE user_id = $1', [user.userId])).rows).toEqual([]);
  });

  it('không nhận mã khôi phục; xin mã email → 409 REAUTH_METHOD_MISMATCH {method: totp}, không gửi email', async () => {
    const user = await signUp(h);
    const { recoveryCodes } = await enrollTotp(h, user);
    expectError(await confirm(user.cookie, recoveryCodes[0]), 400, 'VALIDATION_FAILED');

    const sent = h.email.sent.length;
    const error = expectError(await sendCode(user.cookie), 409, 'REAUTH_METHOD_MISMATCH');
    expect(error.details).toEqual({ method: 'totp' });
    expect(h.email.sent).toHaveLength(sent);
    expect(await codeRow(user.userId)).toBeUndefined();
  });

  it('2FA bị tắt giữa lúc kiểm và lúc xác minh (plugin báo chưa đăng ký) → 409 REAUTH_METHOD_MISMATCH {method: email_otp}, không tính lần sai', async () => {
    const user = await signUpWithTotp(h);
    const verify = vi.spyOn(h.app.get(TotpStore), 'verify').mockResolvedValueOnce({ status: 'not_started' });
    try {
      const error = expectError(await confirm(user.cookie, totpCode(user.manualKey)), 409, 'REAUTH_METHOD_MISMATCH');
      expect(error.details).toEqual({ method: 'email_otp' });
    } finally {
      verify.mockRestore();
    }
    const { rows } = await h.db.pool.query<{ failed_count: number }>(
      'SELECT failed_count FROM totp_verify_failures WHERE user_id = $1',
      [user.userId],
    );
    expect(rows[0]?.failed_count ?? 0).toBe(0);
    expect((await h.db.pool.query('SELECT 1 FROM reauth_grants WHERE user_id = $1', [user.userId])).rows).toEqual([]);
  });

  it('session chưa qua lớp hai → TOTP_REQUIRED (guard), không cấp gì; chưa đăng nhập → 401', async () => {
    const user = await signUpWithTotp(h);
    const fresh = await signIn(h, user.email);
    expectError(await confirm(fresh, totpCode(user.manualKey)), 403, 'TOTP_REQUIRED');
    expectError(await sendCode(fresh), 403, 'TOTP_REQUIRED');
    expectError(await h.http.post('/v1/identity/reauth').send({ code: '123456' }), 401, 'UNAUTHENTICATED');
    expectError(await h.http.post('/v1/identity/reauth/email-code'), 401, 'UNAUTHENTICATED');
  });
});

describe('xác nhận bằng mã email (chưa bật 2FA)', () => {
  it('gửi mã → email "Mã xác nhận" 6 số, hết hạn 5 phút, DB chỉ giữ hash; nhập đúng → token, mã bị xóa (không dùng lại được)', async () => {
    const user = await signUp(h);
    const before = Date.now();
    const sent = await sendCodeOk(user.cookie);
    expect(ReauthEmailCodeResponse.parse(sent.body)).toEqual({ resendAfterSeconds: OTP_RESEND_AFTER_SECONDS });

    const message = h.email.sent.at(-1)!;
    expect(message.to).toBe(user.email);
    expect(message.subject).toBe('Mã xác nhận Tickee của bạn');
    expect(message.text).toContain('Mã xác nhận của bạn là:');
    expect(message.text).toContain('5 phút');
    const code = h.email.lastCodeFor(user.email);
    expect(message.html).toContain(code);

    const row = await codeRow(user.userId);
    expect(row?.attempts).toBe(0);
    expect(row?.code_hash).not.toContain(code);
    const expiresIn = row!.expires_at.getTime() - before;
    expect(expiresIn).toBeGreaterThan((REAUTH_TTL_SECONDS - 10) * 1000);
    expect(expiresIn).toBeLessThanOrEqual((REAUTH_TTL_SECONDS + 10) * 1000);

    const res = await confirm(user.cookie, code);
    expect(res.status, res.text).toBe(200);
    const grant = ReauthGrant.parse(res.body);
    expect(await grantRow(grant.reauthToken)).toMatchObject({
      user_id: user.userId,
      session_id: await sessionIdOf(user.cookie),
      used_at: null,
    });
    expect(await codeRow(user.userId)).toBeUndefined();
    expectError(await confirm(user.cookie, code), 400, 'OTP_ATTEMPTS_EXCEEDED');
  });

  it('sai → OTP_INVALID còn 4..1; lần sai thứ 5 → OTP_ATTEMPTS_EXCEEDED, mã hết hiệu lực; mỗi lần sai tính vào khóa theo ngày', async () => {
    const user = await signUp(h);
    await sendCodeOk(user.cookie);
    const code = h.email.lastCodeFor(user.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const error = expectError(await confirm(user.cookie, wrong), 400, 'OTP_INVALID');
      expect(error.details).toEqual({ remainingAttempts: OTP_MAX_ATTEMPTS - i });
      expect((await codeRow(user.userId))?.attempts).toBe(i);
    }
    expectError(await confirm(user.cookie, wrong), 400, 'OTP_ATTEMPTS_EXCEEDED');
    expect(await codeRow(user.userId)).toBeUndefined();
    expectError(await confirm(user.cookie, code), 400, 'OTP_ATTEMPTS_EXCEEDED');
    // Năm lần sai một mã có thật được ghi; lần nhập khi không còn mã thì không.
    expect(await verifyFailures(user.email)).toBe(OTP_MAX_ATTEMPTS);
  });

  it('hết hạn → OTP_EXPIRED (không tính lần sai); chưa xin mã → OTP_ATTEMPTS_EXCEEDED; gửi mã mới thay mã cũ', async () => {
    const user = await signUp(h);
    expectError(await confirm(user.cookie, '123456'), 400, 'OTP_ATTEMPTS_EXCEEDED');

    await sendCodeOk(user.cookie);
    const first = h.email.lastCodeFor(user.email);
    await h.db.pool.query(`UPDATE reauth_codes SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [
      user.userId,
    ]);
    expectError(await confirm(user.cookie, first), 400, 'OTP_EXPIRED');
    expect(await verifyFailures(user.email)).toBe(0);

    // Gửi lại (sau cooldown): mã mới thay mã cũ.
    await sendCodeOk(user.cookie);
    const second = h.email.lastCodeFor(user.email);
    if (second !== first) expectError(await confirm(user.cookie, first), 400, 'OTP_INVALID');
    expect((await confirm(user.cookie, second)).status).toBe(200);
  });

  it('gửi dồn → 429 OTP_RATE_LIMITED (chung bộ đếm gửi với đăng nhập), không gửi thêm email', async () => {
    const user = await signUp(h);
    await sendCodeOk(user.cookie);
    const sent = h.email.sent.length;
    const error = expectError(await sendCode(user.cookie), 429, 'OTP_RATE_LIMITED');
    expect(error.details).toEqual({ retryAfterSeconds: expect.any(Number) });
    // Mã đăng nhập cùng email cũng bị cooldown chặn.
    expectError(await h.http.post('/v1/identity/otp').send({ email: user.email }), 429, 'OTP_RATE_LIMITED');
    expect(h.email.sent).toHaveLength(sent);
  });

  it('email đang khóa vì sai quá nhiều (khóa của đăng nhập) → OTP_LOCKED khi gửi và khi nhập, kể cả mã đúng', async () => {
    const user = await signUp(h);
    await sendCodeOk(user.cookie);
    const code = h.email.lastCodeFor(user.email);
    const hmac = h.app.get(OtpRateLimiter).emailHmac(user.email);
    await h.db.orm.execute(
      sql`INSERT INTO otp_verify_failures (email_hmac) SELECT ${hmac} FROM generate_series(1, ${OTP_DAILY_FAILURE_LIMIT + 1})`,
    );
    expectError(await confirm(user.cookie, code), 429, 'OTP_LOCKED');
    await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
    expectError(await sendCode(user.cookie), 429, 'OTP_LOCKED');
    expect((await h.db.pool.query('SELECT 1 FROM reauth_grants WHERE user_id = $1', [user.userId])).rows).toEqual([]);
  });

  it('SMTP lỗi → 503, mã không còn và lần gửi không tính (gửi lại được ngay)', async () => {
    const user = await signUp(h);
    await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
    h.email.failWith = new Error(`SMTP từ chối ${user.email}`);
    const error = expectError(await sendCode(user.cookie), 503, 'SERVICE_UNAVAILABLE');
    expect(error.message).not.toContain(user.email);
    expect(await codeRow(user.userId)).toBeUndefined();
    h.email.failWith = null;
    // Không xóa bộ đếm: lần gửi lỗi đã được trả lại nên không dính cooldown.
    const again = await sendCode(user.cookie);
    expect(again.status, again.text).toBe(200);
  });

  it('body sai → 400 VALIDATION_FAILED, không đếm lần sai', async () => {
    const user = await signUp(h);
    await sendCodeOk(user.cookie);
    for (const code of ['12345', '1234567', 'abcdef', 123456, undefined]) {
      expectError(await confirm(user.cookie, code), 400, 'VALIDATION_FAILED');
    }
    expect((await codeRow(user.userId))?.attempts).toBe(0);
  });

  it('bật 2FA sau khi xin mã email → nhập mã email bị coi là TOTP sai', async () => {
    const user = await signUp(h);
    await sendCodeOk(user.cookie);
    const code = h.email.lastCodeFor(user.email);
    const { manualKey } = await enrollTotp(h, user);
    if (code !== totpCode(manualKey)) expectError(await confirm(user.cookie, code), 400, 'TOTP_INVALID');
  });
});

describe('tiêu lần xác nhận (consumeReauth)', () => {
  it('dùng một lần: lần đầu ok (đánh dấu used_at), lần sau REAUTH_REQUIRED', async () => {
    const user = await signUp(h);
    const token = await reauthToken(h, user);
    const sessionId = await sessionIdOf(user.cookie);
    expect(await consume(user.userId, sessionId, token)).toBe('ok');
    expect((await grantRow(token))?.used_at).not.toBeNull();
    expect(await consume(user.userId, sessionId, token)).toBe('REAUTH_REQUIRED:email_otp');
  });

  it('transaction của thao tác rollback → lần xác nhận vẫn còn dùng được', async () => {
    const user = await signUp(h);
    const token = await reauthToken(h, user);
    const sessionId = await sessionIdOf(user.cookie);
    await expect(
      h.db.transaction(async (tx) => {
        await consumeReauth(tx, { userId: user.userId, sessionId, token });
        throw new Error('thao tác lỗi');
      }),
    ).rejects.toThrow('thao tác lỗi');
    expect((await grantRow(token))?.used_at).toBeNull();
    expect(await consume(user.userId, sessionId, token)).toBe('ok');
  });

  it('thiếu token, token lạ, hết hạn, session khác, user khác → REAUTH_REQUIRED; method theo tài khoản', async () => {
    const user = await signUpWithTotp(h);
    const token = await reauthToken(h, user);
    const sessionId = await sessionIdOf(user.cookie);
    const other = await signUp(h);

    expect(await consume(user.userId, sessionId, undefined)).toBe('REAUTH_REQUIRED:totp');
    expect(await consume(user.userId, sessionId, '')).toBe('REAUTH_REQUIRED:totp');
    expect(await consume(user.userId, sessionId, 'khong-phai-token')).toBe('REAUTH_REQUIRED:totp');
    // Session khác của cùng tài khoản (đăng nhập ở máy khác) không dùng được token của session này.
    const secondSession = await sessionIdOf(await signIn(h, user.email));
    expect(await consume(user.userId, secondSession, token)).toBe('REAUTH_REQUIRED:totp');
    // Tài khoản khác (kể cả cùng session id) không dùng được.
    expect(await consume(other.userId, sessionId, token)).toBe('REAUTH_REQUIRED:email_otp');
    expect((await grantRow(token))?.used_at).toBeNull();

    // Quá 5 phút.
    await h.db.pool.query(`UPDATE reauth_grants SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [
      sha256(token),
    ]);
    expect(await consume(user.userId, sessionId, token)).toBe('REAUTH_REQUIRED:totp');
  });

  it('hai thao tác song song cùng token: đúng một lần tiêu được', async () => {
    const user = await signUp(h);
    const token = await reauthToken(h, user);
    const sessionId = await sessionIdOf(user.cookie);
    const results = await Promise.all([1, 2, 3].map(() => consume(user.userId, sessionId, token)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
  });

  it('đăng xuất → lần xác nhận của session bị xóa theo', async () => {
    const user = await signUp(h);
    const token = await reauthToken(h, user);
    await h.http.post('/v1/identity/sign-out').set('cookie', user.cookie).expect(204);
    expect(await grantRow(token)).toBeUndefined();
  });
});
