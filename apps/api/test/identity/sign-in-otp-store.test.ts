import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ErrorResponse, OTP_LENGTH, OTP_MAX_ATTEMPTS } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignInOtpStore } from '../../src/modules/identity/sign-in-otp-store.js';
import { createHarness, newEmail, type Harness } from './harness.js';

// Ghim hành vi nội bộ của Better Auth 1.7 mà `SignInOtpStore` dựa vào (định danh `sign-in-otp-<email>`, định dạng
// `"<hash>:<attempts>"`): nâng Better Auth mà hành vi đổi thì các test này phải fail.

let h: Harness;
let store: SignInOtpStore;

beforeAll(async () => {
  h = await createHarness();
  store = h.app.get(SignInOtpStore);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  // Mọi request test đến từ cùng một IP: xóa bộ đếm để giới hạn theo IP không lan sang test khác.
  await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
});

const sendOtp = (email: string) => h.http.post('/v1/identity/otp').send({ email }).expect(200);
const verifyOtp = (email: string, otp: string) => h.http.post('/v1/identity/otp/verify').send({ email, otp });
/** Đổi `n` thành mã sai chắc chắn khác mã thật. */
const wrongCode = (code: string, n = 1): string =>
  String((Number(code) + n) % 10 ** OTP_LENGTH).padStart(OTP_LENGTH, '0');
const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

/**
 * `package.json` của `better-auth` mà mã nguồn thực sự nạp. Gói chỉ export `.`, nên không resolve thẳng
 * `better-auth/package.json` được: đi ngược từ file entry lên tới `package.json` của gói.
 */
function betterAuthVersion(): string {
  let dir = dirname(createRequire(import.meta.url).resolve('better-auth'));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version: string };
      if (pkg.name === 'better-auth') return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Không tìm thấy package.json của better-auth');
    dir = parent;
  }
}

describe('SignInOtpStore (ghim Better Auth 1.7)', () => {
  it('phiên bản better-auth đã cài là 1.7.x', () => {
    const version = betterAuthVersion();
    expect(
      version,
      `better-auth ${version} khác 1.7.x: kiểm lại định danh và định dạng verification trong sign-in-otp-store.ts`,
    ).toMatch(/^1\.7\./);
  });

  it('chưa gửi mã → không có mã, 0 lượt', async () => {
    const email = newEmail();
    expect(await store.has(email)).toBe(false);
    expect(await store.remainingAttempts(email)).toBe(0);
  });

  it('vừa gửi mã → có mã, đủ OTP_MAX_ATTEMPTS lượt', async () => {
    const email = newEmail();
    await sendOtp(email);
    expect(await store.has(email)).toBe(true);
    expect(await store.remainingAttempts(email)).toBe(OTP_MAX_ATTEMPTS);
  });

  it('email khác hoa/thường vẫn trỏ tới cùng mã (Better Auth đổi email về chữ thường)', async () => {
    const email = newEmail();
    await sendOtp(email);
    const mixed = email.replace(/^n/, 'N').replace('@vidu.vn', '@ViDu.VN');
    expect(mixed).not.toBe(email);
    expect(await store.has(mixed)).toBe(true);
    expect(await store.remainingAttempts(mixed)).toBe(OTP_MAX_ATTEMPTS);
  });

  it('nhập sai k lần → còn OTP_MAX_ATTEMPTS − k lượt, lần thứ OTP_MAX_ATTEMPTS → 0', async () => {
    const email = newEmail();
    await sendOtp(email);
    const code = h.email.lastCodeFor(email);
    for (let k = 1; k <= OTP_MAX_ATTEMPTS; k++) {
      await verifyOtp(email, wrongCode(code, k)).expect(400);
      expect(await store.remainingAttempts(email)).toBe(OTP_MAX_ATTEMPTS - k);
    }
  });

  it('delete → không còn mã, mã đúng cũ không đăng nhập được', async () => {
    const email = newEmail();
    await sendOtp(email);
    const code = h.email.lastCodeFor(email);
    await store.delete(email);
    expect(await store.has(email)).toBe(false);
    const res = await verifyOtp(email, code);
    // Không còn mã: Better Auth trả `INVALID_OTP`, còn 0 lượt → `OTP_ATTEMPTS_EXCEEDED`.
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
