import { describe, expect, it } from 'vitest';
import {
  ADMIN_PATH,
  CLOSED_BETA_TRANSITIONS,
  ClosedBetaOrganizationList,
  ClosedBetaQueueQuery,
  ClosedBetaStatus,
  ClosedBetaTransitionInvalidDetails,
} from '../src/admin.js';
import { ErrorCode } from '../src/errors.js';
import { safeReturnTo } from '../src/identity.js';
import {
  sortStatusNotices,
  STATUS_BANNER_LIMIT,
  STATUS_NOTICE_PRIORITY,
  StatusNoticeCode,
  StatusNoticeList,
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
