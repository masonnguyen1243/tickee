import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { ErrorResponse, Permission, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermission } from '../../src/platform/access/index.js';
import { createHarness, newEmail, sessionCookie, signUp, signUpWithTotp, type Harness } from '../identity/harness.js';
import { EventsTestController, OwnerOnlyTestController } from './test-controllers.js';

/** Cấu hình sai: `@RequirePermission` trên route không có `:orgId`. */
@Controller('test-missing-org-param')
class MissingOrgParamController {
  @Get()
  @RequirePermission(Permission.ORG_READ)
  get(): string {
    return 'không được tới đây';
  }
}

let h: Harness;
let owner: Awaited<ReturnType<typeof signUpWithTotp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let outsider: Awaited<ReturnType<typeof signUp>>;
let orgId: string;

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

beforeAll(async () => {
  h = await createHarness({}, { controllers: [OwnerOnlyTestController, EventsTestController, MissingOrgParamController] });
  // Owner đã bật 2FA và qua lớp hai (Story 2.2) để kiểm `stepUpAt` được chép vào ctx.
  owner = await signUpWithTotp(h);
  admin = await signUp(h);
  outsider = await signUp(h);
  const res = await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'BTC kiểm guard' }).expect(201);
  orgId = res.body.id as string;
  // Story 2.4 mới có luồng mời Admin: chèn trực tiếp.
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await h.close();
});

describe('PermissionGuard', () => {
  it('Owner qua route chỉ Owner; ctx đúng dạng', async () => {
    const res = await h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', owner.cookie).expect(200);
    expect(res.body).toEqual({
      userId: owner.userId,
      organizationId: orgId,
      role: 'owner',
      assignedEventIds: [],
      stepUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('Admin gọi route chỉ Owner → 403 FORBIDDEN_ROLE', async () => {
    const res = await h.http.get(`/v1/orgs/${orgId}/test-owner-only`).set('cookie', admin.cookie);
    expect(res.status).toBe(403);
    expect(errorOf(res.body).code).toBe('FORBIDDEN_ROLE');

    const post = await h.http.post(`/v1/orgs/${orgId}/test-owner-only/items/${randomUUID()}`).set('cookie', admin.cookie);
    expect(post.status).toBe(403);
    expect(errorOf(post.body).code).toBe('FORBIDDEN_ROLE');
  });

  it('Admin qua route Owner/Admin cùng dùng; GET /v1/orgs/:orgId trả vai admin', async () => {
    const res = await h.http.get(`/v1/orgs/${orgId}/test-events`).set('cookie', admin.cookie).expect(200);
    expect(res.body).toMatchObject({ userId: admin.userId, organizationId: orgId, role: 'admin' });
    const org = await h.http.get(`/v1/orgs/${orgId}`).set('cookie', admin.cookie).expect(200);
    expect(org.body).toMatchObject({ id: orgId, role: 'admin' });
  });

  it.each([
    ['không phải thành viên', () => orgId],
    ['BTC không tồn tại', () => randomUUID()],
    ['orgId sai dạng', () => 'khong-phai-uuid'],
    ['orgId gần giống uuid', () => `${orgId}x`],
  ])('%s → 403 NOT_A_MEMBER', async (_label, target) => {
    for (const path of [`/v1/orgs/${target()}`, `/v1/orgs/${target()}/test-owner-only`, `/v1/orgs/${target()}/test-events`]) {
      const res = await h.http.get(path).set('cookie', outsider.cookie);
      expect(res.status, path).toBe(403);
      expect(errorOf(res.body).code, path).toBe('NOT_A_MEMBER');
    }
  });

  it('@RequirePermission trên route không có :orgId → 500 (lỗi cấu hình), không lặng lẽ trả NOT_A_MEMBER', async () => {
    const res = await h.http.get('/v1/test-missing-org-param').set('cookie', owner.cookie);
    expect(res.status).toBe(500);
    expect(errorOf(res.body).code).toBe('INTERNAL_ERROR');
  });

  it('orgId chữ hoa vẫn là cùng BTC', async () => {
    const res = await h.http.get(`/v1/orgs/${orgId.toUpperCase()}`).set('cookie', owner.cookie).expect(200);
    expect(res.body.id).toBe(orgId);
  });

  it('chưa đăng nhập → 401 UNAUTHENTICATED (guard session chạy trước)', async () => {
    const res = await h.http.get(`/v1/orgs/${orgId}/test-owner-only`);
    expect(res.status).toBe(401);
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
  });

  it('chưa đồng ý NĐ 13 → 403 CONSENT_REQUIRED (guard đồng ý chạy trước guard quyền)', async () => {
    const email = newEmail();
    await h.db.orm.execute(sql`DELETE FROM otp_send_events`);
    await h.http.post('/v1/identity/otp').send({ email }).expect(200);
    const verified = await h.http
      .post('/v1/identity/otp/verify')
      .send({ email, otp: h.email.lastCodeFor(email) })
      .expect(200);
    const res = await h.http.get(`/v1/orgs/${orgId}`).set('cookie', sessionCookie(verified.headers['set-cookie']));
    expect(res.status).toBe(403);
    expect(errorOf(res.body).code).toBe('CONSENT_REQUIRED');
  });
});
