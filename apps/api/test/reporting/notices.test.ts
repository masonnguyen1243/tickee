import { ErrorResponse, Role, StatusNoticeList, type StatusNotice } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.5: `reporting.notices(scope)` qua `GET /v1/orgs/:orgId/notices` — banner Closed Beta cho Owner và Admin,
 * đổi theo thao tác của Quản trị Tingee.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let orgId: string;

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  admin = await signUp(h);
  platformAdmin = await signUpPlatformAdmin(h);
});
beforeEach(async () => {
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Cờ Vua' }).expect(201)).body
    .id as string;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await h.close();
});

async function noticesOf(cookie: string, org = orgId): Promise<StatusNotice[]> {
  const res = await h.http.get(`/v1/orgs/${org}/notices`).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return StatusNoticeList.parse(res.body);
}

const closedBeta = (action: 'approve' | 'revoke') =>
  h.http.post(`/v1/admin/organizations/${orgId}/closed-beta/${action}`).set('cookie', platformAdmin.cookie).expect(204);

describe('GET /v1/orgs/:orgId/notices', () => {
  it('BTC mới: Owner và Admin cùng thấy CLOSED_BETA_PENDING (warning, không chặn, không đóng được)', async () => {
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect(await noticesOf(cookie)).toEqual([
        {
          code: 'CLOSED_BETA_PENDING',
          severity: 'warning',
          blocking: false,
          dismissible: false,
          scope: 'organization',
          audience: ['owner', 'admin'],
          data: {},
          version: expect.any(String),
        },
      ]);
    }
  });

  it('Duyệt → hết banner; Thu hồi → CLOSED_BETA_REVOKED (danger, chặn bán, không đóng được); version đổi theo trạng thái', async () => {
    const [pending] = await noticesOf(owner.cookie);
    await closedBeta('approve');
    expect(await noticesOf(owner.cookie)).toEqual([]);
    expect(await noticesOf(admin.cookie)).toEqual([]);

    await closedBeta('revoke');
    const [revoked] = await noticesOf(admin.cookie);
    expect(revoked).toMatchObject({
      code: 'CLOSED_BETA_REVOKED',
      severity: 'danger',
      blocking: true,
      dismissible: false,
      scope: 'organization',
    });
    expect(revoked?.version).not.toBe(pending?.version);

    // Thu hồi rồi duyệt lại rồi thu hồi lần nữa: cùng mã nhưng version mới.
    await closedBeta('approve');
    await closedBeta('revoke');
    const [again] = await noticesOf(owner.cookie);
    expect(again?.code).toBe('CLOSED_BETA_REVOKED');
    expect(again?.version).not.toBe(revoked?.version);
  });

  it('không là thành viên → 403 NOT_A_MEMBER', async () => {
    const outsider = await signUp(h);
    const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', outsider.cookie);
    expect(res.status).toBe(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
  });
});
