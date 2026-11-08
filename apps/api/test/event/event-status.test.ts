import { EventAvailability, EventDetail, ErrorResponse, JobQueue, Role, TicketTypeDetail } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PublicPageQueues } from '../../src/modules/event/public-page-jobs.js';
import { AVAILABILITY_CLOCK } from '../../src/modules/ordering/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.12: Ẩn (`published` → `hidden`), Hiện lại (`hidden` → `published`) và Kết thúc sớm (`ended_manually_at` =
 * `effective_end_at` = lúc bấm, status giữ nguyên) trên Postgres thật. Mỗi test dùng một BTC mới. Đồng hồ của
 * availability tiêm được: mỗi lần đọc lại dời đồng hồ qua hạn memo 2 giây.
 */

const QUEUE = JobQueue.EVENT_REVALIDATE_PUBLIC_PAGE;

let h: Harness;
let boss: PgBoss;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let clockOffset = 0;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

beforeAll(async () => {
  h = await createHarness({}, { overrides: [{ provide: AVAILABILITY_CLOCK, useValue: () => Date.now() + clockOffset }] });
  boss = h.app.get<PgBoss>(BOSS);
  await h.app.get(PublicPageQueues).ready();
  owner = await signUp(h);
  admin = await signUp(h);
  ownerB = await signUp(h);
});
beforeEach(async () => {
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body
    .id as string;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await h.close();
});

const eventsPath = (org = orgId) => `/v1/orgs/${org}/events`;
type Action = 'hide' | 'unhide' | 'end';
const act = (action: Action, eventId: string, cookie = admin.cookie, org = orgId) =>
  h.http.post(`${eventsPath(org)}/${eventId}/${action}`).set('cookie', cookie);

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

async function newEvent(cookie = owner.cookie, org = orgId): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventsPath(org)).set('cookie', cookie).send(draft).expect(201)).body);
}

/** Sự kiện miễn phí đã mở bán; `started` thì dời `starts_at` về trước bây giờ (Kết thúc được). */
async function publishedEvent(started = true): Promise<{ event: EventDetail; free: string }> {
  const event = await newEvent();
  const res = await h.http
    .post(`${eventsPath()}/${event.id}/ticket-types`)
    .set('cookie', owner.cookie)
    .send({ name: 'Miễn phí', price: 0, capacity: 50 })
    .expect(201);
  await h.http.post(`${eventsPath()}/${event.id}/publish`).set('cookie', owner.cookie).expect(200);
  if (started) await h.db.orm.execute(sql`UPDATE events SET starts_at = now() - interval '1 hour' WHERE id = ${event.id}`);
  return { event, free: TicketTypeDetail.parse(res.body).id };
}

/** Dòng `events` (mốc giờ dạng mili giây epoch: `execute` thô trả timestamptz dạng chuỗi). */
async function row(eventId: string) {
  const result = await h.db.orm.execute<{ status: string; ended_ms: number | null; effective_ms: number }>(
    sql`SELECT status,
          (extract(epoch FROM ended_manually_at) * 1000)::float8 AS ended_ms,
          (extract(epoch FROM effective_end_at) * 1000)::float8 AS effective_ms
        FROM events WHERE id = ${eventId}`,
  );
  return result.rows[0]!;
}

async function statusAudits(eventId: string) {
  const result = await h.db.orm.execute<{ action: string; actor_user_id: string; changed_fields: string[] }>(
    sql`SELECT action, actor_user_id, changed_fields FROM audit_events
        WHERE organization_id = ${orgId} AND target_type = 'event' AND target_id = ${eventId}
          AND action IN ('event.hidden', 'event.unhidden', 'event.ended') ORDER BY id`,
  );
  return result.rows;
}

const jobCount = async (slug: string) => (await boss.findJobs(QUEUE, { data: { slug } })).length;

/** Availability mới (bỏ qua memo 2 giây của lần đọc trước). */
async function availability(slug: string): Promise<EventAvailability> {
  clockOffset += 3_000;
  return EventAvailability.parse((await h.http.get(`/v1/events/${slug}/availability`).expect(200)).body);
}

describe('POST …/hide và …/unhide', () => {
  it('Ẩn: published → hidden, audit event.hidden, 1 job; trang công khai vẫn mở, eventReason hidden', async () => {
    const { event, free } = await publishedEvent();
    expect((await availability(event.slug)).eventReason).toBeNull();
    const jobs = await jobCount(event.slug);

    const res = await act('hide', event.id).expect(200);
    expect(EventDetail.parse(res.body)).toMatchObject({ id: event.id, status: 'hidden', endedManuallyAt: null });
    expect(await statusAudits(event.id)).toEqual([
      { action: 'event.hidden', actor_user_id: admin.userId, changed_fields: [] },
    ]);
    expect(await jobCount(event.slug)).toBe(jobs + 1);
    await h.http.get(`/v1/events/${event.slug}`).expect(200);
    const hidden = await availability(event.slug);
    expect(hidden.eventReason).toBe('hidden');
    expect(hidden.tiers).toEqual([expect.objectContaining({ ticketTypeId: free, status: 'unavailable' })]);
  });

  it('Hiện lại: hidden → published, audit event.unhidden, 1 job; bán lại', async () => {
    const { event, free } = await publishedEvent();
    await act('hide', event.id, owner.cookie).expect(200);
    const jobs = await jobCount(event.slug);

    const res = await act('unhide', event.id).expect(200);
    expect(EventDetail.parse(res.body).status).toBe('published');
    expect((await statusAudits(event.id)).map((a) => a.action)).toEqual(['event.hidden', 'event.unhidden']);
    expect(await jobCount(event.slug)).toBe(jobs + 1);
    const again = await availability(event.slug);
    expect(again.eventReason).toBeNull();
    expect(again.tiers).toEqual([expect.objectContaining({ ticketTypeId: free, status: 'on_sale' })]);
  });

  it.each(['draft', 'hidden', 'cancelled'] as const)('Ẩn khi %s → 409 EVENT_STATUS_CONFLICT, không ghi', async (status) => {
    const event = await newEvent();
    await h.db.orm.execute(sql`UPDATE events SET status = ${status} WHERE id = ${event.id}`);
    const res = await act('hide', event.id).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'EVENT_STATUS_CONFLICT', details: { status } });
    expect((await row(event.id)).status).toBe(status);
    expect(await statusAudits(event.id)).toEqual([]);
    expect(await jobCount(event.slug)).toBe(0);
  });

  it.each(['draft', 'published', 'cancelled'] as const)('Hiện lại khi %s → 409 EVENT_STATUS_CONFLICT', async (status) => {
    const event = await newEvent();
    await h.db.orm.execute(sql`UPDATE events SET status = ${status} WHERE id = ${event.id}`);
    const res = await act('unhide', event.id).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'EVENT_STATUS_CONFLICT', details: { status } });
    expect((await row(event.id)).status).toBe(status);
    expect(await statusAudits(event.id)).toEqual([]);
    expect(await jobCount(event.slug)).toBe(0);
  });

  it.each([
    ['hide', 'published', 'tay'],
    ['hide', 'published', 'tự hết giờ'],
    ['unhide', 'hidden', 'tay'],
    ['unhide', 'hidden', 'tự hết giờ'],
  ] as const)('%s khi %s đã kết thúc (%s) → 409 EVENT_ALREADY_ENDED, không ghi', async (action, status, how) => {
    const { event } = await publishedEvent();
    if (status === 'hidden') await act('hide', event.id).expect(200);
    if (how === 'tay') await act('end', event.id).expect(200);
    else await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${event.id}`);
    const audits = (await statusAudits(event.id)).length;
    const jobs = await jobCount(event.slug);

    const res = await act(action, event.id).expect(409);
    expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
    expect((await row(event.id)).status).toBe(status);
    expect(await statusAudits(event.id)).toHaveLength(audits);
    expect(await jobCount(event.slug)).toBe(jobs);
  });

  it('Sự kiện ẩn đã tự hết giờ → availability ended', async () => {
    const { event, free } = await publishedEvent();
    await act('hide', event.id).expect(200);
    expect((await availability(event.slug)).eventReason).toBe('hidden');
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${event.id}`);
    const result = await availability(event.slug);
    expect(result.eventReason).toBe('ended');
    expect(result.tiers).toEqual([expect.objectContaining({ ticketTypeId: free, status: 'unavailable' })]);
  });

  it('hai lần Ẩn song song → một 200, một 409 EVENT_STATUS_CONFLICT; một dòng audit', async () => {
    const { event } = await publishedEvent();
    const jobs = await jobCount(event.slug);
    const results = await Promise.all([act('hide', event.id), act('hide', event.id, owner.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(errorOf(conflict.body)).toMatchObject({ code: 'EVENT_STATUS_CONFLICT', details: { status: 'hidden' } });
    expect(await statusAudits(event.id)).toHaveLength(1);
    expect(await jobCount(event.slug)).toBe(jobs + 1);
  });
});

describe('POST …/end', () => {
  it.each(['published', 'hidden'] as const)(
    '%s đã bắt đầu: hai cột = lúc bấm, status giữ nguyên, audit event.ended, 1 job; availability ended',
    async (status) => {
      const { event, free } = await publishedEvent();
      if (status === 'hidden') await act('hide', event.id).expect(200);
      const jobs = await jobCount(event.slug);
      const before = Date.now();

      const res = await act('end', event.id).expect(200);
      const ended = EventDetail.parse(res.body);
      expect(ended.status).toBe(status);
      expect(ended.endedManuallyAt).not.toBeNull();
      expect(ended.effectiveEndAt).toBe(ended.endedManuallyAt);
      const stored = await row(event.id);
      expect(stored.ended_ms).toBe(stored.effective_ms);
      // Mốc bấm lấy trong transaction (độ chính xác giây của `toEventIso` không áp lên DB).
      expect(stored.ended_ms).toBeGreaterThanOrEqual(before - 1_000);
      expect(stored.ended_ms).toBeLessThanOrEqual(Date.now());
      expect((await statusAudits(event.id)).at(-1)).toEqual({
        action: 'event.ended',
        actor_user_id: admin.userId,
        changed_fields: [],
      });
      expect(await jobCount(event.slug)).toBe(jobs + 1);
      const result = await availability(event.slug);
      // "Đã kết thúc" thắng "Ẩn" trong `sellability`.
      expect(result.eventReason).toBe('ended');
      expect(result.tiers).toEqual([expect.objectContaining({ ticketTypeId: free, status: 'unavailable' })]);
    },
  );

  it('Kết thúc lặp → 409 EVENT_ALREADY_ENDED, mốc bấm không đổi; một dòng audit', async () => {
    const { event } = await publishedEvent();
    await act('end', event.id).expect(200);
    const first = await row(event.id);
    const jobs = await jobCount(event.slug);
    const res = await act('end', event.id, owner.cookie).expect(409);
    expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
    expect((await row(event.id)).ended_ms).toBe(first.ended_ms);
    expect(await statusAudits(event.id)).toHaveLength(1);
    expect(await jobCount(event.slug)).toBe(jobs);
  });

  it('đã tự kết thúc (effective_end_at ≤ now) → 409 EVENT_ALREADY_ENDED, không ghi', async () => {
    const { event } = await publishedEvent();
    await h.db.orm.execute(
      sql`UPDATE events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day',
          effective_end_at = now() - interval '1 second' WHERE id = ${event.id}`,
    );
    const jobs = await jobCount(event.slug);
    const res = await act('end', event.id).expect(409);
    expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
    expect((await row(event.id)).ended_ms).toBeNull();
    expect(await statusAudits(event.id)).toEqual([]);
    expect(await jobCount(event.slug)).toBe(jobs);
  });

  it('chưa tới giờ bắt đầu → 409 EVENT_NOT_STARTED, không ghi', async () => {
    const { event } = await publishedEvent(false);
    const jobs = await jobCount(event.slug);
    const res = await act('end', event.id).expect(409);
    expect(errorOf(res.body).code).toBe('EVENT_NOT_STARTED');
    expect((await row(event.id)).ended_ms).toBeNull();
    expect(await statusAudits(event.id)).toEqual([]);
    expect(await jobCount(event.slug)).toBe(jobs);
  });

  it.each(['draft', 'cancelled'] as const)('%s → 409 EVENT_STATUS_CONFLICT, không ghi', async (status) => {
    const event = await newEvent();
    await h.db.orm.execute(
      sql`UPDATE events SET status = ${status}, starts_at = now() - interval '1 hour' WHERE id = ${event.id}`,
    );
    const res = await act('end', event.id).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'EVENT_STATUS_CONFLICT', details: { status } });
    expect((await row(event.id)).ended_ms).toBeNull();
    expect(await statusAudits(event.id)).toEqual([]);
    expect(await jobCount(event.slug)).toBe(0);
  });

  it('hai lần Kết thúc song song → một 200, một 409 EVENT_ALREADY_ENDED', async () => {
    const { event } = await publishedEvent();
    const jobs = await jobCount(event.slug);
    const results = await Promise.all([act('end', event.id), act('end', event.id, owner.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(errorOf(results.find((r) => r.status === 409)!.body).code).toBe('EVENT_ALREADY_ENDED');
    expect(await statusAudits(event.id)).toHaveLength(1);
    expect(await jobCount(event.slug)).toBe(jobs + 1);
    const stored = await row(event.id);
    expect(stored.ended_ms).not.toBeNull();
    expect(stored.ended_ms).toBe(stored.effective_ms);
  });
});

describe('cách ly', () => {
  it.each(['hide', 'unhide', 'end'] as const)(
    '%s: Sự kiện của BTC khác, id lạ hoặc sai dạng → 404 EVENT_NOT_FOUND',
    async (action) => {
      const orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201))
        .body.id as string;
      const eventB = await newEvent(ownerB.cookie, orgB);
      for (const id of [eventB.id, '019a0000-0000-7000-8000-000000000000', 'abc']) {
        expect(errorOf((await act(action, id).expect(404)).body).code).toBe('EVENT_NOT_FOUND');
      }
      expect((await row(eventB.id)).status).toBe('draft');
    },
  );
});
