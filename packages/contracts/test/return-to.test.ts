import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../src/identity.js';

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

  it.each([
    '/dang-nhap?returnTo=/a',
    '/dang-nhap/',
    '/dang-nhap/google?returnTo=/a',
    '/dang-nhap/google/x',
    '/dong-y',
    '/dong-y/',
    '/dong-y/x?y=1',
    '/su-kien/../dang-nhap/google',
  ])('mọi đường dẫn dưới màn đăng nhập/đồng ý không làm đích quay về: %j → /', (raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });

  it('đường dẫn chỉ trùng tiền tố chữ vẫn hợp lệ', () => {
    expect(safeReturnTo('/dang-nhap-x')).toBe('/dang-nhap-x');
    expect(safeReturnTo('/dong-yy')).toBe('/dong-yy');
  });
});
