import { createHash, randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ErrorResponse, Permission, REAUTH_HEADER } from '@tickee/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermission } from '../../src/platform/access/index.js';
import { createHarness, reauthToken, signUp, type Harness } from '../identity/harness.js';
import { listen, openSse } from '../platform/sse-client.js';
import { discoverRoutes, ORG_ROUTE, type DiscoveredRoute } from './routes.js';
import { EventsTestController, OwnerOnlyTestController } from './test-controllers.js';

/*
 * Bộ test cách ly (AD-27): tự tìm mọi route có `@RequirePermission` rồi gọi chéo BTC bằng cookie Owner BTC A trên
 * id BTC B. Route của story sau tự rơi vào đây mà không phải sửa test.
 */

/**
 * Route SSE (quy ước đường `…/live`, AD-17): trên chính BTC của người gọi, route mở được mà không cần id nào khác (vd.
 * stream cấp BTC, Story 4.2-b) sống mãi, supertest chờ hết body sẽ treo. Test đối chứng bỏ qua mọi route `…/live`; ca riêng
 * mở bằng client SSE thật rồi đóng. Gọi chéo BTC vẫn chạy ở cả hai (guard trả 403 JSON trước khi mở stream).
 */
const isStreamRoute = (route: DiscoveredRoute) => route.method === 'GET' && route.path.endsWith('/live');

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
    // Story 2.14: chuyển quyền Owner.
    expect(guarded).toContain('POST /v1/orgs/:orgId/members/:memberId/ownership-transfer');
    // Story 2.5: thông báo trạng thái của `reporting`.
    expect(guarded).toContain('GET /v1/orgs/:orgId/notices');
    // Story 2.6: tài khoản nhận tiền (chỉ Owner).
    expect(guarded).toContain('GET /v1/orgs/:orgId/payout-account');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/credential');
    expect(guarded).toContain('GET /v1/orgs/:orgId/payout-account/options');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account');
    expect(guarded).toContain('DELETE /v1/orgs/:orgId/payout-account/:accountId');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/:accountId/default');
    // Story 2.13-b: đổi key Tingee.
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/credential/replacement/begin');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/credential/replacement/preview');
    expect(guarded).toContain('POST /v1/orgs/:orgId/payout-account/credential/replacement');
    // Story 4.2-a: "Kiểm tra lại" dịch vụ thanh toán (chỉ Owner).
    expect(guarded).toContain('POST /v1/orgs/:orgId/payment-service/check');
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
    // Story 2.9: form mua vé.
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/form');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/form/questions');
    expect(guarded).toContain('PATCH /v1/orgs/:orgId/events/:eventId/form/questions/:questionId');
    expect(guarded).toContain('DELETE /v1/orgs/:orgId/events/:eventId/form/questions/:questionId');
    expect(guarded).toContain('PUT /v1/orgs/:orgId/events/:eventId/form/order');
    // Story 2.10: điều kiện mở bán và mở bán.
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/publish-readiness');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/publish');
    // Story 2.12: Ẩn, Hiện lại, Kết thúc sớm.
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/hide');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/unhide');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/end');
    // Story 3.10: PATCH Sự kiện chuyển sang flows (cùng đường dẫn) và số Người mua.
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/buyer-count');
    // E3-2: số Đơn đang chờ thanh toán trước `Dialog` "Kết thúc" (flows, `events.manage`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/pending-payment-count');
    // Story 3.11: Tổng quan Sự kiện của `reporting` (REST và SSE, `orders.view`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/overview');
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/overview/live');
    // Story 4.2-b: stream cấp BTC của `reporting` (Owner và Admin, như `notices`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/live');
    const permissionOf = (path: string) => routes.find((r) => r.method === 'GET' && r.path === path)?.permission;
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/overview')).toBe(Permission.ORDERS_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/overview/live')).toBe(Permission.ORDERS_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/pending-payment-count')).toBe(Permission.EVENTS_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/live')).toBe(Permission.ORG_READ);
    expect(permissionOf('/v1/orgs/:orgId/notices')).toBe(Permission.ORG_READ);
    expect(routes.find((r) => r.method === 'POST' && r.path === '/v1/orgs/:orgId/payment-service/check')?.permission).toBe(
      Permission.PAYOUT_ACCOUNT_MANAGE,
    );
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
    for (const route of routes.filter((r) => r.permission && !isStreamRoute(r))) {
      const res = await call(route, orgA, ownerA.cookie);
      // Body `{}` và id ngẫu nhiên ra 4xx (400/404…), không bao giờ 500.
      expect(res.status, label(route)).toBeLessThan(500);
      const code = res.status === 403 ? ErrorResponse.parse(res.body).error.code : null;
      expect(code, label(route)).not.toBe('NOT_A_MEMBER');
    }
  });

  it('đối chứng route SSE (`…/live`): trên BTC A mở được stream hoặc trả 4xx JSON, không NOT_A_MEMBER; trên BTC B → 403 NOT_A_MEMBER', async () => {
    const streams = routes.filter((r) => r.permission && isStreamRoute(r));
    expect(streams.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /v1/orgs/:orgId/live', 'GET /v1/orgs/:orgId/events/:eventId/overview/live']),
    );
    const http = await listen(h.app);
    try {
      for (const route of streams) {
        const own = await openSse(http.baseUrl, fill(route.path, orgA), { cookie: ownerA.cookie });
        if (own.status === 200) {
          own.close();
          expect(own.headers['content-type'], label(route)).toBe('text/event-stream; charset=utf-8');
        } else {
          // Id ngẫu nhiên (vd. Sự kiện) → 4xx JSON trước khi mở stream.
          await own.ended;
          expect(own.status, label(route)).toBeLessThan(500);
          expect(ErrorResponse.parse(JSON.parse(own.text())).error.code, label(route)).not.toBe('NOT_A_MEMBER');
        }
        // Stream cấp BTC không cần id nào khác: luôn mở được trên BTC của mình.
        if (route.path === '/v1/orgs/:orgId/live') expect(own.status, label(route)).toBe(200);
        const cross = await openSse(http.baseUrl, fill(route.path, orgB), { cookie: ownerA.cookie });
        await cross.ended;
        expect(cross.status, label(route)).toBe(403);
        expect(ErrorResponse.parse(JSON.parse(cross.text())).error.code, label(route)).toBe('NOT_A_MEMBER');
      }
    } finally {
      await http.close();
    }
  });

  it('route đòi xác nhận lại (Story 2.13-a, 2.13-b, 2.14): lần xác nhận hợp lệ của Owner A không mở được BTC B, và không bị tiêu', async () => {
    // Mã lỗi trên chính BTC A khi thiếu header (sau kiểm quyền, không bao giờ NOT_A_MEMBER): id ngẫu nhiên →
    // REAUTH_REQUIRED; đổi key trên BTC chưa từng liên kết → 409 (bước 1) hoặc body `{}` → 400 (bước 2, 3).
    const reauthRoutes: Record<string, string> = {
      'DELETE /v1/orgs/:orgId/payout-account/:accountId': 'REAUTH_REQUIRED',
      'POST /v1/orgs/:orgId/payout-account/:accountId/default': 'REAUTH_REQUIRED',
      'POST /v1/orgs/:orgId/payout-account/credential/replacement/begin': 'PAYOUT_ACCOUNT_NOT_LINKED_YET',
      'POST /v1/orgs/:orgId/payout-account/credential/replacement/preview': 'VALIDATION_FAILED',
      'POST /v1/orgs/:orgId/payout-account/credential/replacement': 'VALIDATION_FAILED',
      'POST /v1/orgs/:orgId/members/:memberId/ownership-transfer': 'REAUTH_REQUIRED',
    };
    const guarded = routes.filter((r) => r.permission && `${r.method} ${r.path}` in reauthRoutes);
    expect(guarded).toHaveLength(Object.keys(reauthRoutes).length);
    const token = await reauthToken(h, ownerA);
    for (const route of guarded) {
      const res = await call(route, orgB, ownerA.cookie).set(REAUTH_HEADER, token);
      expect(res.status, label(route)).toBe(403);
      expect(ErrorResponse.parse(res.body).error.code, label(route)).toBe('NOT_A_MEMBER');
      const own = await call(route, orgA, ownerA.cookie);
      expect(ErrorResponse.parse(own.body).error.code, label(route)).toBe(reauthRoutes[`${route.method} ${route.path}`]);
    }
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const { rows } = await h.db.pool.query('SELECT used_at FROM reauth_grants WHERE token_hash = $1', [hash]);
    expect(rows).toEqual([{ used_at: null }]);
  });

  it('route Sự kiện trên BTC A: body {} → 400, id ngẫu nhiên → 404 EVENT_NOT_FOUND', async () => {
    const eventRoutes = routes.filter((r) => r.permission && r.path.startsWith('/v1/orgs/:orgId/events'));
    expect(eventRoutes).toHaveLength(23);
    for (const route of eventRoutes) {
      const res = await call(route, orgA, ownerA.cookie);
      // Body được kiểm trước khi chạm DB; danh sách Sự kiện của BTC trả 200; còn lại Sự kiện ngẫu nhiên → 404.
      // Mở bán, Ẩn, Hiện lại, Kết thúc không có body nên cũng ra 404.
      const hasBody =
        (route.method === 'POST' || route.method === 'PATCH' || route.method === 'PUT') &&
        !/\/events\/:eventId\/(publish|hide|unhide|end)$/.test(route.path);
      const expected = hasBody ? 400 : route.path === '/v1/orgs/:orgId/events' ? 200 : 404;
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
