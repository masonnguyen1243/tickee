import { z } from 'zod';

/** Mã lỗi miền dùng chung web và api. Luôn `UPPER_SNAKE`. Story sau thêm mã vào đây. */
export const ErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** Endpoint cần đăng nhập nhưng request không có session hợp lệ. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Đã đăng nhập nhưng chưa đồng ý xử lý dữ liệu cá nhân (NĐ 13/2023). */
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  /** Gửi mã OTP quá giới hạn; `details.retryAfterSeconds`. */
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  /** Mã OTP sai; `details.remainingAttempts`. */
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  /** Đã sai đủ số lần cho phép hoặc mã không còn hiệu lực: cần gửi mã mới. */
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  /** Email nhập sai mã quá nhiều lần trong 24 giờ: khóa cả gửi lẫn xác minh; `details.retryAfterSeconds`. */
  OTP_LOCKED: 'OTP_LOCKED',
  /**
   * Người gọi không là thành viên BTC trong đường dẫn. Trả cả khi BTC không tồn tại hoặc `orgId` sai dạng,
   * để không lộ BTC nào có thật.
   */
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  /** Là thành viên nhưng vai trò không có quyền này (vd. Admin gọi thao tác chỉ Owner). */
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  /**
   * Request mang vai Owner (route BTC mà vai giải ra là `owner`) nhưng chưa đăng ký TOTP hoặc session chưa step-up
   * trong `STEP_UP_TTL_MS`; `details.reason` (`TotpRequiredDetails`).
   */
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  /** Mã TOTP hoặc mã khôi phục sai (kể cả mã khôi phục đã dùng); `details.remainingAttempts`. */
  TOTP_INVALID: 'TOTP_INVALID',
  /** Sai `TOTP_MAX_FAILURES` lần liên tiếp: khóa xác minh theo user; `details.retryAfterSeconds`. */
  TOTP_LOCKED: 'TOTP_LOCKED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorCodeSchema = z.enum(ErrorCode);

/** Dạng lỗi HTTP duy nhất: `{ "error": { "code", "message", "details" } }`. */
export const ErrorResponse = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
