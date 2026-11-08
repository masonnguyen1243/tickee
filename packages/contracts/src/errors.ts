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
  /**
   * VA này đã là tài khoản nhận tiền hiện hành của BTC; hoặc gửi key Tingee khi BTC đã từng liên kết tài khoản (kể cả
   * đã hủy hết), vì đổi key là luồng riêng (Story 2.13).
   */
  PAYOUT_ACCOUNT_ALREADY_LINKED: 'PAYOUT_ACCOUNT_ALREADY_LINKED',
  /** Tài khoản merchant Tingee của BTC đang bị Tingee tạm khóa. */
  MERCHANT_SUSPENDED: 'MERCHANT_SUSPENDED',
  /** Tingee tạm lỗi (timeout, lỗi mạng, lỗi hệ thống hoặc mã lỗi không lường trước): thử lại sau ít phút. */
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
  /**
   * Không tìm thấy Sự kiện: id lạ hoặc của BTC khác (route BTC); slug không tồn tại hoặc Sự kiện còn nháp (API công
   * khai, cùng thông điệp để không lộ Sự kiện nháp có tồn tại).
   */
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  /** Không tìm thấy Hạng vé: id lạ, sai dạng hoặc thuộc Sự kiện khác. */
  TICKET_TYPE_NOT_FOUND: 'TICKET_TYPE_NOT_FOUND',
  /**
   * Số suất mới nhỏ hơn số Vé đã bán + đang Giữ chỗ của Hạng vé. `details.minimum` = đã bán + đang giữ chỗ
   * (`CapacityBelowCommittedDetails`). Không lưu gì.
   */
  CAPACITY_BELOW_COMMITTED: 'CAPACITY_BELOW_COMMITTED',
  /**
   * Sau thay đổi, mọi Hạng vé của Sự kiện đều 0đ và tổng số suất vượt trần Vé của Sự kiện miễn phí
   * (`FREE_EVENT_TICKET_CAP`, `details`: `FreeEventCapacityExceededDetails`). Không lưu gì.
   */
  FREE_EVENT_CAPACITY_EXCEEDED: 'FREE_EVENT_CAPACITY_EXCEEDED',
  /** Hạng vé đã có Vé bán ra hoặc đang Giữ chỗ (đã bán + đang giữ chỗ > 0): không xóa được. */
  TICKET_TYPE_IN_USE: 'TICKET_TYPE_IN_USE',
  /** Không tìm thấy câu hỏi của form mua: id lạ, sai dạng hoặc thuộc Sự kiện khác. */
  FORM_QUESTION_NOT_FOUND: 'FORM_QUESTION_NOT_FOUND',
  /**
   * Sự kiện đã có đủ `FORM_QUESTIONS_MAX` câu hỏi riêng (`details`: `FormQuestionLimitReachedDetails`). Không lưu gì.
   */
  FORM_QUESTION_LIMIT_REACHED: 'FORM_QUESTION_LIMIT_REACHED',
  /**
   * Mở bán khi Sự kiện còn điều kiện chưa đạt (server kiểm lại trong transaction). `details.unmet`: mã các điều kiện
   * chưa đạt (`EventNotReadyDetails`). Không đổi gì.
   */
  EVENT_NOT_READY: 'EVENT_NOT_READY',
  /** Mở bán Sự kiện không còn ở trạng thái nháp (đã mở bán, ẩn hoặc hủy; kể cả hai người bấm cùng lúc). */
  EVENT_NOT_DRAFT: 'EVENT_NOT_DRAFT',
  /** Sửa Sự kiện đã hủy: chỉ đọc. Không lưu gì. */
  EVENT_CANCELLED: 'EVENT_CANCELLED',
  /**
   * Ẩn, Hiện lại hoặc Kết thúc khi Sự kiện không ở trạng thái cho phép (kể cả hai người bấm cùng lúc).
   * `details.status`: trạng thái hiện tại (`EventStatusConflictDetails`). Không đổi gì.
   */
  EVENT_STATUS_CONFLICT: 'EVENT_STATUS_CONFLICT',
  /**
   * Sự kiện đã kết thúc (`effective_end_at <= now`: tự động hoặc đã bấm "Kết thúc"): trả cho "Kết thúc" lặp, và cho
   * Ẩn / Hiện lại ("Đã kết thúc" thắng "Ẩn"). Không đổi gì.
   */
  EVENT_ALREADY_ENDED: 'EVENT_ALREADY_ENDED',
  /** "Kết thúc" Sự kiện chưa tới giờ bắt đầu: dùng Ẩn để dừng nhận Đơn. Không đổi gì. */
  EVENT_NOT_STARTED: 'EVENT_NOT_STARTED',
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
