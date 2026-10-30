import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isTotpExemptRoute } from '@tickee/contracts';
import { PUBLIC_ROUTE_KEY } from '../../platform/http/index.js';
import type { RequestWithSession } from './session.guard.js';
import { totpRequired } from './totp.service.js';

/** Request sau `SessionGuard`, kèm route Express đã khớp (`path` theo khai báo, vd. `/v1/orgs/:orgId`). */
type TotpGuardRequest = RequestWithSession & { route?: { path?: unknown } };

/**
 * Guard toàn cục số 2 (sau `SessionGuard`, trước `ConsentGuard`; thứ tự đăng ký trong `IdentityModule`), AD-26:
 * user đã bật 2FA (`users.two_factor_enabled`) mà session chưa qua lớp hai (`sessions.step_up_at` rỗng) → 403
 * `TOTP_REQUIRED` `step_up` ở mọi request, trừ route trong `TOTP_EXEMPT_ROUTES`. Qua lớp hai thì hiệu lực tới hết
 * session (không có mốc giờ). Route công khai và request không có session thì bỏ qua; user chưa bật 2FA không bao giờ
 * bị chặn. Đứng trước `ConsentGuard` để user đã bật 2FA mà chưa qua lớp hai nhận `TOTP_REQUIRED` trước, không phải
 * `CONSENT_REQUIRED`.
 * `/v1/auth/*` của Better Auth là middleware, không qua guard (đăng nhập Google/OTP vẫn chạy).
 */
@Injectable()
export class TotpGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const req = context.switchToHttp().getRequest<TotpGuardRequest>();
    const session = req.session;
    if (!session) return true;
    if (session.user.twoFactorEnabled !== true) return true;
    if (session.session.stepUpAt) return true;
    const path = req.route?.path;
    if (typeof path === 'string' && isTotpExemptRoute(req.method, path)) return true;
    throw totpRequired();
  }
}
