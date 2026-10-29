import { SetMetadata } from '@nestjs/common';

/**
 * Khóa metadata "route công khai". Guard session của `identity` bỏ qua route mang khóa này;
 * trùng khóa với `@AllowAnonymous()` của `@thallesp/nestjs-better-auth` (test identity kiểm điều đó),
 * để mô-đun không được import Better Auth (AD-10) vẫn mở được route công khai.
 */
export const PUBLIC_ROUTE_KEY = 'PUBLIC';

/** Route không cần đăng nhập (healthz, trang Sự kiện công khai…). */
export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
