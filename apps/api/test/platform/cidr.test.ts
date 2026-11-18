import { describe, expect, it } from 'vitest';
import { cidrBlockList, isAllowedIp, parseCidrList } from '../../src/platform/config/index.js';

/* Story 4.7-a: đọc `ADMIN_ALLOWED_CIDRS` và so IP client (`node:net` `BlockList`). */

const cidrs = (raw: string): string[] => {
  const parsed = parseCidrList(raw);
  if (!parsed.ok) throw new Error(`parseCidrList lỗi: ${parsed.reason}`);
  return parsed.cidrs;
};

const allowed = (raw: string, ip: string | undefined): boolean => isAllowedIp(cidrBlockList(cidrs(raw)), ip);

describe('parseCidrList', () => {
  it('IPv4 và IPv6 kèm prefix; IP trần → /32 hoặc /128; bỏ khoảng trắng, gộp trùng; IPv6 chuẩn hóa chữ thường, rút gọn', () => {
    expect(cidrs('203.0.113.0/24')).toEqual(['203.0.113.0/24']);
    expect(cidrs(' 203.0.113.0/24 , 2001:db8::/32,198.51.100.7 ')).toEqual([
      '203.0.113.0/24',
      '2001:db8::/32',
      '198.51.100.7/32',
    ]);
    expect(cidrs('2001:DB8:0:0::1')).toEqual(['2001:db8::1/128']);
    expect(cidrs('203.0.113.0/24,203.0.113.0/24, 198.51.100.7/32,198.51.100.7')).toEqual([
      '203.0.113.0/24',
      '198.51.100.7/32',
    ]);
    expect(cidrs('2001:db8::/32,2001:0DB8::/32')).toEqual(['2001:db8::/32']);
    // Prefix biên (`8000::/1` không phủ `::ffff:0:0/96`).
    expect(cidrs('10.0.0.0/1,10.0.0.1/32,8000::/1,::1/128')).toEqual(['10.0.0.0/1', '10.0.0.1/32', '8000::/1', '::1/128']);
    // Sát vùng IPv4 ánh xạ mà không chồng lên: `::/96` (IPv4-compatible cũ), `::ffff:0:0:0/96`.
    expect(cidrs('::/96,::ffff:0:0:0/96')).toEqual(['::/96', '::ffff:0:0:0/96']);
    // Mục rỗng giữa các dấu phẩy bỏ qua (như danh sách email).
    expect(cidrs('203.0.113.0/24,')).toEqual(['203.0.113.0/24']);
  });

  it.each([
    ['', 'danh sách CIDR rỗng'],
    [' ', 'danh sách CIDR rỗng'],
    [',', 'danh sách CIDR rỗng'],
    [' , ', 'danh sách CIDR rỗng'],
    ['abc', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0.0/33', 'mục thứ 1 có prefix ngoài 1–32 của IPv4'],
    ['2001:db8::/129', 'mục thứ 1 có prefix ngoài 1–128 của IPv6'],
    ['0.0.0.0/0', 'mục thứ 1 có prefix /0 (mở cho mọi IP)'],
    ['::/0', 'mục thứ 1 có prefix /0 (mở cho mọi IP)'],
    ['203.0.113.0/24,0.0.0.0/0', 'mục thứ 2 có prefix /0 (mở cho mọi IP)'],
    ['203.0.113.0/24,abc', 'mục thứ 2 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0.0/', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0.0/024', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0.0/+8', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0.0/8/8', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0/8', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['256.0.0.0/8', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['10.0.0.0 /8', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['fe80::1%eth0/64', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    ['203.0.113.0/24;198.51.100.0/24', 'mục thứ 1 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    // Đếm theo vị trí giữa các dấu phẩy: ô rỗng vẫn tính.
    ['203.0.113.0/24,,abc', 'mục thứ 3 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    [',abc', 'mục thứ 2 không phải IP hoặc CIDR IPv4/IPv6 hợp lệ'],
    // Dải IPv6 chồng lên `::ffff:0:0/96`: `BlockList` sẽ khớp cả client IPv4 (lách lệnh cấm /0).
    ['::/1', 'mục thứ 1 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
    ['::/8', 'mục thứ 1 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
    ['2001:db8::/1', 'mục thứ 1 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
    ['::ffff:0:0/96', 'mục thứ 1 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
    ['::ffff:203.0.113.0/120', 'mục thứ 1 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
    ['::ffff:203.0.113.7', 'mục thứ 1 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
    ['203.0.113.0/24,::fffe:0:0/95', 'mục thứ 2 có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96'],
  ])('%j → lỗi "%s", không nêu giá trị', (raw, reason) => {
    expect(parseCidrList(raw)).toEqual({ ok: false, reason });
  });
});

describe('isAllowedIp', () => {
  it('IPv4 trong / ngoài dải', () => {
    expect(allowed('203.0.113.0/24', '203.0.113.7')).toBe(true);
    expect(allowed('203.0.113.0/24', '203.0.113.255')).toBe(true);
    expect(allowed('203.0.113.0/24', '203.0.114.1')).toBe(false);
    expect(allowed('203.0.113.0/24', '198.51.100.1')).toBe(false);
    expect(allowed('198.51.100.7', '198.51.100.7')).toBe(true);
    expect(allowed('198.51.100.7', '198.51.100.8')).toBe(false);
  });

  it('IPv4 ánh xạ `::ffff:a.b.c.d` (api nghe dual-stack) so như IPv4', () => {
    expect(allowed('203.0.113.0/24', '::ffff:203.0.113.7')).toBe(true);
    expect(allowed('203.0.113.0/24', '::FFFF:203.0.113.7')).toBe(true);
    expect(allowed('203.0.113.0/24', '::ffff:198.51.100.1')).toBe(false);
    expect(allowed('127.0.0.1', '::ffff:127.0.0.1')).toBe(true);
  });

  it('IPv6 trong / ngoài dải', () => {
    expect(allowed('2001:db8::/32', '2001:db8::1')).toBe(true);
    expect(allowed('2001:db8::/32', '2001:DB8:ffff::1')).toBe(true);
    expect(allowed('2001:db8::/32', '2001:db9::1')).toBe(false);
    // Dải IPv6 hợp lệ (không chồng lên ::ffff:0:0/96, xem parseCidrList) không khớp client IPv4, và ngược lại.
    expect(allowed('2001:db8::/32', '203.0.113.7')).toBe(false);
    expect(allowed('8000::/1', '203.0.113.7')).toBe(false);
    expect(allowed('203.0.113.0/24', '2001:db8::1')).toBe(false);
  });

  it('nhiều dải: khớp một dải là qua', () => {
    const list = '203.0.113.0/24,2001:db8::/32';
    expect(allowed(list, '203.0.113.7')).toBe(true);
    expect(allowed(list, '2001:db8::1')).toBe(true);
    expect(allowed(list, '198.51.100.1')).toBe(false);
  });

  it.each([undefined, '', 'abc', '203.0.113', '203.0.113.7:443', ' 203.0.113.7', '::ffff:999.0.113.7'])(
    'IP không phân tích được (%j) → chặn',
    (ip) => {
      expect(allowed('203.0.113.0/24', ip)).toBe(false);
    },
  );
});
