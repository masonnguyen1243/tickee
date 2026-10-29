import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { ErrorCode } from '@tickee/contracts';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { AppError, PUBLIC_ROUTE_KEY } from '../../platform/http/index.js';
import type { Auth, AuthSession } from './auth.js';
import { forwardSetCookies } from './cookies.js';

/** Request sau `SessionGuard`: `session` là `null` khi ẩn danh, `undefined` ở route công khai (không tra). */
export type RequestWithSession = Request & { session?: AuthSession | null; user?: AuthSession['user'] | null };

/** Khóa metadata của `@OptionalAuth()` (`@thallesp/nestjs-better-auth`). */
const OPTIONAL_AUTH_KEY = 'OPTIONAL';

/**
 * Guard toàn cục số 1: tra session Better Auth từ cookie và gắn vào `request.session`.
 * Thay `AuthGuard` của thư viện để (1) chuyển tiếp cookie Better Auth trả về khi gia hạn hay xóa session hỏng,
 * (2) lỗi ra đúng dạng chuẩn `UNAUTHENTICATED`. Vẫn tôn trọng `@AllowAnonymous()` / `@OptionalAuth()`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService<Auth>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets)) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithSession>();
    let session: AuthSession | null = null;
    try {
      const result = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers), returnHeaders: true });
      forwardSetCookies(result.headers, http.getResponse<Response>());
      session = result.response;
    } catch (err) {
      // Better Auth báo lỗi khi tra/gia hạn session (vd. session vừa bị xóa bởi lần đăng xuất song song):
      // coi như không có session thay vì 500.
      if (!isAPIError(err)) throw err;
    }
    req.session = session;
    req.user = session?.user ?? null;

    if (session) return true;
    if (this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets)) return true;
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Bạn cần đăng nhập để tiếp tục.');
  }
}
