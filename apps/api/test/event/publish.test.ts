import { EventDetail, EventList, ErrorResponse, PublishReadiness, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.10: điều kiện mở bán (`GET …/publish-readiness`) và mở bán (`POST …/publish`) trên Postgres thật. Mỗi test
 * dùng một BTC mới để trạng thái Closed Beta và tài khoản nhận tiền không lẫn giữa các test.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let orgId: string;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};
const ALWAYS = ['REFUND_POLICY', 'HAS_TICKET_TYPE', 'EVENT_NOT_ENDED', 'ORGANIZATION_NOT_LOCKED'];
const PAID = ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED', 'PAID_PRICE_MINIMUM'];

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  admin = await signUp(h);
  ownerB = await signUp(h);
  platformAdmin = await signUpPlatformAdmin(h);
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

async function newEvent(body: Record<string, unknown> = draft, cookie = admin.cookie, org = orgId): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventsPath(org)).set('cookie', cookie).send(body).expect(201)).body);
}

async function addTicketType(eventId: string, price: number, capacity = 50): Promise<void> {
  await h.http
    .post(`${eventsPath()}/${eventId}/ticket-types`)
    .set('cookie', admin.cookie)
    .send({ name: price > 0 ? 'Có phí' : 'Miễn phí', price, capacity })
    .expect(201);
}

const readinessRes = (eventId: string, cookie = admin.cookie, org = orgId) =>
  h.http.get(`${eventsPath(org)}/${eventId}/publish-readiness`).set('cookie', cookie);
const publish = (eventId: string, cookie = admin.cookie, org = orgId) =>
  h.http.post(`${eventsPath(org)}/${eventId}/publish`).set('cookie', cookie);

async function readiness(eventId: string): Promise<Record<string, boolean>> {
  const res = await readinessRes(eventId).expect(200);
  const parsed = PublishReadiness.parse(res.body);
  return Object.fromEntries(parsed.conditions.map((c) => [c.code, c.satisfied]));
}

async function codes(eventId: string): Promise<string[]> {
  return PublishReadiness.parse((await readinessRes(eventId).expect(200)).body).conditions.map((c) => c.code);
}

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

async function statusOf(eventId: string): Promise<string> {
  const res = await h.http.get(`${eventsPath()}/${eventId}`).set('cookie', owner.cookie).expect(200);
  return EventDetail.parse(res.body).status;
}

async function publishAudits(eventId: string) {
  const result = await h.db.orm.execute<{ action: string; actor_user_id: string; changed_fields: string[] }>(
    sql`SELECT action, actor_user_id, changed_fields FROM audit_events
        WHERE organization_id = ${orgId} AND target_type = 'event' AND target_id = ${eventId}
          AND action = 'event.published' ORDER BY id`,
  );
  return result.rows;
}

async function insertCredential(): Promise<string> {
  const result = await h.db.orm.execute<{ id: string }>(sql`
    INSERT INTO tingee_credentials (organization_id, client_id, secret_token_ciphertext, created_by)
    VALUES (${orgId}, 'tg-client-test', 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA', ${owner.userId})
    RETURNING id`);
  return result.rows[0]!.id;
}

async function insertPayoutAccount(credentialId: string, retired = false): Promise<void> {
  await h.db.orm.execute(sql`
    INSERT INTO payout_accounts
      (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name, account_type, account_last4,
       account_name, created_by, retired_at)
    VALUES (${orgId}, ${credentialId}, '9600000001', '970422', 'MB Bank', 'personal-account', '0000', 'NGUYEN VAN A',
      ${owner.userId}, ${retired ? new Date() : null})`);
}

const closedBeta = (action: 'approve' | 'revoke') =>
  h.http.post(`/v1/admin/organizations/${orgId}/closed-beta/${action}`).set('cookie', platformAdmin.cookie).expect(204);

/** BTC đủ điều kiện bán vé có phí: đã duyệt Closed Beta và có một tài khoản nhận tiền hiện hành. */
async function readyForPaid(): Promise<void> {
  await closedBeta('approve');
  await insertPayoutAccount(await insertCredential());
}

describe('GET …/publish-readiness', () => {
  it('miễn phí, đủ: chỉ 4 mã luôn có, đều đạt (BTC chưa duyệt Closed Beta, chưa có tài khoản)', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    expect(await codes(event.id)).toEqual(ALWAYS);
    expect(Object.values(await readiness(event.id))).toEqual([true, true, true, true]);
  });

  it('thiếu chính sách hoàn vé (rỗng hoặc chỉ khoảng trắng) → REFUND_POLICY chưa đạt', async () => {
    const event = await newEvent({ ...draft, refundPolicy: null });
    await addTicketType(event.id, 0);
    expect(await readiness(event.id)).toMatchObject({ REFUND_POLICY: false, HAS_TICKET_TYPE: true });
    await h.db.orm.execute(sql`UPDATE events SET refund_policy = ${'   \n '} WHERE id = ${event.id}`);
    expect((await readiness(event.id)).REFUND_POLICY).toBe(false);
  });

  it('chưa có Hạng vé → HAS_TICKET_TYPE chưa đạt, không có mã của Hạng vé có phí', async () => {
    const event = await newEvent();
    expect(await codes(event.id)).toEqual(ALWAYS);
    expect(await readiness(event.id)).toMatchObject({ HAS_TICKET_TYPE: false, REFUND_POLICY: true });
  });

  it('đã kết thúc (effective_end_at ≤ now) → EVENT_NOT_ENDED chưa đạt', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = ${event.id}`);
    expect((await readiness(event.id)).EVENT_NOT_ENDED).toBe(false);
  });

  it('có phí, BTC pending, chưa có tài khoản: thêm 3 mã, Closed Beta và tài khoản chưa đạt, giá đạt', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    await addTicketType(event.id, 100_000);
    expect(await codes(event.id)).toEqual([...ALWAYS, ...PAID]);
    expect(await readiness(event.id)).toMatchObject({
      CLOSED_BETA_APPROVED: false,
      PAYOUT_ACCOUNT_LINKED: false,
      PAID_PRICE_MINIMUM: true,
    });
  });

  it('có phí: duyệt + tài khoản → đạt; thu hồi Closed Beta → CLOSED_BETA_APPROVED chưa đạt', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 100_000);
    await readyForPaid();
    expect(Object.values(await readiness(event.id)).every(Boolean)).toBe(true);
    await closedBeta('revoke');
    expect(await readiness(event.id)).toMatchObject({ CLOSED_BETA_APPROVED: false, PAYOUT_ACCOUNT_LINKED: true });
  });

  it('có phí, mọi tài khoản đã hủy liên kết → PAYOUT_ACCOUNT_LINKED chưa đạt', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 100_000);
    await closedBeta('approve');
    await insertPayoutAccount(await insertCredential(), true);
    expect(await readiness(event.id)).toMatchObject({ CLOSED_BETA_APPROVED: true, PAYOUT_ACCOUNT_LINKED: false });
  });

  it('Owner cũng đọc được; id lạ, sai dạng hoặc Sự kiện của BTC khác → 404 EVENT_NOT_FOUND', async () => {
    const event = await newEvent();
    await readinessRes(event.id, owner.cookie).expect(200);
    const res = await readinessRes('khong-phai-uuid').expect(404);
    expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
    const orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body
      .id as string;
    const eventB = await newEvent(draft, ownerB.cookie, orgB);
    expect(errorOf((await readinessRes(eventB.id).expect(404)).body).code).toBe('EVENT_NOT_FOUND');
  });
});

describe('POST …/publish', () => {
  it('miễn phí, đủ: 200 published, audit event.published; danh sách và trang công khai cũng thấy', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    // Trang công khai chưa thấy Sự kiện nháp (404 thống nhất với slug sai).
    const hidden = await h.http.get(`/v1/events/${event.slug}`).expect(404);
    expect(errorOf(hidden.body).code).toBe('EVENT_NOT_FOUND');
    const res = await publish(event.id).expect(200);
    await h.http.get(`/v1/events/${event.slug}`).expect(200);
    expect(EventDetail.parse(res.body)).toMatchObject({ id: event.id, status: 'published', slug: event.slug });
    expect(await statusOf(event.id)).toBe('published');
    expect(await publishAudits(event.id)).toEqual([
      { action: 'event.published', actor_user_id: admin.userId, changed_fields: [] },
    ]);
    const list = EventList.parse((await h.http.get(eventsPath()).set('cookie', owner.cookie).expect(200)).body);
    expect(list.find((e) => e.id === event.id)?.status).toBe('published');
  });

  it('thiếu chính sách → 409 EVENT_NOT_READY unmet [REFUND_POLICY], không đổi, không audit', async () => {
    const event = await newEvent({ ...draft, refundPolicy: '  ' });
    await addTicketType(event.id, 0);
    const res = await publish(event.id).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'EVENT_NOT_READY', details: { unmet: ['REFUND_POLICY'] } });
    expect(await statusOf(event.id)).toBe('draft');
    expect(await publishAudits(event.id)).toEqual([]);
  });

  it('chưa có Hạng vé → 409 unmet [HAS_TICKET_TYPE]; đã kết thúc → 409 unmet [EVENT_NOT_ENDED]', async () => {
    const empty = await newEvent();
    expect(errorOf((await publish(empty.id).expect(409)).body).details).toEqual({ unmet: ['HAS_TICKET_TYPE'] });
    const ended = await newEvent();
    await addTicketType(ended.id, 0);
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 minute' WHERE id = ${ended.id}`);
    expect(errorOf((await publish(ended.id).expect(409)).body).details).toEqual({ unmet: ['EVENT_NOT_ENDED'] });
  });

  it('có phí, BTC pending hoặc đã thu hồi → 409 EVENT_NOT_READY; đủ thì mở bán được', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 100_000);
    const pending = await publish(event.id).expect(409);
    expect(errorOf(pending.body)).toMatchObject({
      code: 'EVENT_NOT_READY',
      details: { unmet: ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'] },
    });
    await readyForPaid();
    await closedBeta('revoke');
    expect(errorOf((await publish(event.id).expect(409)).body).details).toEqual({ unmet: ['CLOSED_BETA_APPROVED'] });
    await closedBeta('approve');
    await publish(event.id).expect(200);
    expect(await statusOf(event.id)).toBe('published');
  });

  it('khóa Sự kiện (locked_at) không chặn mở bán', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    await h.db.orm.execute(sql`UPDATE events SET locked_at = now(), lock_reason = 'test' WHERE id = ${event.id}`);
    await publish(event.id).expect(200);
  });

  it('mở bán lần hai → 409 EVENT_NOT_DRAFT; Sự kiện ẩn cũng vậy', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    await publish(event.id, owner.cookie).expect(200);
    expect(errorOf((await publish(event.id).expect(409)).body).code).toBe('EVENT_NOT_DRAFT');
    await h.db.orm.execute(sql`UPDATE events SET status = 'hidden' WHERE id = ${event.id}`);
    expect(errorOf((await publish(event.id).expect(409)).body).code).toBe('EVENT_NOT_DRAFT');
    expect(await publishAudits(event.id)).toHaveLength(1);
  });

  it('không còn nháp được kiểm trước điều kiện: đã mở bán rồi mất chính sách hoàn vé → vẫn 409 EVENT_NOT_DRAFT', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    await publish(event.id).expect(200);
    await h.db.orm.execute(sql`UPDATE events SET refund_policy = NULL WHERE id = ${event.id}`);
    const res = await publish(event.id).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'EVENT_NOT_DRAFT' });
    expect(errorOf(res.body).details ?? null).toBeNull();
  });

  it('hai request song song → một 200, một 409 EVENT_NOT_DRAFT; một dòng audit', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    const results = await Promise.all([publish(event.id), publish(event.id, owner.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(errorOf(conflict.body).code).toBe('EVENT_NOT_DRAFT');
    expect(await publishAudits(event.id)).toHaveLength(1);
  });

  it('Sự kiện của BTC khác, id lạ hoặc sai dạng → 404 EVENT_NOT_FOUND, không đổi', async () => {
    const orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body
      .id as string;
    const eventB = await newEvent(draft, ownerB.cookie, orgB);
    expect(errorOf((await publish(eventB.id).expect(404)).body).code).toBe('EVENT_NOT_FOUND');
    expect(errorOf((await publish('019a0000-0000-7000-8000-000000000000').expect(404)).body).code).toBe(
      'EVENT_NOT_FOUND',
    );
    expect(errorOf((await publish('abc').expect(404)).body).code).toBe('EVENT_NOT_FOUND');
    const res = await h.http.get(`${eventsPath(orgB)}/${eventB.id}`).set('cookie', ownerB.cookie).expect(200);
    expect(EventDetail.parse(res.body).status).toBe('draft');
  });
});
