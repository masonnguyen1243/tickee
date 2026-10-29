import type { Response } from 'express';

/** Chuyển tiếp mọi `set-cookie` mà `auth.api.*` (gọi với `returnHeaders: true`) trả về sang response HTTP. */
export function forwardSetCookies(from: Headers, res: Response): void {
  const cookies = from.getSetCookie();
  if (cookies.length > 0) res.append('set-cookie', cookies);
}
