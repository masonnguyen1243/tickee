import { createHash } from 'node:crypto';
import {
  CHECKER_INVITE_TOKEN_PATTERN,
  CheckerInviteResponse,
  CreatedCheckerInvite,
  ErrorResponse,
  EventDetail,
  Role,
  toEventIso,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/platform/db/index.js';
import { migrationDatabaseUrl } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 5.1: link mời CTV chung của Sự kiện trên Postgres thật. Mỗi test dùng một BTC mới (Owner chung, Admin chung).
 * Trạng thái Sự kiện và mốc kết thúc đặt thẳng bằng SQL (role `tickee_app`); hạn lưu của link (`expires_at`, cột khóa
 * với `tickee_app`) đổi bằng role migrator.
 */

const DAY_MS = 86_400_000;

let h: Harness;
let migrator: Database;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let orgB: string;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

beforeAll(async () => {
  h = await createHarness();
  migrator = new Database({ connectionString: migrationDatabaseUrl(), max: 1 });
  owner = await signUp(h);
  admin = await signUp(h);
  ownerB = await signUp(h);
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body.id;
});
beforeEach(async () => {
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body
    .id as string;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await migrator.close();
  await h.close();
});

const eventsPath = (org = orgId) => `/v1/orgs/${org}/events`;
const invitePath = (eventId: string, org = orgId) => `${eventsPath(org)}/${eventId}/checker-invite`;
const create = (eventId: string, cookie = admin.cookie, org = orgId) =>
  h.http.post(invitePath(eventId, org)).set('cookie', cookie);
const read = (eventId: string, cookie = admin.cookie, org = orgId) =>
  h.http.get(invitePath(eventId, org)).set('cookie', cookie);

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

async function newEvent(): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventsPath()).set('cookie', owner.cookie).send(draft).expect(201)).body);
}

/** Sự kiện miễn phí đã mở bán; `started` thì dời `starts_at` về trước bây giờ (Kết thúc được). */
async function publishedEvent(started = false): Promise<EventDetail> {
  const event = await newEvent();
  await h.http
    .post(`${eventsPath()}/${event.id}/ticket-types`)
    .set('cookie', owner.cookie)
    .send({ name: 'Miễn phí', price: 0, capacity: 50 })
    .expect(201);
  await h.http.post(`${eventsPath()}/${event.id}/publish`).set('cookie', owner.cookie).expect(200);
  if (started) await h.db.orm.execute(sql`UPDATE events SET starts_at = now() - interval '1 hour' WHERE id = ${event.id}`);
  return event;
}

async function created(eventId: string, cookie = admin.cookie): Promise<CreatedCheckerInvite> {
  const res = await create(eventId, cookie).expect(201);
  expect(res.headers['cache-control']).toBe('no-store');
  return CreatedCheckerInvite.parse(res.body);
}

async function latest(eventId: string, cookie = admin.cookie): Promise<CheckerInviteResponse> {
  const res = await read(eventId, cookie).expect(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return CheckerInviteResponse.parse(res.body);
}

type InviteDbRow = { id: string; token_hash: string; revoked: boolean; organization_id: string };

async function rows(eventId: string): Promise<InviteDbRow[]> {
  const result = await h.db.orm.execute<InviteDbRow>(
    sql`SELECT id, token_hash, revoked_at IS NOT NULL AS revoked, organization_id FROM checker_invites
        WHERE event_id = ${eventId} ORDER BY id`,
  );
  return result.rows;
}

async function audits(eventId: string) {
  const result = await h.db.orm.execute<Record<string, unknown>>(
    sql`SELECT a.* FROM audit_events a
        WHERE a.target_type = 'checker_invite'
          AND a.target_id IN (SELECT id::text FROM checker_invites WHERE event_id = ${eventId})
        ORDER BY a.id`,
  );
  return result.rows;
}

/** `effective_end_at` của Sự kiện (mili giây epoch). */
async function effectiveEndMs(eventId: string): Promise<number> {
  const result = await h.db.orm.execute<{ ms: number }>(
    sql`SELECT (extract(epoch FROM effective_end_at) * 1000)::float8 AS ms FROM events WHERE id = ${eventId}`,
  );
  return result.rows[0]!.ms;
}

/** ISO `+07:00` theo giây (như api trả) của một mốc mili giây. */
const isoSeconds = (ms: number) => toEventIso(new Date(Math.floor(ms / 1000) * 1000));

describe('GET …/checker-invite', () => {
  it('chưa có link → { invite: null }', async () => {
    const event = await publishedEvent();
    expect(await latest(event.id)).toEqual({ invite: null });
    expect(await latest(event.id, owner.cookie)).toEqual({ invite: null });
  });
});

describe('POST …/checker-invite (Tạo link mới)', () => {
  it.each(['published', 'hidden'] as const)(
    'tạo lần đầu (%s): 201 {invite, token}; DB chỉ có sha256 của token; audit checker_invite.created không chứa token hay hash; GET không có token',
    async (status) => {
      const event = await publishedEvent();
      if (status === 'hidden') await h.http.post(`${eventsPath()}/${event.id}/hide`).set('cookie', owner.cookie).expect(200);

      const { invite, token } = await created(event.id);
      expect(token).toMatch(CHECKER_INVITE_TOKEN_PATTERN);
      expect(invite.active).toBe(true);
      // Hạn = lúc tạo + 7 ngày (Sự kiện còn xa mới kết thúc); cùng `now()` của transaction.
      expect(Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)).toBe(7 * DAY_MS);
      expect(Math.abs(Date.parse(invite.createdAt) - Date.now())).toBeLessThan(60_000);

      const stored = await rows(event.id);
      expect(stored).toEqual([{ id: invite.id, token_hash: sha256(token), revoked: false, organization_id: orgId }]);
      const { rows: columns } = await h.db.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'checker_invites' ORDER BY ordinal_position`,
      );
      expect(columns.map((c) => c.column_name)).toEqual([
        'id',
        'organization_id',
        'event_id',
        'token_hash',
        'expires_at',
        'revoked_at',
        'created_at',
      ]);

      const trail = await audits(event.id);
      expect(trail).toEqual([
        expect.objectContaining({
          action: 'checker_invite.created',
          actor_user_id: admin.userId,
          organization_id: orgId,
          target_type: 'checker_invite',
          target_id: invite.id,
          changed_fields: [],
        }),
      ]);
      const trailText = JSON.stringify(trail);
      expect(trailText).not.toContain(token);
      expect(trailText).not.toContain(sha256(token));

      const res = await read(event.id).expect(200);
      expect(CheckerInviteResponse.parse(res.body)).toEqual({ invite });
      expect(res.text).not.toContain(token);
      expect(res.text).not.toContain(sha256(token));
      expect(h.logs.text).not.toContain(token);
    },
  );

  it('Owner cũng tạo được (checkers.manage)', async () => {
    const event = await publishedEvent();
    const { invite } = await created(event.id, owner.cookie);
    expect((await audits(event.id))[0]).toMatchObject({ actor_user_id: owner.userId, target_id: invite.id });
  });

  it('tạo lại: link cũ có revoked_at, link mới active, đúng một dòng chưa thu hồi; audit revoked + created; GET trả link mới', async () => {
    const event = await publishedEvent();
    const first = await created(event.id);
    const second = await created(event.id, owner.cookie);
    expect(second.invite.id).not.toBe(first.invite.id);
    expect(second.token).not.toBe(first.token);
    expect(second.invite.active).toBe(true);

    expect(await rows(event.id)).toEqual([
      expect.objectContaining({ id: first.invite.id, token_hash: sha256(first.token), revoked: true }),
      expect.objectContaining({ id: second.invite.id, token_hash: sha256(second.token), revoked: false }),
    ]);
    expect((await audits(event.id)).map((a) => [a.action, a.target_id, a.actor_user_id])).toEqual([
      ['checker_invite.created', first.invite.id, admin.userId],
      ['checker_invite.revoked', first.invite.id, owner.userId],
      ['checker_invite.created', second.invite.id, owner.userId],
    ]);
    expect(await latest(event.id)).toEqual({ invite: second.invite });
  });

  it('hai lần tạo song song: khóa Sự kiện xếp hàng, cả hai 201, còn đúng một link active (là link GET trả)', async () => {
    const event = await publishedEvent();
    const results = await Promise.all([create(event.id), create(event.id, owner.cookie)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const ids = results.map((r) => CreatedCheckerInvite.parse(r.body).invite.id);

    const stored = await rows(event.id);
    expect(stored.map((r) => r.id).sort()).toEqual([...ids].sort());
    const active = stored.filter((r) => !r.revoked);
    expect(active).toHaveLength(1);
    const { invite } = await latest(event.id);
    expect(invite).toMatchObject({ id: active[0]!.id, active: true });
    const actions = (await audits(event.id)).map((a) => a.action).sort();
    expect(actions).toEqual(['checker_invite.created', 'checker_invite.created', 'checker_invite.revoked']);
  });

  it('Sự kiện sắp kết thúc (effective_end_at = now + 2 ngày) → expiresAt = effective_end_at', async () => {
    const event = await publishedEvent();
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() + interval '2 days' WHERE id = ${event.id}`);
    const end = await effectiveEndMs(event.id);
    const { invite } = await created(event.id);
    expect(invite.expiresAt).toBe(isoSeconds(end));
    expect(invite.active).toBe(true);
    const { rows: stored } = await h.db.pool.query<{ diff_ms: number }>(
      `SELECT abs(extract(epoch FROM (i.expires_at - e.effective_end_at)) * 1000)::float8 AS diff_ms
       FROM checker_invites i JOIN events e ON e.id = i.event_id WHERE i.id = $1`,
      [invite.id],
    );
    // Mốc `effective_end_at` đi qua tham số `timestamptz` (độ chính xác mili giây).
    expect(stored[0]!.diff_ms).toBeLessThan(1);
    expect((await latest(event.id)).invite?.expiresAt).toBe(isoSeconds(end));
  });

  describe('trạng thái chặn: không ghi dòng nào, không audit', () => {
    it('nháp → 409 EVENT_STATUS_CONFLICT (details.status draft)', async () => {
      const event = await newEvent();
      const res = await create(event.id).expect(409);
      expect(errorOf(res.body)).toMatchObject({ code: 'EVENT_STATUS_CONFLICT', details: { status: 'draft' } });
      expect(await rows(event.id)).toEqual([]);
      expect(await latest(event.id)).toEqual({ invite: null });
    });

    it('đã hủy → 409 EVENT_CANCELLED; link cũ giữ nguyên, GET active false', async () => {
      const event = await publishedEvent();
      const before = await created(event.id);
      await h.db.orm.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${event.id}`);
      const res = await create(event.id).expect(409);
      expect(errorOf(res.body).code).toBe('EVENT_CANCELLED');
      expect(await rows(event.id)).toEqual([expect.objectContaining({ id: before.invite.id, revoked: false })]);
      expect(await audits(event.id)).toHaveLength(1);
      expect(await latest(event.id)).toEqual({ invite: { ...before.invite, active: false } });
    });

    it('tự hết giờ → 409 EVENT_ALREADY_ENDED', async () => {
      const event = await publishedEvent();
      await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${event.id}`);
      const res = await create(event.id).expect(409);
      expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
      expect(await rows(event.id)).toEqual([]);
    });

    it('"Kết thúc" sớm sau khi tạo link → 409 EVENT_ALREADY_ENDED; link cũ không bị thu hồi nhưng hết hạn ở lúc kết thúc', async () => {
      const event = await publishedEvent(true);
      const before = await created(event.id);
      await h.http.post(`${eventsPath()}/${event.id}/end`).set('cookie', owner.cookie).expect(200);
      const end = await effectiveEndMs(event.id);

      const res = await create(event.id).expect(409);
      expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
      expect(await rows(event.id)).toEqual([expect.objectContaining({ id: before.invite.id, revoked: false })]);
      expect(await audits(event.id)).toHaveLength(1);
      expect(await latest(event.id)).toEqual({
        invite: { ...before.invite, expiresAt: isoSeconds(end), active: false },
      });
    });
  });

  it('"Kết thúc" ghi mốc còn "tương lai" với đồng hồ DB (đồng hồ app nhanh hơn) → 409 EVENT_ALREADY_ENDED, không thu hồi, GET active false', async () => {
    const event = await publishedEvent(true);
    const before = await created(event.id);
    // `events_ended_manually_check`: `effective_end_at` = `ended_manually_at`, cả hai 5 giây sau `now()` của DB.
    await h.db.orm.execute(
      sql`UPDATE events SET ended_manually_at = now() + interval '5 seconds', effective_end_at = now() + interval '5 seconds'
          WHERE id = ${event.id}`,
    );
    const res = await create(event.id).expect(409);
    expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
    expect(await rows(event.id)).toEqual([expect.objectContaining({ id: before.invite.id, revoked: false })]);
    expect(await audits(event.id)).toHaveLength(1);
    expect((await latest(event.id)).invite).toMatchObject({ id: before.invite.id, active: false });
  });

  it('link quá hạn lưu (expires_at đã qua) → GET active false, expiresAt = expires_at', async () => {
    const event = await publishedEvent();
    const { invite } = await created(event.id);
    await migrator.pool.query(`UPDATE checker_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      invite.id,
    ]);
    const { rows: stored } = await h.db.pool.query<{ ms: number }>(
      `SELECT (extract(epoch FROM expires_at) * 1000)::float8 AS ms FROM checker_invites WHERE id = $1`,
      [invite.id],
    );
    expect(await latest(event.id)).toEqual({ invite: { ...invite, expiresAt: isoSeconds(stored[0]!.ms), active: false } });
    // Hết hạn không chặn tạo link mới (Sự kiện còn mở): link hết hạn bị thu hồi như link còn hạn.
    const next = await created(event.id);
    expect((await rows(event.id)).map((r) => [r.id, r.revoked])).toEqual([
      [invite.id, true],
      [next.invite.id, false],
    ]);
  });
});

describe('cách ly và quyền', () => {
  it('Sự kiện của BTC khác qua BTC của mình → 404 EVENT_NOT_FOUND (kể cả Sự kiện nháp: kiểm Sự kiện trước trạng thái)', async () => {
    const event = await newEvent();
    // Gọi tuần tự (supertest mở server khi gửi, không tạo trước cả hai request).
    for (const call of [() => read(event.id, ownerB.cookie, orgB), () => create(event.id, ownerB.cookie, orgB)]) {
      const res = await call().expect(404);
      expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
    }
    expect(await rows(event.id)).toEqual([]);
  });

  it('id lạ hoặc sai dạng → 404 EVENT_NOT_FOUND', async () => {
    for (const id of ['019a3b2c-0712-7abc-8def-0123456789ab', 'khong-phai-uuid']) {
      expect(errorOf((await read(id).expect(404)).body).code).toBe('EVENT_NOT_FOUND');
      expect(errorOf((await create(id).expect(404)).body).code).toBe('EVENT_NOT_FOUND');
    }
  });

  it('không phải thành viên BTC → 403 NOT_A_MEMBER, không lộ dữ liệu', async () => {
    const event = await publishedEvent();
    await created(event.id);
    for (const call of [() => read(event.id, ownerB.cookie), () => create(event.id, ownerB.cookie)]) {
      const res = await call().expect(403);
      expect(errorOf(res.body).code).toBe('NOT_A_MEMBER');
    }
    expect(await rows(event.id)).toHaveLength(1);
  });
});

describe('ràng buộc DB', () => {
  it('tickee_app chỉ UPDATE được revoked_at', async () => {
    const event = await publishedEvent();
    const { invite } = await created(event.id);
    for (const column of [
      'expires_at = now()',
      `token_hash = '${'0'.repeat(64)}'`,
      'event_id = event_id',
      'created_at = now()',
      'organization_id = organization_id',
      'id = id',
    ]) {
      await expect(h.db.pool.query(`UPDATE checker_invites SET ${column} WHERE id = $1`, [invite.id]), column).rejects.toThrow(
        /permission denied/,
      );
    }
    await h.db.pool.query('UPDATE checker_invites SET revoked_at = now() WHERE id = $1', [invite.id]);
    expect(await rows(event.id)).toEqual([expect.objectContaining({ id: invite.id, revoked: true })]);
  });

  it('một Sự kiện không có hai link chưa thu hồi; token_hash phải là hex 64', async () => {
    const event = await publishedEvent();
    await created(event.id);
    const insert = (hash: string) =>
      h.db.pool.query(
        `INSERT INTO checker_invites (organization_id, event_id, token_hash, expires_at) VALUES ($1, $2, $3, now())`,
        [orgId, event.id, hash],
      );
    await expect(insert(sha256('khac'))).rejects.toMatchObject({
      code: '23505',
      constraint: 'checker_invites_one_active_per_event_key',
    });
    await expect(insert('khong-phai-hash')).rejects.toMatchObject({
      code: '23514',
      constraint: 'checker_invites_token_hash_check',
    });
  });
});
