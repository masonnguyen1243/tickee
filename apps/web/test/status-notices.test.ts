import { StatusNoticeCode } from '@tickee/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusNoticesResponse } from '@/lib/reporting/api';
import {
  isStatusNoticeDismissed,
  saveStatusNoticeDismissed,
  STATUS_NOTICE_CONTENT,
  statusNoticeDismissKey,
} from '@/lib/reporting/status-notices';

describe('nội dung status-banner theo mã (AD-34)', () => {
  it('mọi mã có tiêu đề; Chờ duyệt Closed Beta đúng copy, không có nút', () => {
    for (const code of Object.values(StatusNoticeCode)) {
      expect(STATUS_NOTICE_CONTENT[code].title.length, code).toBeGreaterThan(0);
    }
    expect(STATUS_NOTICE_CONTENT.CLOSED_BETA_PENDING).toEqual({
      title: 'Chờ duyệt Closed Beta',
      description: 'Tingee sẽ liên hệ qua SĐT hoặc email liên hệ của BTC để xác minh.',
    });
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
