import { describe, expect, it } from 'vitest';

import { safeReturnTo, withNotice, withReturnTo } from '@/lib/auth/return-to';

describe('safeReturnTo — chỉ nhận đường dẫn nội bộ', () => {
  it.each([
    ['/su-kien/a?x=1', '/su-kien/a?x=1'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://x', '/'],
    ['', '/'],
  ])('matrix: %j → %j', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [['/a', '/b']],
    ['su-kien/a'],
    ['javascript:alert(1)'],
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    [' /a'],
    ['/a b'],
    ['//\\evil.com'],
    ['/%5Cevil.com/..'],
  ])('không hợp lệ: %j → /', (raw) => {
    const result = safeReturnTo(raw);
    // Kết quả luôn là đường dẫn nội bộ, không bao giờ trỏ ra host khác.
    expect(new URL(result, 'http://tickee.invalid').origin).toBe('http://tickee.invalid');
    if (raw !== '/%5Cevil.com/..') expect(result).toBe('/');
  });

  it.each(['/..//evil.com', '/.//evil.com', '/a/../..//evil.com', '/./..//evil.com?x=1'])(
    'dot-segment chuẩn hóa thành `//host`: %j → /',
    (raw) => {
      expect(safeReturnTo(raw)).toBe('/');
    },
  );

  it('trả đường dẫn đã chuẩn hóa', () => {
    expect(safeReturnTo('/su-kien/./a/../b?x=1#ve')).toBe('/su-kien/b?x=1#ve');
    expect(safeReturnTo('/su-kien/../dang-nhap')).toBe('/');
  });

  it('giữ nguyên đường dẫn có hash và query', () => {
    expect(safeReturnTo('/su-kien/giai-dau#ve?hang=vip')).toBe('/su-kien/giai-dau#ve?hang=vip');
  });

  it('màn đăng nhập/đồng ý không làm đích quay về', () => {
    expect(safeReturnTo('/dang-nhap?returnTo=/a')).toBe('/');
    expect(safeReturnTo('/dong-y')).toBe('/');
  });
});

describe('withReturnTo, withNotice', () => {
  it('mã hóa returnTo và bỏ khi là trang chủ', () => {
    expect(withReturnTo('/dang-nhap', '/su-kien/a?x=1')).toBe('/dang-nhap?returnTo=%2Fsu-kien%2Fa%3Fx%3D1');
    expect(withReturnTo('/dong-y', '//evil.com')).toBe('/dong-y');
    expect(withReturnTo('/dang-nhap', '/..//evil.com')).toBe('/dang-nhap');
  });

  it('thêm notice, giữ query sẵn có', () => {
    expect(withNotice('/su-kien/a?x=1', 'consent-declined')).toBe('/su-kien/a?x=1&notice=consent-declined');
    expect(withNotice('/', 'consent-declined')).toBe('/?notice=consent-declined');
    expect(withNotice('https://evil.com', 'consent-declined')).toBe('/?notice=consent-declined');
    expect(withNotice('/..//evil.com', 'consent-declined')).toBe('/?notice=consent-declined');
    expect(withNotice('/.//evil.com?x=1', 'consent-declined')).toBe('/?notice=consent-declined');
  });
});
