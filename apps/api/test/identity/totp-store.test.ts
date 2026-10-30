import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TotpStore } from '../../src/modules/identity/totp-store.js';
import { createHarness, signUp, totpCode, wrongTotpCode, type Harness } from './harness.js';

/*
 * Ghim hành vi plugin `twoFactor` của Better Auth 1.7 mà `TotpStore` dựa vào. Nâng Better Auth mà test này đỏ thì
 * phải sửa `totp-store.ts` trước.
 */

let h: Harness;
let store: TotpStore;

beforeAll(async () => {
  h = await createHarness();
  store = h.app.get(TotpStore);
});
afterAll(async () => {
  await h.close();
});

const headersOf = (cookie: string) => new Headers({ cookie });
const tokenOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;

async function twoFactorRow(userId: string) {
  const { rows } = await h.db.pool.query<{ secret: string; backup_codes: string; verified: boolean }>(
    'SELECT secret, backup_codes, verified FROM two_factors WHERE user_id = $1',
    [userId],
  );
  return rows[0];
}

async function sessionRow(token: string) {
  const { rows } = await h.db.pool.query<{ user_id: string; step_up_at: Date | null }>(
    'SELECT user_id, step_up_at FROM sessions WHERE token = $1',
    [token],
  );
  return rows[0];
}

describe('TotpStore (Better Auth 1.7 twoFactor)', () => {
  it('beginEnrollment: URI otpauth đúng issuer/6 số/30 giây; hàng two_factors verified=false, secret đã mã hóa', async () => {
    const user = await signUp(h);
    const { totpUri, manualKey } = await store.beginEnrollment(headersOf(user.cookie));
    const uri = new URL(totpUri);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe(`/Tickee:${user.email}`);
    expect(uri.searchParams.get('issuer')).toBe('Tickee');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
    expect(manualKey).toMatch(/^[A-Z2-7]+=*$/);

    const row = await twoFactorRow(user.userId);
    expect(row?.verified).toBe(false);
    expect(row?.secret).not.toContain(manualKey);
    expect(await store.isEnabled(user.userId)).toBe(false);
  });

  it('verify sai → invalid; chưa bắt đầu đăng ký → not_started', async () => {
    const user = await signUp(h);
    expect(await store.verify(headersOf(user.cookie), '123456')).toEqual({ status: 'not_started' });
    const { manualKey } = await store.beginEnrollment(headersOf(user.cookie));
    expect(await store.verify(headersOf(user.cookie), wrongTotpCode(manualKey))).toEqual({ status: 'invalid' });
    expect((await twoFactorRow(user.userId))?.verified).toBe(false);
  });

  it('verify đúng lần đầu: bật TOTP, xoay session (xóa session cũ) và session mới giữ step_up_at của session cũ', async () => {
    const user = await signUp(h);
    const { manualKey } = await store.beginEnrollment(headersOf(user.cookie));
    const oldToken = tokenOf(user.cookie);
    await h.db.orm.execute(sql`UPDATE sessions SET step_up_at = '2026-10-30T01:02:03Z' WHERE token = ${oldToken}`);

    const result = await store.verify(headersOf(user.cookie), totpCode(manualKey));
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.rotatedSessionToken).toBeTruthy();
    expect(result.rotatedSessionToken).not.toBe(oldToken);
    expect(await sessionRow(oldToken)).toBeUndefined();
    const rotated = await sessionRow(result.rotatedSessionToken!);
    expect(rotated?.user_id).toBe(user.userId);
    expect(rotated?.step_up_at?.toISOString()).toBe('2026-10-30T01:02:03.000Z');
    expect((await twoFactorRow(user.userId))?.verified).toBe(true);
    expect(await store.isEnabled(user.userId)).toBe(true);

    // Đã xác nhận: verify lần sau (step-up) không xoay session.
    const newCookie = `tickee.session_token=${result.headers.getSetCookie()[0]!.split(';')[0]!.split('=')[1]}`;
    const again = await store.verify(headersOf(newCookie), totpCode(manualKey));
    expect(again).toMatchObject({ status: 'valid', rotatedSessionToken: null });

    // Đã xác nhận thì plugin không cho bắt đầu lại.
    await expect(store.beginEnrollment(headersOf(newCookie))).rejects.toMatchObject({
      body: { code: 'TOTP_ALREADY_ENABLED' },
    });
  });

  it('remove: xóa two_factors và tắt two_factor_enabled', async () => {
    const user = await signUp(h);
    const { manualKey } = await store.beginEnrollment(headersOf(user.cookie));
    await store.verify(headersOf(user.cookie), totpCode(manualKey));
    await h.db.transaction((tx) => store.remove(tx, user.userId));
    expect(await twoFactorRow(user.userId)).toBeUndefined();
    expect(await store.isEnabled(user.userId)).toBe(false);
  });

  it('endpoint HTTP gốc của plugin bị cổng HTTP chặn (404)', async () => {
    const user = await signUp(h);
    for (const path of ['/v1/auth/two-factor/enable', '/v1/auth/two-factor/verify-totp', '/v1/auth/two-factor/disable']) {
      const res = await h.http.post(path).set('cookie', user.cookie).send({});
      expect(res.status, path).toBe(404);
    }
  });
});
