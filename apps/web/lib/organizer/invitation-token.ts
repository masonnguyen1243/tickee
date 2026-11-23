/*
 * Token của link mời Admin (`/loi-moi-btc#token`), giữ trong `sessionStorage` của tab khi phải rời trang để đăng
 * nhập/đồng ý rồi đọc lại khi quay về `/loi-moi-btc`. Cách giữ chung với link mời CTV: xem `lib/auth/hash-token.ts`.
 */

import { hashTokenStore } from '@/lib/auth/hash-token';

export { tokenFromHash } from '@/lib/auth/hash-token';

const store = hashTokenStore('tickee:loi-moi-btc:token');

/** Lưu token cho tab này. @returns lưu được không; storage bị chặn thì `false`. */
export const rememberInvitationToken = store.remember;
export const recallInvitationToken = store.recall;
export const forgetInvitationToken = store.forget;
