import { createHash, randomBytes } from 'node:crypto';
import {
  AcceptedCheckerInvite,
  CheckerInvitePreview,
  CheckerInviteResponse,
  CreatedCheckerInvite,
  ErrorResponse,
  EventDetail,
  Role,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/platform/db/index.js';
import { migrationDatabaseUrl } from '../helpers.js';
import { createHarness, newEmail, signIn, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 5.2-a: xem trước và nhận lời mời CTV (`POST /v1/checkin/invites/{preview,accept}`) trên Postgres thật. Mỗi test
 * dùng một BTC mới (Owner, Admin chung) và CTV mới. Trạng thái Sự kiện đặt thẳng bằng SQL (role `tickee_app`); hạn lưu
 * của link (`expires_at`, cột khóa với `tickee_app`) đổi bằng role migrator. Thu hồi CTV (Story 5.6 chưa có) đặt bằng SQL.
 */

const ORG_NAME = 'CLB Chạy Bộ';

let h: Harness;
let migrator: Database;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let checker: Awaited<ReturnType<typeof signUp>>;

const draft = {
  name: 'Giải chạy Hồ Tây 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

beforeAll(async () => {
  h = await createHarness();
  migrator = new Database({ connectionString: migrationDatabaseUrl(), max: 1 });
  owner = await signUp(h);
  admin = await signUp(h);
});
beforeEach(async () => {
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: ORG_NAME }).expect(201)).body.id as string;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  checker = await signUp(h);
});
afterAll(async () => {
  await migrator.close();
  await h.close();
});

const eventsPath = () => `/v1/orgs/${orgId}/events`;
const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const preview = (token: string, cookie?: string) => {
  const req = h.http.post('/v1/checkin/invites/preview');
  if (cookie) req.set('cookie', cookie);
  return req.send({ token });
};
const accept = (token: string, cookie?: string) => {
  const req = h.http.post('/v1/checkin/invites/accept');
  if (cookie) req.set('cookie', cookie);
  return req.send({ token });
};

/** Sự kiện miễn phí đã mở bán, kèm link mời CTV mới (Admin tạo). */
async function eventWithInvite(): Promise<{ event: EventDetail; invite: CreatedCheckerInvite }> {
  const event = EventDetail.parse((await h.http.post(eventsPath()).set('cookie', owner.cookie).send(draft).expect(201)).body);
  await h.http
    .post(`${eventsPath()}/${event.id}/ticket-types`)
    .set('cookie', owner.cookie)
    .send({ name: 'Miễn phí', price: 0, capacity: 50 })
    .expect(201);
  await h.http.post(`${eventsPath()}/${event.id}/publish`).set('cookie', owner.cookie).expect(200);
  return { event, invite: await createInvite(event.id) };
}

async function createInvite(eventId: string): Promise<CreatedCheckerInvite> {
  const res = await h.http.post(`${eventsPath()}/${eventId}/checker-invite`).set('cookie', admin.cookie).expect(201);
  return CreatedCheckerInvite.parse(res.body);
}

async function latestActive(eventId: string): Promise<boolean | undefined> {
  const res = await h.http.get(`${eventsPath()}/${eventId}/checker-invite`).set('cookie', admin.cookie).expect(200);
  return CheckerInviteResponse.parse(res.body).invite?.active;
}

/** Cách làm link (đang còn hiệu lực) không dùng được nữa. */
const BROKEN = {
  /** Hạn lưu đã qua. */
  expired: async (_eventId: string, created: CreatedCheckerInvite) => {
    const { rowCount } = await migrator.pool.query(
      `UPDATE checker_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [created.invite.id],
    );
    expect(rowCount).toBe(1);
  },
  /** "Tạo link mới" thu hồi link cũ. */
  replaced: async (eventId: string) => void (await createInvite(eventId)),
  cancelled: (eventId: string) => h.db.orm.execute(sql`UPDATE events SET status = 'cancelled' WHERE id = ${eventId}`),
  /** "Kết thúc" với mốc còn "tương lai" theo đồng hồ DB (đồng hồ app nhanh hơn): vẫn là đã kết thúc. */
  ended_manually: (eventId: string) =>
    h.db.orm.execute(
      sql`UPDATE events SET ended_manually_at = now() + interval '5 seconds', effective_end_at = now() + interval '5 seconds'
          WHERE id = ${eventId}`,
    ),
  /** Tự hết giờ: đồng hồ DB đã qua `effective_end_at` (hạn hiệu lực = min với hạn lưu). */
  time_ended: (eventId: string) =>
    h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${eventId}`),
} satisfies Record<string, (eventId: string, invite: CreatedCheckerInvite) => Promise<unknown>>;
type BrokenState = keyof typeof BROKEN;
const BROKEN_STATES = Object.keys(BROKEN) as BrokenState[];

async function brokenInvite(state: BrokenState): Promise<{ event: EventDetail; invite: CreatedCheckerInvite }> {
  const made = await eventWithInvite();
  await BROKEN[state](made.event.id, made.invite);
  return made;
}

type CheckerRow = { id: string; user_id: string; status: string; organization_id: string; recent: boolean };

async function checkerRows(eventId: string): Promise<CheckerRow[]> {
  const result = await h.db.orm.execute<CheckerRow>(
    sql`SELECT id, user_id, status, organization_id, abs(extract(epoch FROM now() - created_at)) < 60 AS recent
        FROM checkers WHERE event_id = ${eventId} ORDER BY id`,
  );
  return result.rows;
}

async function joinedAudits(eventId: string) {
  const result = await h.db.orm.execute<Record<string, unknown>>(
    sql`SELECT a.* FROM audit_events a
        WHERE a.action = 'checker.joined'
          AND a.target_id IN (SELECT id::text FROM checkers WHERE event_id = ${eventId})
        ORDER BY a.id`,
  );
  return result.rows;
}

const revoke = (eventId: string, userId: string) =>
  h.db.orm.execute(
    sql`UPDATE checkers SET status = 'revoked', revoked_at = now(), revoked_by = ${owner.userId}
        WHERE event_id = ${eventId} AND user_id = ${userId}`,
  );

/** Response lỗi về link: đúng mã, không lộ tên Sự kiện, tên BTC hay id. */
function expectInvalidLink(res: { status: number; body: unknown; text: string }, event: EventDetail, label: string) {
  expect(res.status, label).toBe(404);
  expect(errorOf(res.body), label).toEqual({
    code: 'CHECKER_INVITE_INVALID',
    message: 'Link mời đã hết hạn. Liên hệ BTC để nhận link mới.',
    details: null,
  });
  for (const secret of [event.name, ORG_NAME, event.id, orgId]) expect(res.text, label).not.toContain(secret);
}

async function waitingOnLocks(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'tickee-api' AND wait_event_type = 'Lock'`,
  );
  return rows[0]!.n;
}

/**
 * Gửi các request trong một transaction khác đang giữ khóa (chạy `statements` trước); commit khi cả `n` request đang chờ
 * khóa. Lỗi giữa chừng thì ROLLBACK và chờ các request xong trước khi trả kết nối về pool (không để lại khóa).
 */
async function whileHolding<T>(statements: [string, unknown[]][], n: number, send: () => Promise<T>[]): Promise<T[]> {
  const client: pg.PoolClient = await h.db.pool.connect();
  let pending: Promise<T[]> | undefined;
  try {
    await client.query('BEGIN');
    for (const statement of statements) await client.query(...statement);
    pending = Promise.all(send());
    await expect.poll(waitingOnLocks, { timeout: 15_000, interval: 50 }).toBe(n);
    await client.query('COMMIT');
    return await pending;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    await pending?.catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Token đúng dạng (22 ký tự base64url) nhưng không khớp link nào. */
const unknownToken = () => randomBytes(16).toString('base64url');

describe('POST /v1/checkin/invites/preview', () => {
  it('link còn hiệu lực: ẩn danh và người chưa có quyền → 200 {eventName, organizationName, scanEventId: null}; no-store; token không vào log', async () => {
    const { event, invite } = await eventWithInvite();
    const stranger = await signUp(h);
    for (const cookie of [undefined, stranger.cookie]) {
      const res = await preview(invite.token, cookie).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(CheckerInvitePreview.parse(res.body)).toEqual({
        eventName: draft.name,
        organizationName: ORG_NAME,
        scanEventId: null,
      });
    }
    expect(await checkerRows(event.id)).toEqual([]);
    expect(h.logs.text).not.toContain(invite.token);
  });

  it.each(['valid', ...BROKEN_STATES] as const)(
    'người đã có quyền quét (CTV active, Owner, Admin) → scanEventId, kể cả khi link không còn hiệu lực (%s)',
    async (state) => {
      const { event, invite } = await eventWithInvite();
      await accept(invite.token, checker.cookie).expect(200);
      if (state !== 'valid') await BROKEN[state](event.id, invite);
      for (const cookie of [checker.cookie, owner.cookie, admin.cookie]) {
        const res = await preview(invite.token, cookie).expect(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(CheckerInvitePreview.parse(res.body)).toEqual({
          eventName: draft.name,
          organizationName: ORG_NAME,
          scanEventId: event.id,
        });
      }
    },
  );

  it.each(BROKEN_STATES)('link không còn hiệu lực (%s), người xem chưa có quyền → 404 CHECKER_INVITE_INVALID', async (state) => {
    const { event, invite } = await brokenInvite(state);
    const stranger = await signUp(h);
    for (const cookie of [undefined, stranger.cookie]) {
      const res = await preview(invite.token, cookie);
      expectInvalidLink(res, event, `${state} ${cookie ? 'đã đăng nhập' : 'ẩn danh'}`);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('token sai hoặc sai dạng → 404 CHECKER_INVITE_INVALID (kể cả người là Owner: không có link nào khớp)', async () => {
    const { event, invite } = await eventWithInvite();
    for (const token of [unknownToken(), 'khong-phai-token', 'a', invite.token.toUpperCase(), sha256(invite.token)]) {
      for (const cookie of [undefined, owner.cookie]) expectInvalidLink(await preview(token, cookie), event, token);
    }
  });

  it('CTV đã bị thu hồi xem link còn hiệu lực → scanEventId null (chưa có quyền quét)', async () => {
    const { event, invite } = await eventWithInvite();
    await accept(invite.token, checker.cookie).expect(200);
    await revoke(event.id, checker.userId);
    const res = await preview(invite.token, checker.cookie).expect(200);
    expect(CheckerInvitePreview.parse(res.body).scanEventId).toBeNull();
  });

  it('body sai (thiếu token, quá 256 ký tự, không phải chuỗi) → 400 VALIDATION_FAILED', async () => {
    for (const body of [{}, { token: '' }, { token: 'x'.repeat(257) }, { token: 42 }]) {
      const res = await h.http.post('/v1/checkin/invites/preview').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    }
  });

  it('đã đăng nhập mà chưa đồng ý NĐ 13 → 403 CONSENT_REQUIRED (guard toàn cục vẫn áp ở @OptionalAuth)', async () => {
    const { invite } = await eventWithInvite();
    const cookie = await signIn(h, newEmail());
    const res = await preview(invite.token, cookie);
    expect(res.status).toBe(403);
    expect(errorOf(res.body).code).toBe('CONSENT_REQUIRED');
  });
});

describe('POST /v1/checkin/invites/accept', () => {
  it('nhận lần đầu: 200 {eventId}; một dòng active; audit checker.joined không chứa token hay hash; no-store', async () => {
    const { event, invite } = await eventWithInvite();
    const res = await accept(invite.token, checker.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(AcceptedCheckerInvite.parse(res.body)).toEqual({ eventId: event.id });

    const rows = await checkerRows(event.id);
    expect(rows).toEqual([
      { id: expect.any(String), user_id: checker.userId, status: 'active', organization_id: orgId, recent: true },
    ]);
    const trail = await joinedAudits(event.id);
    expect(trail).toEqual([
      expect.objectContaining({
        action: 'checker.joined',
        actor_user_id: checker.userId,
        organization_id: orgId,
        target_type: 'checker',
        target_id: rows[0]!.id,
        changed_fields: [],
      }),
    ]);
    const trailText = JSON.stringify(trail);
    expect(trailText).not.toContain(invite.token);
    expect(trailText).not.toContain(sha256(invite.token));
    expect(h.logs.text).not.toContain(invite.token);
  });

  it('nhận lại khi đã là CTV active → 200, không ghi thêm; kể cả khi link đã hết hiệu lực', async () => {
    const { event, invite } = await eventWithInvite();
    await accept(invite.token, checker.cookie).expect(200);
    const before = await checkerRows(event.id);
    expect((await accept(invite.token, checker.cookie).expect(200)).body).toEqual({ eventId: event.id });
    await BROKEN.cancelled(event.id);
    expect((await accept(invite.token, checker.cookie).expect(200)).body).toEqual({ eventId: event.id });
    expect(await checkerRows(event.id)).toEqual(before);
    expect(await joinedAudits(event.id)).toHaveLength(1);
  });

  it('Owner/Admin nhận → 200 {eventId}, không ghi dòng hay audit (quét không cần lời mời)', async () => {
    const { event, invite } = await eventWithInvite();
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect((await accept(invite.token, cookie).expect(200)).body).toEqual({ eventId: event.id });
    }
    expect(await checkerRows(event.id)).toEqual([]);
    expect(await joinedAudits(event.id)).toEqual([]);
  });

  it('đã bị thu hồi → 403 CHECKER_REVOKED, không kích hoạt lại: link cũ, link mới, link đã hỏng', async () => {
    const { event, invite } = await eventWithInvite();
    await accept(invite.token, checker.cookie).expect(200);
    await revoke(event.id, checker.userId);
    const fresh = await createInvite(event.id);
    // `invite` đã bị "Tạo link mới" thu hồi: dòng `revoked` vẫn thắng lỗi về link.
    for (const token of [fresh.token, invite.token]) {
      const res = await accept(token, checker.cookie);
      expect(res.status, token).toBe(403);
      expect(errorOf(res.body)).toEqual({
        code: 'CHECKER_REVOKED',
        message: 'Bạn không còn quyền soát vé cho Sự kiện này.',
        details: null,
      });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect((await checkerRows(event.id)).map((r) => r.status)).toEqual(['revoked']);
    expect(await joinedAudits(event.id)).toHaveLength(1);
  });

  it.each(BROKEN_STATES)('link không còn hiệu lực (%s) → 404 CHECKER_INVITE_INVALID, không ghi gì', async (state) => {
    const { event, invite } = await brokenInvite(state);
    const res = await accept(invite.token, checker.cookie);
    expectInvalidLink(res, event, state);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await checkerRows(event.id)).toEqual([]);
    expect(await joinedAudits(event.id)).toEqual([]);
  });

  it('token sai hoặc sai dạng → 404 CHECKER_INVITE_INVALID', async () => {
    const { event } = await eventWithInvite();
    for (const token of [unknownToken(), 'khong-phai-token']) expectInvalidLink(await accept(token, checker.cookie), event, token);
    expect(await checkerRows(event.id)).toEqual([]);
  });

  it('chưa đăng nhập → 401 UNAUTHENTICATED, không ghi gì', async () => {
    const { event, invite } = await eventWithInvite();
    const res = await accept(invite.token);
    expect(res.status).toBe(401);
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
    expect(await checkerRows(event.id)).toEqual([]);
  });

  it('nhiều lần nhận song song của cùng user (cùng chờ khóa Sự kiện rồi chạy một lượt) → tất cả 200, đúng một dòng, một audit', async () => {
    const { event, invite } = await eventWithInvite();
    const results = await whileHolding(
      [['SELECT id FROM events WHERE id = $1 FOR UPDATE', [event.id]]],
      3,
      () => [1, 2, 3].map(() => accept(invite.token, checker.cookie).then((res) => res)),
    );
    expect(results.map((r) => [r.status, r.body])).toEqual(results.map(() => [200, { eventId: event.id }]));
    expect(await checkerRows(event.id)).toHaveLength(1);
    expect(await joinedAudits(event.id)).toHaveLength(1);
  });

  it.each([
    ['active', 200],
    ['revoked', 403],
  ] as const)(
    'INSERT trùng với dòng %s vừa commit (lần nhận khác xen giữa) → đọc lại dòng đó: %i, không ghi audit',
    async (status, expected) => {
      const { event, invite } = await eventWithInvite();
      // Dòng chưa commit: lần nhận không thấy (READ COMMITTED), INSERT … ON CONFLICT chờ trên unique rồi không chèn.
      const [res] = await whileHolding(
        [
          [
            // `checkers_revoked_check` (Story 5.6): dòng `revoked` có người và lúc thu hồi.
            `INSERT INTO checkers (organization_id, event_id, user_id, status, revoked_at, revoked_by)
             VALUES ($1, $2, $3, $4::text, CASE WHEN $4::text = 'revoked' THEN now() END,
                     CASE WHEN $4::text = 'revoked' THEN $5::uuid END)`,
            [orgId, event.id, checker.userId, status, owner.userId],
          ],
        ],
        1,
        () => [accept(invite.token, checker.cookie).then((r) => r)],
      );
      expect(res!.status).toBe(expected);
      if (expected === 200) expect(res!.body).toEqual({ eventId: event.id });
      else expect(errorOf(res!.body).code).toBe('CHECKER_REVOKED');
      expect((await checkerRows(event.id)).map((r) => r.status)).toEqual([status]);
      expect(await joinedAudits(event.id)).toEqual([]);
    },
  );

  it('chờ khóa Sự kiện (FOR SHARE) trong lúc BTC "Kết thúc" Sự kiện → đọc trạng thái đã commit: 404 CHECKER_INVITE_INVALID, không ghi dòng', async () => {
    const { event, invite } = await eventWithInvite();
    // Như "Kết thúc": khóa dòng Sự kiện `FOR UPDATE`, đặt `ended_manually_at` = `effective_end_at` = `now()`.
    const [res] = await whileHolding(
      [
        ['SELECT id FROM events WHERE id = $1 FOR UPDATE', [event.id]],
        ['UPDATE events SET ended_manually_at = now(), effective_end_at = now() WHERE id = $1', [event.id]],
      ],
      1,
      () => [accept(invite.token, checker.cookie).then((r) => r)],
    );
    expectInvalidLink(res!, event, 'Kết thúc trong lúc nhận');
    expect(await checkerRows(event.id)).toEqual([]);
    expect(await joinedAudits(event.id)).toEqual([]);
  });

  it.each(BROKEN_STATES)(
    'Owner/Admin nhận trên link không còn hiệu lực (%s) → 200 {eventId}, không ghi dòng hay audit',
    async (state) => {
      const { event, invite } = await brokenInvite(state);
      for (const cookie of [owner.cookie, admin.cookie]) {
        expect((await accept(invite.token, cookie).expect(200)).body).toEqual({ eventId: event.id });
      }
      expect(await checkerRows(event.id)).toEqual([]);
      expect(await joinedAudits(event.id)).toEqual([]);
    },
  );

  it('Admin cũng có dòng checkers revoked → vai BTC thắng: accept 200 {eventId}, preview scanEventId; dòng vẫn revoked', async () => {
    const { event, invite } = await eventWithInvite();
    await h.db.orm.execute(
      sql`INSERT INTO checkers (organization_id, event_id, user_id, status, revoked_at, revoked_by)
          VALUES (${orgId}, ${event.id}, ${admin.userId}, 'revoked', now(), ${owner.userId})`,
    );
    expect((await accept(invite.token, admin.cookie).expect(200)).body).toEqual({ eventId: event.id });
    const res = await preview(invite.token, admin.cookie).expect(200);
    expect(CheckerInvitePreview.parse(res.body).scanEventId).toBe(event.id);
    expect((await checkerRows(event.id)).map((r) => [r.user_id, r.status])).toEqual([[admin.userId, 'revoked']]);
    expect(await joinedAudits(event.id)).toEqual([]);
  });

  it('hai CTV khác nhau cùng một link → hai dòng', async () => {
    const { event, invite } = await eventWithInvite();
    const other = await signUp(h);
    await Promise.all([accept(invite.token, checker.cookie).expect(200), accept(invite.token, other.cookie).expect(200)]);
    expect((await checkerRows(event.id)).map((r) => r.user_id).sort()).toEqual([checker.userId, other.userId].sort());
  });
});

describe('luật "link còn hiệu lực" dùng chung', () => {
  it.each(['valid', ...BROKEN_STATES] as const)(
    '%s: GET …/checker-invite (active) như Story 5.1 và khớp xem trước ẩn danh',
    async (state) => {
      const { event, invite } = await eventWithInvite();
      if (state !== 'valid') await BROKEN[state](event.id, invite);
      const previewStatus = (await preview(invite.token)).status;
      // Link "replaced": GET trả link mới (còn hiệu lực); link cũ chỉ còn kiểm được qua xem trước.
      if (state === 'replaced') {
        expect(await latestActive(event.id)).toBe(true);
        expect(previewStatus).toBe(404);
        return;
      }
      const active = state === 'valid';
      expect(await latestActive(event.id)).toBe(active);
      expect(previewStatus).toBe(active ? 200 : 404);
    },
  );
});

describe('ràng buộc DB của checkers', () => {
  it('cột đúng; tickee_app chỉ UPDATE được status, revoked_by, revoked_at', async () => {
    const { rows: columns } = await h.db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'checkers' ORDER BY ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'organization_id',
      'event_id',
      'user_id',
      'status',
      'revoked_by',
      'revoked_at',
      'created_at',
    ]);

    const { event, invite } = await eventWithInvite();
    await accept(invite.token, checker.cookie).expect(200);
    const [row] = await checkerRows(event.id);
    for (const column of [
      'id = id',
      'organization_id = organization_id',
      'event_id = event_id',
      'user_id = user_id',
      'created_at = now()',
    ]) {
      await expect(h.db.pool.query(`UPDATE checkers SET ${column} WHERE id = $1`, [row!.id]), column).rejects.toThrow(
        /permission denied/,
      );
    }
    await h.db.pool.query(`UPDATE checkers SET status = 'revoked', revoked_by = $2, revoked_at = now() WHERE id = $1`, [
      row!.id,
      owner.userId,
    ]);
    expect((await checkerRows(event.id)).map((r) => r.status)).toEqual(['revoked']);
  });

  it('unique (event_id, user_id); status chỉ active|revoked', async () => {
    const { event, invite } = await eventWithInvite();
    await accept(invite.token, checker.cookie).expect(200);
    const insert = (userId: string, status: string) =>
      h.db.pool.query(`INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES ($1, $2, $3, $4)`, [
        orgId,
        event.id,
        userId,
        status,
      ]);
    await expect(insert(checker.userId, 'active')).rejects.toMatchObject({
      code: '23505',
      constraint: 'checkers_event_id_user_id_key',
    });
    // `paused` vi phạm cả `checkers_status_check` lẫn `checkers_revoked_check` (Story 5.6); Postgres báo ràng buộc đầu
    // theo tên, nên kiểm thêm cả hai ràng buộc đều có.
    await expect(insert(owner.userId, 'paused')).rejects.toMatchObject({
      code: '23514',
      constraint: expect.stringMatching(/^checkers_(status|revoked)_check$/),
    });
    const { rows } = await h.db.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'checkers'::regclass AND contype = 'c' ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual(['checkers_revoked_check', 'checkers_status_check']);
  });
});
