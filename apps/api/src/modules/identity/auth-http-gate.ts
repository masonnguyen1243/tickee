import { ErrorCode, type ErrorResponse } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { AUTH_BASE_PATH, GOOGLE_PROVIDER_ID } from './auth.js';

/**
 * Đường dẫn HTTP của Better Auth (tương đối với `/v1/auth`, so khớp chính xác pathname sau khi chuẩn hóa, bỏ qua
 * query) được mở cho bên ngoài. Mặc định đóng hết: web chỉ đi qua `/v1/identity/*`, nơi có giới hạn gửi mã và
 * `SessionGuard`/`ConsentGuard`; endpoint Better Auth gọi thẳng qua HTTP thì bỏ qua cả hai. Chỉ mở callback Google
 * (Google điều hướng trình duyệt về đây); bắt đầu đăng nhập Google đi qua `GET /v1/identity/google`.
 * Chỉ chặn HTTP: `auth.api.*` phía server vẫn gọi được.
 */
export const AUTH_HTTP_ALLOWLIST: readonly string[] = [`/callback/${GOOGLE_PROVIDER_ID}`];

/** Phương thức HTTP được qua cổng: Google quay về callback bằng điều hướng GET top-level. */
const AUTH_HTTP_METHODS: ReadonlySet<string> = new Set(['GET']);

const NOT_FOUND_BODY: ErrorResponse = {
  error: { code: ErrorCode.NOT_FOUND, message: 'Không tìm thấy tài nguyên.', details: null },
};

/** `url` (path + query của request) có thuộc allowlist HTTP của Better Auth không. */
export function isAuthHttpPathAllowed(url: string, allowlist: readonly string[] = AUTH_HTTP_ALLOWLIST): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://auth.invalid').pathname;
  } catch {
    return false;
  }
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;
  return allowlist.includes(pathname.slice(AUTH_BASE_PATH.length));
}

/** Middleware của `AuthModule`, chạy trước handler Better Auth: ngoài allowlist → 404 dạng lỗi chuẩn. */
export function authHttpGate(req: Request, res: Response, next: () => void): void {
  if (AUTH_HTTP_METHODS.has(req.method) && isAuthHttpPathAllowed(req.originalUrl ?? req.url)) {
    next();
    return;
  }
  res.status(404).json(NOT_FOUND_BODY);
}
