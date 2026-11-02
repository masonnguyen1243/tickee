import { randomUUID } from 'node:crypto';
import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { DiscoveryModule, Reflector } from '@nestjs/core';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { ClosedBetaOrganizationList, ErrorResponse, type ClosedBetaStatus } from '@tickee/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Auth } from '../../src/modules/identity/auth.js';
import { PlatformAdminGuard } from '../../src/modules/identity/platform-admin.guard.js';
import { RequirePlatformAdmin } from '../../src/platform/access/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { runMigrations } from '../../src/roles/migrate.js';
import { migrationDatabaseUrl } from '../helpers.js';
import { createHarness, signIn, signUp, signUpWithTotp, totpCode, type Harness } from '../identity/harness.js';
import { ADMIN_ROUTE, discoverRoutes } from '../organizer/routes.js';
import { setPlatformAdminFlag, signUpPlatformAdmin } from './platform-admin.js';

/*
 * Story 2.5: khu `/v1/admin/*` (cờ `platform_admin` đọc mới từ DB, 2FA, step-up), màn "Duyệt Closed Beta" (đọc qua
 * `platformAdminScope` có audit, duyệt/thu hồi bằng compare-and-set có audit) và grant theo cột của `users`.
 */

let h: Harness;
let admin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let owner: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  h = await createHarness({}, { imports: [DiscoveryModule] });
  admin = await signUpPlatformAdmin(h);
  owner = await signUp(h);
});
afterAll(async () => {
  await h.close();
});

const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;

function expectError(res: Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(errorOf(res).code).toBe(code);
}

const pgCode = (err: unknown) => (err as { code?: string }).code;

async function createOrg(name = 'CLB Cờ Vua Quận 3', contact: Record<string, string> = {}): Promise<string> {
  const res = await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name, ...contact }).expect(201);
  return res.body.id as string;
}

const queue = (cookie: string, closedBeta: unknown) =>
  h.http.get('/v1/admin/organizations').query(closedBeta === undefined ? {} : { closedBeta }).set('cookie', cookie);

async function listTab(status: ClosedBetaStatus, cookie = admin.cookie) {
  const res = await queue(cookie, status);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  // Danh sách chứa PII của nhiều BTC: không cho cache.
  expect(res.headers['cache-control']).toBe('no-store');
  return ClosedBetaOrganizationList.parse(res.body);
}

const approve = (id: string, cookie = admin.cookie) =>
  h.http.post(`/v1/admin/organizations/${id}/closed-beta/approve`).set('cookie', cookie);
const revoke = (id: string, cookie = admin.cookie) =>
  h.http.post(`/v1/admin/organizations/${id}/closed-beta/revoke`).set('cookie', cookie);

async function statusOf(orgId: string): Promise<string> {
  const { rows } = await h.db.pool.query<{ closed_beta_status: string }>(
    'SELECT closed_beta_status FROM organizations WHERE id = $1',
    [orgId],
  );
  return rows[0]!.closed_beta_status;
}

async function auditRows(where: { action: string; actor?: string; organizationId?: string }) {
  const { rows } = await h.db.pool.query<{
    actor_user_id: string | null;
    organization_id: string | null;
    target_type: string;
    target_id: string;
    changed_fields: string[];
  }>(
    `SELECT actor_user_id, organization_id, target_type, target_id, changed_fields FROM audit_events
     WHERE action = $1 AND ($2::uuid IS NULL OR actor_user_id = $2) AND ($3::uuid IS NULL OR organization_id = $3)
     ORDER BY created_at, id`,
    [where.action, where.actor ?? null, where.organizationId ?? null],
  );
  return rows;
}

describe('khu /v1/admin/* — ai được vào', () => {
  it('mọi route dưới /v1/admin mang @RequirePlatformAdmin(), không @Public() hay @RequirePermission', () => {
    const adminRoutes = discoverRoutes(h.app).filter((r) => ADMIN_ROUTE.test(r.path));
    expect(adminRoutes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      expect.arrayContaining([
        'GET /v1/admin/organizations',
        'POST /v1/admin/organizations/:id/closed-beta/approve',
        'POST /v1/admin/organizations/:id/closed-beta/revoke',
      ]),
    );
    const misconfigured = adminRoutes
      .filter((r) => !r.platformAdmin || r.isPublic || r.permission !== undefined)
      .map((r) => `${r.method} ${r.path} (${r.handler})`);
    expect(misconfigured).toEqual([]);
  });

  it('chưa đăng nhập → 401 UNAUTHENTICATED', async () => {
    expectError(await h.http.get('/v1/admin/organizations?closedBeta=pending'), 401, 'UNAUTHENTICATED');
    expectError(await h.http.post(`/v1/admin/organizations/${randomUUID()}/closed-beta/approve`), 401, 'UNAUTHENTICATED');
  });

  it('tài khoản thường (kể cả Owner, kể cả đã bật 2FA) → 403 FORBIDDEN_ROLE ở mọi route, không đổi gì', async () => {
    const orgId = await createOrg();
    const withTotp = await signUpWithTotp(h);
    for (const cookie of [owner.cookie, withTotp.cookie]) {
      expectError(await queue(cookie, 'pending'), 403, 'FORBIDDEN_ROLE');
      expectError(await approve(orgId, cookie), 403, 'FORBIDDEN_ROLE');
      expectError(await revoke(orgId, cookie), 403, 'FORBIDDEN_ROLE');
    }
    expect(await statusOf(orgId)).toBe('pending');
    expect(await auditRows({ action: 'platform_admin.read', actor: owner.userId })).toEqual([]);
  });

  it('có cờ nhưng chưa bật 2FA → 403 TWO_FACTOR_NOT_ENABLED', async () => {
    const flagged = await signUp(h);
    await setPlatformAdminFlag(flagged.userId, true);
    expectError(await queue(flagged.cookie, 'pending'), 403, 'TWO_FACTOR_NOT_ENABLED');
    expectError(await approve(await createOrg(), flagged.cookie), 403, 'TWO_FACTOR_NOT_ENABLED');
  });

  it('có cờ, đã bật 2FA, session mới chưa qua lớp hai → TOTP_REQUIRED; step-up xong thì vào được', async () => {
    const fresh = await signIn(h, admin.email);
    const res = await queue(fresh, 'pending');
    expectError(res, 403, 'TOTP_REQUIRED');
    expect(errorOf(res).details).toEqual({ reason: 'step_up' });

    await h.http.post('/v1/identity/totp/step-up').set('cookie', fresh).send({ code: totpCode(admin.manualKey) }).expect(200);
    await queue(fresh, 'pending').expect(200);
  });

  it('bị thu cờ giữa phiên → request kế tiếp FORBIDDEN_ROLE (đọc cờ mới từ DB, không qua session)', async () => {
    const other = await signUpPlatformAdmin(h);
    await queue(other.cookie, 'pending').expect(200);
    await setPlatformAdminFlag(other.userId, false);
    expectError(await queue(other.cookie, 'pending'), 403, 'FORBIDDEN_ROLE');
    await setPlatformAdminFlag(other.userId, true);
    await queue(other.cookie, 'pending').expect(200);
  });

  it('guard tự kiểm step-up: session cũ chưa thấy 2FA mà DB đã bật → TOTP_REQUIRED', async () => {
    @Controller('khong-dang-ky')
    class AdminOnly {
      @Get()
      @RequirePlatformAdmin()
      get(): void {}
    }
    const guard = new PlatformAdminGuard(new Reflector(), h.app.get<Database>(DATABASE));
    const req = {
      session: { user: { id: admin.userId, twoFactorEnabled: false }, session: { stepUpAt: null } },
    } as unknown as Record<string, unknown>;
    const context = {
      getType: () => 'http',
      getHandler: () => AdminOnly.prototype.get,
      getClass: () => AdminOnly,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'TOTP_REQUIRED' });
    expect(req.platformAdminContext).toBeUndefined();

    (req.session as { session: { stepUpAt: Date | null } }).session.stepUpAt = new Date();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.platformAdminContext).toMatchObject({ userId: admin.userId });
  });
});

describe('GET /v1/admin/organizations — hàng duyệt', () => {
  it('BTC mới ở tab Chờ duyệt kèm email Owner và kênh liên hệ; không ở hai tab kia', async () => {
    const orgId = await createOrg('Giải Chạy Bộ Sáng', { contactPhone: '0901 234 567', contactEmail: 'LH@Vidu.VN' });
    const row = (await listTab('pending')).find((o) => o.id === orgId);
    expect(row).toEqual({
      id: orgId,
      name: 'Giải Chạy Bộ Sáng',
      ownerEmail: owner.email,
      contactPhone: '0901234567',
      contactEmail: 'lh@vidu.vn',
      closedBetaStatus: 'pending',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect((await listTab('approved')).some((o) => o.id === orgId)).toBe(false);
    expect((await listTab('revoked')).some((o) => o.id === orgId)).toBe(false);
  });

  it('BTC tạo trước đứng trước', async () => {
    const first = await createOrg('BTC trước');
    const second = await createOrg('BTC sau');
    const ids = (await listTab('pending')).map((o) => o.id);
    expect(ids.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
  });

  it('mỗi request đọc ghi đúng một dòng audit platform_admin.read (không thuộc BTC, không có PII)', async () => {
    const reader = await signUpPlatformAdmin(h);
    await listTab('pending', reader.cookie);
    await listTab('revoked', reader.cookie);
    const rows = await auditRows({ action: 'platform_admin.read', actor: reader.userId });
    expect(rows).toEqual([
      { actor_user_id: reader.userId, organization_id: null, target_type: 'closed_beta_queue', target_id: 'pending', changed_fields: [] },
      { actor_user_id: reader.userId, organization_id: null, target_type: 'closed_beta_queue', target_id: 'revoked', changed_fields: [] },
    ]);
  });

  it('query thiếu hoặc sai → 400 VALIDATION_FAILED, không audit', async () => {
    const reader = await signUpPlatformAdmin(h);
    expectError(await queue(reader.cookie, undefined), 400, 'VALIDATION_FAILED');
    expectError(await queue(reader.cookie, 'all'), 400, 'VALIDATION_FAILED');
    expect(await auditRows({ action: 'platform_admin.read', actor: reader.userId })).toEqual([]);
  });
});

describe('duyệt và thu hồi', () => {
  it('Duyệt: 204, sang tab Đã duyệt, audit đúng một dòng; bấm lại → 204 không audit thêm', async () => {
    const orgId = await createOrg();
    await approve(orgId).expect(204);
    expect(await statusOf(orgId)).toBe('approved');
    expect((await listTab('approved')).some((o) => o.id === orgId)).toBe(true);
    expect((await listTab('pending')).some((o) => o.id === orgId)).toBe(false);

    const expected = [
      {
        actor_user_id: admin.userId,
        organization_id: orgId,
        target_type: 'organization',
        target_id: orgId,
        changed_fields: ['closed_beta_status'],
      },
    ];
    expect(await auditRows({ action: 'organization.closed_beta_approved', organizationId: orgId })).toEqual(expected);
    await approve(orgId).expect(204);
    expect(await auditRows({ action: 'organization.closed_beta_approved', organizationId: orgId })).toEqual(expected);
  });

  it('Thu hồi BTC đang chờ → 409 CLOSED_BETA_TRANSITION_INVALID (kèm trạng thái hiện tại), không đổi gì', async () => {
    const orgId = await createOrg();
    const res = await revoke(orgId);
    expectError(res, 409, 'CLOSED_BETA_TRANSITION_INVALID');
    expect(errorOf(res).details).toEqual({ closedBetaStatus: 'pending' });
    expect(await statusOf(orgId)).toBe('pending');
    expect(await auditRows({ action: 'organization.closed_beta_revoked', organizationId: orgId })).toEqual([]);
  });

  it('Thu hồi BTC đã duyệt → 204 + audit; bấm lại → 204; Duyệt lại BTC bị thu hồi → 204', async () => {
    const orgId = await createOrg();
    await approve(orgId).expect(204);
    await revoke(orgId).expect(204);
    expect(await statusOf(orgId)).toBe('revoked');
    expect((await listTab('revoked')).some((o) => o.id === orgId)).toBe(true);
    await revoke(orgId).expect(204);
    expect(await auditRows({ action: 'organization.closed_beta_revoked', organizationId: orgId })).toEqual([
      {
        actor_user_id: admin.userId,
        organization_id: orgId,
        target_type: 'organization',
        target_id: orgId,
        changed_fields: ['closed_beta_status'],
      },
    ]);

    await approve(orgId).expect(204);
    expect(await statusOf(orgId)).toBe('approved');
    expect(await auditRows({ action: 'organization.closed_beta_approved', organizationId: orgId })).toHaveLength(2);
  });

  it('id lạ hoặc sai dạng → 404', async () => {
    expectError(await approve(randomUUID()), 404, 'NOT_FOUND');
    expectError(await revoke(randomUUID()), 404, 'NOT_FOUND');
    expectError(await approve('khong-phai-uuid'), 404, 'NOT_FOUND');
  });

  it('nhiều Quản trị Tingee bấm Duyệt cùng lúc → đều 204, đúng một dòng audit', async () => {
    const second = await signUpPlatformAdmin(h);
    for (let round = 0; round < 3; round++) {
      const orgId = await createOrg(`BTC đua ${round}`);
      const results = await Promise.all([
        approve(orgId, admin.cookie),
        approve(orgId, second.cookie),
        approve(orgId, admin.cookie),
        approve(orgId, second.cookie),
      ]);
      expect(results.map((r) => r.status)).toEqual([204, 204, 204, 204]);
      expect(await auditRows({ action: 'organization.closed_beta_approved', organizationId: orgId })).toHaveLength(1);
    }
  });
});

describe('cờ platform_admin chỉ đổi được bằng role migrate', () => {
  it('tickee_app không UPDATE được users.platform_admin (kể cả sau khi chạy lại migrate); các cột khác vẫn ghi được', async () => {
    await runMigrations({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() });
    const user = await signUp(h);
    await expect(
      h.db.pool.query('UPDATE users SET platform_admin = true WHERE id = $1', [user.userId]),
    ).rejects.toSatisfy((err) => pgCode(err) === '42501');
    await expect(
      h.db.pool.query('UPDATE users SET name = $2, platform_admin = true WHERE id = $1', [user.userId, 'x']),
    ).rejects.toSatisfy((err) => pgCode(err) === '42501');
    // Better Auth và identity ghi các cột này (đổi tên khi nối Google, bật/tắt 2FA, đồng ý NĐ 13).
    const ok = await h.db.pool.query(
      'UPDATE users SET name = $2, two_factor_enabled = false, consented_at = now(), updated_at = now() WHERE id = $1',
      [user.userId, 'Tên mới'],
    );
    expect(ok.rowCount).toBe(1);
    const { rows } = await h.db.pool.query<{ platform_admin: boolean }>('SELECT platform_admin FROM users WHERE id = $1', [
      user.userId,
    ]);
    expect(rows[0]?.platform_admin).toBe(false);
  });

  it('luồng Better Auth sau khi giới hạn cột: đăng ký, đồng ý NĐ 13, bật 2FA vẫn chạy', async () => {
    const user = await signUpWithTotp(h);
    const me = await h.http.get('/v1/identity/me').set('cookie', user.cookie).expect(200);
    expect(me.body).toMatchObject({ id: user.userId, twoFactorEnabled: true, consentedAt: expect.any(String) });
  });

  it('Better Auth không nhận cờ từ input (trường không khai báo), kể cả gọi `updateUser` phía server', async () => {
    const user = await signUp(h);
    const auth = h.app.get<AuthService<Auth>>(AuthService);
    // HTTP `/v1/auth/update-user` đã bị cổng chặn; gọi thẳng API server. Lệnh phải thành công (tên đổi): nếu Better Auth
    // gửi cả cờ xuống DB thì grant theo cột làm cả lệnh lỗi 42501 và test hỏng ở đây.
    await auth.api.updateUser({
      body: { name: 'Tên mới', platformAdmin: true } as { name: string },
      headers: fromNodeHeaders({ cookie: user.cookie }),
    });
    const { rows } = await h.db.pool.query<{ name: string; platform_admin: boolean }>(
      'SELECT name, platform_admin FROM users WHERE id = $1',
      [user.userId],
    );
    expect(rows[0]).toEqual({ name: 'Tên mới', platform_admin: false });
  });
});
