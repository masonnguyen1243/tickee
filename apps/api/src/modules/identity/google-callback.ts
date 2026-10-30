import { GoogleSignInError, SIGN_IN_ERROR_PARAM } from '@tickee/contracts';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';

/** Callback OAuth của Better Auth (`/callback/:id`). */
const OAUTH_CALLBACK_ENDPOINT = '/callback/:id';

/**
 * Better Auth kiểm `email_verified` của provider *trước* `validateUserInfo` khi email đã có user (nối tài khoản), và
 * khi đó trả `account_not_linked`. Với cấu hình của Tickee (`trustedProviders: []`, liên kết bật, user OTP luôn
 * `emailVerified`, user Google chỉ được tạo khi email đã xác minh) mã này chỉ xảy ra khi Google báo email chưa xác
 * minh, nên đổi thành `email_not_verified` để web hiện đúng thông báo dù email mới hay đã có.
 */
export function rewriteUnverifiedLinkError(location: string): string | null {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  if (url.searchParams.get(SIGN_IN_ERROR_PARAM) !== 'account_not_linked') return null;
  url.searchParams.set(SIGN_IN_ERROR_PARAM, GoogleSignInError.EMAIL_NOT_VERIFIED);
  url.searchParams.delete('error_description');
  return url.toString();
}

/** Hook `after` của Better Auth: đổi lỗi chuyển hướng của callback Google theo `rewriteUnverifiedLinkError`. */
export const googleCallbackHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== OAUTH_CALLBACK_ENDPOINT) return;
  const returned = ctx.context.returned;
  const location = isAPIError(returned) ? returned.headers?.get('location') : null;
  const rewritten = location ? rewriteUnverifiedLinkError(location) : null;
  if (rewritten) throw ctx.redirect(rewritten);
});
