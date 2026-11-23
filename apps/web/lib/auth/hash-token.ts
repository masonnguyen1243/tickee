/*
 * Token của link mời đặt sau `#` (`/loi-moi-btc#token`, `/loi-moi-ctv#token`). Phần `#` không tới server web và không lọt
 * vào header `Referer`. Khi phải rời trang để đăng nhập/đồng ý, token được giữ trong `sessionStorage` của tab, mỗi loại
 * link một khóa riêng (không đưa vào `returnTo`, vốn đi qua query của màn đăng nhập và tới api khi đăng nhập Google), rồi
 * đọc lại khi quay về trang của link.
 */

const MAX_TOKEN_LENGTH = 256;

/** Token trong `location.hash` (`#abc` → `abc`); rỗng hoặc dài bất thường → `null`. */
export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, '').trim();
  return token === '' || token.length > MAX_TOKEN_LENGTH ? null : token;
}

/** Bộ lưu token của một loại link trong `sessionStorage` của tab, theo một khóa cố định. */
export type HashTokenStore = {
  /**
   * Lưu token cho tab này. @returns lưu được không; storage bị chặn thì `false` (người gọi giữ token trong `#` của URL,
   * hoặc người dùng mở lại link).
   */
  remember: (token: string) => boolean;
  /** Token đã giữ; không có, sai dạng hoặc storage bị chặn → `null`. */
  recall: () => string | null;
  /** Bỏ token đã giữ; storage bị chặn thì bỏ qua (token hết hiệu lực ở server nên không hại gì). */
  forget: () => void;
};

/** Bộ lưu token theo khóa `storageKey` (mỗi loại link một khóa, không dùng chung). */
export function hashTokenStore(storageKey: string): HashTokenStore {
  return {
    remember(token) {
      try {
        window.sessionStorage.setItem(storageKey, token);
        return true;
      } catch {
        return false;
      }
    },
    recall() {
      try {
        return tokenFromHash(window.sessionStorage.getItem(storageKey) ?? '');
      } catch {
        return null;
      }
    },
    forget() {
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        // Không xóa được: token hết hiệu lực ở server nên không hại gì.
      }
    },
  };
}
