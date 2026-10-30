import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Req, type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import { Me, OTP_LENGTH } from '@tickee/contracts';
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
 * Tạo tài khoản mới bằng OTP và đồng ý NĐ 13 → cookie session + id. Xóa bộ đếm gửi OTP trước (mọi request test
 * cùng một IP).
 */
export async function signUp(h: Harness, email = newEmail()): Promise<{ cookie: string; userId: string; email: string }> {
  await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
  await h.http.post('/v1/identity/otp').send({ email }).expect(200);
  const verified = await h.http
    .post('/v1/identity/otp/verify')
    .send({ email, otp: h.email.lastCodeFor(email) })
    .expect(200);
  const cookie = sessionCookie(verified.headers['set-cookie']);
  const consent = await h.http.post('/v1/identity/consent').set('cookie', cookie).expect(200);
  return { cookie, userId: Me.parse(consent.body).id, email };
}
