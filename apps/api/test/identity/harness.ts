import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { Controller, Get, Req, type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import {
  Me,
  OTP_LENGTH,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TotpEnrollResponse,
  TotpEnrollVerifyResponse,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { ApiModule } from '../../src/api.module.js';
import type { ApiConfig } from '../../src/platform/config/index.js';
import { Database } from '../../src/platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailMessage, type EmailTransport } from '../../src/platform/email/index.js';
import { API_APP_OPTIONS, configureApiApp } from '../../src/roles/api.js';
import { apiConfig, databaseUrl, LogCapture } from '../helpers.js';

/** Transport giả: ghi lại email thay vì gửi SMTP (CI không có Mailpit). */
export class FakeEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  failWith: Error | null = null;

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }

  /** Mã OTP (`OTP_LENGTH` số) trong email gần nhất gửi tới `to`. */
  lastCodeFor(to: string): string {
    const message = this.sent.findLast((m) => m.to === to);
    const code = message?.text.match(new RegExp(`\\b(\\d{${OTP_LENGTH}})\\b`))?.[1];
    if (!code) throw new Error('Không thấy email OTP cho địa chỉ này');
    return code;
  }
}

/** Endpoint cần đăng nhập và đã đồng ý, không thuộc identity: dùng để kiểm guard. */
@Controller('test-protected')
class ProtectedController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }

  /** `@OptionalAuth()`: ẩn danh vẫn qua, có session thì gắn vào request. */
  @Get('optional')
  @OptionalAuth()
  optional(@Req() req: { session?: unknown }): { signedIn: boolean } {
    return { signedIn: Boolean(req.session) };
  }
}

export interface Harness {
  app: INestApplication;
  http: ReturnType<typeof request>;
  email: FakeEmailTransport;
  logs: LogCapture;
  db: Database;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Controller test thêm vào gốc DI (vd. route BTC chỉ Owner để kiểm guard quyền). */
  controllers?: Type[];
  /** Module thêm vào gốc DI (vd. `DiscoveryModule` cho bộ test cách ly). */
  imports?: Type[];
}

export async function createHarness(overrides: Partial<ApiConfig> = {}, options: HarnessOptions = {}): Promise<Harness> {
  const logs = new LogCapture();
  const email = new FakeEmailTransport();
  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule.forRoot(apiConfig(overrides), { destination: logs }), ...(options.imports ?? [])],
    controllers: [ProtectedController, ...(options.controllers ?? [])],
  })
    .overrideProvider(EMAIL_TRANSPORT)
    .useValue(email)
    .compile();
  const app = configureApiApp(moduleRef.createNestApplication(API_APP_OPTIONS), { shutdownHooks: false });
  await app.init();
  const db = new Database({ connectionString: databaseUrl(), max: 2 });
  return {
    app,
    http: request(app.getHttpServer()),
    email,
    logs,
    db,
    async close() {
      await db.close();
      await app.close();
    },
  };
}

export const newEmail = (): string => `nguoi-dung-${randomUUID()}@vidu.vn`;

/** Set-cookie đầy đủ của cookie session (`tickee.session_token`, có thể kèm tiền tố `__Secure-` khi HTTPS). */
export function sessionSetCookie(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = list.find((c) => /^(__Secure-)?tickee\.session_token=/.test(c));
  if (!cookie) throw new Error('Không có cookie session trong response');
  return cookie;
}

/** Cặp `tên=giá trị` của cookie session (để gửi lại ở request sau). */
export function sessionCookie(setCookie: string[] | string | undefined): string {
  return sessionSetCookie(setCookie).split(';')[0]!;
}

/**
 * Đăng nhập bằng OTP → cookie của một session mới (không gọi consent). Dùng để mở session thứ hai cho tài khoản đã có
 * (tài khoản đã bật 2FA thì session mới chưa qua lớp hai). Xóa bộ đếm gửi OTP trước (mọi request test cùng một IP).
 */
export async function signIn(h: Harness, email: string): Promise<string> {
  await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
  await h.http.post('/v1/identity/otp').send({ email }).expect(200);
  const verified = await h.http
    .post('/v1/identity/otp/verify')
    .send({ email, otp: h.email.lastCodeFor(email) })
    .expect(200);
  return sessionCookie(verified.headers['set-cookie']);
}

/** Tạo tài khoản mới bằng OTP và đồng ý NĐ 13 → cookie session + id. */
export async function signUp(h: Harness, email = newEmail()): Promise<{ cookie: string; userId: string; email: string }> {
  const cookie = await signIn(h, email);
  const consent = await h.http.post('/v1/identity/consent').set('cookie', cookie).expect(200);
  return { cookie, userId: Me.parse(consent.body).id, email };
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) throw new Error(`Ký tự base32 không hợp lệ: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Mã TOTP (RFC 6238, HMAC-SHA1) từ khóa base32 nhập tay — như ứng dụng xác thực tính. `offsetSteps` lệch số chu kỳ
 * 30 giây (vd. `-10` cho mã cũ chắc chắn sai).
 */
export function totpCode(manualKey: string, offsetSteps = 0, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(manualKey)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return bin.toString().padStart(TOTP_DIGITS, '0');
}

/** Mã TOTP chắc chắn sai (không trùng mã của các chu kỳ lân cận mà plugin chấp nhận). */
export function wrongTotpCode(manualKey: string): string {
  const near = new Set([-1, 0, 1].map((o) => totpCode(manualKey, o)));
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(TOTP_DIGITS, '0');
    if (!near.has(candidate)) return candidate;
  }
}

export interface TotpUser {
  cookie: string;
  userId: string;
  email: string;
}

/**
 * Bật 2FA cho `user` (enroll → verify bằng mã đúng). Plugin xoay session nên `user.cookie` được thay bằng cookie mới
 * (đã qua lớp hai). Trả khóa nhập tay và 10 mã khôi phục.
 */
export async function enrollTotp(h: Harness, user: TotpUser): Promise<{ manualKey: string; recoveryCodes: string[] }> {
  const started = await h.http.post('/v1/identity/totp/enroll').set('cookie', user.cookie).expect(200);
  const { manualKey } = TotpEnrollResponse.parse(started.body);
  const verified = await h.http
    .post('/v1/identity/totp/enroll/verify')
    .set('cookie', user.cookie)
    .send({ code: totpCode(manualKey) })
    .expect(200);
  user.cookie = sessionCookie(verified.headers['set-cookie']);
  return { manualKey, recoveryCodes: TotpEnrollVerifyResponse.parse(verified.body).recoveryCodes };
}

/** Tài khoản mới đã đồng ý NĐ 13 và đã bật 2FA (session đã qua lớp hai). */
export async function signUpWithTotp(h: Harness, email = newEmail()): Promise<TotpUser & { manualKey: string }> {
  const user = await signUp(h, email);
  const { manualKey } = await enrollTotp(h, user);
  return { ...user, manualKey };
}
