import {
  ErrorResponse,
  Me,
  RecoveryCodeResponse,
  RECOVERY_CODE_COUNT,
  StepUpResponse,
  TOTP_LOCK_MS,
  TOTP_MAX_FAILURES,
  TotpEnrollResponse,
  TotpEnrollVerifyResponse,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TotpStore } from '../../src/modules/identity/totp-store.js';
import {
  createHarness,
  enrollTotp,
  sessionCookie,
  signUp,
  signUpWithTotp,
  totpCode,
  wrongTotpCode,
  type Harness,
} from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  h.email.failWith = null;
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const enroll = (cookie: string) => h.http.post('/v1/identity/totp/enroll').set('cookie', cookie);
const verifyEnroll = (cookie: string, code: string) =>
  h.http.post('/v1/identity/totp/enroll/verify').set('cookie', cookie).send({ code });
const stepUp = (cookie: string, code: string) => h.http.post('/v1/identity/totp/step-up').set('cookie', cookie).send({ code });
const recover = (cookie: string, recoveryCode: string) =>
  h.http.post('/v1/identity/totp/recovery').set('cookie', cookie).send({ recoveryCode });
const me = async (cookie: string) => Me.parse((await h.http.get('/v1/identity/me').set('cookie', cookie).expect(200)).body);

const tokenOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;

async function stepUpAtOf(cookie: string): Promise<Date | null> {
  const { rows } = await h.db.pool.query<{ step_up_at: Date | null }>('SELECT step_up_at FROM sessions WHERE token = $1', [
    tokenOf(cookie),
  ]);
  return rows[0]?.step_up_at ?? null;
}

async function auditActions(userId: string): Promise<{ action: string; organization_id: string | null; changed_fields: string[] }[]> {
  const { rows } = await h.db.pool.query(
    'SELECT action, organization_id, changed_fields FROM audit_events WHERE actor_user_id = $1 ORDER BY created_at, id',
    [userId],
  );
  return rows;
}

/** Toàn bộ dữ liệu TOTP của user trong DB (để kiểm không có mã dạng rõ). */
async function totpDump(userId: string): Promise<string> {
  const tables = [
    ['two_factors', 'user_id'],
    ['totp_recovery_codes', 'user_id'],
    ['totp_verify_failures', 'user_id'],
    ['audit_events', 'actor_user_id'],
    ['sessions', 'user_id'],
    ['users', 'id'],
  ] as const;
  const parts: unknown[] = [];
  for (const [table, column] of tables) {
    parts.push((await h.db.pool.query(`SELECT * FROM ${table} WHERE ${column} = $1`, [userId])).rows);
  }
  return JSON.stringify(parts);
}

describe('đăng ký TOTP', () => {
  it('enroll → URI + khóa nhập tay; xác nhận đúng → 10 mã khôi phục, cookie session mới đã step-up, audit totp.enrolled', async () => {
    const user = await signUp(h);
    expect((await me(user.cookie)).twoFactorEnabled).toBe(false);

    const enrollRes = await enroll(user.cookie).expect(200);
    expect(enrollRes.headers['cache-control']).toBe('no-store');
    const started = TotpEnrollResponse.parse(enrollRes.body);
    expect(started.totpUri).toContain(`secret=${started.manualKey}`);

    const before = Date.now();
    const res = await verifyEnroll(user.cookie, totpCode(started.manualKey)).expect(200);
    const { recoveryCodes } = TotpEnrollVerifyResponse.parse(res.body);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(recoveryCodes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    // Plugin xoay session: cookie cũ hết hiệu lực, cookie mới đã step-up.
    const newCookie = sessionCookie(res.headers['set-cookie']);
    expect(newCookie).not.toBe(user.cookie);
    await h.http.get('/v1/identity/me').set('cookie', user.cookie).expect(401);
    const at = await stepUpAtOf(newCookie);
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect((await me(newCookie)).twoFactorEnabled).toBe(true);

    expect(await auditActions(user.userId)).toEqual([
      { action: 'totp.enrolled', organization_id: null, changed_fields: [] },
    ]);

    // DB không chứa secret hay mã khôi phục dạng rõ; audit không chứa mã.
    const dump = await totpDump(user.userId);
    expect(dump).not.toContain(started.manualKey);
    for (const code of recoveryCodes) {
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(code.replace('-', ''));
    }
    expect(h.logs.text).not.toContain(started.manualKey);
    for (const code of recoveryCodes) expect(h.logs.text).not.toContain(code);
  });

  it('đã đăng ký thì enroll / enroll/verify → 409, không thay secret', async () => {
    const user = await signUpWithTotp(h);
    const res = await enroll(user.cookie);
    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    const verify = await verifyEnroll(user.cookie, totpCode(user.manualKey));
    expect(verify.status).toBe(409);
    // Secret cũ vẫn dùng được.
    await stepUp(user.cookie, totpCode(user.manualKey)).expect(200);
  });

  it('xác nhận khi chưa bắt đầu đăng ký → 409, không tính vào bộ đếm', async () => {
    const user = await signUp(h);
    for (let i = 0; i < 6; i++) expect((await verifyEnroll(user.cookie, '123456')).status).toBe(409);
    const started = TotpEnrollResponse.parse((await enroll(user.cookie).expect(200)).body);
    await verifyEnroll(user.cookie, totpCode(started.manualKey)).expect(200);
  });

  it('mã sai ở bước xác nhận → 400 TOTP_INVALID; mã sai dạng → 400 VALIDATION_FAILED', async () => {
    const user = await signUp(h);
    const started = TotpEnrollResponse.parse((await enroll(user.cookie).expect(200)).body);
    const res = await verifyEnroll(user.cookie, wrongTotpCode(started.manualKey));
    expect(res.status).toBe(400);
    expect(errorOf(res.body)).toMatchObject({ code: 'TOTP_INVALID', details: { remainingAttempts: 4 } });
    const malformed = await verifyEnroll(user.cookie, '12ab');
    expect(errorOf(malformed.body).code).toBe('VALIDATION_FAILED');
  });

  it('sai 5 lần ở bước xác nhận cũng khóa', async () => {
    const user = await signUp(h);
    const started = TotpEnrollResponse.parse((await enroll(user.cookie).expect(200)).body);
    for (let i = 0; i < 4; i++) await verifyEnroll(user.cookie, wrongTotpCode(started.manualKey)).expect(400);
    const locked = await verifyEnroll(user.cookie, wrongTotpCode(started.manualKey));
    expect(locked.status).toBe(429);
    expect(errorOf(locked.body).code).toBe('TOTP_LOCKED');
    expect((await verifyEnroll(user.cookie, totpCode(started.manualKey))).status).toBe(429);
  });

  it('xác nhận đúng nhưng transaction của Tickee lỗi → gỡ lại TOTP, không để user bật mà thiếu mã khôi phục', async () => {
    const user = await signUp(h);
    const started = TotpEnrollResponse.parse((await enroll(user.cookie).expect(200)).body);
    const spy = vi.spyOn(h.app.get(TotpStore), 'markStepUp').mockResolvedValueOnce(null);
    try {
      const res = await verifyEnroll(user.cookie, totpCode(started.manualKey));
      expect(res.status).toBe(401);
    } finally {
      spy.mockRestore();
    }
    const { rows } = await h.db.pool.query<{ two_factor_enabled: boolean }>(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [user.userId],
    );
    expect(rows[0]?.two_factor_enabled).toBe(false);
    expect((await h.db.pool.query('SELECT 1 FROM two_factors WHERE user_id = $1', [user.userId])).rows).toHaveLength(0);
    expect((await h.db.pool.query('SELECT 1 FROM totp_recovery_codes WHERE user_id = $1', [user.userId])).rows).toHaveLength(0);
    const { rows: counter } = await h.db.pool.query<{ failed_count: number }>(
      'SELECT failed_count FROM totp_verify_failures WHERE user_id = $1',
      [user.userId],
    );
    expect(counter[0]?.failed_count ?? 0).toBe(0);
  });

  it('chưa đăng nhập → 401', async () => {
    expect((await h.http.post('/v1/identity/totp/enroll')).status).toBe(401);
    expect((await h.http.post('/v1/identity/totp/step-up').send({ code: '123456' })).status).toBe(401);
  });
});

describe('step-up', () => {
  it('đúng → 200 stepUpAt; session cũ giữ nguyên (không xoay)', async () => {
    const user = await signUpWithTotp(h);
    await h.db.orm.execute(sql`UPDATE sessions SET step_up_at = NULL WHERE token = ${tokenOf(user.cookie)}`);
    const res = await stepUp(user.cookie, totpCode(user.manualKey)).expect(200);
    const { stepUpAt } = StepUpResponse.parse(res.body);
    expect((await stepUpAtOf(user.cookie))?.toISOString()).toBe(stepUpAt);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('chưa đăng ký → 403 TOTP_REQUIRED enroll', async () => {
    const user = await signUp(h);
    const res = await stepUp(user.cookie, '123456');
    expect(res.status).toBe(403);
    expect(errorOf(res.body)).toMatchObject({ code: 'TOTP_REQUIRED', details: { reason: 'enroll' } });
  });

  it('sai lần 1–4 → TOTP_INVALID còn 4..1; lần 5 → 429 TOTP_LOCKED + audit; khóa thì mã đúng cũng bị từ chối', async () => {
    const user = await signUpWithTotp(h);
    const wrong = wrongTotpCode(user.manualKey);
    for (const remaining of [4, 3, 2, 1]) {
      const res = await stepUp(user.cookie, wrong);
      expect(res.status).toBe(400);
      expect(errorOf(res.body)).toMatchObject({ code: 'TOTP_INVALID', details: { remainingAttempts: remaining } });
    }
    const locked = await stepUp(user.cookie, wrong);
    expect(locked.status).toBe(429);
    const error = errorOf(locked.body);
    expect(error.code).toBe('TOTP_LOCKED');
    const retryAfter = (error.details as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(retryAfter).toBeGreaterThan(TOTP_LOCK_MS / 1000 - 30);
    expect(retryAfter).toBeLessThanOrEqual(TOTP_LOCK_MS / 1000);
    expect(error.message).toContain('15 phút');

    const actions = (await auditActions(user.userId)).map((a) => a.action);
    expect(actions.filter((a) => a === 'totp.locked')).toHaveLength(1);

    const correct = await stepUp(user.cookie, totpCode(user.manualKey));
    expect(correct.status).toBe(429);
    expect(errorOf(correct.body).code).toBe('TOTP_LOCKED');

    // Hết 15 phút → mở khóa, mã đúng qua và bộ đếm về 0.
    await h.db.orm.execute(
      sql`UPDATE totp_verify_failures SET locked_until = now() - interval '1 second' WHERE user_id = ${user.userId}`,
    );
    await stepUp(user.cookie, totpCode(user.manualKey)).expect(200);
    const after = await stepUp(user.cookie, wrong);
    expect(errorOf(after.body)).toMatchObject({ code: 'TOTP_INVALID', details: { remainingAttempts: 4 } });
  });

  it('đúng thì đặt lại bộ đếm (sai liên tiếp mới tính)', async () => {
    const user = await signUpWithTotp(h);
    const wrong = wrongTotpCode(user.manualKey);
    for (let i = 0; i < 3; i++) await stepUp(user.cookie, wrong).expect(400);
    await stepUp(user.cookie, totpCode(user.manualKey)).expect(200);
    for (let i = 0; i < 4; i++) await stepUp(user.cookie, wrong).expect(400);
  });

  it('sai song song: tối đa TOTP_MAX_FAILURES lần TOTP_INVALID, còn lại TOTP_LOCKED, đúng một audit totp.locked', async () => {
    const user = await signUpWithTotp(h);
    const wrong = wrongTotpCode(user.manualKey);
    const results = await Promise.all(Array.from({ length: 8 }, () => stepUp(user.cookie, wrong)));
    const codes = results.map((r) => errorOf(r.body).code);
    expect(codes.filter((c) => c === 'TOTP_INVALID').length).toBeLessThanOrEqual(TOTP_MAX_FAILURES);
    expect(codes.every((c) => c === 'TOTP_INVALID' || c === 'TOTP_LOCKED')).toBe(true);
    expect(codes.filter((c) => c === 'TOTP_LOCKED').length).toBeGreaterThanOrEqual(8 - TOTP_MAX_FAILURES);
    const locked = (await auditActions(user.userId)).filter((a) => a.action === 'totp.locked');
    expect(locked).toHaveLength(1);
  });

  it('khóa theo user: session khác của cùng user cũng bị khóa', async () => {
    const user = await signUpWithTotp(h);
    const wrong = wrongTotpCode(user.manualKey);
    for (let i = 0; i < 4; i++) await stepUp(user.cookie, wrong).expect(400);
    await stepUp(user.cookie, wrong).expect(429);
    const other = await signUp(h, user.email);
    expect((await stepUp(other.cookie, totpCode(user.manualKey))).status).toBe(429);
  });
});

describe('mã khôi phục', () => {
  it('mã chưa dùng → step-up, mã hết hiệu lực, TOTP bị gỡ, audit + email; đăng ký lại sinh bộ mới, bộ cũ hết hiệu lực', async () => {
    const user = await signUp(h);
    const first = await enrollTotp(h, user);
    await h.db.orm.execute(sql`UPDATE sessions SET step_up_at = NULL WHERE token = ${tokenOf(user.cookie)}`);
    // Một session khác của cùng user đã step-up: dùng mã khôi phục phải xóa step-up của nó.
    const other = await signUp(h, user.email);
    await stepUp(other.cookie, totpCode(first.manualKey)).expect(200);
    expect(await stepUpAtOf(other.cookie)).not.toBeNull();
    const sentBefore = h.email.sent.length;

    const res = await recover(user.cookie, first.recoveryCodes[0]!.toLowerCase()).expect(200);
    const body = RecoveryCodeResponse.parse(res.body);
    expect(body.reenrollRequired).toBe(true);
    expect((await stepUpAtOf(user.cookie))?.toISOString()).toBe(body.stepUpAt);
    expect((await me(user.cookie)).twoFactorEnabled).toBe(false);
    expect(await stepUpAtOf(other.cookie)).toBeNull();
    const { rows } = await h.db.pool.query('SELECT 1 FROM two_factors WHERE user_id = $1', [user.userId]);
    expect(rows).toHaveLength(0);

    const actions = await auditActions(user.userId);
    expect(actions.at(-1)).toEqual({ action: 'totp.recovery_code_used', organization_id: null, changed_fields: [] });
    const mail = h.email.sent.slice(sentBefore);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe(user.email);
    expect(mail[0]!.subject).toContain('mã khôi phục');
    for (const code of first.recoveryCodes) expect(mail[0]!.text).not.toContain(code);

    // Đã gỡ TOTP: dùng tiếp mã khôi phục → đòi đăng ký.
    const again = await recover(user.cookie, first.recoveryCodes[1]!);
    expect(errorOf(again.body)).toMatchObject({ code: 'TOTP_REQUIRED', details: { reason: 'enroll' } });

    // Đăng ký lại: bộ mới; mã cũ (đã dùng hoặc chưa) → TOTP_INVALID, tính vào bộ đếm.
    const second = await enrollTotp(h, user);
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
    const used = await recover(user.cookie, first.recoveryCodes[0]!);
    expect(used.status).toBe(400);
    expect(errorOf(used.body)).toMatchObject({ code: 'TOTP_INVALID', details: { remainingAttempts: 4 } });
    const stale = await recover(user.cookie, first.recoveryCodes[1]!);
    expect(errorOf(stale.body)).toMatchObject({ code: 'TOTP_INVALID', details: { remainingAttempts: 3 } });
    // Mã sai TOTP cũng cùng bộ đếm.
    const totpWrong = await stepUp(user.cookie, wrongTotpCode(second.manualKey));
    expect(errorOf(totpWrong.body)).toMatchObject({ code: 'TOTP_INVALID', details: { remainingAttempts: 2 } });
    await recover(user.cookie, second.recoveryCodes[0]!).expect(200);
  });

  it('gửi email lỗi không làm hỏng step-up; log không chứa email', async () => {
    const user = await signUp(h);
    const { recoveryCodes } = await enrollTotp(h, user);
    h.email.failWith = new Error(`SMTP từ chối ${user.email}`);
    await recover(user.cookie, recoveryCodes[0]!).expect(200);
    expect(h.logs.lines.some((l) => l.msg === 'Không gửi được email báo dùng mã khôi phục')).toBe(true);
    expect(h.logs.text).not.toContain(user.email);
  });

  it('mã sai dạng → 400 VALIDATION_FAILED, không tính vào bộ đếm', async () => {
    const user = await signUpWithTotp(h);
    for (let i = 0; i < 6; i++) {
      const res = await recover(user.cookie, 'abc');
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    }
    await stepUp(user.cookie, totpCode(user.manualKey)).expect(200);
  });

  it('sai 5 lần (mã khôi phục) → khóa', async () => {
    const user = await signUpWithTotp(h);
    for (let i = 0; i < 4; i++) await recover(user.cookie, 'AAAAA-AAAAA').expect(400);
    const locked = await recover(user.cookie, 'AAAAA-AAAAA');
    expect(locked.status).toBe(429);
    expect(errorOf(locked.body).code).toBe('TOTP_LOCKED');
  });
});
