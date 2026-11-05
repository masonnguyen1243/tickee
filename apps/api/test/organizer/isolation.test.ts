import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ErrorResponse, Permission } from '@tickee/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermission } from '../../src/platform/access/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { discoverRoutes, ORG_ROUTE, type DiscoveredRoute } from './routes.js';
import { EventsTestController, OwnerOnlyTestController } from './test-controllers.js';

/*
 * Bộ test cách ly (AD-27): tự tìm mọi route có `@RequirePermission` rồi gọi chéo BTC bằng cookie Owner BTC A trên
 * id BTC B. Route của story sau tự rơi vào đây mà không phải sửa test.
 */

let h: Harness;
let routes: DiscoveredRoute[];
let ownerA: Awaited<ReturnType<typeof signUp>>;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  h = await createHarness({}, { imports: [DiscoveryModule], controllers: [OwnerOnlyTestController, EventsTestController] });
  routes = discoverRoutes(h.app);
  ownerA = await signUp(h);
  const ownerB = await signUp(h);
  orgA = (await h.http.post('/v1/orgs').set('cookie', ownerA.cookie).send({ name: 'BTC A' }).expect(201)).body.id;
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body.id;
});
afterAll(async () => {
  await h.close();
});

const fill = (path: string, orgId: string) =>
  path.replace(/:orgId\b/g, orgId).replace(/:[A-Za-z0-9_]+/g, () => randomUUID());

function call(route: DiscoveredRoute, orgId: string, cookie: string) {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const req = h.http[method](fill(route.path, orgId)).set('cookie', cookie);
  return method === 'get' || method === 'delete' ? req : req.send({});
}

const label = (r: DiscoveredRoute) => `${r.method} ${r.path} (${r.handler})`;

describe('cách ly BTC', () => {
  it('duyệt được route BTC thật và route test', () => {
    const guarded = routes.filter((r) => r.permission).map((r) => `${r.method} ${r.path}`);
    expect(guarded).toContain('GET /v1/orgs/:orgId');
    // Story 2.4: route thành viên tự rơi vào bộ cách ly.
    expect(guarded).toContain('GET /v1/orgs/:orgId/members');
    expect(guarded).toContain('POST /v1/orgs/:orgId/invitations');
    expect(guarded).toContain('DELETE /v1/orgs/:orgId/invitations/:invitationId');
    expect(guarded).toContain('DELETE /v1/orgs/:orgId/members/:memberId');
    // Story 2.5: thông báo trạng thái của `reporting`.
    expect(guarded).toContain('GET /v1/orgs/:orgId/notices');
    // Story 2.6: tài khoản nhận tiền (chỉ Owner).
    expect(guarded).toContain('GET /v1/orgs/:orgId/payout-account');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/credential');
    expect(guarded).toContain('GET /v1/orgs/:orgId/payout-account/options');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account');
    expect(guarded).toContain('DELETE /v1/orgs/:orgId/payout-account/:accountId');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/:accountId/default');
    // Story 2.7: Sự kiện (Owner và Admin).
    expect(guarded).toContain('POST /v1/orgs/:orgId/events');
    expect(guarded).toContain('GET /v1/orgs/:orgId/events');
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId');
    expect(guarded).toContain('PATCH /v1/orgs/:orgId/events/:eventId');
    // Story 2.8: Hạng vé (flows) và giới hạn Vé/Đơn.
    expect(guarded).toContain('PATCH /v1/orgs/:orgId/events/:eventId/order-limit');
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/ticket-types');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/ticket-types');
    expect(guarded).toContain('PATCH /v1/orgs/:orgId/events/:eventId/ticket-types/:ticketTypeId');
    expect(guarded).toContain('DELETE /v1/orgs/:orgId/events/:eventId/ticket-types/:ticketTypeId');
    expect(guarded).toContain('GET /v1/orgs/:orgId/test-owner-only');
    expect(guarded).toContain('POST /v1/orgs/:orgId/test-owner-only/items/:itemId');
  });

  it('mọi route dưới /v1/orgs/:orgId đều mang @RequirePermission', () => {
    const missing = routes.filter((r) => ORG_ROUTE.test(r.path) && !r.permission).map(label);
    expect(missing).toEqual([]);
  });

  it('Owner BTC A gọi mọi route @RequirePermission trên BTC B → 403 NOT_A_MEMBER', async () => {
    const guarded = routes.filter((r) => r.permission);
    expect(guarded.length).toBeGreaterThan(0);
    for (const route of guarded) {
      const res = await call(route, orgB, ownerA.cookie);
      expect(res.status, label(route)).toBe(403);
      expect(ErrorResponse.parse(res.body).error.code, label(route)).toBe('NOT_A_MEMBER');
    }
  });

  it('đối chứng: cùng route trên BTC A không trả NOT_A_MEMBER', async () => {
    for (const route of routes.filter((r) => r.permission)) {
      const res = await call(route, orgA, ownerA.cookie);
      // Body `{}` và id ngẫu nhiên ra 4xx (400/404…), không bao giờ 500.
      expect(res.status, label(route)).toBeLessThan(500);
      const code = res.status === 403 ? ErrorResponse.parse(res.body).error.code : null;
      expect(code, label(route)).not.toBe('NOT_A_MEMBER');
    }
  });

  it('route Sự kiện trên BTC A: body {} → 400, id ngẫu nhiên → 404 EVENT_NOT_FOUND', async () => {
    const eventRoutes = routes.filter((r) => r.permission && r.path.startsWith('/v1/orgs/:orgId/events'));
    expect(eventRoutes).toHaveLength(9);
    for (const route of eventRoutes) {
      const res = await call(route, orgA, ownerA.cookie);
      // Body được kiểm trước khi chạm DB; danh sách Sự kiện của BTC trả 200; còn lại Sự kiện ngẫu nhiên → 404.
      const expected =
        route.method === 'POST' || route.method === 'PATCH' ? 400 : route.path === '/v1/orgs/:orgId/events' ? 200 : 404;
      expect(res.status, label(route)).toBe(expected);
      if (expected === 404) expect(ErrorResponse.parse(res.body).error.code, label(route)).toBe('EVENT_NOT_FOUND');
    }
  });
});

@Controller('orgs/:orgId/quen-decorator')
class MissingDecoratorController {
  @Get()
  get(): string {
    return 'lộ dữ liệu';
  }

  @Get('ok')
  @RequirePermission(Permission.ORG_READ)
  ok(): string {
    return 'ok';
  }
}

describe('bộ kiểm route tự phát hiện route BTC thiếu decorator', () => {
  it('route dưới /v1/orgs/:orgId thiếu @RequirePermission bị báo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [MissingDecoratorController],
    }).compile();
    try {
      const missing = discoverRoutes(moduleRef).filter((r) => ORG_ROUTE.test(r.path) && !r.permission);
      expect(missing.map((r) => r.path)).toEqual(['/v1/orgs/:orgId/quen-decorator']);
    } finally {
      await moduleRef.close();
    }
  });
});
