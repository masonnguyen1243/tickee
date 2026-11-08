import { randomUUID } from 'node:crypto';
import { EventDetail, EventList, ErrorResponse, PublicEvent, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENT_SLUG_SUFFIX } from '../../src/modules/event/index.js';
import { randomSlugSuffix } from '../../src/modules/event/event.service.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.7: Owner và Admin tạo, sửa, đọc Sự kiện nháp trên Postgres thật. Giờ nhận và trả ISO 8601 có offset +07:00;
 * `effectiveEndAt` = max(23:59:59 ngày kết thúc, `endsAt` + 6 giờ) theo giờ Việt Nam. Slug sinh một lần lúc tạo, trùng
 * thì sinh lại (hàm sinh hậu tố tiêm được để ép trùng). API công khai không bao giờ trả Sự kiện nháp.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let orgB: string;
/** Hậu tố slug kế tiếp (lấy lần lượt); hết thì ngẫu nhiên như thật. */
let suffixes: string[] = [];
let suffixCalls = 0;

const START = '2026-11-16T07:00:00+07:00';
const END = '2026-11-16T17:00:00+07:00';
const draft = (overrides: Record<string, unknown> = {}) => ({ name: 'Giải chạy Hà Nội 2026', startsAt: START, endsAt: END, ...overrides });

beforeAll(async () => {
  h = await createHarness(
    {},
    {
      overrides: [
        {
          provide: EVENT_SLUG_SUFFIX,
          useValue: () => {
            suffixCalls++;
            return suffixes.shift() ?? randomSlugSuffix();
          },
        },
      ],
    },
  );
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
beforeEach(() => {
  suffixes = [];
  suffixCalls = 0;
});

const create = (body: unknown, cookie = admin.cookie, org = orgId) =>
  h.http.post(`/v1/orgs/${org}/events`).set('cookie', cookie).send(body as object);

async function created(body: unknown = draft(), cookie = admin.cookie): Promise<EventDetail> {
  return EventDetail.parse((await create(body, cookie).expect(201)).body);
}

async function audits(eventId: string) {
  const result = await h.db.orm.execute<{ action: string; actor_user_id: string; changed_fields: string[] }>(
    sql`SELECT action, actor_user_id, changed_fields FROM audit_events
        WHERE organization_id = ${orgId} AND target_type = 'event' AND target_id = ${eventId} ORDER BY id`,
  );
  return result.rows;
}

const issuePaths = (body: unknown) =>
  (ErrorResponse.parse(body).error.details as { issues: { path: string }[] }).issues.map((i) => i.path);

describe('tạo Sự kiện nháp', () => {
  it('Admin tạo được: 201, draft, slug từ tên, giờ +07:00, không có chính sách hoàn vé; audit event.created', async () => {
    const event = await created();
    expect(event).toMatchObject({
      organizationId: orgId,
      name: 'Giải chạy Hà Nội 2026',
      status: 'draft',
      startsAt: START,
      endsAt: END,
      effectiveEndAt: '2026-11-16T23:59:59+07:00',
      endedManuallyAt: null,
      venue: null,
      description: null,
      refundPolicy: null,
    });
    expect(event.slug).toMatch(/^giai-chay-ha-noi-2026-[a-z0-9]{4}$/);
    expect(await audits(event.id)).toEqual([{ action: 'event.created', actor_user_id: admin.userId, changed_fields: [] }]);
  });

  it('Owner tạo được; giờ gửi dạng UTC được trả lại theo +07:00', async () => {
    const event = await created(
      draft({ startsAt: '2026-11-16T00:00:00Z', endsAt: '2026-11-16T13:00:00Z', venue: ' Hồ Gươm ', refundPolicy: 'Không hoàn.' }),
      owner.cookie,
    );
    expect(event).toMatchObject({
      startsAt: START,
      endsAt: '2026-11-16T20:00:00+07:00',
      effectiveEndAt: '2026-11-17T02:00:00+07:00',
      venue: 'Hồ Gươm',
      refundPolicy: 'Không hoàn.',
    });
  });

  it('thiếu giờ, hoặc kết thúc ≤ bắt đầu → 400 VALIDATION_FAILED tại trường, không ghi gì', async () => {
    const missing = await create({ name: 'Thiếu giờ' }).expect(400);
    expect(ErrorResponse.parse(missing.body).error.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(missing.body)).toEqual(expect.arrayContaining(['startsAt', 'endsAt']));

    const same = await create(draft({ endsAt: START })).expect(400);
    expect(issuePaths(same.body)).toEqual(['endsAt']);
    const before = await create(draft({ endsAt: '2026-11-16T06:00:00+07:00' })).expect(400);
    expect(issuePaths(before.body)).toEqual(['endsAt']);
    const noOffset = await create(draft({ startsAt: '2026-11-16T07:00:00' })).expect(400);
    expect(issuePaths(noOffset.body)).toEqual(['startsAt']);
    const noName = await create(draft({ name: '   ' })).expect(400);
    expect(issuePaths(noName.body)).toEqual(['name']);

    const count = await h.db.orm.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM events WHERE organization_id = ${orgId} AND name IN ('Thiếu giờ', '   ')`,
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it('hai Sự kiện cùng tên → hai slug khác nhau, cùng tiền tố giai-chay-', async () => {
    const a = await created(draft({ name: 'Giải chạy' }));
    const b = await created(draft({ name: 'Giải chạy' }));
    expect(a.slug).toMatch(/^giai-chay-[a-z0-9]{4}$/);
    expect(b.slug).toMatch(/^giai-chay-[a-z0-9]{4}$/);
    expect(a.slug).not.toBe(b.slug);
  });

  it('slug trùng (ép bằng hàm sinh hậu tố) → sinh lại, không lỗi', async () => {
    // DB test giữ dữ liệu giữa các lần chạy: tên có phần ngẫu nhiên để slug lần đầu chắc chắn chưa có.
    const tag = randomUUID().slice(0, 8);
    const name = `Đêm nhạc trùng slug ${tag}`;
    suffixes = ['x7k2'];
    const first = await created(draft({ name }));
    expect(first.slug).toBe(`dem-nhac-trung-slug-${tag}-x7k2`);
    suffixes = ['x7k2', 'x7k2', 'a1b2'];
    suffixCalls = 0;
    const second = await created(draft({ name }));
    expect(second.slug).toBe(`dem-nhac-trung-slug-${tag}-a1b2`);
    expect(suffixCalls).toBe(3);
  });

  it('slug trùng cả 5 lần → dừng sau 5 lần sinh, 500, không ghi gì thêm', async () => {
    const tag = randomUUID().slice(0, 8);
    const name = `Đêm nhạc hết lượt ${tag}`;
    suffixes = ['x7k2'];
    await created(draft({ name }));
    suffixes = Array(6).fill('x7k2');
    suffixCalls = 0;
    await create(draft({ name })).expect(500);
    expect(suffixCalls).toBe(5);
    const result = await h.db.orm.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM events WHERE name = ${name}`,
    );
    expect(result.rows[0]?.count).toBe(1);
  });

  it('tên không còn chữ/số → tiền tố su-kien', async () => {
    const event = await created(draft({ name: '🎉 !!!' }));
    expect(event.slug).toMatch(/^su-kien-[a-z0-9]{4}$/);
  });
});

describe('sửa Sự kiện nháp', () => {
  it('đổi tên và giờ: 200, slug giữ nguyên, effectiveEndAt tính lại, audit chỉ ghi tên trường đổi', async () => {
    const event = await created(draft({ venue: 'Hồ Gươm' }));
    const res = await h.http
      .patch(`/v1/orgs/${orgId}/events/${event.id}`)
      .set('cookie', owner.cookie)
      .send(draft({ name: 'Giải chạy đêm', startsAt: '2026-11-16T18:00:00+07:00', endsAt: '2026-11-16T20:00:00+07:00', venue: 'Hồ Gươm' }))
      .expect(200);
    const updated = EventDetail.parse(res.body);
    expect(updated).toMatchObject({
      id: event.id,
      slug: event.slug,
      name: 'Giải chạy đêm',
      startsAt: '2026-11-16T18:00:00+07:00',
      endsAt: '2026-11-16T20:00:00+07:00',
      effectiveEndAt: '2026-11-17T02:00:00+07:00',
      venue: 'Hồ Gươm',
      status: 'draft',
    });
    expect(await audits(event.id)).toEqual([
      { action: 'event.created', actor_user_id: admin.userId, changed_fields: [] },
      { action: 'event.updated', actor_user_id: owner.userId, changed_fields: ['name', 'startsAt', 'endsAt'] },
    ]);
    const fetched = await h.http.get(`/v1/orgs/${orgId}/events/${event.id}`).set('cookie', admin.cookie).expect(200);
    expect(EventDetail.parse(fetched.body)).toEqual(updated);
  });

  it('cùng mốc giờ viết khác offset và không đổi gì → không audit event.updated', async () => {
    const event = await created();
    await h.http
      .patch(`/v1/orgs/${orgId}/events/${event.id}`)
      .set('cookie', admin.cookie)
      .send(draft({ startsAt: '2026-11-16T00:00:00Z' }))
      .expect(200);
    expect((await audits(event.id)).map((a) => a.action)).toEqual(['event.created']);
  });

  it('PATCH sai dữ liệu → 400; id lạ hoặc sai dạng → 404 EVENT_NOT_FOUND', async () => {
    const event = await created();
    await h.http.patch(`/v1/orgs/${orgId}/events/${event.id}`).set('cookie', admin.cookie).send(draft({ endsAt: START })).expect(400);
    for (const id of ['019a3b2c-5678-7abc-8def-0123456789ab', 'khong-phai-uuid']) {
      const patch = await h.http.patch(`/v1/orgs/${orgId}/events/${id}`).set('cookie', admin.cookie).send(draft()).expect(404);
      expect(ErrorResponse.parse(patch.body).error.code).toBe('EVENT_NOT_FOUND');
      const get = await h.http.get(`/v1/orgs/${orgId}/events/${id}`).set('cookie', admin.cookie).expect(404);
      expect(ErrorResponse.parse(get.body).error.code).toBe('EVENT_NOT_FOUND');
    }
  });
});

describe('sửa Sự kiện đã mở bán, ẩn, đã kết thúc hoặc đã hủy (Story 2.12)', () => {
  const patch = (eventId: string, body: unknown) =>
    h.http.patch(`/v1/orgs/${orgId}/events/${eventId}`).set('cookie', admin.cookie).send(body as object);

  it.each(['published', 'hidden'] as const)('%s: đổi tên → 200, audit changedFields [name], status giữ nguyên', async (status) => {
    const event = await created();
    await h.db.orm.execute(sql`UPDATE events SET status = ${status} WHERE id = ${event.id}`);
    const res = await patch(event.id, draft({ name: 'Tên mới' })).expect(200);
    expect(EventDetail.parse(res.body)).toMatchObject({ name: 'Tên mới', status, slug: event.slug });
    expect((await audits(event.id)).at(-1)).toEqual({
      action: 'event.updated',
      actor_user_id: admin.userId,
      changed_fields: ['name'],
    });
  });

  it('đã hủy → 409 EVENT_CANCELLED, không ghi, không audit', async () => {
    const event = await created();
    await h.db.orm.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${event.id}`);
    const res = await patch(event.id, draft({ name: 'Tên mới' })).expect(409);
    expect(ErrorResponse.parse(res.body).error.code).toBe('EVENT_CANCELLED');
    const fetched = EventDetail.parse(
      (await h.http.get(`/v1/orgs/${orgId}/events/${event.id}`).set('cookie', admin.cookie).expect(200)).body,
    );
    expect(fetched.name).toBe(event.name);
    expect((await audits(event.id)).map((a) => a.action)).toEqual(['event.created']);
  });

  it('đã bấm Kết thúc: đổi endsAt → endsAt đổi, effectiveEndAt giữ nguyên mốc bấm', async () => {
    const event = await created();
    const endedAt = '2026-11-16T09:30:00+07:00';
    await h.db.orm.execute(
      sql`UPDATE events SET status = 'published', ended_manually_at = ${endedAt}, effective_end_at = ${endedAt}
          WHERE id = ${event.id}`,
    );
    const res = await patch(event.id, draft({ endsAt: '2026-11-16T20:00:00+07:00' })).expect(200);
    expect(EventDetail.parse(res.body)).toMatchObject({
      endsAt: '2026-11-16T20:00:00+07:00',
      effectiveEndAt: endedAt,
      endedManuallyAt: endedAt,
    });
  });

  it('CHECK events_ended_manually_check: effective_end_at lệch khỏi ended_manually_at bị DB từ chối', async () => {
    const event = await created();
    await expect(
      h.db.orm.execute(sql`UPDATE events SET ended_manually_at = now() WHERE id = ${event.id}`),
    ).rejects.toSatisfy((error: unknown) => {
      // drizzle bọc lỗi pg: tên ràng buộc nằm ở message hoặc trong chuỗi `cause`.
      for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { message, constraint } = e as { message?: string; constraint?: string };
        if (constraint === 'events_ended_manually_check' || message?.includes('events_ended_manually_check')) return true;
      }
      return false;
    });
  });
});

describe('danh sách và cách ly', () => {
  it('danh sách của BTC, mới tạo trước; BTC chưa có Sự kiện → []', async () => {
    const latest = await created(draft({ name: 'Sự kiện mới nhất' }));
    const list = EventList.parse((await h.http.get(`/v1/orgs/${orgId}/events`).set('cookie', admin.cookie).expect(200)).body);
    expect(list[0]).toEqual({
      id: latest.id,
      slug: latest.slug,
      name: 'Sự kiện mới nhất',
      status: 'draft',
      startsAt: START,
      endsAt: END,
      effectiveEndAt: '2026-11-16T23:59:59+07:00',
    });
    const empty = await h.http.get(`/v1/orgs/${orgB}/events`).set('cookie', ownerB.cookie).expect(200);
    expect(empty.body).toEqual([]);
  });

  it('id Sự kiện của BTC B gọi qua /orgs/{A}/events/{id} → 404 EVENT_NOT_FOUND, không sửa được', async () => {
    const res = await create(draft({ name: 'Của BTC B' }), ownerB.cookie, orgB).expect(201);
    const eventB = EventDetail.parse(res.body);
    const get = await h.http.get(`/v1/orgs/${orgId}/events/${eventB.id}`).set('cookie', owner.cookie).expect(404);
    expect(ErrorResponse.parse(get.body).error.code).toBe('EVENT_NOT_FOUND');
    await h.http.patch(`/v1/orgs/${orgId}/events/${eventB.id}`).set('cookie', owner.cookie).send(draft({ name: 'Chiếm' })).expect(404);
    const list = EventList.parse((await h.http.get(`/v1/orgs/${orgId}/events`).set('cookie', owner.cookie).expect(200)).body);
    expect(list.map((e) => e.id)).not.toContain(eventB.id);
    const still = await h.http.get(`/v1/orgs/${orgB}/events/${eventB.id}`).set('cookie', ownerB.cookie).expect(200);
    expect(EventDetail.parse(still.body).name).toBe('Của BTC B');
  });
});

describe('API công khai theo slug', () => {
  it('Sự kiện nháp và slug không tồn tại → cùng 404 EVENT_NOT_FOUND, cùng thông điệp, không cần đăng nhập', async () => {
    const event = await created();
    const draftRes = await h.http.get(`/v1/events/${event.slug}`).expect(404);
    const missingRes = await h.http.get('/v1/events/khong-ton-tai-zz99').expect(404);
    const weirdRes = await h.http.get('/v1/events/KHONG%20HOP%20LE').expect(404);
    for (const res of [draftRes, missingRes, weirdRes]) {
      expect(ErrorResponse.parse(res.body).error).toEqual(ErrorResponse.parse(draftRes.body).error);
    }
    expect(ErrorResponse.parse(draftRes.body).error.code).toBe('EVENT_NOT_FOUND');
  });

  it('Sự kiện không còn nháp thì đọc được: kèm tên BTC và Hạng vé (thứ tự tạo, không có số vé)', async () => {
    const event = await created(draft({ refundPolicy: 'Hoàn 100% trước 7 ngày.' }));
    const addTier = async (body: Record<string, unknown>) =>
      (
        await h.http
          .post(`/v1/orgs/${orgId}/events/${event.id}/ticket-types`)
          .set('cookie', admin.cookie)
          .send({ capacity: 50, ...body })
          .expect(201)
      ).body.id as string;
    const vip = await addTier({
      name: 'VIP',
      description: 'Ghế đầu',
      price: 300_000,
      saleStartsAt: '2026-11-01T08:00:00+07:00',
      saleEndsAt: '2026-11-15T20:00:00+07:00',
    });
    const free = await addTier({ name: 'Miễn phí', price: 0 });
    await h.db.orm.execute(sql`UPDATE events SET status = 'published' WHERE id = ${event.id}`);
    const res = await h.http.get(`/v1/events/${event.slug}`).expect(200);
    expect(res.body).toEqual({
      slug: event.slug,
      name: event.name,
      status: 'published',
      startsAt: START,
      endsAt: END,
      venue: null,
      description: null,
      refundPolicy: 'Hoàn 100% trước 7 ngày.',
      organizationName: 'CLB Chạy Bộ',
      ticketTypes: [
        {
          id: vip,
          name: 'VIP',
          description: 'Ghế đầu',
          price: 300_000,
          saleStartsAt: '2026-11-01T08:00:00+07:00',
          saleEndsAt: '2026-11-15T20:00:00+07:00',
        },
        { id: free, name: 'Miễn phí', description: null, price: 0, saleStartsAt: null, saleEndsAt: null },
      ],
    });
    expect(PublicEvent.parse(res.body).ticketTypes).toHaveLength(2);
  });

  it.each([
    ['hidden', sql`status = 'hidden'`, 'hidden'],
    ['cancelled', sql`status = 'cancelled'`, 'cancelled'],
    ['bị khóa', sql`status = 'published', locked_at = now(), lock_reason = 'vi phạm'`, 'published'],
  ])('Sự kiện %s vẫn trả 200 (Ẩn vẫn mở được bằng link), không lộ lý do khóa', async (_label, set, status) => {
    const event = await created();
    await h.db.orm.execute(sql`UPDATE events SET ${set} WHERE id = ${event.id}`);
    const res = await h.http.get(`/v1/events/${event.slug}`).expect(200);
    expect(PublicEvent.parse(res.body)).toMatchObject({ slug: event.slug, status, ticketTypes: [] });
    expect(JSON.stringify(res.body)).not.toMatch(/lock|vi phạm/i);
  });
});

describe('ràng buộc DB', () => {
  it('status ngoài enum và ends_at ≤ starts_at bị CHECK chặn', async () => {
    const event = await created();
    await expect(h.db.orm.execute(sql`UPDATE events SET status = 'ended' WHERE id = ${event.id}`)).rejects.toThrow();
    await expect(h.db.orm.execute(sql`UPDATE events SET ends_at = starts_at WHERE id = ${event.id}`)).rejects.toThrow();
  });
});
