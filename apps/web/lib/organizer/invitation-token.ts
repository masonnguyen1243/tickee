/*
 * Token của link mời Admin (`/loi-moi-btc#token`). Token nằm sau `#` nên không tới server web và không lọt vào header
 * `Referer`. Khi phải rời trang để đăng nhập/đồng ý, token được giữ trong `sessionStorage` của tab (không đưa vào
 * `returnTo`, vốn đi qua query của màn đăng nhập và tới api khi đăng nhập Google), rồi đọc lại khi quay về
 * `/loi-moi-btc`.
 */

const STORAGE_KEY = 'tickee:loi-moi-btc:token';
const MAX_TOKEN_LENGTH = 256;

/** Token trong `location.hash` (`#abc` → `abc`); rỗng hoặc dài bất thường → `null`. */
export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, '').trim();
  return token === '' || token.length > MAX_TOKEN_LENGTH ? null : token;
}

/**
 * Lưu token cho tab này. @returns lưu được không; storage bị chặn thì `false` (người gọi giữ token trong `#` của URL,
 * hoặc người dùng mở lại link trong email).
 */
export function rememberInvitationToken(token: string): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export function recallInvitationToken(): string | null {
  try {
    return tokenFromHash(window.sessionStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return null;
  }
}

export function forgetInvitationToken(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Không xóa được: token hết hiệu lực ở server nên không hại gì.
  }
}
