import { randomUUID } from 'node:crypto';
import { EventDetail, ErrorResponse, Role, TicketTypeDetail, TicketTypeList } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.8: Hạng vé và tồn kho trên Postgres thật. Tạo/sửa/xóa đi qua flows (ghi `ticket_types` của `event` và
 * `ticket_type_inventory` của `ordering` trong một transaction). `sold`/`held` chưa có luồng ghi (Epic 3) nên test
 * `UPDATE` thẳng bằng SQL.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let orgB: string;

const draft = { name: 'Giải chạy Hà Nội 2026', startsAt: '2026-11-16T07:00:00+07:00', endsAt: '2026-11-16T17:00:00+07:00' };
const paid = (overrides: Record<string, unknown> = {}) => ({ name: 'Đơn nam', price: 300_000, capacity: 32, ...overrides });
const free = (capacity: number, overrides: Record<string, unknown> = {}) => ({ name: 'Miễn phí', price: 0, capacity, ...overrides });

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  admin = await signUp(h);
  ownerB = await signUp(h);
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body.id;
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body.id;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await h.close();
});

async function newEvent(cookie = admin.cookie, org = orgId): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(`/v1/orgs/${org}/events`).set('cookie', cookie).send(draft).expect(201)).body);
}

const path = (eventId: string, org = orgId) => `/v1/orgs/${org}/events/${eventId}/ticket-types`;
const create = (eventId: string, body: unknown, cookie = admin.cookie) =>
  h.http.post(path(eventId)).set('cookie', cookie).send(body as object);
const patch = (eventId: string, id: string, body: unknown, cookie = admin.cookie) =>
  h.http.patch(`${path(eventId)}/${id}`).set('cookie', cookie).send(body as object);

async function created(eventId: string, body: unknown = paid()): Promise<TicketTypeDetail> {
  return TicketTypeDetail.parse((await create(eventId, body).expect(201)).body);
}

async function list(eventId: string): Promise<TicketTypeList> {
  return TicketTypeList.parse((await h.http.get(path(eventId)).set('cookie', owner.cookie).expect(200)).body);
}

async function inventory(ticketTypeId: string) {
  const result = await h.db.orm.execute<{ capacity: number; sold: number; held: number }>(
    sql`SELECT capacity, sold, held FROM ticket_type_inventory WHERE ticket_type_id = ${ticketTypeId}`,
  );
  return result.rows[0];
}

async function audits(type: string, id: string) {
  const result = await h.db.orm.execute<{ action: string; actor_user_id: string; changed_fields: string[] }>(
    sql`SELECT action, actor_user_id, changed_fields FROM audit_events
        WHERE organization_id = ${orgId} AND target_type = ${type} AND target_id = ${id} ORDER BY id`,
  );
  return result.rows;
}

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const issuePaths = (body: unknown) =>
  (errorOf(body).details as { issues: { path: string }[] }).issues.map((i) => i.path);

describe('tạo Hạng vé', () => {
  it('Admin tạo "Đơn nam" 300.000đ 32 suất: 201, tồn kho (32, 0, 0), audit ticket_type.created', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id);
    expect(ticketType).toMatchObject({
      eventId: event.id,
      name: 'Đơn nam',
      description: null,
      price: 300_000,
      capacity: 32,
      sold: 0,
      held: 0,
      saleStartsAt: null,
      saleEndsAt: null,
    });
    expect(await inventory(ticketType.id)).toEqual({ capacity: 32, sold: 0, held: 0 });
    expect(await audits('ticket_type', ticketType.id)).toEqual([
      { action: 'ticket_type.created', actor_user_id: admin.userId, changed_fields: [] },
    ]);
    expect(await list(event.id)).toEqual([ticketType]);
    const byAdmin = await h.http.get(path(event.id)).set('cookie', admin.cookie).expect(200);
    expect(TicketTypeList.parse(byAdmin.body)).toEqual([ticketType]);
  });

  it('có giờ mở/đóng bán: trả lại theo +07:00', async () => {
    const event = await newEvent();
    const ticketType = await created(
      event.id,
      paid({ saleStartsAt: '2026-11-01T01:00:00Z', saleEndsAt: '2026-11-15T22:00:00+07:00', description: ' Áo size M ' }),
    );
    expect(ticketType).toMatchObject({
      saleStartsAt: '2026-11-01T08:00:00+07:00',
      saleEndsAt: '2026-11-15T22:00:00+07:00',
      description: 'Áo size M',
    });
  });

  it('giá 1.500 → 400 VALIDATION_FAILED tại price; giá 0 và 2.000 lưu được', async () => {
    const event = await newEvent();
    const res = await create(event.id, paid({ price: 1_500 })).expect(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    expect(issuePaths(res.body)).toEqual(['price']);
    expect(await list(event.id)).toEqual([]);
    await created(event.id, paid({ price: 0 }));
    await created(event.id, paid({ price: 2_000 }));
    expect((await list(event.id)).map((t) => t.price)).toEqual([0, 2_000]);
  });

  it('giờ đóng ≤ giờ mở → 400 tại saleEndsAt; số suất 0 → 400 tại capacity', async () => {
    const event = await newEvent();
    const start = '2026-11-10T08:00:00+07:00';
    const res = await create(event.id, paid({ saleStartsAt: start, saleEndsAt: start })).expect(400);
    expect(issuePaths(res.body)).toEqual(['saleEndsAt']);
    const zero = await create(event.id, paid({ capacity: 0 })).expect(400);
    expect(issuePaths(zero.body)).toEqual(['capacity']);
  });

  it('trần miễn phí: 0đ 120 + 0đ 90 → Hạng vé thứ hai 409 FREE_EVENT_CAPACITY_EXCEEDED, không lưu', async () => {
    const event = await newEvent();
    await created(event.id, free(120));
    const res = await create(event.id, free(90)).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'FREE_EVENT_CAPACITY_EXCEEDED', details: { limit: 200 } });
    expect((await list(event.id)).map((t) => t.capacity)).toEqual([120]);
    const count = await h.db.orm.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ticket_type_inventory WHERE event_id = ${event.id}`,
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('có Hạng vé có phí: 0đ 150 + 300.000đ 100 lưu được (không phải Sự kiện miễn phí)', async () => {
    const event = await newEvent();
    await created(event.id, free(150));
    await created(event.id, paid({ capacity: 100 }));
    expect(await list(event.id)).toHaveLength(2);
  });

  it('hai request tạo Hạng vé 0đ (150 suất mỗi request) cùng lúc → đúng một request thành công', async () => {
    const event = await newEvent();
    const results = await Promise.all([create(event.id, free(150)), create(event.id, free(150))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(errorOf(results.find((r) => r.status === 409)!.body).code).toBe('FREE_EVENT_CAPACITY_EXCEEDED');
    expect(await list(event.id)).toHaveLength(1);
  });

  it('Sự kiện của BTC khác qua /orgs/{A}/… → 404 EVENT_NOT_FOUND; id sai dạng → 404', async () => {
    const eventB = await newEvent(ownerB.cookie, orgB);
    const res = await create(eventB.id, paid()).expect(404);
    expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
    const get = await h.http.get(path(eventB.id)).set('cookie', owner.cookie).expect(404);
    expect(errorOf(get.body).code).toBe('EVENT_NOT_FOUND');
    const bad = await h.http.get(path('khong-phai-uuid')).set('cookie', owner.cookie).expect(404);
    expect(errorOf(bad.body).code).toBe('EVENT_NOT_FOUND');
    // BTC B vẫn thấy Sự kiện của mình trống.
    const own = await h.http.get(path(eventB.id, orgB)).set('cookie', ownerB.cookie).expect(200);
    expect(own.body).toEqual([]);
  });
});

describe('sửa Hạng vé', () => {
  it('đổi tên và số suất: 200, tồn kho đổi, audit chỉ ghi tên trường đổi', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id);
    const res = await patch(event.id, ticketType.id, paid({ name: 'Đơn nam VIP', capacity: 40 }), owner.cookie).expect(200);
    expect(TicketTypeDetail.parse(res.body)).toMatchObject({ id: ticketType.id, name: 'Đơn nam VIP', capacity: 40 });
    expect(await inventory(ticketType.id)).toEqual({ capacity: 40, sold: 0, held: 0 });
    expect(await audits('ticket_type', ticketType.id)).toEqual([
      { action: 'ticket_type.created', actor_user_id: admin.userId, changed_fields: [] },
      { action: 'ticket_type.updated', actor_user_id: owner.userId, changed_fields: ['name', 'capacity'] },
    ]);
  });

  it('gửi lại y nguyên → 200, không audit', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id, paid({ saleStartsAt: '2026-11-01T08:00:00+07:00' }));
    await patch(event.id, ticketType.id, paid({ saleStartsAt: '2026-11-01T01:00:00Z' })).expect(200);
    expect(await audits('ticket_type', ticketType.id)).toHaveLength(1);
  });

  it('giảm số suất dưới đã cam kết (sold 5, held 3 → 7) → 409 CAPACITY_BELOW_COMMITTED, minimum 8; 8 thì được', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id);
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 5, held = 3 WHERE ticket_type_id = ${ticketType.id}`);
    const res = await patch(event.id, ticketType.id, paid({ capacity: 7, name: 'Đổi tên' })).expect(409);
    expect(errorOf(res.body)).toMatchObject({
      code: 'CAPACITY_BELOW_COMMITTED',
      message: 'Tối thiểu 8 — đã bán và đang giữ chỗ.',
      details: { minimum: 8 },
    });
    expect(await inventory(ticketType.id)).toEqual({ capacity: 32, sold: 5, held: 3 });
    expect((await list(event.id))[0]).toMatchObject({ name: 'Đơn nam', sold: 5, held: 3 });
    const ok = await patch(event.id, ticketType.id, paid({ capacity: 8 })).expect(200);
    expect(TicketTypeDetail.parse(ok.body)).toMatchObject({ capacity: 8, sold: 5, held: 3 });
  });

  it('Hạng vé có phí duy nhất 250 suất đổi giá 0 → 409 FREE_EVENT_CAPACITY_EXCEEDED, không lưu', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id, paid({ capacity: 250 }));
    const res = await patch(event.id, ticketType.id, paid({ capacity: 250, price: 0 })).expect(409);
    expect(errorOf(res.body).code).toBe('FREE_EVENT_CAPACITY_EXCEEDED');
    expect((await list(event.id))[0]?.price).toBe(300_000);
  });

  it('Sự kiện miễn phí: tăng số suất vượt 200 → 409', async () => {
    const event = await newEvent();
    const a = await created(event.id, free(100));
    await created(event.id, free(100));
    const res = await patch(event.id, a.id, free(101)).expect(409);
    expect(errorOf(res.body).code).toBe('FREE_EVENT_CAPACITY_EXCEEDED');
    expect(await inventory(a.id)).toMatchObject({ capacity: 100 });
  });

  it('Hạng vé lạ, sai dạng hoặc của Sự kiện khác → 404 TICKET_TYPE_NOT_FOUND', async () => {
    const event = await newEvent();
    const other = await newEvent();
    const ticketType = await created(other.id);
    for (const id of [randomUUID(), 'abc', ticketType.id]) {
      const res = await patch(event.id, id, paid()).expect(404);
      expect(errorOf(res.body).code).toBe('TICKET_TYPE_NOT_FOUND');
    }
  });
});

describe('xóa Hạng vé', () => {
  it('chưa bán, chưa giữ chỗ → 204, xóa cả dòng tồn kho, audit ticket_type.deleted', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id);
    await h.http.delete(`${path(event.id)}/${ticketType.id}`).set('cookie', admin.cookie).expect(204);
    expect(await list(event.id)).toEqual([]);
    expect(await inventory(ticketType.id)).toBeUndefined();
    expect((await audits('ticket_type', ticketType.id)).map((a) => a.action)).toEqual([
      'ticket_type.created',
      'ticket_type.deleted',
    ]);
  });

  it('đã có người mua hoặc đang giữ chỗ → 409 TICKET_TYPE_IN_USE, không xóa', async () => {
    const event = await newEvent();
    const ticketType = await created(event.id);
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET held = 1 WHERE ticket_type_id = ${ticketType.id}`);
    const res = await h.http.delete(`${path(event.id)}/${ticketType.id}`).set('cookie', admin.cookie).expect(409);
    expect(errorOf(res.body).code).toBe('TICKET_TYPE_IN_USE');
    expect(await list(event.id)).toHaveLength(1);
  });

  it('xóa Hạng vé có phí duy nhất (100 suất) khi còn 0đ 250 suất → 409 FREE_EVENT_CAPACITY_EXCEEDED, không xóa gì', async () => {
    const event = await newEvent();
    const paidType = await created(event.id, paid({ capacity: 100 }));
    await created(event.id, free(250));
    const res = await h.http.delete(`${path(event.id)}/${paidType.id}`).set('cookie', admin.cookie).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'FREE_EVENT_CAPACITY_EXCEEDED', details: { limit: 200 } });
    expect((await list(event.id)).map((t) => t.price)).toEqual([300_000, 0]);
    expect(await inventory(paidType.id)).toEqual({ capacity: 100, sold: 0, held: 0 });
    expect((await audits('ticket_type', paidType.id)).map((a) => a.action)).toEqual(['ticket_type.created']);
  });

  it('Hạng vé có phí duy nhất đã có người mua, phần còn lại vượt trần miễn phí → 409 TICKET_TYPE_IN_USE (không phải trần)', async () => {
    const event = await newEvent();
    const paidType = await created(event.id, paid({ capacity: 100 }));
    await created(event.id, free(250));
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 1 WHERE ticket_type_id = ${paidType.id}`);
    const res = await h.http.delete(`${path(event.id)}/${paidType.id}`).set('cookie', admin.cookie).expect(409);
    expect(errorOf(res.body).code).toBe('TICKET_TYPE_IN_USE');
    expect(await inventory(paidType.id)).toEqual({ capacity: 100, sold: 1, held: 0 });
  });

  it('Hạng vé lạ → 404 TICKET_TYPE_NOT_FOUND', async () => {
    const event = await newEvent();
    const res = await h.http.delete(`${path(event.id)}/${randomUUID()}`).set('cookie', admin.cookie).expect(404);
    expect(errorOf(res.body).code).toBe('TICKET_TYPE_NOT_FOUND');
  });
});

describe('cách ly và id sai dạng', () => {
  it('PATCH/DELETE Hạng vé thật của BTC B qua /orgs/A/… → 404, dòng của B không đổi', async () => {
    const eventA = await newEvent(owner.cookie);
    const eventB = await newEvent(ownerB.cookie, orgB);
    const typeB = TicketTypeDetail.parse(
      (await h.http.post(path(eventB.id, orgB)).set('cookie', ownerB.cookie).send(paid()).expect(201)).body,
    );
    const cases = [
      { eventId: eventA.id, code: 'TICKET_TYPE_NOT_FOUND' },
      { eventId: eventB.id, code: 'EVENT_NOT_FOUND' },
    ];
    for (const { eventId, code } of cases) {
      const url = `${path(eventId)}/${typeB.id}`;
      const patched = await h.http.patch(url).set('cookie', owner.cookie).send(paid({ name: 'Bị sửa', capacity: 1 }));
      expect(patched.status, url).toBe(404);
      expect(errorOf(patched.body).code, url).toBe(code);
      const deleted = await h.http.delete(url).set('cookie', owner.cookie);
      expect(deleted.status, url).toBe(404);
      expect(errorOf(deleted.body).code, url).toBe(code);
    }
    const own = await h.http.get(path(eventB.id, orgB)).set('cookie', ownerB.cookie).expect(200);
    expect(TicketTypeList.parse(own.body)).toEqual([typeB]);
    expect(await inventory(typeB.id)).toEqual({ capacity: 32, sold: 0, held: 0 });
  });

  it('eventId sai dạng với body hợp lệ → 404 EVENT_NOT_FOUND ở mọi route ghi', async () => {
    const bad = 'khong-phai-uuid';
    const requests = [
      () => h.http.post(path(bad)).set('cookie', admin.cookie).send(paid()),
      () => h.http.patch(`${path(bad)}/${randomUUID()}`).set('cookie', admin.cookie).send(paid()),
      () => h.http.delete(`${path(bad)}/${randomUUID()}`).set('cookie', admin.cookie),
      () => h.http.patch(`/v1/orgs/${orgId}/events/${bad}/order-limit`).set('cookie', admin.cookie).send({ maxTicketsPerOrder: 5 }),
    ];
    for (const [index, request] of requests.entries()) {
      const res = await request();
      expect(res.status, String(index)).toBe(404);
      expect(errorOf(res.body).code, String(index)).toBe('EVENT_NOT_FOUND');
    }
  });
});

describe('giới hạn Vé/Đơn', () => {
  it('Sự kiện mới: 10; đặt 4 → audit event.updated [maxTicketsPerOrder]; 0 hoặc 51 → 400', async () => {
    const event = await newEvent();
    expect(event.maxTicketsPerOrder).toBe(10);
    const url = `/v1/orgs/${orgId}/events/${event.id}/order-limit`;
    const res = await h.http.patch(url).set('cookie', admin.cookie).send({ maxTicketsPerOrder: 4 }).expect(200);
    expect(EventDetail.parse(res.body).maxTicketsPerOrder).toBe(4);
    await h.http.patch(url).set('cookie', admin.cookie).send({ maxTicketsPerOrder: 4 }).expect(200);
    expect(await audits('event', event.id)).toEqual([
      { action: 'event.created', actor_user_id: admin.userId, changed_fields: [] },
      { action: 'event.updated', actor_user_id: admin.userId, changed_fields: ['maxTicketsPerOrder'] },
    ]);
    for (const value of [0, 51]) {
      const bad = await h.http.patch(url).set('cookie', admin.cookie).send({ maxTicketsPerOrder: value }).expect(400);
      expect(issuePaths(bad.body)).toEqual(['maxTicketsPerOrder']);
    }
    const fetched = await h.http.get(`/v1/orgs/${orgId}/events/${event.id}`).set('cookie', owner.cookie).expect(200);
    expect(EventDetail.parse(fetched.body).maxTicketsPerOrder).toBe(4);
  });

  it('Sự kiện của BTC khác → 404 EVENT_NOT_FOUND', async () => {
    const eventB = await newEvent(ownerB.cookie, orgB);
    const res = await h.http
      .patch(`/v1/orgs/${orgId}/events/${eventB.id}/order-limit`)
      .set('cookie', owner.cookie)
      .send({ maxTicketsPerOrder: 5 })
      .expect(404);
    expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
  });
});
