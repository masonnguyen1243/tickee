import { ErrorCode } from '@tickee/contracts';

import { hasErrorCode } from '@/lib/auth/api';
import { isTotpRequired } from '@/lib/auth/totp';

/**
 * Lỗi do nơi khác xử lý, trang gọi không báo lại: 2FA (`Providers` mở dialog rồi gửi lại), đồng ý NĐ 13 (`Providers`
 * chuyển trang), 401 (sang đăng nhập), `NOT_A_MEMBER` (`DashboardShell` mở `Dialog` bị xóa khỏi BTC giữa phiên).
 */
export const handledElsewhere = (error: unknown): boolean =>
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED) ||
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  hasErrorCode(error, ErrorCode.NOT_A_MEMBER);
