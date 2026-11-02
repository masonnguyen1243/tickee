import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

/** Khóa metadata của `@RequirePlatformAdmin()`; guard Quản trị Tingee của `identity` đọc khóa này. */
export const REQUIRE_PLATFORM_ADMIN_KEY = 'access:platform-admin';

/**
 * Ngữ cảnh Quản trị Tingee do guard của `identity` dựng: người gọi có cờ `platform_admin` (đọc mới từ DB ở mỗi
 * request), đã bật 2FA và session đã qua lớp hai.
 */
export interface PlatformAdminContext {
  userId: string;
  /** Mốc session qua lớp hai; route admin luôn có (guard từ chối khi chưa step-up). */
  stepUpAt: Date;
}

/** Request sau guard Quản trị Tingee ở route `@RequirePlatformAdmin()`. */
export interface RequestWithPlatformAdmin {
  platformAdminContext?: PlatformAdminContext;
}

/**
 * Route chỉ cho Quản trị Tingee (khu `/v1/admin/*`, AD-26). `platform` chỉ khai báo metadata; guard toàn cục của
 * `identity` (chạy sau `ConsentGuard`) kiểm cờ, 2FA và step-up rồi gắn `PlatformAdminContext`. Không dùng cùng
 * `@RequirePermission` (route admin không thuộc một BTC) hay `@Public()`.
 */
export const RequirePlatformAdmin = () => SetMetadata(REQUIRE_PLATFORM_ADMIN_KEY, true);

/** Lấy `PlatformAdminContext` trong handler của route `@RequirePlatformAdmin()`. */
export const PlatformAdminAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformAdminContext => {
    const ctx = context.switchToHttp().getRequest<RequestWithPlatformAdmin>().platformAdminContext;
    if (!ctx) throw new Error('PlatformAdminContext chưa được dựng: route thiếu @RequirePlatformAdmin()?');
    return ctx;
  },
);
