import { BlockList, isIP } from 'node:net';

/*
 * Danh sách CIDR cho phép (Story 4.7-a, `ADMIN_ALLOWED_CIDRS`, FR-4, AD-26): schema `config` kiểm và chuẩn hóa lúc khởi
 * động, middleware của `admin` so IP client với danh sách đã chuẩn hóa. Chỉ dùng `node:net` (`BlockList`, `isIP`).
 */

/** Kết quả đọc danh sách CIDR. `reason` chỉ nêu sai gì và ở mục thứ mấy, không bao giờ chứa giá trị. */
export type CidrListResult = { ok: true; cidrs: string[] } | { ok: false; reason: string };

/** Prefix thập phân, không số 0 thừa ở đầu (`/0`, `/24`, `/128`). */
const PREFIX = /^(0|[1-9]\d{0,2})$/;

/** IPv6 dạng ngắn gọn, chữ thường (`2001:0DB8::0001` → `2001:db8::1`); `address` đã qua `isIP`. */
function canonicalIpv6(address: string): string {
  return new URL(`http://[${address}]`).hostname.slice(1, -1);
}

/** Vùng IPv4 ánh xạ sang IPv6 (`::ffff:0:0/96`). */
const IPV4_MAPPED_RANGE = new BlockList();
IPV4_MAPPED_RANGE.addSubnet('::ffff:0:0', 96, 'ipv6');

/**
 * Dải IPv6 `address/prefix` có giao với `::ffff:0:0/96` không: `BlockList` so client IPv4 với cả dải IPv6 phủ vùng này
 * (`::/1` mở cho mọi IPv4, lách lệnh cấm `/0`). Hai dải giao nhau khi dải này chứa `::ffff:0:0` hoặc nằm trong vùng đó.
 */
function overlapsIpv4Mapped(address: string, prefix: number): boolean {
  const range = new BlockList();
  range.addSubnet(address, prefix, 'ipv6');
  return range.check('::ffff:0:0', 'ipv6') || IPV4_MAPPED_RANGE.check(address, 'ipv6');
}

/** Một mục `ip/prefix` hoặc IP trần → `ip/prefix` chuẩn hóa, hoặc lý do sai (không có giá trị). */
function normalizeCidr(entry: string): { cidr: string } | { reason: string } {
  const slash = entry.indexOf('/');
  const address = slash < 0 ? entry : entry.slice(0, slash);
  // Zone IPv6 (`fe80::1%eth0`) không có nghĩa trong một dải.
  const version = address.includes('%') ? 0 : isIP(address);
  if (version === 0) return { reason: 'không phải IP hoặc CIDR IPv4/IPv6 hợp lệ' };
  const max = version === 4 ? 32 : 128;
  let prefix = max;
  if (slash >= 0) {
    const text = entry.slice(slash + 1);
    if (!PREFIX.test(text)) return { reason: 'không phải IP hoặc CIDR IPv4/IPv6 hợp lệ' };
    prefix = Number(text);
    if (prefix === 0) return { reason: 'có prefix /0 (mở cho mọi IP)' };
    if (prefix > max) return { reason: `có prefix ngoài 1–${max} của IPv${version}` };
  }
  if (version === 6 && overlapsIpv4Mapped(address, prefix)) {
    return { reason: 'có dải IPv6 chồng lên IPv4 ánh xạ ::ffff:0:0/96' };
  }
  return { cidr: `${version === 4 ? address : canonicalIpv6(address)}/${prefix}` };
}

/**
 * Đọc danh sách CIDR cách nhau bằng dấu phẩy (khoảng trắng quanh mục bỏ qua, mục rỗng bỏ qua, trùng thì gộp). Mỗi mục là
 * `ip/prefix` IPv4 (prefix 1–32) hoặc IPv6 (1–128); IP trần là `/32` hoặc `/128`. Danh sách rỗng, mục sai, prefix `/0`
 * hoặc dải IPv6 chồng lên `::ffff:0:0/96` → lỗi. "Mục thứ N" đếm theo vị trí giữa các dấu phẩy (kể cả ô rỗng).
 */
export function parseCidrList(raw: string): CidrListResult {
  const cidrs: string[] = [];
  for (const [index, slot] of raw.split(',').entries()) {
    const entry = slot.trim();
    if (entry === '') continue;
    const result = normalizeCidr(entry);
    if ('reason' in result) return { ok: false, reason: `mục thứ ${index + 1} ${result.reason}` };
    cidrs.push(result.cidr);
  }
  if (cidrs.length === 0) return { ok: false, reason: 'danh sách CIDR rỗng' };
  return { ok: true, cidrs: [...new Set(cidrs)] };
}

/** `BlockList` (dùng làm danh sách cho phép) từ các CIDR đã chuẩn hóa bởi `parseCidrList`. */
export function cidrBlockList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const slash = cidr.lastIndexOf('/');
    const address = cidr.slice(0, slash);
    list.addSubnet(address, Number(cidr.slice(slash + 1)), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

/** IPv4 ánh xạ sang IPv6 (`::ffff:a.b.c.d`): IP client khi api nghe dual-stack. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * `ip` (vd. `req.ip`) có thuộc `list` không. `::ffff:a.b.c.d` được so như IPv4 `a.b.c.d`. IP thiếu hoặc không phân tích
 * được → `false` (bị chặn).
 */
export function isAllowedIp(list: BlockList, ip: string | undefined): boolean {
  if (!ip) return false;
  const address = IPV4_MAPPED.exec(ip)?.[1] ?? ip;
  const version = isIP(address);
  if (version === 0) return false;
  return list.check(address, version === 4 ? 'ipv4' : 'ipv6');
}
