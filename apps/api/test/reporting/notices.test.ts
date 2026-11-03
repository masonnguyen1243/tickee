import { ErrorResponse, Role, StatusNoticeList, type StatusNotice } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.5: `reporting.notices(scope)` qua `GET /v1/orgs/:orgId/notices` — banner Closed Beta cho Owner và Admin,
 * đổi theo thao tác của Quản trị Tingee. Story 2.6: banner tài khoản nhận tiền.
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

async function allNoticesOf(cookie: string, org = orgId): Promise<StatusNotice[]> {
  const res = await h.http.get(`/v1/orgs/${org}/notices`).set('cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return StatusNoticeList.parse(res.body);
}

/** Chỉ thông báo của trục Closed Beta (trục tài khoản nhận tiền kiểm riêng bên dưới). */
async function noticesOf(cookie: string, org = orgId): Promise<StatusNotice[]> {
  return (await allNoticesOf(cookie, org)).filter((n) => n.code.startsWith('CLOSED_BETA_'));
}

/** Một lần thử liên kết ở trạng thái `status` (Story 2.6), ghi thẳng DB. */
async function insertPayoutAccount(status: 'awaiting_otp' | 'linked' | 'failed'): Promise<void> {
  const linked = status === 'linked';
  await h.db.orm.execute(sql`
    INSERT INTO payout_accounts
      (organization_id, status, bank_bin, account_type, account_last4, account_name, created_by, va_account_number, linked_at)
    VALUES (${orgId}, ${status}, '970422', 'personal-account', '0000', 'NGUYEN VAN A', ${owner.userId},
      ${linked ? '9600000001' : null}, ${linked ? sql`now()` : null})`);
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

  it('tài khoản nhận tiền (Story 2.6): chưa liên kết → NOT_LINKED (danger, chặn bán) xếp trên Chờ duyệt; chờ OTP → LINKING; đã liên kết → hết', async () => {
    for (const cookie of [owner.cookie, admin.cookie]) {
      const notices = await allNoticesOf(cookie);
      expect(notices.map((n) => n.code)).toEqual(['PAYOUT_ACCOUNT_NOT_LINKED', 'CLOSED_BETA_PENDING']);
      expect(notices[0]).toMatchObject({
        severity: 'danger',
        blocking: true,
        dismissible: false,
        scope: 'organization',
        audience: ['owner', 'admin'],
        data: {},
      });
    }
    const [notLinked] = await allNoticesOf(owner.cookie);

    await insertPayoutAccount('failed');
    const [afterFailure] = await allNoticesOf(owner.cookie);
    expect(afterFailure?.code).toBe('PAYOUT_ACCOUNT_NOT_LINKED');
    expect(afterFailure?.version).not.toBe(notLinked?.version);

    await insertPayoutAccount('awaiting_otp');
    const linking = await allNoticesOf(admin.cookie);
    expect(linking.map((n) => n.code)).toEqual(['PAYOUT_ACCOUNT_LINKING', 'CLOSED_BETA_PENDING']);
    expect(linking[0]).toMatchObject({ severity: 'neutral', blocking: false, dismissible: false });

    await insertPayoutAccount('linked');
    expect((await allNoticesOf(owner.cookie)).map((n) => n.code)).toEqual(['CLOSED_BETA_PENDING']);
    await closedBeta('approve');
    expect(await allNoticesOf(admin.cookie)).toEqual([]);
  });

  it('không là thành viên → 403 NOT_A_MEMBER', async () => {
    const outsider = await signUp(h);
    const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', outsider.cookie);
    expect(res.status).toBe(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');
  });
});
