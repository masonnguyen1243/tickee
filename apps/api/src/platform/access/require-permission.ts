import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@tickee/contracts';

/** Khóa metadata của `@RequirePermission`; bộ test cách ly đọc khóa này để tự tìm route BTC. */
export const REQUIRE_PERMISSION_KEY = 'access:permission';

/** Tên tham số đường dẫn chứa id BTC: route BTC luôn dưới `/v1/orgs/:orgId/…`. */
export const ORG_ID_PARAM = 'orgId';

/** Tên tham số đường dẫn chứa id Sự kiện: route CTV luôn dưới `/v1/checkin/events/:eventId/…` (không có `:orgId`). */
export const EVENT_ID_PARAM = 'eventId';

/**
 * Route cần quyền `permission` (ma trận FR-4 trong `@tickee/contracts`). `PermissionGuard` chọn nhánh theo tham số
 * đường dẫn:
 * - có `:orgId` (route BTC, `/v1/orgs/:orgId/…`): dựng `AccessContext`, lấy bằng `@Access()`;
 * - không có `:orgId` mà có `:eventId` (route CTV, `/v1/checkin/events/:eventId/…`): dựng `EventAccessContext`, lấy bằng
 *   `@EventAccess()`.
 * Mọi route dưới hai tiền tố đó bắt buộc mang decorator này; không dùng cùng `@Public()`.
 */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);
