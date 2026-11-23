import type { Role } from '@tickee/contracts';

/** Token DI của cổng `AccessResolver`; mô-đun miền (`organizer`) cài đặt và đăng ký. */
export const ACCESS_RESOLVER = Symbol('ACCESS_RESOLVER');

/**
 * Cổng tra vai trò (AD-10: `platform` khai báo, mô-đun cài đặt). `organizationId` luôn là UUID hợp lệ khi được gọi.
 * Trả `null` khi `userId` không là thành viên của BTC (kể cả BTC không tồn tại).
 */
export interface AccessResolver {
  resolve(userId: string, organizationId: string): Promise<{ role: Role } | null>;
}

/**
 * Token DI của cổng `CheckerAccessResolver`; `checkin` cài đặt và xuất toàn cục (`@Global()`). `PermissionGuard` inject
 * bằng `@Optional()`: app không nạp `checkin` vẫn chạy route BTC như cũ.
 */
export const CHECKER_ACCESS_RESOLVER = Symbol('CHECKER_ACCESS_RESOLVER');

/** Trạng thái CTV của một tài khoản ở một Sự kiện (bảng `checkers` của `checkin`). */
export type CheckerStatus = 'active' | 'revoked';

/**
 * Cổng tra Sự kiện cho route CTV (`/v1/checkin/events/:eventId/…`, AD-26): BTC sở hữu Sự kiện và trạng thái CTV của
 * `userId` ở Sự kiện đó (`null` khi chưa từng nhận lời mời). `eventId` luôn là UUID hợp lệ (chữ thường) khi được gọi.
 * Trả `null` khi Sự kiện không tồn tại. Đọc lại ở mỗi request, không cache (thu hồi có hiệu lực ngay request kế tiếp).
 */
export interface CheckerAccessResolver {
  resolveEvent(userId: string, eventId: string): Promise<{ organizationId: string; checker: CheckerStatus | null } | null>;
}
