import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ErrorCode,
  isTotpExemptRoute,
  Role,
  STEP_UP_TTL_MS,
  TotpRequiredReason,
  roleHasPermission,
  type Permission,
  type TotpRequiredDetails,
} from '@tickee/contracts';
import { AppError, PUBLIC_ROUTE_KEY } from '../http/index.js';
import { ACCESS_RESOLVER, type AccessResolver } from './access-resolver.js';
import type { RequestWithAccess } from './org-scope.js';
import { ORG_ID_PARAM, REQUIRE_PERMISSION_KEY } from './require-permission.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kiểu request tối thiểu guard cần (`platform` không import kiểu của `identity`). */
type GuardRequest = RequestWithAccess & {
  method: string;
  user?: { id: string; twoFactorEnabled?: boolean | null } | null;
  /** Session Better Auth do `SessionGuard` gắn; `stepUpAt` là cột `sessions.step_up_at` (Story 2.2). */
  session?: { session?: { stepUpAt?: Date | string | null } } | null;
  params?: Record<string, string | undefined>;
  /** Route Express đã khớp (`path` theo khai báo, vd. `/v1/orgs/:orgId`). */
  route?: { path?: unknown };
};

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const totpRequired = (reason: TotpRequiredReason) => {
  const details: TotpRequiredDetails = { reason };
  return new AppError(ErrorCode.TOTP_REQUIRED, 'Bạn cần xác thực hai lớp để tiếp tục.', { details });
};

/**
 * Guard toàn cục số 3 (sau `SessionGuard` và `ConsentGuard`): chỉ chạy ở route `@RequirePermission`.
 * Không là thành viên (kể cả BTC không tồn tại hay `orgId` sai dạng) → 403 `NOT_A_MEMBER`; vai thiếu quyền →
 * 403 `FORBIDDEN_ROLE`. Vai giải ra là `owner` (AD-26, quyết định 30/10/2026) mà chưa đăng ký TOTP → 403
 * `TOTP_REQUIRED` `enroll`; đã đăng ký mà session chưa step-up hoặc step-up quá `STEP_UP_TTL_MS` → `step_up`
 * (trừ route trong `TOTP_EXEMPT_ROUTES`). Admin không bao giờ bị đòi TOTP. Qua thì gắn `req.accessContext`.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACCESS_RESOLVER) private readonly resolver: AccessResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRE_PERMISSION_KEY, targets);
    if (!permission) return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets)) {
      throw new Error('Route vừa @Public() vừa @RequirePermission(): cấu hình sai');
    }

    const req = context.switchToHttp().getRequest<GuardRequest>();
    const userId = req.user?.id;
    if (!userId) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Bạn cần đăng nhập để tiếp tục.');

    if (!req.params || !(ORG_ID_PARAM in req.params)) {
      throw new Error(`Route @RequirePermission() thiếu tham số :${ORG_ID_PARAM}: cấu hình sai`);
    }
    const organizationId = req.params[ORG_ID_PARAM];
    if (!organizationId || !UUID.test(organizationId)) throw notAMember();
    const access = await this.resolver.resolve(userId, organizationId.toLowerCase());
    if (!access) throw notAMember();
    if (!roleHasPermission(access.role, permission)) {
      throw new AppError(ErrorCode.FORBIDDEN_ROLE, 'Vai trò của bạn không được thực hiện thao tác này.', {
        details: { permission },
      });
    }

    const stepUpAt = toDate(req.session?.session?.stepUpAt);
    if (access.role === Role.OWNER && !this.isExempt(req)) {
      if (req.user?.twoFactorEnabled !== true) throw totpRequired(TotpRequiredReason.ENROLL);
      if (!stepUpAt || Date.now() - stepUpAt.getTime() > STEP_UP_TTL_MS) throw totpRequired(TotpRequiredReason.STEP_UP);
    }

    req.accessContext = {
      userId,
      organizationId: organizationId.toLowerCase(),
      role: access.role,
      assignedEventIds: [],
      stepUpAt,
    };
    return true;
  }

  private isExempt(req: GuardRequest): boolean {
    const path = req.route?.path;
    return typeof path === 'string' && isTotpExemptRoute(req.method, path);
  }
}

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
