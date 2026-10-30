import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@tickee/contracts';

/** Khóa metadata của `@RequirePermission`; bộ test cách ly đọc khóa này để tự tìm route BTC. */
export const REQUIRE_PERMISSION_KEY = 'access:permission';

/** Tên tham số đường dẫn chứa id BTC: route BTC luôn dưới `/v1/orgs/:orgId/…`. */
export const ORG_ID_PARAM = 'orgId';

/**
 * Route BTC cần quyền `permission` (ma trận FR-4 trong `@tickee/contracts`). `PermissionGuard` dựng
 * `AccessContext` từ `:orgId` trước controller; mọi route dưới `/v1/orgs/:orgId` bắt buộc mang decorator này.
 */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);
