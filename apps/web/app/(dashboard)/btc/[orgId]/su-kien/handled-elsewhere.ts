import { ErrorCode } from '@tickee/contracts';

import { hasErrorCode } from '@/lib/auth/api';
import { isTotpRequired } from '@/lib/auth/totp';

/**
 * Lỗi do nơi khác xử lý, trang Sự kiện không báo lại: 2FA và đồng ý NĐ 13 (`Providers`), 401 (sang đăng nhập), bị xóa
 * khỏi BTC (`DashboardShell`).
 */
export const handledElsewhere = (error: unknown): boolean =>
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED) ||
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  hasErrorCode(error, ErrorCode.NOT_A_MEMBER);
