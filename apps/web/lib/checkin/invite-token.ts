/*
 * Token của link mời CTV (`/loi-moi-ctv#token`, Story 5.2), giữ trong `sessionStorage` của tab khi phải rời trang để đăng
 * nhập/đồng ý rồi đọc lại khi quay về `/loi-moi-ctv`. Khóa riêng, không dùng chung với link mời Admin. Cách giữ: xem
 * `lib/auth/hash-token.ts`.
 */

import { hashTokenStore } from '@/lib/auth/hash-token';

/** Khóa `sessionStorage` của token link mời CTV. */
export const CHECKER_INVITE_TOKEN_STORAGE_KEY = 'tickee:loi-moi-ctv:token';

const store = hashTokenStore(CHECKER_INVITE_TOKEN_STORAGE_KEY);

/** Lưu token cho tab này. @returns lưu được không; storage bị chặn thì `false`. */
export const rememberCheckerInviteToken = store.remember;
export const recallCheckerInviteToken = store.recall;
export const forgetCheckerInviteToken = store.forget;
