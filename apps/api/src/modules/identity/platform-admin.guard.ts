import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@tickee/contracts';
import { eq } from 'drizzle-orm';
import { REQUIRE_PLATFORM_ADMIN_KEY, type RequestWithPlatformAdmin } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError, PUBLIC_ROUTE_KEY } from '../../platform/http/index.js';
import { users } from './schema.js';
import type { RequestWithSession } from './session.guard.js';
import { totpRequired } from './totp.service.js';

type PlatformAdminRequest = RequestWithSession & RequestWithPlatformAdmin;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Guard toàn cục số 4 của `identity` (sau `SessionGuard`, `TotpGuard`, `ConsentGuard`), chỉ chạy ở route
 * `@RequirePlatformAdmin()` (khu `/v1/admin/*`, AD-26). Đọc **mới từ DB** `users.platform_admin` và
 * `users.two_factor_enabled` ở mỗi request (không qua session của Better Auth), nên thu cờ có hiệu lực ngay ở request kế
 * tiếp. Không cờ → 403 `FORBIDDEN_ROLE`; có cờ mà chưa bật 2FA → 403 `TWO_FACTOR_NOT_ENABLED`; session chưa qua lớp hai
 * → `TOTP_REQUIRED` (thường `TotpGuard` đã chặn trước; kiểm lại ở đây vì 2FA có thể vừa bật trong lúc session cũ còn
 * mang cờ cũ). Qua thì gắn `req.platformAdminContext`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(REQUIRE_PLATFORM_ADMIN_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets)) {
      throw new Error('Route vừa @Public() vừa @RequirePlatformAdmin(): cấu hình sai');
    }

    const req = context.switchToHttp().getRequest<PlatformAdminRequest>();
    const session = req.session;
    if (!session) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Bạn cần đăng nhập để tiếp tục.');

    const [user] = await this.db.orm
      .select({ platformAdmin: users.platformAdmin, twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (!user?.platformAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN_ROLE, 'Bạn không có quyền vào trang này.');
    }
    if (!user.twoFactorEnabled) {
      throw new AppError(ErrorCode.TWO_FACTOR_NOT_ENABLED, 'Bạn cần bật xác thực hai lớp để vào trang quản trị.');
    }
    const stepUpAt = toDate(session.session.stepUpAt);
    if (!stepUpAt) throw totpRequired();

    req.platformAdminContext = { userId: session.user.id, stepUpAt };
    return true;
  }
}
