import { createHash, randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ErrorResponse, IDEMPOTENCY_KEY_HEADER, Permission, REAUTH_HEADER, REVIEW_ACTIONS } from '@tickee/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermission } from '../../src/platform/access/index.js';
import { Public } from '../../src/platform/http/index.js';
import { createHarness, reauthToken, signUp, type Harness } from '../identity/harness.js';
import { listen, openSse } from '../platform/sse-client.js';
import {
  CHECKIN_EVENT_ROUTE,
  discoverRoutes,
  ORG_ROUTE,
  PERMISSION_ROUTE_PREFIXES,
  type DiscoveredRoute,
} from './routes.js';
import { EventsTestController, OwnerOnlyTestController } from './test-controllers.js';

/*
 * Bộ test cách ly (AD-27): tự tìm mọi route có `@RequirePermission` rồi gọi chéo BTC bằng cookie Owner BTC A trên
 * id BTC B. Route BTC (`/v1/orgs/:orgId/…`) thay `:orgId`; route CTV (`/v1/checkin/events/:eventId/…`, Story 5.2) thay
 * `:eventId` bằng Sự kiện của BTC B. Route của story sau tự rơi vào đây mà không phải sửa test.
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
let eventA: string;
let eventB: string;

const draft = {
  name: 'Sự kiện kiểm cách ly',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Không hoàn vé.',
};

beforeAll(async () => {
  h = await createHarness({}, { imports: [DiscoveryModule], controllers: [OwnerOnlyTestController, EventsTestController] });
  routes = discoverRoutes(h.app);
  ownerA = await signUp(h);
  const ownerB = await signUp(h);
  orgA = (await h.http.post('/v1/orgs').set('cookie', ownerA.cookie).send({ name: 'BTC A' }).expect(201)).body.id;
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body.id;
  eventA = (await h.http.post(`/v1/orgs/${orgA}/events`).set('cookie', ownerA.cookie).send(draft).expect(201)).body.id;
  eventB = (await h.http.post(`/v1/orgs/${orgB}/events`).set('cookie', ownerB.cookie).send(draft).expect(201)).body.id;
});
afterAll(async () => {
  await h.close();
});

const fill = (path: string, orgId: string) =>
  path.replace(/:orgId\b/g, orgId).replace(/:[A-Za-z0-9_]+/g, () => randomUUID());

/** Route CTV: `:eventId` là Sự kiện cho trước, tham số khác ngẫu nhiên. */
const fillEvent = (path: string, eventId: string) =>
  path.replace(/:eventId\b/g, eventId).replace(/:[A-Za-z0-9_]+/g, () => randomUUID());

function request(route: DiscoveredRoute, path: string, cookie: string) {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const req = h.http[method](path).set('cookie', cookie);
  return method === 'get' || method === 'delete' ? req : req.send({});
}

const call = (route: DiscoveredRoute, orgId: string, cookie: string) => request(route, fill(route.path, orgId), cookie);

/** Route BTC có `@RequirePermission` (phần thay `:orgId`). */
const orgRoutes = () => routes.filter((r) => r.permission && ORG_ROUTE.test(r.path));

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
    // Story 6.1: tab Đơn của `reporting` (danh sách và chi tiết, `orders.view`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/orders');
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/orders/:code');
    // Story 4.2-b: stream cấp BTC của `reporting` (Owner và Admin, như `notices`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/live');
    // Story 4.2-c: trạng thái bán trên dashboard của `ordering` (ngoài tiền tố `…/events/`, như danh sách Sự kiện).
    expect(guarded).toContain('GET /v1/orgs/:orgId/event-sale-status');
    // Story 4.8-a: presign ảnh Sự kiện của `event` (Owner và Admin; theo BTC nên ngoài tiền tố `…/events`).
    expect(guarded).toContain('POST /v1/orgs/:orgId/event-images');
    // Story 4.3: hàng Cần xử lý của `reporting` (Owner và Admin, `review_queue.handle`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/review-items');
    expect(guarded).toContain('GET /v1/orgs/:orgId/review-items/summary');
    expect(guarded).toContain('GET /v1/orgs/:orgId/review-items/:itemId');
    // Story 4.4-a, 4.4-b: thao tác trên mục của `payment` (Owner và Admin, `review_queue.handle`), kể cả "Ghép với Đơn".
    for (const action of REVIEW_ACTIONS) expect(guarded).toContain(`POST /v1/orgs/:orgId/review-items/:itemId/${action}`);
    expect(guarded).toContain('POST /v1/orgs/:orgId/review-items/:itemId/match');
    // Story 4.4-b: Đơn ứng viên của "Ghép với Đơn" (`reporting`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/review-items/:itemId/match-candidates');
    // Story 4.5-a: trang Token của `organizer` (Owner và Admin, `token.view`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/token');
    // Story 4.5-b: ngưỡng cảnh báo Token (chỉ Owner, `token_alert.manage`).
    expect(guarded).toContain('PUT /v1/orgs/:orgId/token/alert-threshold');
    // Story 5.1: link mời CTV của `checkin` (Owner và Admin, `checkers.manage`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/checker-invite');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/checker-invite');
    // Story 5.6: danh sách CTV (flows), thu hồi và khôi phục CTV (`checkin`; Owner và Admin, `checkers.manage`).
    expect(guarded).toContain('GET /v1/orgs/:orgId/events/:eventId/checkers');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/checkers/:checkerId/revoke');
    expect(guarded).toContain('POST /v1/orgs/:orgId/events/:eventId/checkers/:checkerId/restore');
    const permissionOf = (path: string, method = 'GET') =>
      routes.find((r) => r.method === method && r.path === path)?.permission;
    for (const path of ['', '/summary', '/:itemId', '/:itemId/match-candidates']) {
      expect(permissionOf(`/v1/orgs/:orgId/review-items${path}`), path).toBe(Permission.REVIEW_QUEUE_HANDLE);
    }
    for (const action of REVIEW_ACTIONS) {
      expect(permissionOf(`/v1/orgs/:orgId/review-items/:itemId/${action}`, 'POST'), action).toBe(
        Permission.REVIEW_QUEUE_HANDLE,
      );
    }
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/overview')).toBe(Permission.ORDERS_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/overview/live')).toBe(Permission.ORDERS_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/orders')).toBe(Permission.ORDERS_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/orders/:code')).toBe(Permission.ORDERS_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/pending-payment-count')).toBe(Permission.EVENTS_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/live')).toBe(Permission.ORG_READ);
    expect(permissionOf('/v1/orgs/:orgId/notices')).toBe(Permission.ORG_READ);
    expect(permissionOf('/v1/orgs/:orgId/event-sale-status')).toBe(Permission.EVENTS_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/event-images', 'POST')).toBe(Permission.EVENTS_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/token')).toBe(Permission.TOKEN_VIEW);
    expect(permissionOf('/v1/orgs/:orgId/token/alert-threshold', 'PUT')).toBe(Permission.TOKEN_ALERT_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/checker-invite')).toBe(Permission.CHECKERS_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/checker-invite', 'POST')).toBe(Permission.CHECKERS_MANAGE);
    expect(permissionOf('/v1/orgs/:orgId/events/:eventId/checkers')).toBe(Permission.CHECKERS_MANAGE);
    for (const action of ['revoke', 'restore']) {
      expect(permissionOf(`/v1/orgs/:orgId/events/:eventId/checkers/:checkerId/${action}`, 'POST'), action).toBe(
        Permission.CHECKERS_MANAGE,
      );
    }
    expect(routes.find((r) => r.method === 'POST' && r.path === '/v1/orgs/:orgId/payment-service/check')?.permission).toBe(
      Permission.PAYOUT_ACCOUNT_MANAGE,
    );
    expect(guarded).toContain('GET /v1/orgs/:orgId/test-owner-only');
    expect(guarded).toContain('POST /v1/orgs/:orgId/test-owner-only/items/:itemId');
    // Story 5.2: route CTV của `checkin` (Owner, Admin và CTV `active`, `checkin.scan`).
    expect(guarded).toContain('GET /v1/checkin/events/:eventId');
    expect(permissionOf('/v1/checkin/events/:eventId')).toBe(Permission.CHECKIN_SCAN);
    // Story 5.3: quét Mã QR vé (flows; Owner, Admin và CTV `active`, `checkin.scan`).
    expect(guarded).toContain('POST /v1/checkin/events/:eventId/scans');
    expect(permissionOf('/v1/checkin/events/:eventId/scans', 'POST')).toBe(Permission.CHECKIN_SCAN);
    // Story 5.5: tra tay và check-in tay (flows; Owner, Admin và CTV `active`, `checkin.lookup`).
    expect(guarded).toContain('POST /v1/checkin/events/:eventId/lookups');
    expect(permissionOf('/v1/checkin/events/:eventId/lookups', 'POST')).toBe(Permission.CHECKIN_LOOKUP);
    expect(guarded).toContain('POST /v1/checkin/events/:eventId/tickets/:ticketId/check-in');
    expect(permissionOf('/v1/checkin/events/:eventId/tickets/:ticketId/check-in', 'POST')).toBe(Permission.CHECKIN_LOOKUP);
  });

  it('kho route: không route nào vừa @Public() vừa @RequirePermission; route có quyền chỉ dưới /v1/orgs/:orgId hoặc /v1/checkin/events/:eventId', () => {
    const publicAndGuarded = routes.filter((r) => r.isPublic && r.permission).map(label);
    expect(publicAndGuarded).toEqual([]);
    const outside = routes
      .filter((r) => r.permission && !PERMISSION_ROUTE_PREFIXES.some((prefix) => prefix.test(r.path)))
      .map(label);
    expect(outside).toEqual([]);
  });

  it('mọi route dưới /v1/orgs/:orgId và /v1/checkin/events/:eventId đều mang @RequirePermission', () => {
    const missing = routes
      .filter((r) => (ORG_ROUTE.test(r.path) || CHECKIN_EVENT_ROUTE.test(r.path)) && !r.permission)
      .map(label);
    expect(missing).toEqual([]);
  });

  it('Owner BTC A gọi mọi route BTC @RequirePermission trên BTC B → 403 NOT_A_MEMBER', async () => {
    const guarded = orgRoutes();
    expect(guarded.length).toBeGreaterThan(0);
    for (const route of guarded) {
      const res = await call(route, orgB, ownerA.cookie);
      expect(res.status, label(route)).toBe(403);
      expect(ErrorResponse.parse(res.body).error.code, label(route)).toBe('NOT_A_MEMBER');
    }
  });

  it('đối chứng: cùng route trên BTC A không trả NOT_A_MEMBER', async () => {
    for (const route of orgRoutes().filter((r) => !isStreamRoute(r))) {
      const res = await call(route, orgA, ownerA.cookie);
      // Body `{}` và id ngẫu nhiên ra 4xx (400/404…), không bao giờ 500.
      expect(res.status, label(route)).toBeLessThan(500);
      const code = res.status === 403 ? ErrorResponse.parse(res.body).error.code : null;
      expect(code, label(route)).not.toBe('NOT_A_MEMBER');
    }
  });

  it('đối chứng route SSE (`…/live`): trên BTC A mở được stream hoặc trả 4xx JSON, không NOT_A_MEMBER; trên BTC B → 403 NOT_A_MEMBER', async () => {
    const streams = orgRoutes().filter(isStreamRoute);
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

  it('route Cần xử lý trên BTC A (Story 4.3, 4.4-a, 4.4-b): danh sách và summary → 200; mục id ngẫu nhiên → 404 REVIEW_ITEM_NOT_FOUND; thao tác thiếu Idempotency-Key → 400', async () => {
    const reviewRoutes = routes.filter((r) => r.permission && r.path.startsWith('/v1/orgs/:orgId/review-items'));
    // 3 GET của 4.3, GET Đơn ứng viên của 4.4-b, một POST mỗi thao tác.
    expect(reviewRoutes).toHaveLength(4 + REVIEW_ACTIONS.length);
    /** Body đúng theo thao tác: lý do của "Bỏ qua", mã Đơn của "Ghép với Đơn"; còn lại không đọc body. */
    const bodyOf = (path: string) => (path.endsWith('/match') ? { orderCode: 'TK5R8W1CAB' } : { reason: 'Bỏ qua' });
    for (const route of reviewRoutes) {
      const res = await call(route, orgA, ownerA.cookie);
      if (route.method === 'POST') {
        // Thao tác (Story 4.4): header kiểm trước mục → thiếu khóa 400; có khóa (và body đúng) → mục lạ 404.
        expect(res.status, label(route)).toBe(400);
        expect(ErrorResponse.parse(res.body).error.code, label(route)).toBe('VALIDATION_FAILED');
        const keyed = await h.http
          .post(fill(route.path, orgA))
          .set('cookie', ownerA.cookie)
          .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
          .send(bodyOf(route.path));
        expect(keyed.status, label(route)).toBe(404);
        expect(ErrorResponse.parse(keyed.body).error.code, label(route)).toBe('REVIEW_ITEM_NOT_FOUND');
        // Có khóa vẫn không mở được BTC B.
        const cross = await h.http
          .post(fill(route.path, orgB))
          .set('cookie', ownerA.cookie)
          .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
          .send(bodyOf(route.path));
        expect(cross.status, label(route)).toBe(403);
        expect(ErrorResponse.parse(cross.body).error.code, label(route)).toBe('NOT_A_MEMBER');
        continue;
      }
      // Route theo mục (chi tiết, Đơn ứng viên) với id ngẫu nhiên → 404; danh sách và summary → 200.
      const expected = route.path.includes('/:itemId') ? 404 : 200;
      expect(res.status, label(route)).toBe(expected);
      if (expected === 404) expect(ErrorResponse.parse(res.body).error.code, label(route)).toBe('REVIEW_ITEM_NOT_FOUND');
    }
  });

  it('route CTV (Story 5.2): Owner BTC A trên Sự kiện của BTC B hoặc Sự kiện không có, CTV của Sự kiện khác cùng BTC → 403 NOT_A_MEMBER; CTV bị thu hồi → 403 CHECKER_REVOKED; đối chứng Sự kiện của A không NOT_A_MEMBER', async () => {
    const checkinRoutes = routes.filter((r) => r.permission && CHECKIN_EVENT_ROUTE.test(r.path));
    expect(checkinRoutes.map((r) => `${r.method} ${r.path}`)).toContain('GET /v1/checkin/events/:eventId');
    // CTV `active` của một Sự kiện khác cùng BTC A, và CTV đã bị thu hồi ở `eventA` (dòng `checkers` chèn bằng SQL).
    const otherEventA = (await h.http.post(`/v1/orgs/${orgA}/events`).set('cookie', ownerA.cookie).send(draft).expect(201))
      .body.id as string;
    const ctvOther = await signUp(h);
    const ctvRevoked = await signUp(h);
    await h.db.pool.query(
      `INSERT INTO checkers (organization_id, event_id, user_id, status, revoked_at, revoked_by)
       VALUES ($1, $2, $3, 'active', NULL, NULL), ($1, $4, $5, 'revoked', now(), $6)`,
      [orgA, otherEventA, ctvOther.userId, eventA, ctvRevoked.userId, ownerA.userId],
    );
    for (const route of checkinRoutes) {
      for (const eventId of [eventB, randomUUID(), 'khong-phai-uuid']) {
        const res = await request(route, fillEvent(route.path, eventId), ownerA.cookie);
        expect(res.status, `${label(route)} ${eventId}`).toBe(403);
        expect(ErrorResponse.parse(res.body).error.code, `${label(route)} ${eventId}`).toBe('NOT_A_MEMBER');
        expect(res.text).not.toContain(draft.name);
      }
      for (const [caller, expected] of [
        [ctvOther, 'NOT_A_MEMBER'],
        [ctvRevoked, 'CHECKER_REVOKED'],
      ] as const) {
        const res = await request(route, fillEvent(route.path, eventA), caller.cookie);
        expect(res.status, `${label(route)} ${expected}`).toBe(403);
        expect(ErrorResponse.parse(res.body).error.code, `${label(route)} ${expected}`).toBe(expected);
        expect(res.text).not.toContain(draft.name);
      }
      if (isStreamRoute(route)) continue;
      const own = await request(route, fillEvent(route.path, eventA), ownerA.cookie);
      expect(own.status, label(route)).toBeLessThan(500);
      const code = own.status === 403 ? ErrorResponse.parse(own.body).error.code : null;
      expect(code, label(route)).not.toBe('NOT_A_MEMBER');
    }
  });

  it('check-in tay (Story 5.5): Sự kiện của A thiếu Idempotency-Key → 400; có khóa → 200 invalid (Vé ngẫu nhiên); có khóa vẫn không mở được Sự kiện của B → 403 NOT_A_MEMBER', async () => {
    const path = '/v1/checkin/events/:eventId/tickets/:ticketId/check-in';
    const route = routes.find((r) => r.method === 'POST' && r.path === path);
    expect(route?.permission).toBe(Permission.CHECKIN_LOOKUP);
    const own = await request(route!, fillEvent(path, eventA), ownerA.cookie);
    expect(own.status).toBe(400);
    expect(ErrorResponse.parse(own.body).error.code).toBe('VALIDATION_FAILED');
    const keyed = await h.http
      .post(fillEvent(path, eventA))
      .set('cookie', ownerA.cookie)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID());
    expect(keyed.status, keyed.text).toBe(200);
    expect(keyed.body).toEqual({ outcome: 'invalid', reason: 'BAD_SIGNATURE' });
    const cross = await h.http
      .post(fillEvent(path, eventB))
      .set('cookie', ownerA.cookie)
      .set(IDEMPOTENCY_KEY_HEADER, randomUUID());
    expect(cross.status).toBe(403);
    expect(ErrorResponse.parse(cross.body).error.code).toBe('NOT_A_MEMBER');
    expect(cross.text).not.toContain(draft.name);
  });

  it('route Sự kiện trên BTC A: body {} → 400, id ngẫu nhiên → 404 EVENT_NOT_FOUND', async () => {
    const eventRoutes = routes.filter((r) => r.permission && r.path.startsWith('/v1/orgs/:orgId/events'));
    // Story 5.1: thêm `GET`/`POST …/checker-invite` (25). Story 5.6: danh sách, thu hồi, khôi phục CTV (28). Story 6.1:
    // danh sách và chi tiết Đơn (30).
    expect(eventRoutes).toHaveLength(30);
    for (const route of eventRoutes) {
      const res = await call(route, orgA, ownerA.cookie);
      // Body được kiểm trước khi chạm DB; danh sách Sự kiện của BTC trả 200; còn lại Sự kiện ngẫu nhiên → 404.
      // Mở bán, Ẩn, Hiện lại, Kết thúc, Tạo link mời CTV, thu hồi/khôi phục CTV không có body nên cũng ra 404.
      const hasBody =
        (route.method === 'POST' || route.method === 'PATCH' || route.method === 'PUT') &&
        !/\/events\/:eventId\/(publish|hide|unhide|end|checker-invite|checkers\/:checkerId\/(revoke|restore))$/.test(
          route.path,
        );
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

/** Cấu hình sai mà bộ kiểm kho route phải bắt: công khai mà đòi quyền; đòi quyền ngoài hai tiền tố. */
@Controller('checkin/events/:eventId/cau-hinh-sai')
class MisconfiguredController {
  @Get('cong-khai')
  @Public()
  @RequirePermission(Permission.CHECKIN_SCAN)
  open(): string {
    return 'sai';
  }
}

@Controller('checkin/khong-co-su-kien/:eventId')
class OutsidePrefixController {
  @Get()
  @RequirePermission(Permission.CHECKIN_SCAN)
  get(): string {
    return 'sai';
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

  it('route vừa @Public() vừa @RequirePermission, hoặc đòi quyền ngoài hai tiền tố, bị báo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [MisconfiguredController, OutsidePrefixController],
    }).compile();
    try {
      const found = discoverRoutes(moduleRef);
      expect(found.filter((r) => r.isPublic && r.permission).map((r) => r.path)).toEqual([
        '/v1/checkin/events/:eventId/cau-hinh-sai/cong-khai',
      ]);
      const outside = found.filter((r) => r.permission && !PERMISSION_ROUTE_PREFIXES.some((p) => p.test(r.path)));
      expect(outside.map((r) => r.path)).toEqual(['/v1/checkin/khong-co-su-kien/:eventId']);
    } finally {
      await moduleRef.close();
    }
  });
});
