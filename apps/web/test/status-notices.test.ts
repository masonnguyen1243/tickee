import { StatusNoticeCode } from '@tickee/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusNoticesResponse } from '@/lib/reporting/api';
import {
  isStatusNoticeDismissed,
  saveStatusNoticeDismissed,
  STATUS_NOTICE_CONTENT,
  statusNoticeContent,
  statusNoticeDismissKey,
  statusNoticeLink,
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

describe('dịch vụ thanh toán bị ngắt (Story 4.2-b): câu theo vai, một hành động cho Owner', () => {
  const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
  const PAUSED = 'Mọi Sự kiện có phí đang Tạm ngừng bán.';
  const notice = (data: Record<string, unknown> = {}) => ({ data });

  it('tiêu đề giữ của 4.2-a; Owner: mô tả + hành động; Admin: câu nhờ Owner, không hành động', () => {
    const table = {
      PAYMENT_SERVICE_SUSPENDED_TOKEN: {
        title: 'Mọi Sự kiện có phí đang Tạm ngừng bán',
        owner: 'Tingee báo đã hết Token (gói dịch vụ hết hạn).',
        action: 'Mua thêm Token',
        admin: 'Tingee báo đã hết Token. Nhờ Owner mua thêm Token.',
      },
      PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED: {
        title: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC',
        owner: PAUSED,
        action: 'Xem chi tiết',
        admin: `${PAUSED} Nhờ Owner liên hệ Tingee.`,
      },
      PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID: {
        title: 'Key Tingee không còn dùng được',
        owner: PAUSED,
        action: 'Nhập lại key',
        admin: `${PAUSED} Nhờ Owner cập nhật key Tingee.`,
      },
      PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING: {
        title: 'Key Tingee chưa được cấp quyền Cổng thanh toán',
        owner: PAUSED,
        action: 'Xem cách xử lý',
        admin: `${PAUSED} Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee.`,
      },
    } as const;
    for (const [code, copy] of Object.entries(table) as [keyof typeof table, (typeof table)[keyof typeof table]][]) {
      const owner = statusNoticeContent(code, 'owner');
      expect(owner.title, code).toBe(copy.title);
      expect(owner.description, code).toBe(copy.owner);
      expect(owner.action?.label, code).toBe(copy.action);
      const admin = statusNoticeContent(code, 'admin');
      expect(admin.title, code).toBe(copy.title);
      expect(admin.description, code).toBe(copy.admin);
      expect(admin.action, code).toBeUndefined();
    }
  });

  it('"Mua thêm Token" là liên kết ngoài tới data.tingeePortalUrl; các hành động khác tới trang Tài khoản nhận tiền', () => {
    const buy = statusNoticeContent('PAYMENT_SERVICE_SUSPENDED_TOKEN', 'owner').action!;
    expect(statusNoticeLink(buy, notice({ tingeePortalUrl: 'https://baas.tingee.vn' }), ORG)).toEqual({
      label: 'Mua thêm Token',
      href: 'https://baas.tingee.vn',
      external: true,
    });
    for (const code of [
      'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
      'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
      'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
      'PAYOUT_ACCOUNT_NOT_LINKED',
    ] as const) {
      const link = statusNoticeLink(statusNoticeContent(code, 'owner').action!, notice(), ORG);
      expect(link, code).toMatchObject({ href: `/btc/${ORG}/tai-khoan-nhan-tien`, external: false });
    }
  });

  it('URL ngoài thiếu, không phải chuỗi hay không phải http(s) → không có hành động', () => {
    const buy = statusNoticeContent('PAYMENT_SERVICE_SUSPENDED_TOKEN', 'owner').action!;
    for (const data of [{}, { tingeePortalUrl: 42 }, { tingeePortalUrl: 'javascript:alert(1)' }, { tingeePortalUrl: 'portal' }]) {
      expect(statusNoticeLink(buy, notice(data), ORG), JSON.stringify(data)).toBeNull();
    }
    expect(statusNoticeLink(buy, notice({ tingeePortalUrl: 'http://localhost:4010' }), ORG)?.href).toBe(
      'http://localhost:4010',
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
