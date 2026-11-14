import { describe, expect, it } from 'vitest';
import {
  ADMIN_PATH,
  CLOSED_BETA_TRANSITIONS,
  ClosedBetaOrganizationList,
  ClosedBetaQueueQuery,
  ClosedBetaStatus,
  ADMIN_SUSPENDED_PAYMENT_SERVICES_API_PATH,
  adminPaymentServiceResumeApiPath,
  ClosedBetaTransitionInvalidDetails,
  SuspendedPaymentServiceOrganization,
  SuspendedPaymentServiceOrganizationList,
} from '../src/admin.js';
import { ErrorCode } from '../src/errors.js';
import { safeReturnTo } from '../src/identity.js';
import {
  PaymentServiceCheckOutcome,
  PaymentServiceCheckResult,
  PaymentServiceReason,
  PaymentServiceResumePath,
  PaymentServiceState,
  paymentServiceCheckApiPath,
} from '../src/organizer.js';
import {
  organizationLiveApiPath,
  PAYMENT_SERVICE_NOTICE_CODES,
  sortStatusNotices,
  STATUS_BANNER_LIMIT,
  STATUS_NOTICE_PRIORITY,
  StatusNoticeCode,
  StatusNoticeList,
  statusNoticesApiPath,
} from '../src/reporting.js';

const ID = '019a3b2c-5678-7abc-8def-0123456789ab';

describe('Closed Beta (Story 2.5)', () => {
  it('mã lỗi mới', () => {
    expect(ErrorCode.TWO_FACTOR_NOT_ENABLED).toBe('TWO_FACTOR_NOT_ENABLED');
    expect(ErrorCode.CLOSED_BETA_TRANSITION_INVALID).toBe('CLOSED_BETA_TRANSITION_INVALID');
    expect(ClosedBetaTransitionInvalidDetails.safeParse({ closedBetaStatus: 'pending' }).success).toBe(true);
  });

  it('máy trạng thái: duyệt từ chờ duyệt hoặc đã thu hồi, thu hồi chỉ từ đã duyệt', () => {
    expect(CLOSED_BETA_TRANSITIONS.approve).toEqual({ from: ['pending', 'revoked'], to: 'approved' });
    expect(CLOSED_BETA_TRANSITIONS.revoke).toEqual({ from: ['approved'], to: 'revoked' });
    // Trạng thái đích không bao giờ là trạng thái nguồn (bấm lại = no-op, không phải chuyển).
    for (const { from, to } of Object.values(CLOSED_BETA_TRANSITIONS)) expect(from).not.toContain(to);
  });

  it('query tab bắt buộc và chỉ nhận ba trạng thái', () => {
    for (const status of Object.values(ClosedBetaStatus)) {
      expect(ClosedBetaQueueQuery.parse({ closedBeta: status })).toEqual({ closedBeta: status });
    }
    expect(ClosedBetaQueueQuery.safeParse({}).success).toBe(false);
    expect(ClosedBetaQueueQuery.safeParse({ closedBeta: 'all' }).success).toBe(false);
  });

  it('hàng duyệt: email Owner và kênh liên hệ có thể rỗng', () => {
    const row = {
      id: ID,
      name: 'CLB Cờ Vua',
      ownerEmail: null,
      contactPhone: null,
      contactEmail: 'lh@vidu.vn',
      closedBetaStatus: 'pending',
      createdAt: '2026-11-02T01:02:03.000Z',
    };
    expect(ClosedBetaOrganizationList.parse([row])).toHaveLength(1);
  });

  it('/admin là đích quay về hợp lệ sau đăng nhập', () => {
    expect(ADMIN_PATH).toBe('/admin');
    expect(safeReturnTo(ADMIN_PATH)).toBe('/admin');
  });
});

describe('thông báo trạng thái (AD-34)', () => {
  const notice = (code: StatusNoticeCode) => ({
    code,
    severity: 'warning',
    blocking: false,
    dismissible: false,
    scope: 'organization',
    audience: ['owner', 'admin'],
    data: {},
    version: '2026-11-02T01:02:03.000Z',
  });

  it('mọi mã đều có đúng một hạng ưu tiên; thu hồi trên chờ duyệt', () => {
    expect([...STATUS_NOTICE_PRIORITY].sort()).toEqual(Object.values(StatusNoticeCode).sort());
    expect(new Set(STATUS_NOTICE_PRIORITY).size).toBe(STATUS_NOTICE_PRIORITY.length);
    expect(STATUS_NOTICE_PRIORITY.indexOf('CLOSED_BETA_REVOKED')).toBeLessThan(
      STATUS_NOTICE_PRIORITY.indexOf('CLOSED_BETA_PENDING'),
    );
  });

  it('sắp theo ưu tiên, không đổi mảng gốc', () => {
    const input = [notice('CLOSED_BETA_PENDING'), notice('CLOSED_BETA_REVOKED')];
    expect(sortStatusNotices(input).map((n) => n.code)).toEqual(['CLOSED_BETA_REVOKED', 'CLOSED_BETA_PENDING']);
    expect(input[0]?.code).toBe('CLOSED_BETA_PENDING');
  });

  it('schema: mã lạ, audience rỗng hoặc version rỗng bị từ chối', () => {
    expect(StatusNoticeList.safeParse([notice('CLOSED_BETA_PENDING')]).success).toBe(true);
    expect(StatusNoticeList.safeParse([{ ...notice('CLOSED_BETA_PENDING'), code: 'KHONG_CO' }]).success).toBe(false);
    expect(StatusNoticeList.safeParse([{ ...notice('CLOSED_BETA_PENDING'), audience: [] }]).success).toBe(false);
    expect(StatusNoticeList.safeParse([{ ...notice('CLOSED_BETA_PENDING'), version: '' }]).success).toBe(false);
  });

  it('dashboard hiện tối đa 2 banner', () => {
    expect(STATUS_BANNER_LIMIT).toBe(2);
  });
});

describe('dịch vụ thanh toán của BTC (Story 4.2)', () => {
  it('năm mã notice ở bậc 4: sau Closed Beta bị thu hồi, trước chưa liên kết tài khoản nhận tiền; mỗi lý do một mã', () => {
    const rank = (code: StatusNoticeCode) => STATUS_NOTICE_PRIORITY.indexOf(code);
    const codes = Object.values(PaymentServiceReason).map((reason) => PAYMENT_SERVICE_NOTICE_CODES[reason]);
    expect(new Set(codes).size).toBe(5);
    for (const code of codes) {
      expect(rank(code)).toBeGreaterThan(rank('CLOSED_BETA_REVOKED'));
      expect(rank(code)).toBeLessThan(rank('PAYOUT_ACCOUNT_NOT_LINKED'));
    }
    expect(PAYMENT_SERVICE_NOTICE_CODES).toEqual({
      token: 'PAYMENT_SERVICE_SUSPENDED_TOKEN',
      credential_invalid: 'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
      gateway_permission_missing: 'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
      payout_account_not_allowed: 'PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED',
      tingee_disabled: 'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
    });
    // Story 4.2-d: lý do VA và đường mở lại khi đổi tài khoản mặc định.
    expect(PaymentServiceReason.PAYOUT_ACCOUNT_NOT_ALLOWED).toBe('payout_account_not_allowed');
    expect(PaymentServiceResumePath.DEFAULT_CHANGED).toBe('default_changed');
    expect(Object.values(PaymentServiceResumePath).sort()).toEqual([
      'default_changed',
      'new_key',
      'owner_check',
      'platform_admin',
      'probe',
    ]);
  });

  it('trạng thái: lý do và mốc có thể null; lý do lạ bị từ chối; danh sách Quản trị chỉ có id, tên, lý do, mốc', () => {
    const state = { status: 'suspended', reason: 'token', since: '2026-11-13T01:02:03.000Z', checkedAt: null };
    expect(PaymentServiceState.parse(state)).toEqual(state);
    expect(PaymentServiceState.safeParse({ ...state, reason: 'khac' }).success).toBe(false);
    expect(PaymentServiceState.parse({ status: 'active', reason: null, since: null, checkedAt: null }).status).toBe(
      'active',
    );
    const row = { id: ID, name: 'CLB Cờ Vua', reason: 'tingee_disabled', since: state.since, checkedAt: null };
    expect(SuspendedPaymentServiceOrganizationList.parse([row])).toEqual([row]);
    expect(Object.keys(SuspendedPaymentServiceOrganization.shape).sort()).toEqual([
      'checkedAt',
      'id',
      'name',
      'reason',
      'since',
    ]);
    expect(ErrorCode.PAYMENT_SERVICE_NOT_SUSPENDED).toBe('PAYMENT_SERVICE_NOT_SUSPENDED');
    expect(paymentServiceCheckApiPath(ID)).toBe(`/orgs/${ID}/payment-service/check`);
  });

  it('đường API của stream cấp BTC, notices và Quản trị (Story 4.2-b)', () => {
    expect(organizationLiveApiPath(ID)).toBe(`/orgs/${ID}/live`);
    expect(statusNoticesApiPath(ID)).toBe(`/orgs/${ID}/notices`);
    expect(ADMIN_SUSPENDED_PAYMENT_SERVICES_API_PATH).toBe('/admin/organizations/payment-service/suspended');
    expect(adminPaymentServiceResumeApiPath(ID)).toBe(`/admin/organizations/${ID}/payment-service/resume`);
  });

  it('kết quả "Kiểm tra lại": sáu outcome; retryAfterSeconds có đúng khi cooldown (1–30 giây)', () => {
    expect(Object.values(PaymentServiceCheckOutcome).sort()).toEqual([
      'cooldown',
      'no_target',
      'not_suspended',
      'resumed',
      'still_suspended',
      'unknown',
    ]);
    const state = { status: 'suspended', reason: 'token', since: '2026-11-13T01:02:03.000Z', checkedAt: null };
    const ok = (outcome: string, retryAfterSeconds: number | null) =>
      PaymentServiceCheckResult.safeParse({ state, outcome, retryAfterSeconds }).success;
    expect(ok('cooldown', 12)).toBe(true);
    expect(ok('cooldown', 30)).toBe(true);
    expect(ok('still_suspended', null)).toBe(true);
    expect(ok('cooldown', null)).toBe(false);
    expect(ok('cooldown', 0)).toBe(false);
    expect(ok('cooldown', 31)).toBe(false);
    expect(ok('unknown', 5)).toBe(false);
    expect(ok('skipped', null)).toBe(false);
  });
});
