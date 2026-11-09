import { randomUUID } from 'node:crypto';
import { EventDetail, ErrorResponse, JobQueue, Role, TicketTypeDetail, TicketTypeList } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BOSS } from '../../src/platform/jobs/index.js';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.8: Hạng vé và tồn kho trên Postgres thật. Tạo/sửa/xóa đi qua flows (ghi `ticket_types` của `event` và
 * `ticket_type_inventory` của `ordering` trong một transaction). `sold`/`held` chưa có luồng ghi (Epic 3) nên test
 * `UPDATE` thẳng bằng SQL.
 *
 * E2-3: guard sau khi mở bán (Hạng vé có phí cần BTC đủ điều kiện bán, không xóa Hạng vé cuối) và trần suất miễn phí theo
 * tổng số suất 0đ ở mọi Sự kiện. Trạng thái Sự kiện đặt thẳng bằng SQL; mỗi test của guard dùng một BTC mới.
 */

let h: Harness;
let boss: PgBoss;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let orgId: string;
let orgB: string;

const draft = { name: 'Giải chạy Hà Nội 2026', startsAt: '2026-11-16T07:00:00+07:00', endsAt: '2026-11-16T17:00:00+07:00' };
const paid = (overrides: Record<string, unknown> = {}) => ({ name: 'Đơn nam', price: 300_000, capacity: 32, ...overrides });
const free = (capacity: number, overrides: Record<string, unknown> = {}) => ({ name: 'Miễn phí', price: 0, capacity, ...overrides });

beforeAll(async () => {
  h = await createHarness();
  boss = h.app.get<PgBoss>(BOSS);
  owner = await signUp(h);
  admin = await signUp(h);
  ownerB = await signUp(h);
  platformAdmin = await signUpPlatformAdmin(h);
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

  it('có Hạng vé có phí: 0đ 150 + 300.000đ 100 lưu được (Hạng vé có phí không tính vào trần)', async () => {
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

  it('xóa Hạng vé có phí khi còn 0đ 200 suất → 204 (trần không phụ thuộc Hạng vé có phí)', async () => {
    const event = await newEvent();
    const paidType = await created(event.id, paid({ capacity: 100 }));
    await created(event.id, free(200));
    await h.http.delete(`${path(event.id)}/${paidType.id}`).set('cookie', admin.cookie).expect(204);
    expect((await list(event.id)).map((t) => [t.price, t.capacity])).toEqual([[0, 200]]);
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

describe('Sự kiện không còn nháp và trần suất miễn phí (E2-3)', () => {
  type Status = 'draft' | 'published' | 'hidden' | 'cancelled';
  let org: string;

  beforeEach(async () => {
    org = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'BTC E2-3' }).expect(201)).body
      .id as string;
  });

  const at = (eventId: string) => path(eventId, org);
  const add = (eventId: string, body: unknown) => h.http.post(at(eventId)).set('cookie', owner.cookie).send(body as object);
  const edit = (eventId: string, id: string, body: unknown) =>
    h.http.patch(`${at(eventId)}/${id}`).set('cookie', owner.cookie).send(body as object);
  const remove = (eventId: string, id: string) => h.http.delete(`${at(eventId)}/${id}`).set('cookie', owner.cookie);

  async function added(eventId: string, body: unknown): Promise<TicketTypeDetail> {
    return TicketTypeDetail.parse((await add(eventId, body).expect(201)).body);
  }

  /** Sự kiện của BTC trong test, Hạng vé tạo lúc còn nháp rồi đặt `status` thẳng bằng SQL. */
  async function eventWith(status: Status, bodies: unknown[]): Promise<{ event: EventDetail; types: TicketTypeDetail[] }> {
    const event = await newEvent(owner.cookie, org);
    const types: TicketTypeDetail[] = [];
    for (const body of bodies) types.push(await added(event.id, body));
    if (status !== 'draft') await h.db.orm.execute(sql`UPDATE events SET status = ${status} WHERE id = ${event.id}`);
    return { event, types };
  }

  async function listOf(eventId: string): Promise<TicketTypeList> {
    return TicketTypeList.parse((await h.http.get(at(eventId)).set('cookie', owner.cookie).expect(200)).body);
  }

  /** Mọi thứ guard không được đổi: Hạng vé, tồn kho, audit Hạng vé của BTC và job revalidate của trang. */
  async function snapshot(event: EventDetail) {
    const stock = await h.db.orm.execute<{ ticket_type_id: string; capacity: number; sold: number; held: number }>(
      sql`SELECT ticket_type_id, capacity, sold, held FROM ticket_type_inventory WHERE event_id = ${event.id}
          ORDER BY ticket_type_id`,
    );
    const audit = await h.db.orm.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_events WHERE organization_id = ${org} AND target_type = 'ticket_type'`,
    );
    const jobs = await boss.findJobs(JobQueue.EVENT_REVALIDATE_PUBLIC_PAGE, { data: { slug: event.slug } });
    return { ticketTypes: await listOf(event.id), stock: stock.rows, audits: audit.rows[0]!.n, jobs: jobs.length };
  }

  const closedBeta = (action: 'approve' | 'revoke') =>
    h.http.post(`/v1/admin/organizations/${org}/closed-beta/${action}`).set('cookie', platformAdmin.cookie).expect(204);

  async function linkPayoutAccount(): Promise<void> {
    const credential = await h.db.orm.execute<{ id: string }>(sql`
      INSERT INTO tingee_credentials (organization_id, client_id, secret_token_ciphertext, created_by)
      VALUES (${org}, 'tg-client-test', 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA', ${owner.userId})
      RETURNING id`);
    await h.db.orm.execute(sql`
      INSERT INTO payout_accounts
        (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name, account_type, account_last4,
         account_name, created_by)
      VALUES (${org}, ${credential.rows[0]!.id}, '9600000001', '970422', 'MB Bank', 'personal-account', '0000',
        'NGUYEN VAN A', ${owner.userId})`);
  }

  const notAllowed = (body: unknown, unmet: string[], message: string) =>
    expect(errorOf(body)).toEqual({ code: 'PAID_TICKET_TYPE_NOT_ALLOWED', message, details: { unmet } });
  const BOTH_UNMET = 'BTC chưa được duyệt Closed Beta và chưa có tài khoản nhận tiền nên chưa bán được Vé có phí.';

  describe('Hạng vé có phí', () => {
    it.each(['published', 'hidden'] as const)(
      '%s, BTC chưa duyệt Closed Beta và chưa có tài khoản: thêm Hạng vé 2.000đ → 409, không lưu, không revalidate',
      async (status) => {
        const { event } = await eventWith(status, [free(50)]);
        const before = await snapshot(event);
        const res = await add(event.id, paid({ price: 2_000 })).expect(409);
        notAllowed(res.body, ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'], BOTH_UNMET);
        expect(await snapshot(event)).toEqual(before);
      },
    );

    it('chỉ thiếu một điều kiện → details.unmet và câu báo chỉ nêu điều kiện đó', async () => {
      const { event } = await eventWith('published', [free(50)]);
      await closedBeta('approve');
      notAllowed(
        (await add(event.id, paid()).expect(409)).body,
        ['PAYOUT_ACCOUNT_LINKED'],
        'BTC chưa có tài khoản nhận tiền nên chưa bán được Vé có phí.',
      );
      await linkPayoutAccount();
      await closedBeta('revoke');
      notAllowed(
        (await add(event.id, paid()).expect(409)).body,
        ['CLOSED_BETA_APPROVED'],
        'BTC chưa được duyệt Closed Beta nên chưa bán được Vé có phí.',
      );
    });

    it('published, chưa đủ điều kiện: sửa 0đ → 2.000đ (kèm đổi số suất) → 409, Hạng vé, tồn kho, audit, job không đổi', async () => {
      const { event, types } = await eventWith('published', [free(50)]);
      const before = await snapshot(event);
      const res = await edit(event.id, types[0]!.id, free(80, { price: 2_000, name: 'Thành có phí' })).expect(409);
      notAllowed(res.body, ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'], BOTH_UNMET);
      expect(await snapshot(event)).toEqual(before);
    });

    it('published, đủ điều kiện (đã duyệt + có tài khoản): thêm Hạng vé có phí và sửa 0đ → có phí như thường', async () => {
      const { event, types } = await eventWith('published', [free(50)]);
      await closedBeta('approve');
      await linkPayoutAccount();
      const before = await snapshot(event);
      const extra = await added(event.id, paid({ price: 2_000 }));
      expect(extra).toMatchObject({ price: 2_000, capacity: 32 });
      const res = await edit(event.id, types[0]!.id, free(50, { price: 150_000 })).expect(200);
      expect(TicketTypeDetail.parse(res.body).price).toBe(150_000);
      const after = await snapshot(event);
      expect(after.audits).toBe(before.audits + 2);
      expect(after.jobs).toBe(before.jobs + 2);
    });

    it('nháp, BTC chưa đủ điều kiện: thêm Hạng vé có phí và sửa 0đ → có phí như thường (kiểm lúc mở bán)', async () => {
      const { event, types } = await eventWith('draft', [free(50)]);
      await added(event.id, paid({ price: 2_000 }));
      await edit(event.id, types[0]!.id, free(50, { price: 50_000 })).expect(200);
      expect((await listOf(event.id)).map((t) => t.price)).toEqual([50_000, 2_000]);
    });

    it('published, chưa đủ điều kiện: Hạng vé đã có phí sửa được (đổi tên, giảm suất, đóng bán, giảm giá), đổi về 0đ được', async () => {
      // Hạng vé có phí tạo lúc nháp: BTC từng đủ điều kiện rồi mất (vd. hủy hết tài khoản); `sellability` tạm ngừng bán.
      const { event, types } = await eventWith('published', [paid({ capacity: 40 })]);
      const id = types[0]!.id;
      const edited = paid({ name: 'Đổi tên', capacity: 30, price: 250_000, saleEndsAt: '2026-11-15T22:00:00+07:00' });
      const res = await edit(event.id, id, edited).expect(200);
      expect(TicketTypeDetail.parse(res.body)).toMatchObject({
        name: 'Đổi tên',
        capacity: 30,
        price: 250_000,
        saleEndsAt: '2026-11-15T22:00:00+07:00',
      });
      await added(event.id, free(30));
      const zero = await edit(event.id, id, { ...edited, price: 0 }).expect(200);
      expect(TicketTypeDetail.parse(zero.body).price).toBe(0);
    });

    it('published, chưa đủ điều kiện: gửi lại y nguyên Hạng vé có phí → 200, không audit, không revalidate', async () => {
      const { event, types } = await eventWith('published', [paid()]);
      const before = await snapshot(event);
      const res = await edit(event.id, types[0]!.id, paid()).expect(200);
      expect(TicketTypeDetail.parse(res.body)).toEqual(types[0]);
      expect(await snapshot(event)).toEqual(before);
    });
  });

  describe('xóa Hạng vé cuối', () => {
    it.each(['published', 'hidden', 'cancelled'] as const)(
      '%s, còn đúng 1 Hạng vé → 409 LAST_TICKET_TYPE, không xóa, không revalidate',
      async (status) => {
        const { event, types } = await eventWith(status, [free(50)]);
        const before = await snapshot(event);
        const res = await remove(event.id, types[0]!.id).expect(409);
        expect(errorOf(res.body).code).toBe('LAST_TICKET_TYPE');
        expect(await snapshot(event)).toEqual(before);
      },
    );

    it('published, 2 Hạng vé: xóa một được, rồi Hạng vé còn lại → 409 LAST_TICKET_TYPE', async () => {
      const { event, types } = await eventWith('published', [free(50), free(20)]);
      await remove(event.id, types[1]!.id).expect(204);
      expect(errorOf((await remove(event.id, types[0]!.id).expect(409)).body).code).toBe('LAST_TICKET_TYPE');
      expect((await listOf(event.id)).map((t) => t.id)).toEqual([types[0]!.id]);
    });

    it('nháp, 1 Hạng vé → 204 như hiện tại', async () => {
      const { event, types } = await eventWith('draft', [free(50)]);
      await remove(event.id, types[0]!.id).expect(204);
      expect(await listOf(event.id)).toEqual([]);
    });
  });

  describe('trần suất miễn phí, Sự kiện hỗn hợp', () => {
    it('Sự kiện đã vượt trần từ trước (0đ 250 + có phí, theo luật cũ): giảm còn 220, thêm Hạng vé có phí được; tăng suất 0đ → 409', async () => {
      const { event, types } = await eventWith('draft', [free(200), paid({ capacity: 100 })]);
      const freeType = types[0]!;
      await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET capacity = 250 WHERE ticket_type_id = ${freeType.id}`);
      const lowered = await edit(event.id, freeType.id, free(220)).expect(200);
      expect(TicketTypeDetail.parse(lowered.body).capacity).toBe(220);
      await added(event.id, paid({ name: 'Đôi nam nữ', capacity: 10 }));
      for (const attempt of [() => edit(event.id, freeType.id, free(221)), () => add(event.id, free(1))]) {
        const res = await attempt();
        expect(res.status).toBe(409);
        expect(errorOf(res.body)).toMatchObject({ code: 'FREE_EVENT_CAPACITY_EXCEEDED', details: { limit: 200 } });
      }
      expect((await listOf(event.id)).map((t) => [t.price, t.capacity])).toEqual([
        [0, 220],
        [300_000, 100],
        [300_000, 10],
      ]);
    });

    it.each(['draft', 'published', 'hidden'] as const)(
      '%s, 0đ 150 + có phí 100: thêm 0đ 60, nâng 0đ lên 210, đổi Hạng vé có phí thành 0đ → 409 {limit: 200}, không lưu',
      async (status) => {
        const { event, types } = await eventWith(status, [free(150), paid({ capacity: 100 })]);
        const [freeType, paidType] = types as [TicketTypeDetail, TicketTypeDetail];
        const before = await snapshot(event);
        const attempts = [
          () => add(event.id, free(60)),
          () => edit(event.id, freeType.id, free(210)),
          () => edit(event.id, paidType.id, paid({ capacity: 100, price: 0 })),
        ];
        for (const [index, attempt] of attempts.entries()) {
          const res = await attempt();
          expect(res.status, String(index)).toBe(409);
          expect(errorOf(res.body), String(index)).toMatchObject({
            code: 'FREE_EVENT_CAPACITY_EXCEEDED',
            message: 'Tối đa 200 suất miễn phí mỗi Sự kiện.',
            details: { limit: 200 },
          });
        }
        expect(await snapshot(event)).toEqual(before);
      },
    );

    it.each(['draft', 'published'] as const)(
      '%s, tổng suất 0đ đúng 200 kèm Hạng vé có phí 100.000 suất → lưu được',
      async (status) => {
        const { event } = await eventWith(status, [free(150), paid({ capacity: 100_000 })]);
        await added(event.id, free(50));
        expect((await listOf(event.id)).map((t) => [t.price, t.capacity])).toEqual([
          [0, 150],
          [300_000, 100_000],
          [0, 50],
        ]);
      },
    );

    it('published, xóa Hạng vé có phí khi còn 0đ 200 suất → 204', async () => {
      const { event, types } = await eventWith('published', [free(200), paid()]);
      await remove(event.id, types[1]!.id).expect(204);
      expect((await listOf(event.id)).map((t) => t.capacity)).toEqual([200]);
    });
  });
});
