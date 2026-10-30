import { randomUUID } from 'node:crypto';
import { Controller, Get, Req } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ErrorResponse, RECOVERY_CODE_COUNT, TOTP_EXEMPT_ROUTES } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Public } from '../../src/platform/http/index.js';
import { discoverRoutes } from '../organizer/routes.js';
import { EventsTestController, OwnerOnlyTestController } from '../organizer/test-controllers.js';
import {
  createHarness,
  enrollTotp,
  sessionCookie,
  signIn,
  signUp,
  signUpWithTotp,
  totpCode,
  type Harness,
} from './harness.js';

/*
 * AD-26 (Story 2.2 làm lại): `TotpGuard` toàn cục của `identity`. User đã bật 2FA mà session chưa qua lớp hai →
 * `TOTP_REQUIRED` `step_up` ở mọi route ngoài `TOTP_EXEMPT_ROUTES`; user chưa bật không bao giờ bị hỏi.
 */

/** Route `@Public()`: báo request có mang session không. */
@Controller('test-totp-public')
class PublicTestController {
  @Get()
  @Public()
  get(@Req() req: { session?: unknown }): { signedIn: boolean } {
    return { signedIn: Boolean(req.session) };
  }
}

let h: Harness;

beforeAll(async () => {
  h = await createHarness(
    {},
    { imports: [DiscoveryModule], controllers: [OwnerOnlyTestController, EventsTestController, PublicTestController] },
  );
});
afterAll(async () => {
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const tokenOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;
const setStepUpAt = (cookie: string, at: Date | null) =>
  h.db.orm.execute(sql`UPDATE sessions SET step_up_at = ${at} WHERE token = ${tokenOf(cookie)}`);

async function stepUpAtOf(cookie: string): Promise<Date | null> {
  const { rows } = await h.db.pool.query<{ step_up_at: Date | null }>('SELECT step_up_at FROM sessions WHERE token = $1', [
    tokenOf(cookie),
  ]);
  return rows[0]?.step_up_at ?? null;
}

async function createOrg(cookie: string): Promise<string> {
  return (await h.http.post('/v1/orgs').set('cookie', cookie).send({ name: 'BTC kiểm 2FA' }).expect(201)).body.id as string;
}

function expectTotpRequired(res: Response, label = '') {
  expect(res.status, `${label} ${JSON.stringify(res.body)}`).toBe(403);
  expect(errorOf(res.body)).toMatchObject({ code: 'TOTP_REQUIRED', details: { reason: 'step_up' } });
}

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Đăng nhập Google trọn vòng (start → callback) như `google-login.test.ts`: token endpoint giả trả `id_token` không ký
 * cho `email` (đã xác minh, nên nối vào user sẵn có). @returns cookie của session mới.
 */
async function googleSignIn(email: string): Promise<string> {
  await h.db.orm.execute(sql`DELETE FROM google_start_events`);
  const start = await h.http.get('/v1/identity/google');
  expect(start.status).toBe(302);
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
  const stateCookie = ([] as string[])
    .concat((start.headers['set-cookie'] as string[] | string | undefined) ?? [])
    .find((c) => c.startsWith('tickee.state='))
    ?.split(';')[0];
  if (!stateCookie) throw new Error('Không có cookie state');

  const now = Math.floor(Date.now() / 1000);
  const idToken = [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
    b64url({
      iss: 'https://accounts.google.com',
      aud: 'test',
      iat: now,
      exp: now + 3600,
      sub: `google-${randomUUID()}`,
      email,
      email_verified: true,
      name: 'Nguyễn Văn An',
    }),
    'sig',
  ].join('.');
  const realFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(GOOGLE_TOKEN_ENDPOINT)) return realFetch(input, init);
    return globalThis.Response.json({
      access_token: 'ya29.test',
      id_token: idToken,
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    });
  });
  try {
    const res = await h.http.get('/v1/auth/callback/google').query({ state, code: '4/0Atest' }).set('cookie', stateCookie);
    expect(res.status).toBe(302);
    return sessionCookie(res.headers['set-cookie']);
  } finally {
    fetchSpy.mockRestore();
  }
}

/** Một route không miễn bất kỳ (không thuộc identity, không thuộc BTC). */
const protectedRoute = (cookie: string) => h.http.get('/v1/test-protected').set('cookie', cookie);

describe('chưa bật 2FA', () => {
  it('Owner không bao giờ nhận TOTP_REQUIRED: route BTC (kể cả chỉ Owner), tạo BTC, route ngoài BTC; ctx stepUpAt null', async () => {
    const owner = await signUp(h);
    const orgId = await createOrg(owner.cookie);
    expect(await stepUpAtOf(owner.cookie)).toBeNull();

    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie).expect(200);
    await h.http.get(`/v1/orgs/${orgId}/test-events`).set('cookie', owner.cookie).expect(200);
    const ownerOnly = await h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', owner.cookie).expect(200);
    expect(ownerOnly.body).toMatchObject({ role: 'owner', stepUpAt: null });
    await h.http.get('/v1/me/memberships').set('cookie', owner.cookie).expect(200);
    await protectedRoute(owner.cookie).expect(200);
    await createOrg(owner.cookie);

    // Session thứ hai (đăng nhập lại) cũng vậy.
    const again = await signIn(h, owner.email);
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', again).expect(200);
  });
});

describe('đã bật 2FA', () => {
  it('bật 2FA: 10 mã khôi phục, session hiện tại đã qua lớp hai; session khác của user nhận TOTP_REQUIRED ở request kế tiếp', async () => {
    const user = await signUp(h);
    const other = await signIn(h, user.email);
    // Session khác từng qua lớp hai (vd. từ lần bật trước): bật lại phải xóa mốc này.
    await setStepUpAt(other, new Date());
    await protectedRoute(other).expect(200);

    const { recoveryCodes } = await enrollTotp(h, user);
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);

    expect(await stepUpAtOf(user.cookie)).not.toBeNull();
    await protectedRoute(user.cookie).expect(200);
    expect(await stepUpAtOf(other)).toBeNull();
    expectTotpRequired(await protectedRoute(other));
  });

  it('đăng nhập lại: session mới gọi route không miễn → 403 step_up, kể cả route BTC, BTC lạ và route identity khác', async () => {
    const owner = await signUpWithTotp(h);
    const orgId = await createOrg(owner.cookie);
    const fresh = await signIn(h, owner.email);
    expect(await stepUpAtOf(fresh)).toBeNull();

    const calls: [string, () => Promise<Response>][] = [
      ['GET /v1/orgs/:orgId', () => h.http.get(`/v1/orgs/${orgId}`).set('cookie', fresh)],
      ['GET test-owner-only', () => h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', fresh)],
      // Guard 2FA chạy trước PermissionGuard: chưa qua lớp hai thì không biết được có là thành viên hay không.
      ['GET BTC lạ', () => h.http.get(`/v1/orgs/${randomUUID()}`).set('cookie', fresh)],
      ['POST /v1/orgs', () => h.http.post('/v1/orgs').set('cookie', fresh).send({ name: 'BTC mới' })],
      ['GET /v1/me/memberships', () => h.http.get('/v1/me/memberships').set('cookie', fresh)],
      ['GET /v1/test-protected', () => protectedRoute(fresh)],
      // Đứng trước ConsentGuard: route đồng ý cũng bị chặn.
      ['POST /v1/identity/consent', () => h.http.post('/v1/identity/consent').set('cookie', fresh)],
      ['POST /v1/identity/totp/enroll', () => h.http.post('/v1/identity/totp/enroll').set('cookie', fresh)],
      [
        'POST /v1/identity/totp/disable',
        () => h.http.post('/v1/identity/totp/disable').set('cookie', fresh).send({ code: totpCode(owner.manualKey) }),
      ],
    ];
    for (const [label, call] of calls) expectTotpRequired(await call(), label);
    // Session cũ (đã qua lớp hai) không bị ảnh hưởng.
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie).expect(200);
  });

  it('route công khai: session chưa qua lớp hai được xử lý như khách; request ẩn danh không bị đụng tới', async () => {
    const user = await signUpWithTotp(h);
    const fresh = await signIn(h, user.email);
    const res = await h.http.get('/v1/test-totp-public').set('cookie', fresh).expect(200);
    expect(res.body).toEqual({ signedIn: false });

    // `@OptionalAuth()` ẩn danh: không có session thì guard bỏ qua.
    expect((await h.http.get('/v1/test-protected/optional').expect(200)).body).toEqual({ signedIn: false });
    // `@OptionalAuth()` không phải route công khai: có session chưa qua lớp hai thì vẫn bị đòi.
    expectTotpRequired(await h.http.get('/v1/test-protected/optional').set('cookie', fresh));
  });

  it('không chặn đăng nhập: OTP email, bắt đầu Google và callback Google vẫn chạy với user đã bật 2FA', async () => {
    const user = await signUpWithTotp(h);
    // `signIn` gọi `POST /v1/identity/otp` và `POST /v1/identity/otp/verify` (expect 200).
    const fresh = await signIn(h, user.email);

    const google = await h.http.get('/v1/identity/google').set('cookie', fresh);
    expect(google.status).toBe(302);
    expect(google.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);

    const callback = await h.http.get('/v1/auth/callback/google').query({ state: 'khong-co', code: 'x' }).set('cookie', fresh);
    expect(callback.status).toBe(302);
  });

  it('đăng nhập Google thành công với user đã bật 2FA: session mới nhận TOTP_REQUIRED ở route không miễn, /me vẫn 200', async () => {
    const user = await signUpWithTotp(h);
    const fresh = await googleSignIn(user.email);
    expect(fresh).not.toBe(user.cookie);
    expect(await stepUpAtOf(fresh)).toBeNull();

    expectTotpRequired(await protectedRoute(fresh));
    const me = await h.http.get('/v1/identity/me').set('cookie', fresh).expect(200);
    expect(me.body).toMatchObject({ id: user.userId, twoFactorEnabled: true });
  });

  it('step-up đúng: mọi request sau trong session qua guard, không hết hạn theo giờ; ctx mang stepUpAt', async () => {
    const owner = await signUpWithTotp(h);
    const orgId = await createOrg(owner.cookie);
    const fresh = await signIn(h, owner.email);
    expectTotpRequired(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', fresh));

    await h.http.post('/v1/identity/totp/step-up').set('cookie', fresh).send({ code: totpCode(owner.manualKey) }).expect(200);
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', fresh).expect(200);
    await protectedRoute(fresh).expect(200);
    await h.http.get('/v1/me/memberships').set('cookie', fresh).expect(200);

    // Không có mốc 12 giờ: step-up từ 30 ngày trước vẫn còn hiệu lực trong session đó.
    const longAgo = new Date(Date.now() - 30 * 24 * 3_600_000);
    await setStepUpAt(fresh, longAgo);
    const ctx = await h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', fresh).expect(200);
    expect(ctx.body).toMatchObject({ role: 'owner', stepUpAt: longAgo.toISOString() });
  });
});

describe('TOTP_EXEMPT_ROUTES', () => {
  it('mọi route trong danh sách miễn đều có thật', () => {
    const registered = new Set(discoverRoutes(h.app).map((r) => `${r.method} ${r.path}`));
    for (const route of TOTP_EXEMPT_ROUTES) expect(registered.has(route), route).toBe(true);
  });

  it('guard đọc danh sách miễn: cùng một session chưa qua lớp hai, route miễn → 2xx còn route không miễn → TOTP_REQUIRED', async () => {
    const user = await signUp(h);
    const first = await enrollTotp(h, user);
    let session = await signIn(h, user.email);
    let manualKey = first.manualKey;

    /** Đối chứng với cùng session: route không miễn (cả trong identity) vẫn bị chặn. */
    const expectBlocked = async (when: string) => {
      expectTotpRequired(await protectedRoute(session), `${when}: test-protected`);
      expectTotpRequired(await h.http.get('/v1/me/memberships').set('cookie', session), `${when}: memberships`);
      expectTotpRequired(await h.http.post('/v1/identity/consent').set('cookie', session), `${when}: consent`);
    };

    // Thứ tự có chủ đích: me → step-up → mã khôi phục (gỡ 2FA, bật lại) → đăng xuất. Trước mỗi route miễn, session
    // ở trạng thái "chưa qua lớp hai" và được đối chứng bằng route không miễn.
    const calls: [string, () => Promise<Response>][] = [
      ['GET /v1/identity/me', () => h.http.get('/v1/identity/me').set('cookie', session)],
      [
        'POST /v1/identity/totp/step-up',
        () => h.http.post('/v1/identity/totp/step-up').set('cookie', session).send({ code: totpCode(manualKey) }),
      ],
      [
        'POST /v1/identity/totp/recovery',
        async () => {
          const res = await h.http
            .post('/v1/identity/totp/recovery')
            .set('cookie', session)
            .send({ recoveryCode: first.recoveryCodes[0] });
          // Bật lại để còn kiểm route đăng xuất với session chưa qua lớp hai.
          const holder = { ...user, cookie: session };
          manualKey = (await enrollTotp(h, holder)).manualKey;
          session = holder.cookie;
          await setStepUpAt(session, null);
          return res;
        },
      ],
      ['POST /v1/identity/sign-out', () => h.http.post('/v1/identity/sign-out').set('cookie', session)],
    ];
    expect(calls.map(([r]) => r).sort()).toEqual([...TOTP_EXEMPT_ROUTES].sort());

    for (const [route, call] of calls) {
      await expectBlocked(`trước ${route}`);
      const res = await call();
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
      if (route === 'POST /v1/identity/totp/step-up') {
        await protectedRoute(session).expect(200);
        await setStepUpAt(session, null);
      }
    }
    // Đã đăng xuất: session không còn.
    expect((await protectedRoute(session)).status).toBe(401);
  });
});
