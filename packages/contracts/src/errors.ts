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
   * đã hủy hết), vì đổi key là luồng riêng có xác nhận lại (`…/credential/replacement`, Story 2.13-b).
   */
  PAYOUT_ACCOUNT_ALREADY_LINKED: 'PAYOUT_ACCOUNT_ALREADY_LINKED',
  /**
   * Đổi key Tingee (`…/credential/replacement`) khi BTC chưa từng liên kết tài khoản nhận tiền nào: dùng form kết nối
   * (`POST …/payout-account/credential`), không cần xác nhận lại. Không đổi gì.
   */
  PAYOUT_ACCOUNT_NOT_LINKED_YET: 'PAYOUT_ACCOUNT_NOT_LINKED_YET',
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
   * Sau thay đổi, tổng số suất của các Hạng vé 0đ trong Sự kiện vượt trần suất miễn phí (`FREE_EVENT_TICKET_CAP`), ở mọi
   * trạng thái Sự kiện, kể cả Sự kiện có cả Hạng vé có phí (`details`: `FreeEventCapacityExceededDetails`). Không lưu gì.
   */
  FREE_EVENT_CAPACITY_EXCEEDED: 'FREE_EVENT_CAPACITY_EXCEEDED',
  /**
   * Hạng vé đã có Vé bán ra, đang Giữ chỗ (đã bán + đang giữ chỗ > 0) hoặc đã có dòng Đơn (kể cả Đơn đã hết hạn): không
   * xóa được (không xóa mềm; muốn ngừng bán thì đặt giờ kết thúc bán).
   */
  TICKET_TYPE_IN_USE: 'TICKET_TYPE_IN_USE',
  /**
   * Sự kiện không còn nháp: tạo Hạng vé giá > 0, hoặc sửa Hạng vé mà giá sau khi sửa > 0, khi BTC chưa đủ điều kiện bán
   * Vé có phí (chưa được duyệt Closed Beta hoặc không còn tài khoản nhận tiền). `details.unmet`: mã điều kiện chưa đạt
   * (`PaidTicketTypeNotAllowedDetails`). Sự kiện nháp không bị chặn (điều kiện kiểm lúc mở bán). Không lưu gì.
   */
  PAID_TICKET_TYPE_NOT_ALLOWED: 'PAID_TICKET_TYPE_NOT_ALLOWED',
  /** Xóa Hạng vé cuối cùng của Sự kiện không còn nháp: Sự kiện đã mở bán phải còn ít nhất một Hạng vé. Không xóa gì. */
  LAST_TICKET_TYPE: 'LAST_TICKET_TYPE',
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
  /**
   * Thao tác nhạy cảm (đặt mặc định, hủy liên kết tài khoản nhận tiền, đổi key Tingee; Story 2.13) cần một lần xác
   * nhận lại còn hiệu lực của chính session trong header `REAUTH_HEADER`: thiếu, sai, đã dùng, hết hạn hoặc của session
   * khác. Luôn sau kiểm quyền (Admin nhận `FORBIDDEN_ROLE`). `details.method`: cách xác nhận (`ReauthRequiredDetails`).
   * Không đổi gì.
   */
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  /**
   * Cách xác nhận lại không còn đúng với tài khoản: xin mã email khi đã bật 2FA (`details.method` `totp`), hoặc nhập mã
   * TOTP khi 2FA vừa bị tắt (`details.method` `email_otp`). `details.method` là cách đúng (`ReauthRequiredDetails`).
   * Không gửi, không cấp gì.
   */
  REAUTH_METHOD_MISMATCH: 'REAUTH_METHOD_MISMATCH',
  /**
   * Gửi Đơn: một Hạng vé không còn đủ chỗ (giữ chỗ có điều kiện trả 0 dòng). Không tạo Đơn, không giữ chỗ Hạng vé nào.
   * `details`: `TicketTypeSoldOutDetails` (`ticketTypeId`, `ticketTypeName`).
   */
  TICKET_TYPE_SOLD_OUT: 'TICKET_TYPE_SOLD_OUT',
  /**
   * Gửi Đơn khi Sự kiện không nhận Đơn (ẩn, khóa, hủy, đã kết thúc) hoặc một Hạng vé không bán (tạm ngừng, chưa mở,
   * đã đóng, không còn). Không tạo Đơn. `details`: `NotOnSaleDetails` (`ticketTypeId?`, `reason`).
   */
  NOT_ON_SALE: 'NOT_ON_SALE',
  /**
   * Người mua đang có một Đơn `pending` khác cho cùng Sự kiện. Không tạo Đơn. `details`: `PendingOrderExistsDetails`
   * (`code` của Đơn đang chờ).
   */
  PENDING_ORDER_EXISTS: 'PENDING_ORDER_EXISTS',
  /** Gửi Đơn quá nhanh (theo tài khoản hoặc theo IP, `ORDER_RATE_LIMITS`); `details.retryAfterSeconds`. */
  ORDER_RATE_LIMITED: 'ORDER_RATE_LIMITED',
  /** Không tìm thấy Đơn: mã sai dạng, không tồn tại, hoặc Đơn của người khác (cùng lỗi để không lộ mã nào có thật). */
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
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
