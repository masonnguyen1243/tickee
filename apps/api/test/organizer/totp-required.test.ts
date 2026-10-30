import { DiscoveryModule } from '@nestjs/core';
import { ErrorResponse, Role, STEP_UP_TTL_MS, TOTP_EXEMPT_ROUTES } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  enrollTotp,
  sessionCookie,
  signUp,
  signUpWithTotp,
  totpCode,
  type Harness,
} from '../identity/harness.js';
import { discoverRoutes } from './routes.js';
import { EventsTestController, OwnerOnlyTestController } from './test-controllers.js';

/* AD-26: request mang vai Owner (route BTC mà vai là `owner`) phải đã đăng ký TOTP và step-up trong 12 giờ. */

let h: Harness;

beforeAll(async () => {
  h = await createHarness({}, { imports: [DiscoveryModule], controllers: [OwnerOnlyTestController, EventsTestController] });
});
afterAll(async () => {
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const tokenOf = (cookie: string) => decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;
const setStepUpAt = (cookie: string, at: Date | null) =>
  h.db.orm.execute(sql`UPDATE sessions SET step_up_at = ${at} WHERE token = ${tokenOf(cookie)}`);

async function createOrg(cookie: string): Promise<string> {
  return (await h.http.post('/v1/orgs').set('cookie', cookie).send({ name: 'BTC kiểm TOTP' }).expect(201)).body.id as string;
}

function expectTotpRequired(res: Response, reason: 'enroll' | 'step_up') {
  expect(res.status).toBe(403);
  expect(errorOf(res.body)).toMatchObject({ code: 'TOTP_REQUIRED', details: { reason } });
}

describe('TOTP_REQUIRED ở route BTC', () => {
  it('Owner chưa đăng ký → 403 reason enroll (cả route Owner/Admin dùng chung)', async () => {
    const owner = await signUp(h);
    const orgId = await createOrg(owner.cookie);
    for (const path of [`/v1/orgs/${orgId}`, `/v1/orgs/${orgId}/test-events`, `/v1/orgs/${orgId}/test-owner-only`]) {
      expectTotpRequired(await h.http.get(path).set('cookie', owner.cookie), 'enroll');
    }
    // Route miễn vẫn dùng được khi chưa đăng ký.
    await h.http.get('/v1/identity/me').set('cookie', owner.cookie).expect(200);
    await h.http.get('/v1/me/memberships').set('cookie', owner.cookie).expect(200);
  });

  it('đã đăng ký: chưa step-up hoặc quá 12 giờ → step_up; còn hạn → 200 và ctx mang stepUpAt', async () => {
    const owner = await signUpWithTotp(h);
    const orgId = await createOrg(owner.cookie);
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie).expect(200);

    await setStepUpAt(owner.cookie, null);
    expectTotpRequired(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie), 'step_up');

    await setStepUpAt(owner.cookie, new Date(Date.now() - STEP_UP_TTL_MS - 60_000));
    expectTotpRequired(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie), 'step_up');

    const recent = new Date(Date.now() - STEP_UP_TTL_MS + 60_000);
    await setStepUpAt(owner.cookie, recent);
    const res = await h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', owner.cookie).expect(200);
    expect(res.body.stepUpAt).toBe(recent.toISOString());
  });

  it('step-up đúng thì thử lại request dở được', async () => {
    const owner = await signUpWithTotp(h);
    const orgId = await createOrg(owner.cookie);
    await setStepUpAt(owner.cookie, null);
    expectTotpRequired(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie), 'step_up');
    await h.http.post('/v1/identity/totp/step-up').set('cookie', owner.cookie).send({ code: totpCode(owner.manualKey) }).expect(200);
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie).expect(200);
  });

  it('dùng mã khôi phục → lần request Owner kế tiếp ra enroll; đăng ký lại thì qua', async () => {
    const owner = await signUp(h);
    const orgId = await createOrg(owner.cookie);
    const { recoveryCodes } = await enrollTotp(h, owner);
    await setStepUpAt(owner.cookie, null);
    await h.http.post('/v1/identity/totp/recovery').set('cookie', owner.cookie).send({ recoveryCode: recoveryCodes[0] }).expect(200);
    expectTotpRequired(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie), 'enroll');
    await enrollTotp(h, owner);
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie).expect(200);
  });

  it('Admin không bao giờ bị đòi TOTP; ctx Admin mang stepUpAt null', async () => {
    const owner = await signUpWithTotp(h);
    const orgId = await createOrg(owner.cookie);
    const admin = await signUp(h);
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
    );
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', admin.cookie).expect(200);
    const res = await h.http.get(`/v1/orgs/${orgId}/test-events`).set('cookie', admin.cookie).expect(200);
    expect(res.body).toMatchObject({ role: 'admin', stepUpAt: null });
    // Vai thiếu quyền vẫn là FORBIDDEN_ROLE, không phải TOTP_REQUIRED.
    expect(errorOf((await h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', admin.cookie)).body).code).toBe(
      'FORBIDDEN_ROLE',
    );
  });

  it('Người mua và route ngoài BTC (tạo BTC mới, Vé của tôi…) không đòi TOTP kể cả khi là Owner nơi khác', async () => {
    const buyer = await signUp(h);
    await h.http.get('/v1/test-protected').set('cookie', buyer.cookie).expect(200);
    await h.http.get('/v1/me/memberships').set('cookie', buyer.cookie).expect(200);

    const owner = await signUp(h);
    await createOrg(owner.cookie);
    await h.http.get('/v1/test-protected').set('cookie', owner.cookie).expect(200);
    await createOrg(owner.cookie);
  });

  it('người ngoài BTC vẫn nhận NOT_A_MEMBER (kiểm thành viên trước TOTP)', async () => {
    const owner = await signUpWithTotp(h);
    const orgId = await createOrg(owner.cookie);
    const outsider = await signUp(h);
    expect(errorOf((await h.http.get(`/v1/orgs/${orgId}`).set('cookie', outsider.cookie)).body).code).toBe('NOT_A_MEMBER');
  });
});

describe('TOTP_EXEMPT_ROUTES', () => {
  it('mọi route trong danh sách miễn đều có thật', () => {
    const registered = new Set(discoverRoutes(h.app).map((r) => `${r.method} ${r.path}`));
    for (const route of TOTP_EXEMPT_ROUTES) expect(registered.has(route), route).toBe(true);
  });

  it('Owner chưa step-up / chưa đăng ký gọi từng route miễn → 2xx', async () => {
    const owner = await signUp(h);
    const orgId = await createOrg(owner.cookie);
    const { recoveryCodes } = await enrollTotp(h, owner);
    await setStepUpAt(owner.cookie, null);
    expectTotpRequired(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie), 'step_up');
    let manualKey = '';

    // Thứ tự có chủ đích: đi hết vòng step-up → mã khôi phục (gỡ TOTP) → đăng ký lại → đăng xuất.
    const calls: [string, () => Promise<Response>][] = [
      ['GET /v1/identity/me', () => h.http.get('/v1/identity/me').set('cookie', owner.cookie)],
      ['GET /v1/me/memberships', () => h.http.get('/v1/me/memberships').set('cookie', owner.cookie)],
      [
        'POST /v1/identity/totp/recovery',
        () => h.http.post('/v1/identity/totp/recovery').set('cookie', owner.cookie).send({ recoveryCode: recoveryCodes[0] }),
      ],
      [
        'POST /v1/identity/totp/enroll',
        async () => {
          const res = await h.http.post('/v1/identity/totp/enroll').set('cookie', owner.cookie);
          manualKey = (res.body as { manualKey: string }).manualKey;
          return res;
        },
      ],
      [
        'POST /v1/identity/totp/enroll/verify',
        async () => {
          const res = await h.http
            .post('/v1/identity/totp/enroll/verify')
            .set('cookie', owner.cookie)
            .send({ code: totpCode(manualKey) });
          if (res.status === 200) owner.cookie = sessionCookie(res.headers['set-cookie']);
          await setStepUpAt(owner.cookie, null);
          return res;
        },
      ],
      [
        'POST /v1/identity/totp/step-up',
        () => h.http.post('/v1/identity/totp/step-up').set('cookie', owner.cookie).send({ code: totpCode(manualKey) }),
      ],
      ['POST /v1/identity/sign-out', () => h.http.post('/v1/identity/sign-out').set('cookie', owner.cookie)],
    ];
    expect(calls.map(([r]) => r).sort()).toEqual([...TOTP_EXEMPT_ROUTES].sort());

    for (const [route, call] of calls) {
      const res = await call();
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    }
  });
});
