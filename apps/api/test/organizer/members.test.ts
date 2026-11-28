import { createHash, randomUUID } from 'node:crypto';
import {
  AcceptedInvitation,
  ErrorResponse,
  JobQueue,
  MemberList,
  ORGANIZATION_INVITATION_DAILY_LIMIT,
  OrganizationInvitation,
  REAUTH_HEADER,
  Role,
  SheetsAuthRevokedEmailPayload,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendSheetsAuthRevokedEmail,
  sheetsAuthRevokedRecipients,
} from '../../src/modules/integration/sheet-revoked-email-jobs.js';
import { sheetsAuthRevokedEmailJobId } from '../../src/modules/integration/sheet-revocation.js';
import { sendAdminInvitation } from '../../src/modules/organizer/invitation-jobs.js';
import { Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { databaseUrl, migrationDatabaseUrl, TEST_WEB_ORIGIN } from '../helpers.js';
import {
  createHarness,
  newEmail,
  reauthToken,
  signIn,
  signUp,
  signUpWithTotp,
  totpCode,
  type Harness,
} from '../identity/harness.js';

/*
 * Story 2.4: Owner mời Admin bằng email (job pg-boss gửi email), thu hồi, xóa Admin; người được mời xem trước và nhận
 * lời mời. Postgres thật; email đi qua `FakeEmailTransport` của harness. Story 6.6: xóa Admin (route chuyển sang
 * `flows/`) chuyển `auth_revoked` mọi kết nối Google Sheets người đó cấp và thu hồi mọi dòng CTV `active` của người đó
 * trong BTC, cùng transaction.
 */

const QUEUE = JobQueue.ORGANIZER_SEND_ADMIN_INVITATION;

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let orgId: string;

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
});
// BTC mới cho mỗi test: giới hạn 20 lời mời / 24 giờ tính theo BTC.
beforeEach(async () => {
  orgId = await createOrg(owner.cookie, 'CLB Cờ Vua Quận 3');
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;

function expectError(res: Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(errorOf(res).code).toBe(code);
}

async function createOrg(cookie: string, name = 'BTC kiểm thành viên'): Promise<string> {
  return (await h.http.post('/v1/orgs').set('cookie', cookie).send({ name }).expect(201)).body.id as string;
}

const invite = (cookie: string, email: unknown, org = orgId) =>
  h.http.post(`/v1/orgs/${org}/invitations`).set('cookie', cookie).send({ email });

async function invited(email: string, org = orgId, cookie = owner.cookie): Promise<OrganizationInvitation> {
  const res = await invite(cookie, email, org);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return OrganizationInvitation.parse(res.body);
}

const sender = () => ({ db: h.db, email: h.email, webOrigin: TEST_WEB_ORIGIN });

/** Chạy handler của job như worker rồi lấy token trong link của email vừa gửi. */
async function deliver(invitationId: string, to: string): Promise<string> {
  expect(await sendAdminInvitation(sender(), invitationId)).toBe('sent');
  const message = h.email.sent.findLast((m) => m.to === to);
  const token = message?.text.match(/\/loi-moi-btc#([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('Không thấy link mời trong email');
  return token;
}

/** Mời `email` rồi gửi email → token. */
async function inviteAndDeliver(email: string, org = orgId, cookie = owner.cookie) {
  const invitation = await invited(email, org, cookie);
  return { invitation, token: await deliver(invitation.id, email) };
}

const preview = (token: unknown) => h.http.post('/v1/org-invitations/preview').send({ token });
const accept = (cookie: string, token: unknown) =>
  h.http.post('/v1/org-invitations/accept').set('cookie', cookie).send({ token });

async function listMembers(cookie = owner.cookie, org = orgId): Promise<MemberList> {
  const res = await h.http.get(`/v1/orgs/${org}/members`).set('cookie', cookie).expect(200);
  return MemberList.parse(res.body);
}

async function auditRows(organizationId: string, action: string) {
  const { rows } = await h.db.pool.query<{ actor_user_id: string; target_type: string; target_id: string; changed_fields: string[] }>(
    'SELECT actor_user_id, target_type, target_id, changed_fields FROM audit_events WHERE organization_id = $1 AND action = $2 ORDER BY created_at, id',
    [organizationId, action],
  );
  return rows;
}

async function memberRows(organizationId: string, userId: string) {
  const { rows } = await h.db.pool.query<{ id: string; role: string }>(
    'SELECT id, role FROM members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  return rows;
}

const boss = () => h.app.get<PgBoss>(BOSS);

describe('mời Admin', () => {
  it('201: email chuẩn hóa, hạn 7 ngày, hiện trong danh sách chờ; audit không có email; job chỉ mang invitationId', async () => {
    const email = newEmail();
    const before = Date.now();
    const res = await invite(owner.cookie, `  ${email.toUpperCase()} `);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invitation = OrganizationInvitation.parse(res.body);
    expect(invitation).toMatchObject({ email, expired: false });
    const ttl = Date.parse(invitation.expiresAt) - before;
    expect(ttl).toBeGreaterThan(7 * 24 * 3_600_000 - 60_000);
    expect(ttl).toBeLessThan(7 * 24 * 3_600_000 + 60_000);

    const list = await listMembers();
    expect(list.members).toEqual([
      expect.objectContaining({ userId: owner.userId, role: 'owner', email: owner.email }),
    ]);
    expect(list.invitations[0]).toEqual(invitation);

    const audits = await auditRows(orgId, 'member.invited');
    expect(audits.at(-1)).toMatchObject({
      actor_user_id: owner.userId,
      target_type: 'organization_invitation',
      target_id: invitation.id,
    });
    expect(JSON.stringify(await auditRows(orgId, 'member.invited'))).not.toContain(email);

    // Job enqueue cùng tx: payload chỉ có id lời mời, không email/token. DB chưa có hash tới khi worker gửi.
    const jobs = await boss().findJobs<Record<string, unknown>>(QUEUE, { data: { invitationId: invitation.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ invitationId: invitation.id });
    const { rows } = await h.db.pool.query('SELECT token_hash FROM organization_invitations WHERE id = $1', [invitation.id]);
    expect(rows[0]?.token_hash).toBeNull();
  });

  it('danh sách chờ: lời mời mới nhất trước', async () => {
    const first = await invited(newEmail());
    const second = await invited(newEmail());
    expect((await listMembers()).invitations.map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it.each([[{}], [{ email: '' }], [{ email: 'khong-phai-email' }], [{ email: 42 }]])(
    'body %j → 400 VALIDATION_FAILED tại trường email',
    async (body) => {
      const res = await h.http.post(`/v1/orgs/${orgId}/invitations`).set('cookie', owner.cookie).send(body);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(errorOf(res).details).toEqual({ issues: [expect.objectContaining({ path: 'email' })] });
    },
  );

  it('email đã là thành viên (Owner, Admin) → 409 ALREADY_A_MEMBER tại ô email', async () => {
    expectError(await invite(owner.cookie, owner.email.toUpperCase()), 409, 'ALREADY_A_MEMBER');
    const admin = await signUp(h);
    const { token } = await inviteAndDeliver(admin.email);
    await accept(admin.cookie, token).expect(200);
    const res = await invite(owner.cookie, admin.email);
    expectError(res, 409, 'ALREADY_A_MEMBER');
    expect(errorOf(res)).toMatchObject({ message: 'Email này đã là thành viên của BTC.', details: { field: 'email' } });
  });

  it('mời lại cùng email: lời mời cũ còn treo bị thu hồi (link cũ không hợp lệ), chỉ còn một lời mời chờ', async () => {
    const email = newEmail();
    const first = await inviteAndDeliver(email);
    const second = await invited(email);
    expectError(await preview(first.token), 404, 'INVITATION_INVALID');

    const pending = (await listMembers()).invitations.filter((i) => i.email === email);
    expect(pending.map((i) => i.id)).toEqual([second.id]);
    const revoked = await auditRows(orgId, 'member.invitation_revoked');
    expect(revoked.map((r) => r.target_id)).toContain(first.invitation.id);
  });

  it(`tối đa ${ORGANIZATION_INVITATION_DAILY_LIMIT} lời mời mới mỗi BTC trong 24 giờ (kể cả đã thu hồi) → 429; quá 24 giờ thì không tính`, async () => {
    const org = await createOrg(owner.cookie);
    const created: OrganizationInvitation[] = [];
    for (let i = 0; i < ORGANIZATION_INVITATION_DAILY_LIMIT; i += 1) created.push(await invited(newEmail(), org));
    await h.http.delete(`/v1/orgs/${org}/invitations/${created[0]!.id}`).set('cookie', owner.cookie).expect(204);
    expectError(await invite(owner.cookie, newEmail(), org), 429, 'INVITATION_LIMIT_REACHED');

    await h.db.orm.execute(
      sql`UPDATE organization_invitations SET created_at = now() - interval '25 hours' WHERE id = ${created[1]!.id}`,
    );
    await invited(newEmail(), org);
    // BTC khác không bị ảnh hưởng.
    await invited(newEmail());
  });

  it('Owner đã bật 2FA, session chưa qua lớp hai: POST mời → 403 TOTP_REQUIRED; step-up xong gửi lại → 201', async () => {
    const totpOwner = await signUpWithTotp(h);
    const org = await createOrg(totpOwner.cookie);
    const fresh = await signIn(h, totpOwner.email);
    const email = newEmail();

    const blocked = await invite(fresh, email, org);
    expectError(blocked, 403, 'TOTP_REQUIRED');
    expect(errorOf(blocked).details).toEqual({ reason: 'step_up' });

    await h.http
      .post('/v1/identity/totp/step-up')
      .set('cookie', fresh)
      .send({ code: totpCode(totpOwner.manualKey) })
      .expect(200);
    const res = await invite(fresh, email, org);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(OrganizationInvitation.parse(res.body).email).toBe(email);
  });

  it('tx rollback (lỗi ngay sau khi enqueue) → không có lời mời lẫn job', async () => {
    const email = newEmail();
    const b = boss();
    const realSend = b.send.bind(b) as (...args: unknown[]) => Promise<string | null>;
    let jobId: string | null = null;
    vi.spyOn(b, 'send').mockImplementationOnce((async (...args: unknown[]) => {
      jobId = await realSend(...args);
      throw new Error('lỗi giả lập sau khi enqueue');
    }) as PgBoss['send']);

    const res = await invite(owner.cookie, email);
    expectError(res, 500, 'INTERNAL_ERROR');
    expect(jobId).toBeTruthy();
    expect(await b.getJobById(QUEUE, jobId!)).toBeNull();
    const { rows } = await h.db.pool.query('SELECT id FROM organization_invitations WHERE email = $1', [email]);
    expect(rows).toEqual([]);
  });
});

describe('thu hồi lời mời', () => {
  it('204: rời danh sách chờ, link → INVITATION_INVALID; thu hồi lại, id lạ, id sai dạng, đã nhận → 404', async () => {
    const email = newEmail();
    const { invitation, token } = await inviteAndDeliver(email);
    await preview(token).expect(200);

    await h.http.delete(`/v1/orgs/${orgId}/invitations/${invitation.id}`).set('cookie', owner.cookie).expect(204);
    expect((await listMembers()).invitations.map((i) => i.id)).not.toContain(invitation.id);
    expectError(await preview(token), 404, 'INVITATION_INVALID');
    const invitee = await signUp(h, email);
    expectError(await accept(invitee.cookie, token), 404, 'INVITATION_INVALID');
    expect(await memberRows(orgId, invitee.userId)).toEqual([]);
    expect((await auditRows(orgId, 'member.invitation_revoked')).map((r) => r.target_id)).toContain(invitation.id);

    for (const id of [invitation.id, randomUUID(), 'khong-phai-uuid']) {
      expectError(await h.http.delete(`/v1/orgs/${orgId}/invitations/${id}`).set('cookie', owner.cookie), 404, 'NOT_FOUND');
    }

    const acceptedEmail = newEmail();
    const accepted = await inviteAndDeliver(acceptedEmail);
    const joiner = await signUp(h, acceptedEmail);
    await accept(joiner.cookie, accepted.token).expect(200);
    expectError(
      await h.http.delete(`/v1/orgs/${orgId}/invitations/${accepted.invitation.id}`).set('cookie', owner.cookie),
      404,
      'NOT_FOUND',
    );
  });

  it('lời mời của BTC khác qua đường dẫn BTC này → 404 (orgScope)', async () => {
    const otherOwner = await signUp(h);
    const otherOrg = await createOrg(otherOwner.cookie);
    const other = await invited(newEmail(), otherOrg, otherOwner.cookie);
    expectError(
      await h.http.delete(`/v1/orgs/${orgId}/invitations/${other.id}`).set('cookie', owner.cookie),
      404,
      'NOT_FOUND',
    );
    expect((await listMembers(otherOwner.cookie, otherOrg)).invitations.map((i) => i.id)).toContain(other.id);
  });
});

describe('xem trước lời mời (công khai)', () => {
  it('còn hiệu lực → tên BTC, không cần đăng nhập', async () => {
    const { token } = await inviteAndDeliver(newEmail());
    const res = await preview(token).expect(200);
    expect(res.body).toEqual({ organizationName: 'CLB Cờ Vua Quận 3' });
  });

  it('hết hạn → 410 INVITATION_EXPIRED; đã dùng → 409 INVITATION_USED; token sai → 404 INVITATION_INVALID; thiếu → 400', async () => {
    const expired = await inviteAndDeliver(newEmail());
    await h.db.orm.execute(
      sql`UPDATE organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = ${expired.invitation.id}`,
    );
    expectError(await preview(expired.token), 410, 'INVITATION_EXPIRED');
    // Lời mời quá hạn vẫn nằm trong danh sách chờ, đánh dấu đã hết hạn.
    expect((await listMembers()).invitations.find((i) => i.id === expired.invitation.id)).toMatchObject({ expired: true });

    const usedEmail = newEmail();
    const used = await inviteAndDeliver(usedEmail);
    await accept((await signUp(h, usedEmail)).cookie, used.token).expect(200);
    expectError(await preview(used.token), 409, 'INVITATION_USED');

    expectError(await preview('khong-co-token-nay'), 404, 'INVITATION_INVALID');
    expectError(await h.http.post('/v1/org-invitations/preview').send({}), 400, 'VALIDATION_FAILED');
  });
});

describe('nhận lời mời', () => {
  it('đúng email: thành Admin, vào được BTC với vai admin, audit member.joined; bấm nhận lại vẫn thành công', async () => {
    const email = newEmail();
    const { token } = await inviteAndDeliver(email);
    const invitee = await signUp(h, email);

    const res = await accept(invitee.cookie, token).expect(200);
    expect(AcceptedInvitation.parse(res.body)).toEqual({
      organizationId: orgId,
      organizationName: 'CLB Cờ Vua Quận 3',
      role: 'admin',
    });
    expect(await memberRows(orgId, invitee.userId)).toEqual([expect.objectContaining({ role: 'admin' })]);
    const memberships = await h.http.get('/v1/me/memberships').set('cookie', invitee.cookie).expect(200);
    expect(memberships.body).toContainEqual({ organizationId: orgId, name: 'CLB Cờ Vua Quận 3', role: 'admin' });
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', invitee.cookie).expect(200);
    expect((await auditRows(orgId, 'member.joined')).filter((r) => r.target_id === invitee.userId)).toEqual([
      expect.objectContaining({ actor_user_id: invitee.userId, target_type: 'user' }),
    ]);

    const again = await accept(invitee.cookie, token).expect(200);
    expect(again.body).toEqual(res.body);
    expect(await memberRows(orgId, invitee.userId)).toHaveLength(1);
    expect((await auditRows(orgId, 'member.joined')).filter((r) => r.target_id === invitee.userId)).toHaveLength(1);

    const list = await listMembers();
    expect(list.members.find((m) => m.userId === invitee.userId)).toMatchObject({ role: 'admin', email });
    expect(list.invitations.map((i) => i.email)).not.toContain(email);
  });

  it('hai lần nhận đồng thời của cùng người: CAS chỉ cho một lần thắng, cả hai đều 200, đúng một thành viên', async () => {
    const email = newEmail();
    const { token } = await inviteAndDeliver(email);
    const invitee = await signUp(h, email);

    const results = await Promise.all([accept(invitee.cookie, token), accept(invitee.cookie, token)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await memberRows(orgId, invitee.userId)).toHaveLength(1);
    expect((await auditRows(orgId, 'member.joined')).filter((r) => r.target_id === invitee.userId)).toHaveLength(1);
  });

  it('email session khác email lời mời → 403 INVITATION_EMAIL_MISMATCH kèm email đã che; không tạo thành viên', async () => {
    const email = `an.nguyen-${randomUUID()}@vidu.vn`;
    const { token } = await inviteAndDeliver(email);
    const stranger = await signUp(h);

    const res = await accept(stranger.cookie, token);
    expectError(res, 403, 'INVITATION_EMAIL_MISMATCH');
    expect(errorOf(res).details).toEqual({ maskedEmail: 'a***@vidu.vn' });
    expect(JSON.stringify(res.body)).not.toContain(email);
    expect(await memberRows(orgId, stranger.userId)).toEqual([]);
    // Lời mời vẫn còn cho đúng người.
    await accept((await signUp(h, email)).cookie, token).expect(200);
  });

  it('hết hạn → 410, token sai → 404; người nhận bị xóa rồi mở lại link → 409 INVITATION_USED; không tạo thành viên', async () => {
    const email = newEmail();
    const expired = await inviteAndDeliver(email);
    await h.db.orm.execute(
      sql`UPDATE organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = ${expired.invitation.id}`,
    );
    const invitee = await signUp(h, email);
    expectError(await accept(invitee.cookie, expired.token), 410, 'INVITATION_EXPIRED');
    expectError(await accept(invitee.cookie, 'khong-co-token-nay'), 404, 'INVITATION_INVALID');
    expect(await memberRows(orgId, invitee.userId)).toEqual([]);

    const fresh = await inviteAndDeliver(email);
    await accept(invitee.cookie, fresh.token).expect(200);
    const [row] = await memberRows(orgId, invitee.userId);
    await h.http.delete(`/v1/orgs/${orgId}/members/${row!.id}`).set('cookie', owner.cookie).expect(204);
    expectError(await accept(invitee.cookie, fresh.token), 409, 'INVITATION_USED');
    expect(await memberRows(orgId, invitee.userId)).toEqual([]);
  });

  it('chưa đăng nhập → 401; chưa đồng ý NĐ 13 → 403 CONSENT_REQUIRED', async () => {
    const email = newEmail();
    const { token } = await inviteAndDeliver(email);
    expectError(await h.http.post('/v1/org-invitations/accept').send({ token }), 401, 'UNAUTHENTICATED');
    const notConsented = await signIn(h, email);
    expectError(await accept(notConsented, token), 403, 'CONSENT_REQUIRED');
  });
});

describe('xóa Admin', () => {
  it('204: request kế tiếp của Admin đó → NOT_A_MEMBER; audit member.removed; Owner, id lạ, id sai dạng → 404', async () => {
    const email = newEmail();
    const { token } = await inviteAndDeliver(email);
    const admin = await signUp(h, email);
    await accept(admin.cookie, token).expect(200);
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', admin.cookie).expect(200);

    const list = await listMembers();
    const adminRow = list.members.find((m) => m.userId === admin.userId)!;
    const ownerRow = list.members.find((m) => m.role === 'owner')!;

    await h.http.delete(`/v1/orgs/${orgId}/members/${adminRow.id}`).set('cookie', owner.cookie).expect(204);
    expectError(await h.http.get(`/v1/orgs/${orgId}`).set('cookie', admin.cookie), 403, 'NOT_A_MEMBER');
    expect((await listMembers()).members.map((m) => m.userId)).not.toContain(admin.userId);
    expect((await auditRows(orgId, 'member.removed')).filter((r) => r.target_id === admin.userId)).toEqual([
      expect.objectContaining({ actor_user_id: owner.userId, target_type: 'user' }),
    ]);

    for (const id of [ownerRow.id, adminRow.id, randomUUID(), 'khong-phai-uuid']) {
      expectError(await h.http.delete(`/v1/orgs/${orgId}/members/${id}`).set('cookie', owner.cookie), 404, 'NOT_FOUND');
    }
    expect((await listMembers()).members.map((m) => m.role)).toContain('owner');
  });

  it('thành viên của BTC khác qua đường dẫn BTC này → 404 (orgScope)', async () => {
    const otherOwner = await signUp(h);
    const otherOrg = await createOrg(otherOwner.cookie);
    const email = newEmail();
    const { token } = await inviteAndDeliver(email, otherOrg, otherOwner.cookie);
    const otherAdmin = await signUp(h, email);
    await accept(otherAdmin.cookie, token).expect(200);
    const [row] = await memberRows(otherOrg, otherAdmin.userId);
    expectError(await h.http.delete(`/v1/orgs/${orgId}/members/${row!.id}`).set('cookie', owner.cookie), 404, 'NOT_FOUND');
    expect(await memberRows(otherOrg, otherAdmin.userId)).toHaveLength(1);
  });
});

describe('quyền', () => {
  it('Admin gọi mọi API thành viên → 403 FORBIDDEN_ROLE', async () => {
    const email = newEmail();
    const { token } = await inviteAndDeliver(email);
    const admin = await signUp(h, email);
    await accept(admin.cookie, token).expect(200);
    const pending = await invited(newEmail());
    const ownerRow = (await listMembers()).members.find((m) => m.role === 'owner')!;

    const calls = [
      h.http.get(`/v1/orgs/${orgId}/members`).set('cookie', admin.cookie),
      invite(admin.cookie, newEmail()),
      h.http.delete(`/v1/orgs/${orgId}/invitations/${pending.id}`).set('cookie', admin.cookie),
      h.http.delete(`/v1/orgs/${orgId}/members/${ownerRow.id}`).set('cookie', admin.cookie),
      h.http.post(`/v1/orgs/${orgId}/members/${ownerRow.id}/ownership-transfer`).set('cookie', admin.cookie),
    ];
    for (const res of await Promise.all(calls)) expectError(res, 403, 'FORBIDDEN_ROLE');
    expect((await listMembers()).invitations.map((i) => i.id)).toContain(pending.id);
  });
});

describe('chuyển quyền Owner', () => {
  const OWNERSHIP_QUEUE = JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED;

  const transfer = (memberId: string, token?: string, cookie = owner.cookie, org = orgId) => {
    const req = h.http.post(`/v1/orgs/${org}/members/${memberId}/ownership-transfer`).set('cookie', cookie);
    return token ? req.set(REAUTH_HEADER, token) : req;
  };

  /** Mời, gửi và nhận lời mời → Admin mới của `org` kèm id dòng `members`. */
  async function addAdmin(org = orgId, cookie = owner.cookie) {
    const email = newEmail();
    const { token } = await inviteAndDeliver(email, org, cookie);
    const user = await signUp(h, email);
    await accept(user.cookie, token).expect(200);
    const [row] = await memberRows(org, user.userId);
    return { ...user, memberId: row!.id };
  }

  async function rolesOf(org = orgId) {
    const { rows } = await h.db.pool.query<{ user_id: string; role: string }>(
      'SELECT user_id, role FROM members WHERE organization_id = $1 ORDER BY user_id',
      [org],
    );
    return rows;
  }

  async function grantUsedAt(token: string) {
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const { rows } = await h.db.pool.query<{ used_at: Date | null }>(
      'SELECT used_at FROM reauth_grants WHERE token_hash = $1',
      [hash],
    );
    return rows[0]?.used_at;
  }

  it('204: Owner cũ → admin, Admin → owner, đúng một Owner; audit; job chỉ id; vai mới có hiệu lực ở request kế tiếp', async () => {
    const admin = await addAdmin();
    const other = await addAdmin();
    const token = await reauthToken(h, owner);

    await transfer(admin.memberId, token).expect(204);

    const roles = await rolesOf();
    expect(roles.filter((r) => r.role === 'owner')).toEqual([{ user_id: admin.userId, role: 'owner' }]);
    expect(roles).toContainEqual({ user_id: owner.userId, role: 'admin' });
    expect(roles).toContainEqual({ user_id: other.userId, role: 'admin' });
    expect(await grantUsedAt(token)).not.toBeNull();

    expect(await auditRows(orgId, 'member.ownership_transferred')).toEqual([
      { actor_user_id: owner.userId, target_type: 'user', target_id: admin.userId, changed_fields: ['role'] },
    ]);
    const jobs = await boss().findJobs(OWNERSHIP_QUEUE, { data: { organizationId: orgId } });
    expect(jobs.map((j) => j.data)).toEqual([
      { organizationId: orgId, previousOwnerUserId: owner.userId, newOwnerUserId: admin.userId },
    ]);

    // Owner cũ: mục chỉ Owner → FORBIDDEN_ROLE; vẫn là thành viên.
    expectError(await h.http.get(`/v1/orgs/${orgId}/members`).set('cookie', owner.cookie), 403, 'FORBIDDEN_ROLE');
    await h.http.get(`/v1/orgs/${orgId}`).set('cookie', owner.cookie).expect(200);
    const memberships = await h.http.get('/v1/me/memberships').set('cookie', owner.cookie).expect(200);
    expect(memberships.body).toContainEqual(expect.objectContaining({ organizationId: orgId, role: 'admin' }));
    // Owner mới: thao tác chỉ Owner được phép ngay.
    expect((await listMembers(admin.cookie)).members[0]).toMatchObject({ userId: admin.userId, role: 'owner' });
    await invited(newEmail(), orgId, admin.cookie);
    await h.http.get(`/v1/orgs/${orgId}/payout-account`).set('cookie', admin.cookie).expect(200);
  });

  it('thiếu xác nhận, token đã tiêu, token quá 5 phút, token của session khác → 403 REAUTH_REQUIRED; không đổi gì', async () => {
    const admin = await addAdmin();
    const before = await rolesOf();

    const missing = await transfer(admin.memberId);
    expectError(missing, 403, 'REAUTH_REQUIRED');
    expect(errorOf(missing).details).toEqual({ method: 'email_otp' });

    const used = await reauthToken(h, owner);
    await h.db.pool.query('UPDATE reauth_grants SET used_at = now() WHERE token_hash = $1', [
      createHash('sha256').update(used, 'utf8').digest('hex'),
    ]);
    expectError(await transfer(admin.memberId, used), 403, 'REAUTH_REQUIRED');

    const expired = await reauthToken(h, owner);
    await h.db.pool.query("UPDATE reauth_grants SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [
      createHash('sha256').update(expired, 'utf8').digest('hex'),
    ]);
    expectError(await transfer(admin.memberId, expired), 403, 'REAUTH_REQUIRED');

    const otherSession = { ...owner, cookie: await signIn(h, owner.email) };
    const foreign = await reauthToken(h, otherSession);
    expectError(await transfer(admin.memberId, foreign), 403, 'REAUTH_REQUIRED');

    expect(await rolesOf()).toEqual(before);
    expect(await auditRows(orgId, 'member.ownership_transferred')).toEqual([]);
    expect(await boss().findJobs(OWNERSHIP_QUEUE, { data: { organizationId: orgId } })).toEqual([]);
  });

  it('đích sai dạng, lạ, của BTC khác, là chính Owner, Admin vừa bị xóa → 404; token không bị tiêu, dùng tiếp được', async () => {
    const admin = await addAdmin();
    const removed = await addAdmin();
    await h.http.delete(`/v1/orgs/${orgId}/members/${removed.memberId}`).set('cookie', owner.cookie).expect(204);
    const otherOwner = await signUp(h);
    const otherOrg = await createOrg(otherOwner.cookie);
    const foreignAdmin = await addAdmin(otherOrg, otherOwner.cookie);
    const [ownerRow] = await memberRows(orgId, owner.userId);
    const before = await rolesOf();

    const token = await reauthToken(h, owner);
    for (const id of ['khong-phai-uuid', randomUUID(), foreignAdmin.memberId, ownerRow!.id, removed.memberId]) {
      const res = await transfer(id, token);
      expectError(res, 404, 'NOT_FOUND');
      expect(errorOf(res).message, id).toBe('Không tìm thấy thành viên.');
    }
    expect(await rolesOf()).toEqual(before);
    expect(await rolesOf(otherOrg)).toContainEqual({ user_id: foreignAdmin.userId, role: 'admin' });
    expect(await grantUsedAt(token)).toBeNull();
    expect(await auditRows(orgId, 'member.ownership_transferred')).toEqual([]);

    await transfer(admin.memberId, token).expect(204);
  });

  it('hai lần gửi song song (2 token): một lần 204, lần kia 403 FORBIDDEN_ROLE; đúng một Owner, một audit, một job', async () => {
    const first = await addAdmin();
    const second = await addAdmin();
    const tokenA = await reauthToken(h, owner);
    const tokenB = await reauthToken(h, owner);

    const results = await Promise.all([transfer(first.memberId, tokenA), transfer(second.memberId, tokenB)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 403]);
    expect(errorOf(results.find((r) => r.status === 403)!).code).toBe('FORBIDDEN_ROLE');

    const owners = (await rolesOf()).filter((r) => r.role === 'owner');
    expect(owners).toHaveLength(1);
    expect([first.userId, second.userId]).toContain(owners[0]!.user_id);
    expect(await auditRows(orgId, 'member.ownership_transferred')).toHaveLength(1);
    expect(await boss().findJobs(OWNERSHIP_QUEUE, { data: { organizationId: orgId } })).toHaveLength(1);
  });

  it('Admin gọi → 403 FORBIDDEN_ROLE trước khi xét xác nhận lại; token của Admin không bị tiêu', async () => {
    const admin = await addAdmin();
    const peer = await addAdmin();
    const token = await reauthToken(h, admin);
    expectError(await transfer(peer.memberId, token, admin.cookie), 403, 'FORBIDDEN_ROLE');
    expect(await grantUsedAt(token)).toBeNull();
    expect((await rolesOf()).filter((r) => r.role === 'owner')).toEqual([{ user_id: owner.userId, role: 'owner' }]);
  });
});

describe('xóa Admin (Story 6.6): kết nối Google Sheets người đó cấp và dòng CTV, cùng transaction', () => {
  const EMAIL_QUEUE = JobQueue.INTEGRATION_SHEETS_AUTH_REVOKED_EMAIL;
  const draft = {
    name: 'Giải cờ nhanh mùa đông',
    startsAt: '2099-12-16T07:00:00+07:00',
    endsAt: '2099-12-16T17:00:00+07:00',
    refundPolicy: 'Không hoàn vé.',
  };
  let listener: pg.Client;
  const notified: Record<string, unknown>[] = [];

  beforeAll(async () => {
    listener = new pg.Client({ connectionString: databaseUrl() });
    await listener.connect();
    listener.on('notification', (m) => notified.push(JSON.parse(m.payload ?? '{}') as Record<string, unknown>));
    await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
  });
  afterAll(async () => {
    await listener.end();
  });

  const statusSignals = () => notified.filter((n) => n.type === 'org_status_changed' && n.organizationId === orgId);

  /** Admin mới của BTC hiện tại (chèn thẳng `members`): tài khoản và id dòng thành viên. */
  async function newAdmin() {
    const user = await signUp(h);
    const { rows } = await h.db.pool.query<{ id: string }>(
      'INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
      [orgId, user.userId, Role.ADMIN],
    );
    return { ...user, memberId: rows[0]!.id };
  }

  const newEvent = async () =>
    (await h.http.post(`/v1/orgs/${orgId}/events`).set('cookie', owner.cookie).send(draft).expect(201)).body.id as string;

  /** Kết nối Google Sheets của Sự kiện (BTC `org`, mặc định BTC hiện tại), chèn thẳng (không qua Google): `active`. */
  async function connectionFor(eventId: string, grantedBy: string, org = orgId): Promise<string> {
    const { rows } = await h.db.pool.query<{ id: string }>(
      `INSERT INTO sheet_connections (organization_id, event_id, granted_by_user_id, status, refresh_token, spreadsheet_id,
                                      spreadsheet_url, last_synced_at)
       VALUES ($1, $2, $3, 'active', 'v1:khong-dung', $4, $5, now()) RETURNING id`,
      [org, eventId, grantedBy, `sheet-${eventId}`, `https://docs.google.com/spreadsheets/d/sheet-${eventId}/edit`],
    );
    return rows[0]!.id;
  }

  async function connectionState(connectionId: string) {
    const { rows } = await h.db.pool.query<{ status: string; last_error_code: string | null; auth_revoked_at: Date | null }>(
      'SELECT status, last_error_code, auth_revoked_at FROM sheet_connections WHERE id = $1',
      [connectionId],
    );
    return rows[0];
  }

  async function checkerRows(userId: string) {
    const { rows } = await h.db.pool.query<{
      id: string;
      event_id: string;
      status: string;
      revoked_by: string | null;
      revoked_at: Date | null;
    }>('SELECT id, event_id, status, revoked_by, revoked_at FROM checkers WHERE user_id = $1 ORDER BY created_at, id', [
      userId,
    ]);
    return rows;
  }

  const emailRootsOf = async (connectionId: string) =>
    (await boss().findJobs(EMAIL_QUEUE, { data: { connectionId } })).filter(
      (job) => (job.data as { recipientUserId?: string }).recipientUserId === undefined,
    );

  const removeAdmin = (memberId: string, cookie = owner.cookie) =>
    h.http.delete(`/v1/orgs/${orgId}/members/${memberId}`).set('cookie', cookie);

  it('xóa người cấp OAuth của 2 Sự kiện: cả hai kết nối auth_revoked (grantor_removed) cùng mốc; mỗi kết nối một job email; mỗi người nhận hai email; kết nối người khác cấp giữ nguyên; một tín hiệu', async () => {
    const granter = await newAdmin();
    const stays = await newAdmin();
    const [e1, e2, e3, e4] = [await newEvent(), await newEvent(), await newEvent(), await newEvent()];
    const c1 = await connectionFor(e1, granter.userId);
    const c2 = await connectionFor(e2, granter.userId);
    const byOwner = await connectionFor(e3, owner.userId);
    const byOther = await connectionFor(e4, stays.userId);
    const signals = statusSignals().length;

    await removeAdmin(granter.memberId).expect(204);
    expect(await memberRows(orgId, granter.userId)).toEqual([]);
    const [s1, s2] = [(await connectionState(c1))!, (await connectionState(c2))!];
    for (const state of [s1, s2]) {
      expect(state).toMatchObject({ status: 'auth_revoked', last_error_code: 'grantor_removed' });
      expect(state.auth_revoked_at).toBeInstanceOf(Date);
    }
    // Cùng transaction: cùng `now()`.
    expect(s1.auth_revoked_at!.getTime()).toBe(s2.auth_revoked_at!.getTime());
    for (const id of [byOwner, byOther]) {
      expect(await connectionState(id)).toMatchObject({ status: 'active', last_error_code: null, auth_revoked_at: null });
    }
    for (const [id, state] of [
      [c1, s1],
      [c2, s2],
    ] as const) {
      expect((await emailRootsOf(id)).map((job) => job.id)).toEqual([sheetsAuthRevokedEmailJobId(id, state.auth_revoked_at!)]);
    }
    expect(await emailRootsOf(byOwner)).toEqual([]);
    await expect.poll(() => statusSignals().length, { timeout: 5_000, interval: 50 }).toBe(signals + 1);

    // Người nhận: Owner và Admin còn lại (người bị xóa không còn trong BTC); mỗi người hai email (mỗi kết nối một).
    const notifier = { db: h.db, email: h.email, webOrigin: TEST_WEB_ORIGIN };
    const before = h.email.sent.length;
    for (const id of [c1, c2]) {
      const payload = SheetsAuthRevokedEmailPayload.parse((await emailRootsOf(id))[0]!.data);
      const recipients = await sheetsAuthRevokedRecipients(h.db, payload);
      expect(recipients).toEqual([owner.userId, stays.userId]);
      for (const userId of recipients as string[]) {
        expect(await sendSheetsAuthRevokedEmail(notifier, payload, userId)).toBe('sent');
      }
      // Người bị xóa không bao giờ nhận.
      expect(await sendSheetsAuthRevokedEmail(notifier, payload, granter.userId)).toBe('skipped');
    }
    const sent = h.email.sent.slice(before);
    expect(sent.filter((m) => m.to === owner.email)).toHaveLength(2);
    expect(sent.filter((m) => m.to === stays.email)).toHaveLength(2);
    expect(sent.filter((m) => m.to === granter.email)).toEqual([]);
    for (const m of sent) expect(m.text).toContain('Lý do: Người kết nối đã rời BTC.');
  });

  it('kết nối người bị xóa cấp ở BTC khác (vẫn là Admin ở đó) giữ nguyên: active, không mốc, không job email', async () => {
    const granter = await newAdmin();
    const here = await connectionFor(await newEvent(), granter.userId);
    const otherOwner = await signUp(h);
    const otherOrg = await createOrg(otherOwner.cookie, 'BTC khác của người cấp');
    await h.db.pool.query('INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3)', [
      otherOrg,
      granter.userId,
      Role.ADMIN,
    ]);
    const otherEvent = (
      await h.http.post(`/v1/orgs/${otherOrg}/events`).set('cookie', otherOwner.cookie).send(draft).expect(201)
    ).body.id as string;
    const there = await connectionFor(otherEvent, granter.userId, otherOrg);

    await removeAdmin(granter.memberId).expect(204);
    expect(await connectionState(here)).toMatchObject({ status: 'auth_revoked', last_error_code: 'grantor_removed' });
    expect(await connectionState(there)).toEqual({ status: 'active', last_error_code: null, auth_revoked_at: null });
    expect(await emailRootsOf(there)).toEqual([]);
    expect(await memberRows(otherOrg, granter.userId)).toHaveLength(1);
  });

  it('xóa Admin không cấp kết nối nào: như cũ, không kết nối nào đổi, không job email, không tín hiệu', async () => {
    const plain = await newAdmin();
    const event = await newEvent();
    const kept = await connectionFor(event, owner.userId);
    const signals = statusSignals().length;
    await removeAdmin(plain.memberId).expect(204);
    expect(await memberRows(orgId, plain.userId)).toEqual([]);
    expect(await connectionState(kept)).toMatchObject({ status: 'active', auth_revoked_at: null });
    expect(await emailRootsOf(kept)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(statusSignals()).toHaveLength(signals);
  });

  it('xóa Admin là CTV: dòng active ở 2 Sự kiện → revoked (người xóa, lúc xóa) + audit checker.revoked; dòng đã revoked giữ người và lúc thu hồi cũ; sau đó bị chặn ở route check-in', async () => {
    const ctv = await newAdmin();
    const otherOwner = await signUp(h);
    const otherOrg = await createOrg(otherOwner.cookie, 'BTC khác của CTV');
    const otherEvent = (
      await h.http.post(`/v1/orgs/${otherOrg}/events`).set('cookie', otherOwner.cookie).send(draft).expect(201)
    ).body.id as string;
    const [a1, a2, a3] = [await newEvent(), await newEvent(), await newEvent()];
    const oldRevokedAt = new Date('2026-11-20T03:04:05.000Z');
    await h.db.pool.query(
      `INSERT INTO checkers (organization_id, event_id, user_id, status, revoked_at, revoked_by) VALUES
         ($1, $2, $5, 'active', NULL, NULL),
         ($1, $3, $5, 'active', NULL, NULL),
         ($1, $4, $5, 'revoked', $6, $7),
         ($8, $9, $5, 'active', NULL, NULL)`,
      [orgId, a1, a2, a3, ctv.userId, oldRevokedAt, owner.userId, otherOrg, otherEvent],
    );
    const ids = Object.fromEntries((await checkerRows(ctv.userId)).map((r) => [r.event_id, r.id]));

    const before = Date.now();
    await removeAdmin(ctv.memberId).expect(204);
    const rows = Object.fromEntries((await checkerRows(ctv.userId)).map((r) => [r.event_id, r]));
    for (const event of [a1, a2]) {
      expect(rows[event]).toMatchObject({ status: 'revoked', revoked_by: owner.userId });
      expect(rows[event]!.revoked_at!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    }
    // Dòng đã thu hồi giữ người và lúc thu hồi cũ; CTV ở BTC khác không đổi.
    expect(rows[a3]).toMatchObject({ status: 'revoked', revoked_by: owner.userId, revoked_at: oldRevokedAt });
    expect(rows[otherEvent]).toMatchObject({ status: 'active', revoked_by: null, revoked_at: null });
    const audits = (await auditRows(orgId, 'checker.revoked')).filter((r) => [ids[a1], ids[a2], ids[a3]].includes(r.target_id));
    expect(audits.map((r) => r.target_id).sort()).toEqual([ids[a1], ids[a2]].sort());
    for (const audit of audits) {
      expect(audit).toMatchObject({ actor_user_id: owner.userId, target_type: 'checker', changed_fields: ['status'] });
    }

    // Không còn là thành viên, CTV đã bị thu hồi: route check-in chặn.
    const gate = await h.http.get(`/v1/checkin/events/${a1}`).set('cookie', ctv.cookie);
    expectError(gate, 403, 'CHECKER_REVOKED');
  });

  it('CTV (không phải thành viên) gọi xóa Admin → 403 NOT_A_MEMBER; route vẫn trong bộ cách ly', async () => {
    const target = await newAdmin();
    const ctv = await signUp(h);
    const event = await newEvent();
    await h.db.pool.query(
      "INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES ($1, $2, $3, 'active')",
      [orgId, event, ctv.userId],
    );
    expectError(await removeAdmin(target.memberId, ctv.cookie), 403, 'NOT_A_MEMBER');
    expect(await memberRows(orgId, target.userId)).toHaveLength(1);
  });

  it('lỗi DB lúc commit → rollback: Admin chưa bị xóa, CTV và kết nối không đổi, không job email, không audit', async () => {
    const granter = await newAdmin();
    const event = await newEvent();
    const connection = await connectionFor(event, granter.userId);
    await h.db.pool.query("INSERT INTO checkers (organization_id, event_id, user_id, status) VALUES ($1, $2, $3, 'active')", [
      orgId,
      event,
      granter.userId,
    ]);
    // Trigger hoãn tới lúc commit: flow đã xóa thành viên, thu hồi CTV, chuyển kết nối và enqueue email rồi mới hỏng.
    const migrator = new Database({ connectionString: migrationDatabaseUrl(), max: 1 });
    try {
      await migrator.pool.query(`
        CREATE OR REPLACE FUNCTION test_member_removal_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.granted_by_user_id = '${granter.userId}' AND NEW.last_error_code = 'grantor_removed' THEN
            RAISE EXCEPTION 'test: rollback xóa Admin';
          END IF;
          RETURN NULL;
        END $$`);
      await migrator.pool.query(`
        CREATE CONSTRAINT TRIGGER test_member_removal_fail AFTER UPDATE ON sheet_connections
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_member_removal_fail()`);

      const res = await removeAdmin(granter.memberId);
      expect(res.status).toBe(500);
      expect(await memberRows(orgId, granter.userId)).toHaveLength(1);
      expect(await checkerRows(granter.userId)).toEqual([
        expect.objectContaining({ status: 'active', revoked_by: null, revoked_at: null }),
      ]);
      expect(await connectionState(connection)).toMatchObject({ status: 'active', auth_revoked_at: null });
      expect(await emailRootsOf(connection)).toEqual([]);
      expect((await auditRows(orgId, 'member.removed')).filter((r) => r.target_id === granter.userId)).toEqual([]);
    } finally {
      await migrator.pool.query('DROP TRIGGER IF EXISTS test_member_removal_fail ON sheet_connections');
      await migrator.pool.query('DROP FUNCTION IF EXISTS test_member_removal_fail()');
      await migrator.close();
    }
    // Hết lỗi: xóa lại được.
    await removeAdmin(granter.memberId).expect(204);
    expect(await connectionState(connection)).toMatchObject({ status: 'auth_revoked', last_error_code: 'grantor_removed' });
  });
});
