import { randomUUID } from 'node:crypto';
import { Controller, Get, Module } from '@nestjs/common';
import { CheckinEvent, CreatedCheckerInvite, ErrorResponse, EventDetail, Permission, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckinModule } from '../../src/modules/checkin/index.js';
import { EventAccess, RequirePermission, type EventAccessContext } from '../../src/platform/access/index.js';
import { createHarness, signUp, signUpWithTotp, type Harness } from '../identity/harness.js';
import { EventsTestController } from '../organizer/test-controllers.js';

/*
 * Story 5.2-a: nhánh Sự kiện của `PermissionGuard` (route CTV `/v1/checkin/events/:eventId/…`, AD-26) và
 * `GET /v1/checkin/events/:eventId`. BTC A có hai Sự kiện (A1, A2), BTC B có B1; CTV nhận lời mời của A1. Thu hồi CTV
 * (Story 5.6 chưa có) đặt bằng SQL.
 */

/** Route CTV cần `checkin.lookup` (trong `CHECKER_PERMISSIONS`): trả lại ctx. */
@Controller('checkin/events/:eventId/test-lookup')
class LookupTestController {
  @Get()
  @RequirePermission(Permission.CHECKIN_LOOKUP)
  get(@EventAccess() ctx: EventAccessContext): EventAccessContext {
    return ctx;
  }
}

/** Route dưới tiền tố CTV nhưng cần quyền ngoài `CHECKER_PERMISSIONS` (`orders.view`). */
@Controller('checkin/events/:eventId/test-orders')
class OrdersTestController {
  @Get()
  @RequirePermission(Permission.ORDERS_VIEW)
  get(@EventAccess() ctx: EventAccessContext): EventAccessContext {
    return ctx;
  }
}

/** Route chỉ Owner dưới tiền tố CTV (`members.manage`): Admin → `FORBIDDEN_ROLE`. */
@Controller('checkin/events/:eventId/test-owner-only')
class OwnerOnlyEventTestController {
  @Get()
  @RequirePermission(Permission.MEMBERS_MANAGE)
  get(@EventAccess() ctx: EventAccessContext): EventAccessContext {
    return ctx;
  }
}

const draft = {
  name: 'Đêm nhạc Trịnh 2026',
  startsAt: '2099-11-16T19:00:00+07:00',
  endsAt: '2099-11-16T22:00:00+07:00',
  refundPolicy: 'Không hoàn vé.',
};

type User = Awaited<ReturnType<typeof signUp>>;

let h: Harness;
let owner: Awaited<ReturnType<typeof signUpWithTotp>>;
let admin: User;
let ctv: User;
let stranger: User;
let ownerB: User;
let orgA: string;
let orgB: string;
let eventA1: EventDetail;
let eventA2: EventDetail;
let eventB1: EventDetail;

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const checkinPath = (eventId: string, suffix = '') => `/v1/checkin/events/${eventId}${suffix}`;
const get = (path: string, cookie?: string) => {
  const req = h.http.get(path);
  return cookie ? req.set('cookie', cookie) : req;
};

async function createEvent(orgId: string, cookie: string, publish: boolean): Promise<EventDetail> {
  const events = `/v1/orgs/${orgId}/events`;
  const event = EventDetail.parse((await h.http.post(events).set('cookie', cookie).send(draft).expect(201)).body);
  if (!publish) return event;
  await h.http
    .post(`${events}/${event.id}/ticket-types`)
    .set('cookie', cookie)
    .send({ name: 'Miễn phí', price: 0, capacity: 50 })
    .expect(201);
  await h.http.post(`${events}/${event.id}/publish`).set('cookie', cookie).expect(200);
  return event;
}

const setChecker = (eventId: string, userId: string, status: 'active' | 'revoked') =>
  h.db.orm.execute(
    sql`UPDATE checkers SET status = ${status}, revoked_at = ${status === 'revoked' ? sql`now()` : null},
          revoked_by = ${status === 'revoked' ? owner.userId : null}
        WHERE event_id = ${eventId} AND user_id = ${userId}`,
  );

beforeAll(async () => {
  h = await createHarness(
    {},
    { controllers: [LookupTestController, OrdersTestController, OwnerOnlyEventTestController, EventsTestController] },
  );
  // Owner đã bật 2FA và qua lớp hai để kiểm `stepUpAt` được chép vào ctx.
  owner = await signUpWithTotp(h);
  admin = await signUp(h);
  ctv = await signUp(h);
  stranger = await signUp(h);
  ownerB = await signUp(h);
  orgA = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'BTC A' }).expect(201)).body.id;
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body.id;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgA}, ${admin.userId}, ${Role.ADMIN})`,
  );
  eventA1 = await createEvent(orgA, owner.cookie, true);
  eventA2 = await createEvent(orgA, owner.cookie, true);
  eventB1 = await createEvent(orgB, ownerB.cookie, true);
  const invite = CreatedCheckerInvite.parse(
    (await h.http.post(`/v1/orgs/${orgA}/events/${eventA1.id}/checker-invite`).set('cookie', owner.cookie).expect(201))
      .body,
  );
  await h.http.post('/v1/checkin/invites/accept').set('cookie', ctv.cookie).send({ token: invite.token }).expect(200);
});
afterAll(async () => {
  await h.close();
});

describe('GET /v1/checkin/events/:eventId', () => {
  it('CTV active của Sự kiện → 200 {eventId, eventName}; no-store', async () => {
    const res = await get(checkinPath(eventA1.id), ctv.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(CheckinEvent.parse(res.body)).toEqual({ eventId: eventA1.id, eventName: draft.name });
  });

  it('Owner/Admin của BTC sở hữu → 200 không cần lời mời (kể cả Sự kiện nháp)', async () => {
    const draftEvent = await createEvent(orgA, owner.cookie, false);
    for (const event of [eventA1, eventA2, draftEvent]) {
      for (const cookie of [owner.cookie, admin.cookie]) {
        const res = await get(checkinPath(event.id), cookie).expect(200);
        expect(res.body).toEqual({ eventId: event.id, eventName: draft.name });
      }
    }
  });

  it('id chữ hoa vẫn là cùng Sự kiện', async () => {
    const res = await get(checkinPath(eventA1.id.toUpperCase()), ctv.cookie).expect(200);
    expect(res.body).toEqual({ eventId: eventA1.id, eventName: draft.name });
  });

  it('chưa đăng nhập → 401 UNAUTHENTICATED', async () => {
    const res = await get(checkinPath(eventA1.id));
    expect(res.status).toBe(401);
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
  });
});

describe('cách ly route CTV → 403 NOT_A_MEMBER, không lộ dữ liệu', () => {
  const cases: [string, () => string, () => string][] = [
    ['CTV của A1 gọi A2 (cùng BTC)', () => ctv.cookie, () => eventA2.id],
    ['CTV của A1 gọi B1 (BTC khác)', () => ctv.cookie, () => eventB1.id],
    ['người lạ', () => stranger.cookie, () => eventA1.id],
    ['Owner BTC khác', () => ownerB.cookie, () => eventA1.id],
    ['Sự kiện không tồn tại', () => owner.cookie, () => randomUUID()],
    ['id sai dạng', () => owner.cookie, () => 'khong-phai-uuid'],
    ['id gần giống uuid', () => ctv.cookie, () => `${eventA1.id}x`],
  ];
  it.each(cases)('%s', async (_label, cookie, eventId) => {
    for (const suffix of ['', '/test-lookup', '/test-orders']) {
      const res = await get(checkinPath(eventId(), suffix), cookie());
      expect(res.status, suffix).toBe(403);
      expect(errorOf(res.body), suffix).toEqual({
        code: 'NOT_A_MEMBER',
        message: 'Bạn không có quyền soát vé cho Sự kiện này.',
        details: null,
      });
      expect(res.text).not.toContain(draft.name);
    }
  });

  it('CTV gọi route BTC (/v1/orgs/:orgId…) → 403 NOT_A_MEMBER', async () => {
    for (const path of [
      `/v1/orgs/${orgA}`,
      `/v1/orgs/${orgA}/events`,
      `/v1/orgs/${orgA}/events/${eventA1.id}`,
      `/v1/orgs/${orgA}/events/${eventA1.id}/checker-invite`,
      `/v1/orgs/${orgA}/test-events`,
    ]) {
      const res = await get(path, ctv.cookie);
      expect(res.status, path).toBe(403);
      expect(errorOf(res.body).code, path).toBe('NOT_A_MEMBER');
    }
  });
});

describe('quyền và EventAccessContext', () => {
  it('Owner/Admin: role là vai, assignedEventIds []; CTV: role null, assignedEventIds [eventId]', async () => {
    const ownerCtx = await get(checkinPath(eventA1.id, '/test-lookup'), owner.cookie).expect(200);
    expect(ownerCtx.body).toEqual({
      userId: owner.userId,
      organizationId: orgA,
      eventId: eventA1.id,
      role: 'owner',
      assignedEventIds: [],
      stepUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    const adminCtx = await get(checkinPath(eventA1.id, '/test-lookup'), admin.cookie).expect(200);
    expect(adminCtx.body).toMatchObject({ userId: admin.userId, role: 'admin', assignedEventIds: [], stepUpAt: null });
    const ctvCtx = await get(checkinPath(eventA1.id.toUpperCase(), '/test-lookup'), ctv.cookie).expect(200);
    expect(ctvCtx.body).toEqual({
      userId: ctv.userId,
      organizationId: orgA,
      eventId: eventA1.id,
      role: null,
      assignedEventIds: [eventA1.id],
      stepUpAt: null,
    });
  });

  it('CTV gọi route cần quyền ngoài CHECKER_PERMISSIONS → 403 FORBIDDEN_ROLE; Owner/Admin theo ROLE_PERMISSIONS', async () => {
    const res = await get(checkinPath(eventA1.id, '/test-orders'), ctv.cookie);
    expect(res.status).toBe(403);
    expect(errorOf(res.body)).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { permission: 'orders.view' } });
    for (const cookie of [owner.cookie, admin.cookie]) await get(checkinPath(eventA1.id, '/test-orders'), cookie).expect(200);

    await get(checkinPath(eventA1.id, '/test-owner-only'), owner.cookie).expect(200);
    for (const cookie of [admin.cookie, ctv.cookie]) {
      const denied = await get(checkinPath(eventA1.id, '/test-owner-only'), cookie);
      expect(denied.status).toBe(403);
      expect(errorOf(denied.body).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('CTV bị thu hồi → 403 CHECKER_REVOKED ở ngay request kế tiếp (không cache); trạng thái active lại → 200', async () => {
    await get(checkinPath(eventA1.id), ctv.cookie).expect(200);
    await setChecker(eventA1.id, ctv.userId, 'revoked');
    try {
      for (const suffix of ['', '/test-lookup', '/test-orders']) {
        const res = await get(checkinPath(eventA1.id, suffix), ctv.cookie);
        expect(res.status, suffix).toBe(403);
        expect(errorOf(res.body), suffix).toEqual({
          code: 'CHECKER_REVOKED',
          message: 'Bạn không còn quyền soát vé cho Sự kiện này.',
          details: null,
        });
        expect(res.text).not.toContain(draft.name);
      }
      // Thu hồi ở A1 không biến CTV thành "bị thu hồi" ở Sự kiện khác.
      expect(errorOf((await get(checkinPath(eventA2.id), ctv.cookie)).body).code).toBe('NOT_A_MEMBER');
    } finally {
      await setChecker(eventA1.id, ctv.userId, 'active');
    }
    await get(checkinPath(eventA1.id), ctv.cookie).expect(200);
  });

  it('Owner/Admin thắng trạng thái CTV: thành viên BTC có dòng revoked vẫn quét được', async () => {
    await h.db.orm.execute(
      sql`INSERT INTO checkers (organization_id, event_id, user_id, status, revoked_at, revoked_by)
          VALUES (${orgA}, ${eventA2.id}, ${admin.userId}, 'revoked', now(), ${owner.userId})`,
    );
    const res = await get(checkinPath(eventA2.id, '/test-lookup'), admin.cookie).expect(200);
    expect(res.body).toMatchObject({ role: 'admin', assignedEventIds: [] });
  });
});

/** Thay `CheckinModule`: app không có cổng CTV. */
@Module({})
class NoCheckinModule {}

describe('harness không nạp CheckinModule (cổng CTV @Optional())', () => {
  let bare: Harness;
  beforeAll(async () => {
    bare = await createHarness(
      {},
      {
        controllers: [EventsTestController, LookupTestController],
        moduleOverrides: [{ module: CheckinModule, useModule: NoCheckinModule }],
      },
    );
  });
  afterAll(async () => {
    await bare.close();
  });

  it('route BTC chạy như trước; route CTV là lỗi cấu hình (500), route của checkin không còn', async () => {
    const res = await bare.http.get(`/v1/orgs/${orgA}/test-events`).set('cookie', admin.cookie).expect(200);
    expect(res.body).toEqual({ userId: admin.userId, organizationId: orgA, role: 'admin', assignedEventIds: [], stepUpAt: null });
    const outsider = await bare.http.get(`/v1/orgs/${orgA}/test-events`).set('cookie', stranger.cookie);
    expect(outsider.status).toBe(403);
    expect(errorOf(outsider.body).code).toBe('NOT_A_MEMBER');

    const ctvRoute = await bare.http.get(checkinPath(eventA1.id, '/test-lookup')).set('cookie', owner.cookie);
    expect(ctvRoute.status).toBe(500);
    expect(errorOf(ctvRoute.body).code).toBe('INTERNAL_ERROR');
    await bare.http.get(checkinPath(eventA1.id)).set('cookie', owner.cookie).expect(404);
  });
});
