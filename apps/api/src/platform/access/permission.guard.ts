import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, roleHasPermission, type Permission } from '@tickee/contracts';
import { AppError, PUBLIC_ROUTE_KEY } from '../http/index.js';
import { ACCESS_RESOLVER, type AccessResolver } from './access-resolver.js';
import type { RequestWithAccess } from './org-scope.js';
import { ORG_ID_PARAM, REQUIRE_PERMISSION_KEY } from './require-permission.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kiểu request tối thiểu guard cần (`platform` không import kiểu của `identity`). */
type GuardRequest = RequestWithAccess & {
  user?: { id: string } | null;
  /** Session Better Auth do `SessionGuard` gắn; `stepUpAt` là cột `sessions.step_up_at` (Story 2.2). */
  session?: { session?: { stepUpAt?: Date | string | null } } | null;
  params?: Record<string, string | undefined>;
};

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Guard toàn cục số 4 (sau `SessionGuard`, `TotpGuard` và `ConsentGuard`): chỉ chạy ở route `@RequirePermission`.
 * Không là thành viên (kể cả BTC không tồn tại hay `orgId` sai dạng) → 403 `NOT_A_MEMBER`; vai thiếu quyền →
 * 403 `FORBIDDEN_ROLE`. Qua thì gắn `req.accessContext` (kèm `stepUpAt` của session để story sau dùng). Luật 2FA
 * không nằm ở đây mà ở `TotpGuard` của `identity` (AD-26).
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

    req.accessContext = {
      userId,
      organizationId: organizationId.toLowerCase(),
      role: access.role,
      assignedEventIds: [],
      stepUpAt: toDate(req.session?.session?.stepUpAt),
    };
    return true;
  }
}

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
