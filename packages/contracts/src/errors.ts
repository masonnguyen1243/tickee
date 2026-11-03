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
   * Tài khoản đã bật 2FA mà session chưa qua lớp hai (chưa nhập TOTP hay mã khôi phục), gọi route ngoài
   * `TOTP_EXEMPT_ROUTES`; `details.reason` luôn `step_up` (`TotpRequiredDetails`).
   */
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  /** Mã TOTP hoặc mã khôi phục sai (kể cả mã khôi phục đã dùng); `details.remainingAttempts`. */
  TOTP_INVALID: 'TOTP_INVALID',
  /** Sai `TOTP_MAX_FAILURES` lần liên tiếp: khóa xác minh theo user; `details.retryAfterSeconds`. */
  TOTP_LOCKED: 'TOTP_LOCKED',
  /** Mời Admin bằng email đã là thành viên của BTC (kể cả Owner); `details.field` là `email`. */
  ALREADY_A_MEMBER: 'ALREADY_A_MEMBER',
  /** Link mời sai, không tồn tại hoặc đã bị thu hồi. */
  INVITATION_INVALID: 'INVITATION_INVALID',
  /** Link mời đã quá hạn `ORGANIZATION_INVITATION_TTL_DAYS` ngày. */
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  /** Link mời đã được nhận (bởi tài khoản khác, hoặc tài khoản này nhưng đã bị xóa sau đó). */
  INVITATION_USED: 'INVITATION_USED',
  /** Email của session khác email lời mời; `details.maskedEmail` (`InvitationEmailMismatchDetails`). */
  INVITATION_EMAIL_MISMATCH: 'INVITATION_EMAIL_MISMATCH',
  /** BTC đã tạo đủ `ORGANIZATION_INVITATION_DAILY_LIMIT` lời mời trong 24 giờ qua. */
  INVITATION_LIMIT_REACHED: 'INVITATION_LIMIT_REACHED',
  /**
   * Tài khoản có cờ Quản trị Tingee (`platform_admin`) nhưng chưa bật 2FA: khu `/v1/admin/*` bắt buộc đã bật 2FA và đã
   * qua lớp hai trong session (chưa qua lớp hai thì là `TOTP_REQUIRED`).
   */
  TWO_FACTOR_NOT_ENABLED: 'TWO_FACTOR_NOT_ENABLED',
  /**
   * Chuyển trạng thái Closed Beta không hợp lệ (vd. thu hồi BTC đang chờ duyệt); `details.closedBetaStatus` là trạng
   * thái hiện tại (`ClosedBetaTransitionInvalidDetails`).
   */
  CLOSED_BETA_TRANSITION_INVALID: 'CLOSED_BETA_TRANSITION_INVALID',
  /**
   * Tingee từ chối API key của BTC: Client ID không tồn tại hoặc bị khóa, Secret Token sai, hoặc key chưa được cấp quyền
   * nhóm dịch vụ cần dùng. Không lưu gì.
   */
  TINGEE_CREDENTIAL_INVALID: 'TINGEE_CREDENTIAL_INVALID',
  /** Ngân hàng của tài khoản chưa được hỗ trợ làm tài khoản nhận tiền (VietinBank, `BLOCKED_BANK_BINS`). */
  BANK_NOT_SUPPORTED: 'BANK_NOT_SUPPORTED',
  /** Tài khoản đã chọn không còn `active` trên Tingee (hoặc credential đã đổi giữa chừng): tải lại danh sách. */
  PAYOUT_ACCOUNT_UNAVAILABLE: 'PAYOUT_ACCOUNT_UNAVAILABLE',
  /** BTC đã có tài khoản nhận tiền đang dùng; đổi tài khoản hoặc đổi key là luồng riêng (Story 2.13). */
  PAYOUT_ACCOUNT_ALREADY_LINKED: 'PAYOUT_ACCOUNT_ALREADY_LINKED',
  /** Tài khoản merchant Tingee của BTC đang bị Tingee tạm khóa. */
  MERCHANT_SUSPENDED: 'MERCHANT_SUSPENDED',
  /** Tingee tạm lỗi (timeout, lỗi mạng, lỗi hệ thống hoặc mã lỗi không lường trước): thử lại sau ít phút. */
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
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
