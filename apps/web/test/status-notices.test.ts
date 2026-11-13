import { StatusNoticeCode } from '@tickee/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusNoticesResponse } from '@/lib/reporting/api';
import {
  isStatusNoticeDismissed,
  saveStatusNoticeDismissed,
  STATUS_NOTICE_CONTENT,
  statusNoticeContent,
  statusNoticeDismissKey,
} from '@/lib/reporting/status-notices';

describe('nội dung status-banner theo mã (AD-34)', () => {
  it('mọi mã có tiêu đề; Chờ duyệt Closed Beta đúng copy, không có nút', () => {
    for (const code of Object.values(StatusNoticeCode)) {
      for (const role of ['owner', 'admin'] as const) {
        expect(statusNoticeContent(code, role).title.length, `${code} ${role}`).toBeGreaterThan(0);
      }
    }
    expect(STATUS_NOTICE_CONTENT.CLOSED_BETA_PENDING).toEqual({
      title: 'Chờ duyệt Closed Beta',
      description: 'Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.',
    });
  });
});

describe('dịch vụ thanh toán bị ngắt (Story 4.2-a): tiêu đề theo câu đã chốt, chưa có hành động', () => {
  it('bốn mã, cùng nội dung cho Owner và Admin', () => {
    const titles = {
      PAYMENT_SERVICE_SUSPENDED_TOKEN: 'Mọi Sự kiện có phí đang Tạm ngừng bán',
      PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID: 'Key Tingee không còn dùng được',
      PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING: 'Key Tingee chưa được cấp quyền Cổng thanh toán',
      PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC',
    } as const;
    for (const [code, title] of Object.entries(titles) as [keyof typeof titles, string][]) {
      for (const role of ['owner', 'admin'] as const) {
        const content = statusNoticeContent(code, role);
        expect(content.title, `${code} ${role}`).toBe(title);
        expect(content.action, `${code} ${role}`).toBeUndefined();
      }
    }
    expect(statusNoticeContent('PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED', 'owner').description).toBe(
      'Mọi Sự kiện có phí đang Tạm ngừng bán.',
    );
  });
});

describe('chưa liên kết tài khoản nhận tiền: câu theo vai (Story 2.6)', () => {
  it('Owner có nút "Liên kết ngay" tới Tài khoản nhận tiền; Admin chỉ được nhắc nhờ Owner', () => {
    expect(statusNoticeContent('PAYOUT_ACCOUNT_NOT_LINKED', 'owner')).toMatchObject({
      description: 'Liên kết tài khoản nhận tiền để bán Vé có phí.',
      action: { label: 'Liên kết ngay', section: 'payout-account' },
    });
    const admin = statusNoticeContent('PAYOUT_ACCOUNT_NOT_LINKED', 'admin');
    expect(admin.description).toBe('Nhờ Owner liên kết tài khoản nhận tiền.');
    expect(admin.action).toBeUndefined();
    // Mã không theo vai: cùng nội dung cho mọi vai.
    expect(statusNoticeContent('CLOSED_BETA_PENDING', 'admin')).toBe(statusNoticeContent('CLOSED_BETA_PENDING', 'owner'));
  });
});

describe('đóng banner theo code + version', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('khóa đổi khi version đổi', () => {
    const a = statusNoticeDismissKey({ code: 'CLOSED_BETA_PENDING', version: 'v1' });
    expect(a).not.toBe(statusNoticeDismissKey({ code: 'CLOSED_BETA_PENDING', version: 'v2' }));
    expect(a).not.toBe(statusNoticeDismissKey({ code: 'CLOSED_BETA_REVOKED', version: 'v1' }));
  });

  it('lưu vào sessionStorage; storage bị chặn thì coi như chưa đóng, không ném lỗi', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    });
    const notice = { code: 'CLOSED_BETA_PENDING', version: 'v1' } as const;
    expect(isStatusNoticeDismissed(notice)).toBe(false);
    saveStatusNoticeDismissed(notice);
    expect(isStatusNoticeDismissed(notice)).toBe(true);
    expect(isStatusNoticeDismissed({ ...notice, version: 'v2' })).toBe(false);

    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(isStatusNoticeDismissed(notice)).toBe(false);
    expect(() => saveStatusNoticeDismissed(notice)).not.toThrow();
  });
});

describe('đọc danh sách thông báo dễ dãi', () => {
  const notice = (code: string) => ({
    code,
    severity: 'danger',
    blocking: true,
    dismissible: false,
    scope: 'organization',
    audience: ['owner', 'admin'],
    data: {},
    version: 'v1',
  });

  it('mã lạ (api mới hơn web) bị bỏ, các thông báo biết mã vẫn giữ đúng thứ tự', () => {
    const parsed = StatusNoticesResponse.parse([
      notice('MA_MOI_CHUA_BIET'),
      notice('CLOSED_BETA_REVOKED'),
      { ...notice('CLOSED_BETA_PENDING'), severity: 'warning', blocking: false },
    ]);
    expect(parsed.map((n) => n.code)).toEqual(['CLOSED_BETA_REVOKED', 'CLOSED_BETA_PENDING']);
  });

  it('response không phải mảng vẫn bị từ chối', () => {
    expect(StatusNoticesResponse.safeParse({ notices: [] }).success).toBe(false);
  });
});
