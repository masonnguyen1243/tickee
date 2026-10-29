import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@tickee/contracts';
import { AppError, PUBLIC_ROUTE_KEY } from '../../platform/http/index.js';
import type { RequestWithSession } from './session.guard.js';

const CONSENT_EXEMPT_KEY = 'identity:consent-exempt';

/** Endpoint dùng được khi chưa đồng ý NĐ 13 (chỉ `me`, `consent`, `sign-out`). */
export const ConsentExempt = () => SetMetadata(CONSENT_EXEMPT_KEY, true);

/**
 * Guard toàn cục số 2, chạy sau `SessionGuard` (thứ tự đăng ký trong `IdentityModule`).
 * Có session mà `consentedAt` còn `null` → 403 `CONSENT_REQUIRED`, trừ route `@ConsentExempt()`.
 * Request ẩn danh và route công khai thì bỏ qua.
 */
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(CONSENT_EXEMPT_KEY, targets)) return true;

    const session = context.switchToHttp().getRequest<RequestWithSession>().session;
    if (!session) return true;
    if (session.user.consentedAt) return true;
    throw new AppError(ErrorCode.CONSENT_REQUIRED, 'Bạn cần đồng ý xử lý dữ liệu cá nhân để tiếp tục.');
  }
}
