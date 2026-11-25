import { Inject, Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { checkerHasPermission, ErrorCode, roleHasPermission, type Permission } from '@tickee/contracts';
import { AppError, PUBLIC_ROUTE_KEY } from '../http/index.js';
import { assignLogContext } from '../logging/index.js';
import {
  ACCESS_RESOLVER,
  CHECKER_ACCESS_RESOLVER,
  type AccessResolver,
  type CheckerAccessResolver,
} from './access-resolver.js';
import type { RequestWithAccess } from './org-scope.js';
import { EVENT_ID_PARAM, ORG_ID_PARAM, REQUIRE_PERMISSION_KEY } from './require-permission.js';

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
 * Guard toàn cục số 5 (sau bốn guard của `identity`: `SessionGuard`, `TotpGuard`, `ConsentGuard`, `PlatformAdminGuard`):
 * chỉ chạy ở route `@RequirePermission`. Chọn nhánh theo tham số đường dẫn:
 * - Có `:orgId` (route BTC): không là thành viên (kể cả BTC không tồn tại hay `orgId` sai dạng) → 403 `NOT_A_MEMBER`;
 *   vai thiếu quyền → 403 `FORBIDDEN_ROLE`. Qua thì gắn `req.accessContext`.
 * - Không có `:orgId` mà có `:eventId` (route CTV, AD-26): ghép cổng `ACCESS_RESOLVER` (vai trong BTC sở hữu Sự kiện) và
 *   `CHECKER_ACCESS_RESOLVER` (BTC sở hữu, trạng thái CTV, Sự kiện đã kết thúc). Owner/Admin kiểm theo
 *   `ROLE_PERMISSIONS`, kể cả khi Sự kiện đã kết thúc; CTV `revoked` → 403 `CHECKER_REVOKED`; CTV `active` khi Sự kiện
 *   đã kết thúc → 403 `EVENT_ENDED` (Story 5.6, AD-14); CTV `active` còn lại chỉ có `CHECKER_PERMISSIONS` (quyền khác →
 *   403 `FORBIDDEN_ROLE`); còn lại (kể cả Sự kiện không tồn tại, `eventId` sai dạng) → 403 `NOT_A_MEMBER`. Qua thì gắn
 *   `req.eventAccessContext`.
 * - Không có tham số nào: lỗi cấu hình (500).
 * Quyền đọc lại ở mỗi request, không cache. Ctx mang `stepUpAt` của session để story sau dùng; `organizationId` gắn vào
 * mọi log còn lại của request. Luật 2FA không nằm ở đây mà ở `TotpGuard` của `identity` (AD-26).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACCESS_RESOLVER) private readonly resolver: AccessResolver,
    // `checkin` cài cổng này (`@Global()`); harness hay vai không nạp `checkin` vẫn chạy route BTC như cũ.
    @Optional() @Inject(CHECKER_ACCESS_RESOLVER) private readonly checkers?: CheckerAccessResolver | null,
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

    const params = req.params ?? {};
    if (ORG_ID_PARAM in params) {
      await this.organizationRoute(req, userId, params[ORG_ID_PARAM], permission);
    } else if (EVENT_ID_PARAM in params) {
      await this.eventRoute(req, userId, params[EVENT_ID_PARAM], permission);
    } else {
      throw new Error(`Route @RequirePermission() thiếu tham số :${ORG_ID_PARAM} hoặc :${EVENT_ID_PARAM}: cấu hình sai`);
    }
    return true;
  }

  /** Route BTC (`/v1/orgs/:orgId/…`): vai của người gọi trong BTC trên đường dẫn. */
  private async organizationRoute(
    req: GuardRequest,
    userId: string,
    rawOrganizationId: string | undefined,
    permission: Permission,
  ): Promise<void> {
    if (!rawOrganizationId || !UUID.test(rawOrganizationId)) throw notAMember();
    const organizationId = rawOrganizationId.toLowerCase();
    const access = await this.resolver.resolve(userId, organizationId);
    if (!access) throw notAMember();
    if (!roleHasPermission(access.role, permission)) throw forbiddenRole(permission);

    req.accessContext = {
      userId,
      organizationId,
      role: access.role,
      assignedEventIds: [],
      stepUpAt: toDate(req.session?.session?.stepUpAt),
    };
    // Mọi log còn lại của request (kể cả dòng kết thúc request) mang BTC (Story 4.6-a).
    assignLogContext({ organizationId });
  }

  /**
   * Route CTV (`/v1/checkin/events/:eventId/…`): Owner/Admin của BTC sở hữu Sự kiện thắng mọi trạng thái CTV (quét
   * không cần lời mời, kể cả khi Sự kiện đã kết thúc); không thì theo dòng `checkers` của người gọi ở đúng Sự kiện này,
   * theo thứ tự: `revoked` → `CHECKER_REVOKED`; `active` mà Sự kiện đã kết thúc → `EVENT_ENDED`; `active` → quyền CTV.
   */
  private async eventRoute(
    req: GuardRequest,
    userId: string,
    rawEventId: string | undefined,
    permission: Permission,
  ): Promise<void> {
    if (!this.checkers) {
      throw new Error(`Route :${EVENT_ID_PARAM} cần cổng CHECKER_ACCESS_RESOLVER (mô-đun checkin chưa nạp): cấu hình sai`);
    }
    if (!rawEventId || !UUID.test(rawEventId)) throw notAChecker();
    const eventId = rawEventId.toLowerCase();
    const event = await this.checkers.resolveEvent(userId, eventId);
    if (!event) throw notAChecker();
    const { organizationId } = event;
    const stepUpAt = toDate(req.session?.session?.stepUpAt);

    const member = await this.resolver.resolve(userId, organizationId);
    if (member) {
      if (!roleHasPermission(member.role, permission)) throw forbiddenRole(permission);
      req.eventAccessContext = { userId, organizationId, eventId, role: member.role, assignedEventIds: [], stepUpAt };
    } else if (event.checker === 'revoked') {
      throw new AppError(ErrorCode.CHECKER_REVOKED, 'Bạn không còn quyền soát vé cho Sự kiện này.');
    } else if (event.checker === 'active') {
      if (event.ended) throw new AppError(ErrorCode.EVENT_ENDED, 'Bạn không còn quyền soát vé cho Sự kiện này.');
      if (!checkerHasPermission(permission)) throw forbiddenRole(permission);
      req.eventAccessContext = { userId, organizationId, eventId, role: null, assignedEventIds: [eventId], stepUpAt };
    } else {
      throw notAChecker();
    }
    assignLogContext({ organizationId });
  }
}

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');

/** Route CTV: cùng mã `NOT_A_MEMBER` (không lộ Sự kiện nào có thật), câu theo ngữ cảnh soát vé. */
const notAChecker = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không có quyền soát vé cho Sự kiện này.');

const forbiddenRole = (permission: Permission) =>
  new AppError(ErrorCode.FORBIDDEN_ROLE, 'Vai trò của bạn không được thực hiện thao tác này.', { details: { permission } });
