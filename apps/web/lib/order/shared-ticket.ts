import { SHARE_TOKEN_PATTERN } from '@tickee/contracts';

/*
 * Token của link chia sẻ Vé (`/xem-ve#<token>`, Story 3.8). Token nằm sau `#` nên không tới server web, không vào log
 * web hay header `Referer`; trang đọc ở trình duyệt rồi gọi API công khai.
 */

/** Token trong `location.hash` (`#abc…` → `abc…`); rỗng hoặc sai dạng (không phải 22 ký tự base64url) → `null`. */
export function sharedTicketTokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, '').trim();
  return SHARE_TOKEN_PATTERN.test(token) ? token : null;
}
