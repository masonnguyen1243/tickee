import type { Role } from '@tickee/contracts';

/** Token DI của cổng `AccessResolver`; mô-đun miền (`organizer`, sau này `checkin`) cài đặt và đăng ký. */
export const ACCESS_RESOLVER = Symbol('ACCESS_RESOLVER');

/**
 * Cổng tra vai trò (AD-10: `platform` khai báo, mô-đun cài đặt). `organizationId` luôn là UUID hợp lệ khi được gọi.
 * Trả `null` khi `userId` không là thành viên của BTC (kể cả BTC không tồn tại).
 */
export interface AccessResolver {
  resolve(userId: string, organizationId: string): Promise<{ role: Role } | null>;
}
