import { tokenApiPath } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { tokenQueryKey } from '@/lib/organizer/api';
import {
  canLinkPayoutAccount,
  formatTokenCount,
  TOKEN_NO_PAYOUT_ACCOUNT_ADMIN,
  TOKEN_PURCHASE_ADMIN,
  TOKEN_PURCHASE_LABEL,
  TOKEN_PURCHASE_NOTE,
  TOKEN_UNAVAILABLE_TITLE,
  tokenPurchaseOf,
  tokenReadAtLabel,
} from '@/lib/organizer/token';

/* Story 4.5-a: định dạng số và giờ đọc của trang Token, nội dung theo vai. Trang được kiểm bằng Playwright. */

const ORG_ID = '019a3b2c-5678-7abc-8def-0123456789ab';
const PORTAL = 'https://baas.tingee.vn';

describe('số Token (vi-VN)', () => {
  it('dấu chấm phân cách nghìn; số âm có dấu trừ', () => {
    expect(formatTokenCount(1_700)).toBe('1.700');
    expect(formatTokenCount(1_200)).toBe('1.200');
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(-200)).toBe('-200');
    expect(formatTokenCount(-1_234_567)).toBe('-1.234.567');
    expect(formatTokenCount(12_345_678_901)).toBe('12.345.678.901');
    // Cùng kết quả với Intl `vi-VN` (khi runtime có dữ liệu ICU).
    for (const n of [1_700, -200, -1_234_567, 999, 1_000]) expect(formatTokenCount(n)).toBe(n.toLocaleString('vi-VN'));
  });

  it('không phải số nguyên → lỗi (api chỉ trả số nguyên)', () => {
    expect(() => formatTokenCount(1.5)).toThrow(RangeError);
    expect(() => formatTokenCount(Number.NaN)).toThrow(RangeError);
  });
});

describe('giờ đọc', () => {
  it('"Đọc lúc HH:mm:ss" theo giờ Việt Nam, không theo múi giờ máy', () => {
    expect(tokenReadAtLabel('2026-11-16T03:04:05.000Z')).toBe('Đọc lúc 10:04:05');
    expect(tokenReadAtLabel('2026-11-16T17:00:09.999Z')).toBe('Đọc lúc 00:00:09');
  });
});

describe('nội dung theo vai', () => {
  it('Owner: link "Mua thêm Token" tới portal Tingee; Admin: "Chỉ Owner mua thêm Token."', () => {
    expect(tokenPurchaseOf('owner', PORTAL)).toEqual({ kind: 'link', href: PORTAL });
    expect(tokenPurchaseOf('admin', undefined)).toEqual({ kind: 'owner_only' });
    // Admin không bao giờ có link, kể cả khi api lỡ trả.
    expect(tokenPurchaseOf('admin', PORTAL)).toEqual({ kind: 'owner_only' });
    // Owner mà api không trả link: không hiện gì (không hiện câu dành cho Admin).
    expect(tokenPurchaseOf('owner', undefined)).toEqual({ kind: 'none' });
  });

  it('chưa có tài khoản nhận tiền mặc định: Owner có nút tới Tài khoản nhận tiền, Admin nhờ Owner', () => {
    expect(canLinkPayoutAccount('owner')).toBe(true);
    expect(canLinkPayoutAccount('admin')).toBe(false);
    expect(TOKEN_NO_PAYOUT_ACCOUNT_ADMIN).toBe('Nhờ Owner liên kết tài khoản nhận tiền.');
  });

  it('câu chữ chốt trong spec', () => {
    expect(TOKEN_UNAVAILABLE_TITLE).toBe('Chưa đọc được số dư');
    expect(TOKEN_PURCHASE_LABEL).toBe('Mua thêm Token');
    expect(TOKEN_PURCHASE_ADMIN).toBe('Chỉ Owner mua thêm Token.');
    expect(TOKEN_PURCHASE_NOTE).toBe('Token mua trên portal Tingee; Tickee không bán Token.');
  });
});

describe('API', () => {
  it('đường dẫn và khóa query', () => {
    expect(tokenApiPath(ORG_ID)).toBe(`/orgs/${ORG_ID}/token`);
    expect(tokenQueryKey(ORG_ID)).toEqual(['organizer', 'token', ORG_ID]);
  });
});
