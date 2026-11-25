import { randomUUID } from 'node:crypto';
import {
  CheckerList,
  CreatedCheckerInvite,
  ErrorResponse,
  IDEMPOTENCY_KEY_HEADER,
  Role,
  ScanResult,
  toEventIso,
  type BuyerTicket,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  buyerInput,
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type SaleEvent,
  type User,
} from '../ordering/order-fixtures.js';

/*
 * Story 5.6: danh sách CTV (`GET /v1/orgs/:orgId/events/:eventId/checkers`, flows), "Thu hồi" / "Khôi phục"
 * (`POST …/checkers/:checkerId/{revoke,restore}`, checkin), CHECK `checkers_revoked_check` và hết quyền theo thời gian
 * (`403 EVENT_ENDED` ở guard nhánh Sự kiện, AD-14), trên Postgres thật. BTC chính có Owner và Admin; CTV nhận lời mời
 * bằng link thật. Mốc kết thúc của Sự kiện đặt bằng SQL như `scan.test.ts`.
 */

const TIER = 'Vé tham dự';

let h: Harness;
let org: Org;
let orgB: Org;
let admin: User;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Bơi Lội Quận 7' });
  orgB = await paidReadyOrg(h, { name: 'CLB Cầu Lông' });
  admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

type Caller = User | Org['owner'];

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

/** Sự kiện 0đ đã mở bán của BTC `owner` (mặc định BTC chính). */
const freeEvent = (owner: Org = org) => eventOnSale(owner, [{ name: TIER, price: 0, capacity: 100 }]);

/** Token link mời mới của Sự kiện (Owner tạo link mới). */
async function inviteToken(sale: SaleEvent, owner: Org = org): Promise<string> {
  const res = await h.http
    .post(`/v1/orgs/${owner.orgId}/events/${sale.event.id}/checker-invite`)
    .set('cookie', owner.owner.cookie)
    .expect(201);
  return CreatedCheckerInvite.parse(res.body).token;
}

const accept = (token: string, caller: Caller) =>
  h.http.post('/v1/checkin/invites/accept').set('cookie', caller.cookie).send({ token });

/** Tài khoản mới nhận lời mời CTV của Sự kiện. */
async function checkerOf(sale: SaleEvent, owner: Org = org): Promise<User> {
  const created = await signUp(h);
  await accept(await inviteToken(sale, owner), created).expect(200);
  return created;
}

/** Id dòng `checkers` của `user` ở Sự kiện. */
async function checkerIdOf(sale: SaleEvent, user: User): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>(
    'SELECT id FROM checkers WHERE event_id = $1 AND user_id = $2',
    [sale.event.id, user.userId],
  );
  return rows[0]!.id;
}

interface CheckerDbRow {
  status: string;
  revoked_by: string | null;
  revoked_at: Date | null;
}

async function checkerRow(id: string): Promise<CheckerDbRow> {
  const { rows } = await h.db.pool.query<CheckerDbRow>(
    'SELECT status, revoked_by, revoked_at FROM checkers WHERE id = $1',
    [id],
  );
  return rows[0]!;
}

/** Dòng audit thu hồi/khôi phục của một CTV, cũ trước (bỏ `checker.joined` lúc nhận lời mời). */
async function audits(checkerId: string) {
  const { rows } = await h.db.pool.query<Record<string, unknown>>(
    `SELECT action, actor_user_id, organization_id, target_type, target_id, changed_fields FROM audit_events
      WHERE target_type = 'checker' AND target_id = $1 AND action IN ('checker.revoked', 'checker.restored')
      ORDER BY id`,
    [checkerId],
  );
  return rows;
}

const auditOf = (action: string, actor: Caller, checkerId: string, organizationId = org.orgId) => ({
  action,
  actor_user_id: actor.userId,
  organization_id: organizationId,
  target_type: 'checker',
  target_id: checkerId,
  changed_fields: ['status'],
});

const listPath = (eventId: string, orgId = org.orgId) => `/v1/orgs/${orgId}/events/${eventId}/checkers`;
const actionPath = (eventId: string, checkerId: string, action: 'revoke' | 'restore', orgId = org.orgId) =>
  `${listPath(eventId, orgId)}/${checkerId}/${action}`;

const list = (eventId: string, caller: Caller = org.owner, orgId = org.orgId) =>
  h.http.get(listPath(eventId, orgId)).set('cookie', caller.cookie);

async function listOk(eventId: string, caller: Caller = org.owner): Promise<CheckerList> {
  const res = await list(eventId, caller);
  expect(res.status, res.text).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return CheckerList.parse(res.body);
}

const act = (
  eventId: string,
  checkerId: string,
  action: 'revoke' | 'restore',
  caller: Caller = org.owner,
  orgId = org.orgId,
) => h.http.post(actionPath(eventId, checkerId, action, orgId)).set('cookie', caller.cookie);

async function actOk(eventId: string, checkerId: string, action: 'revoke' | 'restore', caller: Caller = org.owner) {
  const res = await act(eventId, checkerId, action, caller);
  expect(res.status, res.text).toBe(204);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.text).toBe('');
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

/** Người mua mới nhận một Vé 0đ của Sự kiện. */
async function issue(sale: SaleEvent): Promise<BuyerTicket> {
  const buyer = await signUp(h);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return parseOrder(res.body).tickets[0]!;
}

const scan = (eventId: string, caller: Caller, code: string) =>
  h.http.post(`/v1/checkin/events/${eventId}/scans`).set('cookie', caller.cookie).send({ code, scanId: randomUUID() });

const okOf = (ticket: BuyerTicket) => ({
  outcome: 'ok',
  holderName: buyerInput.name,
  seq: ticket.seq,
  count: ticket.count,
  ticketTypeName: TIER,
});

/** Bốn route CTV (`/v1/checkin/events/:eventId/…`): Sự kiện của Màn quét, quét, tra tay, check-in tay. */
const checkerRoutes = (eventId: string, ticket: BuyerTicket) =>
  [
    ['GET Sự kiện', (c: Caller) => h.http.get(`/v1/checkin/events/${eventId}`).set('cookie', c.cookie)],
    ['quét', (c: Caller) => scan(eventId, c, ticket.qr)],
    [
      'tra tay',
      (c: Caller) =>
        h.http.post(`/v1/checkin/events/${eventId}/lookups`).set('cookie', c.cookie).send({ query: '0912345678' }),
    ],
    [
      'check-in tay',
      (c: Caller) =>
        h.http
          .post(`/v1/checkin/events/${eventId}/tickets/${ticket.id}/check-in`)
          .set('cookie', c.cookie)
          .set(IDEMPOTENCY_KEY_HEADER, randomUUID()),
    ],
  ] as const;

const NO_LONGER = 'Bạn không còn quyền soát vé cho Sự kiện này.';

const CLOSE = {
  /** Đồng hồ DB đã qua `effective_end_at`. */
  time_ended: (eventId: string) =>
    h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${eventId}`),
  /** "Kết thúc" với mốc còn "tương lai" theo đồng hồ DB: vẫn là đã kết thúc. */
  ended_manually: (eventId: string) =>
    h.db.orm.execute(
      sql`UPDATE events SET ended_manually_at = now() + interval '5 seconds', effective_end_at = now() + interval '5 seconds'
          WHERE id = ${eventId}`,
    ),
} satisfies Record<string, (eventId: string) => Promise<unknown>>;

describe('GET /v1/orgs/:orgId/events/:eventId/checkers', () => {
  it('chưa có CTV → []; Owner và Admin đọc được; no-store', async () => {
    const sale = await freeEvent();
    expect(await listOk(sale.event.id)).toEqual({ checkers: [] });
    expect(await listOk(sale.event.id, admin)).toEqual({ checkers: [] });
  });

  it('mọi CTV kể cả đã thu hồi, theo lúc nhận tăng dần (không đổi chỗ khi đổi trạng thái); tên đã trim, rỗng → null; tài khoản không còn → name/email null', async () => {
    const sale = await freeEvent();
    const first = await checkerOf(sale);
    const second = await checkerOf(sale);
    const third = await checkerOf(sale);
    await h.db.orm.execute(sql`UPDATE users SET name = '  Trần Thị Bình  ' WHERE id = ${second.userId}`);
    await h.db.orm.execute(sql`UPDATE users SET name = '   ' WHERE id = ${third.userId}`);
    // Tài khoản không còn: `checkers.user_id` không có FK tới `users`.
    const ghostId = randomUUID();
    await h.db.orm.execute(
      sql`INSERT INTO checkers (organization_id, event_id, user_id, status, created_at)
          VALUES (${org.orgId}, ${sale.event.id}, ${ghostId}, 'active', now() + interval '1 minute')`,
    );
    const ids = [await checkerIdOf(sale, first), await checkerIdOf(sale, second), await checkerIdOf(sale, third)];
    // Thu hồi CTV đầu (thứ tự giữ nguyên).
    await actOk(sale.event.id, ids[0]!, 'revoke', admin);

    const { checkers } = await listOk(sale.event.id);
    const { rows } = await h.db.pool.query<{ id: string; created_at: Date; revoked_at: Date | null }>(
      'SELECT id, created_at, revoked_at FROM checkers WHERE event_id = $1 ORDER BY created_at, id',
      [sale.event.id],
    );
    expect(checkers.map((c) => c.id)).toEqual(rows.map((r) => r.id));
    expect(checkers.slice(0, 3).map((c) => c.id)).toEqual(ids);
    const active = (i: number, name: string | null, email: string | null) => ({
      id: rows[i]!.id,
      name,
      email,
      acceptedAt: toEventIso(rows[i]!.created_at),
      status: 'active',
      revokedAt: null,
    });
    expect(checkers).toEqual([
      {
        id: ids[0],
        name: null,
        email: first.email,
        acceptedAt: toEventIso(rows[0]!.created_at),
        status: 'revoked',
        revokedAt: toEventIso(rows[0]!.revoked_at!),
      },
      active(1, 'Trần Thị Bình', second.email),
      active(2, null, third.email),
      active(3, null, null),
    ]);
  });

  it('chỉ CTV của đúng Sự kiện', async () => {
    const sale = await freeEvent();
    const other = await freeEvent();
    const mine = await checkerOf(sale);
    await checkerOf(other);
    const { checkers } = await listOk(sale.event.id);
    expect(checkers.map((c) => c.email)).toEqual([mine.email]);
  });

  it('Sự kiện của BTC khác, lạ, sai dạng → 404 EVENT_NOT_FOUND; không lộ CTV', async () => {
    const foreign = await freeEvent(orgB);
    const foreignChecker = await checkerOf(foreign, orgB);
    for (const eventId of [foreign.event.id, randomUUID(), 'khong-phai-uuid']) {
      const res = await list(eventId);
      expect(res.status, eventId).toBe(404);
      expect(errorOf(res.body).code, eventId).toBe('EVENT_NOT_FOUND');
      expect(res.text).not.toContain(foreignChecker.email);
    }
    // Owner A trên đường dẫn của BTC B → 403 NOT_A_MEMBER (guard).
    const cross = await list(foreign.event.id, org.owner, orgB.orgId);
    expect(cross.status).toBe(403);
    expect(errorOf(cross.body).code).toBe('NOT_A_MEMBER');
  });
});

describe('POST …/checkers/:checkerId/revoke và …/restore', () => {
  it('Admin thu hồi → 204; dòng revoked + người/lúc thu hồi; 1 audit; CTV quét, tra tay → 403 CHECKER_REVOKED, nhận lại lời mời → CHECKER_REVOKED', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const id = await checkerIdOf(sale, ctv);
    const ticket = await issue(sale);

    await actOk(sale.event.id, id, 'revoke', admin);
    const row = await checkerRow(id);
    expect(row).toMatchObject({ status: 'revoked', revoked_by: admin.userId });
    expect(row.revoked_at).toBeInstanceOf(Date);
    expect(await audits(id)).toEqual([auditOf('checker.revoked', admin, id)]);

    for (const [label, call] of checkerRoutes(sale.event.id, ticket)) {
      const res = await call(ctv);
      expect(res.status, label).toBe(403);
      expect(errorOf(res.body), label).toEqual({ code: 'CHECKER_REVOKED', message: NO_LONGER, details: null });
    }
    const again = await accept(await inviteToken(sale), ctv);
    expect(again.status).toBe(403);
    expect(errorOf(again.body).code).toBe('CHECKER_REVOKED');
  });

  it('thu hồi lặp (kể cả hai người bấm cùng lúc) → 204, không thêm audit, revoked_by giữ người đầu', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const id = await checkerIdOf(sale, ctv);
    await actOk(sale.event.id, id, 'revoke', admin);
    const before = await checkerRow(id);
    await actOk(sale.event.id, id, 'revoke', org.owner);
    expect(await checkerRow(id)).toEqual(before);
    expect(await audits(id)).toEqual([auditOf('checker.revoked', admin, id)]);

    const racer = await checkerOf(sale);
    const racerId = await checkerIdOf(sale, racer);
    const results = await Promise.all([
      act(sale.event.id, racerId, 'revoke', admin),
      act(sale.event.id, racerId, 'revoke', org.owner),
    ]);
    expect(results.map((r) => r.status)).toEqual([204, 204]);
    const trail = await audits(racerId);
    expect(trail).toHaveLength(1);
    expect((await checkerRow(racerId)).revoked_by).toBe(trail[0]!.actor_user_id);
  });

  it('thu hồi rồi khôi phục → CTV quét lại như CTV mới (không cần link mới); dòng active, revoked_* NULL; audit đủ revoked, restored; khôi phục lặp → 204 không audit', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const id = await checkerIdOf(sale, ctv);
    const ticket = await issue(sale);

    await actOk(sale.event.id, id, 'revoke');
    expect((await scan(sale.event.id, ctv, ticket.qr)).status).toBe(403);
    await actOk(sale.event.id, id, 'restore', admin);
    expect(await checkerRow(id)).toEqual({ status: 'active', revoked_by: null, revoked_at: null });

    const res = await scan(sale.event.id, ctv, ticket.qr);
    expect(res.status, res.text).toBe(200);
    expect(ScanResult.parse(res.body)).toEqual(okOf(ticket));
    await h.http.get(`/v1/checkin/events/${sale.event.id}`).set('cookie', ctv.cookie).expect(200);

    await actOk(sale.event.id, id, 'restore');
    expect(await audits(id)).toEqual([
      auditOf('checker.revoked', org.owner, id),
      auditOf('checker.restored', admin, id),
    ]);
    expect((await listOk(sale.event.id)).checkers).toEqual([
      expect.objectContaining({ id, status: 'active', revokedAt: null }),
    ]);
  });

  it.each(Object.keys(CLOSE) as (keyof typeof CLOSE)[])(
    'Sự kiện đã kết thúc (%s): khôi phục → 409 EVENT_ALREADY_ENDED không ghi gì; thu hồi vẫn được',
    async (state) => {
      const sale = await freeEvent();
      const revoked = await checkerOf(sale);
      const active = await checkerOf(sale);
      const revokedId = await checkerIdOf(sale, revoked);
      const activeId = await checkerIdOf(sale, active);
      await actOk(sale.event.id, revokedId, 'revoke');
      const before = await checkerRow(revokedId);
      await CLOSE[state](sale.event.id);

      for (const caller of [org.owner, admin]) {
        const res = await act(sale.event.id, revokedId, 'restore', caller);
        expect(res.status).toBe(409);
        expect(errorOf(res.body).code).toBe('EVENT_ALREADY_ENDED');
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(await checkerRow(revokedId)).toEqual(before);
      expect(await audits(revokedId)).toEqual([auditOf('checker.revoked', org.owner, revokedId)]);

      await actOk(sale.event.id, activeId, 'revoke', admin);
      expect(await checkerRow(activeId)).toMatchObject({ status: 'revoked', revoked_by: admin.userId });
      expect(await audits(activeId)).toEqual([auditOf('checker.revoked', admin, activeId)]);
    },
  );

  it('khôi phục chờ khóa Sự kiện (FOR UPDATE) trong lúc BTC "Kết thúc" → đọc trạng thái đã commit: 409 EVENT_ALREADY_ENDED, dòng vẫn revoked, không audit', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const id = await checkerIdOf(sale, ctv);
    await actOk(sale.event.id, id, 'revoke');
    const before = await checkerRow(id);
    // Như "Kết thúc": khóa dòng Sự kiện `FOR UPDATE`, đặt `ended_manually_at` = `effective_end_at` = `now()`.
    const [res] = await whileHolding(
      [
        ['SELECT id FROM events WHERE id = $1 FOR UPDATE', [sale.event.id]],
        ['UPDATE events SET ended_manually_at = now(), effective_end_at = now() WHERE id = $1', [sale.event.id]],
      ],
      1,
      () => [act(sale.event.id, id, 'restore').then((r) => r)],
    );
    expect(res!.status, res!.text).toBe(409);
    expect(errorOf(res!.body).code).toBe('EVENT_ALREADY_ENDED');
    expect(await checkerRow(id)).toEqual(before);
    expect(before).toMatchObject({ status: 'revoked', revoked_by: org.owner.userId });
    expect(await audits(id)).toEqual([auditOf('checker.revoked', org.owner, id)]);
  });

  it('checkerId của Sự kiện khác (cùng BTC), lạ, sai dạng → 404 NOT_FOUND; không ghi gì', async () => {
    const sale = await freeEvent();
    const other = await freeEvent();
    const otherCtv = await checkerOf(other);
    const otherId = await checkerIdOf(other, otherCtv);
    for (const action of ['revoke', 'restore'] as const) {
      for (const checkerId of [otherId, randomUUID(), 'khong-phai-uuid']) {
        const res = await act(sale.event.id, checkerId, action);
        expect(res.status, `${action} ${checkerId}`).toBe(404);
        expect(errorOf(res.body).code, `${action} ${checkerId}`).toBe('NOT_FOUND');
      }
    }
    expect(await checkerRow(otherId)).toEqual({ status: 'active', revoked_by: null, revoked_at: null });
    expect(await audits(otherId)).toEqual([]);
  });

  it('Sự kiện của BTC khác, lạ, sai dạng → 404 EVENT_NOT_FOUND (kiểm trước checkerId); đường dẫn BTC khác → 403 NOT_A_MEMBER', async () => {
    const foreign = await freeEvent(orgB);
    const foreignCtv = await checkerOf(foreign, orgB);
    const foreignId = await checkerIdOf(foreign, foreignCtv);
    for (const action of ['revoke', 'restore'] as const) {
      for (const eventId of [foreign.event.id, randomUUID(), 'khong-phai-uuid']) {
        for (const checkerId of [foreignId, 'khong-phai-uuid']) {
          const res = await act(eventId, checkerId, action);
          expect(res.status, `${action} ${eventId} ${checkerId}`).toBe(404);
          expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
        }
      }
      const cross = await act(foreign.event.id, foreignId, action, org.owner, orgB.orgId);
      expect(cross.status).toBe(403);
      expect(errorOf(cross.body).code).toBe('NOT_A_MEMBER');
    }
    expect(await checkerRow(foreignId)).toEqual({ status: 'active', revoked_by: null, revoked_at: null });
  });

  it('CTV (không phải thành viên BTC) gọi danh sách, thu hồi → 403 NOT_A_MEMBER', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const id = await checkerIdOf(sale, ctv);
    for (const res of [await list(sale.event.id, ctv), await act(sale.event.id, id, 'revoke', ctv)]) {
      expect(res.status).toBe(403);
      expect(errorOf(res.body).code).toBe('NOT_A_MEMBER');
    }
    expect((await checkerRow(id)).status).toBe('active');
  });
});

describe('CHECK checkers_revoked_check', () => {
  it('active không mang revoked_*; revoked phải có cả revoked_at lẫn revoked_by', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const id = await checkerIdOf(sale, ctv);
    const violation = { code: '23514', constraint: 'checkers_revoked_check' };
    const update = (set: string, params: unknown[] = []) =>
      h.db.pool.query(`UPDATE checkers SET ${set} WHERE id = $1`, [id, ...params]);
    await expect(update("status = 'revoked'")).rejects.toMatchObject(violation);
    await expect(update("status = 'revoked', revoked_at = now()")).rejects.toMatchObject(violation);
    await expect(update("status = 'revoked', revoked_by = $2", [org.owner.userId])).rejects.toMatchObject(violation);
    await expect(update('revoked_at = now()')).rejects.toMatchObject(violation);
    await expect(update('revoked_by = $2', [org.owner.userId])).rejects.toMatchObject(violation);
    await update("status = 'revoked', revoked_at = now(), revoked_by = $2", [org.owner.userId]);
    await expect(update("status = 'active'")).rejects.toMatchObject(violation);
    await expect(update('revoked_at = NULL')).rejects.toMatchObject(violation);
    await update("status = 'active', revoked_at = NULL, revoked_by = NULL");
    const insert = (status: string, revoked: boolean) =>
      h.db.pool.query(
        `INSERT INTO checkers (organization_id, event_id, user_id, status, revoked_at, revoked_by)
         VALUES ($1, $2, $3, $4, ${revoked ? 'now()' : 'NULL'}, ${revoked ? '$5' : 'NULL'})`,
        revoked
          ? [org.orgId, sale.event.id, randomUUID(), status, org.owner.userId]
          : [org.orgId, sale.event.id, randomUUID(), status],
      );
    await expect(insert('active', true)).rejects.toMatchObject(violation);
    await expect(insert('revoked', false)).rejects.toMatchObject(violation);
  });
});

describe('hết quyền theo thời gian (AD-14): guard nhánh Sự kiện', () => {
  it.each(Object.keys(CLOSE) as (keyof typeof CLOSE)[])(
    'Sự kiện đã kết thúc (%s): CTV active → 403 EVENT_ENDED ở cả 4 route CTV, không ghi gì; Owner/Admin vẫn vào, quét ra invalid EVENT_ENDED; CTV bị thu hồi → CHECKER_REVOKED',
    async (state) => {
      const sale = await freeEvent();
      const ctv = await checkerOf(sale);
      const revoked = await checkerOf(sale);
      await actOk(sale.event.id, await checkerIdOf(sale, revoked), 'revoke');
      const ticket = await issue(sale);
      await CLOSE[state](sale.event.id);

      for (const [label, call] of checkerRoutes(sale.event.id, ticket)) {
        const res = await call(ctv);
        expect(res.status, label).toBe(403);
        expect(errorOf(res.body), label).toEqual({ code: 'EVENT_ENDED', message: NO_LONGER, details: null });
        expect(res.text, label).not.toContain(sale.event.name);
        const gone = await call(revoked);
        expect(gone.status, label).toBe(403);
        expect(errorOf(gone.body).code, label).toBe('CHECKER_REVOKED');
      }
      const { rows } = await h.db.pool.query('SELECT checked_in_at FROM tickets WHERE id = $1', [ticket.id]);
      expect(rows).toEqual([{ checked_in_at: null }]);

      for (const caller of [org.owner, admin]) {
        await h.http.get(`/v1/checkin/events/${sale.event.id}`).set('cookie', caller.cookie).expect(200);
        const res = await scan(sale.event.id, caller, ticket.qr);
        expect(res.status, res.text).toBe(200);
        expect(res.body).toEqual({ outcome: 'invalid', reason: 'EVENT_ENDED' });
      }
    },
  );

  it('đọc lại ở mỗi request (không cache): mốc kết thúc lùi lại tương lai → CTV vào lại được', async () => {
    const sale = await freeEvent();
    const ctv = await checkerOf(sale);
    const path = `/v1/checkin/events/${sale.event.id}`;
    await h.http.get(path).set('cookie', ctv.cookie).expect(200);
    await CLOSE.time_ended(sale.event.id);
    expect(errorOf((await h.http.get(path).set('cookie', ctv.cookie)).body).code).toBe('EVENT_ENDED');
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() + interval '1 day' WHERE id = ${sale.event.id}`);
    await h.http.get(path).set('cookie', ctv.cookie).expect(200);
  });
});
