import { describe, expect, it } from 'vitest';

import { withNotice, withReturnTo } from '@/lib/auth/return-to';

describe('withReturnTo, withNotice', () => {
  it('mã hóa returnTo và bỏ khi là trang chủ', () => {
    expect(withReturnTo('/dang-nhap', '/su-kien/a?x=1')).toBe('/dang-nhap?returnTo=%2Fsu-kien%2Fa%3Fx%3D1');
    expect(withReturnTo('/dong-y', '//evil.com')).toBe('/dong-y');
    expect(withReturnTo('/dang-nhap', '/..//evil.com')).toBe('/dang-nhap');
  });

  it('đích dưới màn đăng nhập (trang trung gian Google) bị bỏ', () => {
    expect(withReturnTo('/dang-nhap', '/dang-nhap/google?returnTo=/a')).toBe('/dang-nhap');
  });

  it('thêm notice, giữ query sẵn có', () => {
    expect(withNotice('/su-kien/a?x=1', 'consent-declined')).toBe('/su-kien/a?x=1&notice=consent-declined');
    expect(withNotice('/', 'consent-declined')).toBe('/?notice=consent-declined');
    expect(withNotice('https://evil.com', 'consent-declined')).toBe('/?notice=consent-declined');
    expect(withNotice('/..//evil.com', 'consent-declined')).toBe('/?notice=consent-declined');
    expect(withNotice('/.//evil.com?x=1', 'consent-declined')).toBe('/?notice=consent-declined');
  });
});
