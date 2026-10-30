import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@tickee/contracts';
import { eq, type Column, type SQL } from 'drizzle-orm';

/** Ngữ cảnh truy cập do `PermissionGuard` dựng cho mỗi request BTC. */
export interface AccessContext {
  userId: string;
  organizationId: string;
  role: Role;
  /** Sự kiện được giao (CTV, Epic 5); thành viên BTC luôn `[]`. */
  assignedEventIds: string[];
  /** Mốc session qua lớp hai (TOTP/mã khôi phục, Story 2.2), hiệu lực hết session; chưa có thì `null`. */
  stepUpAt: Date | null;
}

/** Request sau `PermissionGuard` ở route `@RequirePermission`. */
export interface RequestWithAccess {
  accessContext?: AccessContext;
}

/**
 * Điều kiện cách ly BTC: mọi truy vấn trong request BTC đi qua đây. `orgScope(ctx)(members)` →
 * `members.organization_id = ctx.organizationId`. Bảng mà khóa BTC là cột khác (vd. `organizations.id`) truyền
 * `{ organizationId: organizations.id }`.
 */
export const orgScope =
  (ctx: Pick<AccessContext, 'organizationId'>) =>
  (table: { organizationId: Column }): SQL =>
    eq(table.organizationId, ctx.organizationId);

/** Lấy `AccessContext` trong handler của route `@RequirePermission`. */
export const Access = createParamDecorator((_data: unknown, context: ExecutionContext): AccessContext => {
  const ctx = context.switchToHttp().getRequest<RequestWithAccess>().accessContext;
  if (!ctx) throw new Error('AccessContext chưa được dựng: route thiếu @RequirePermission?');
  return ctx;
});
