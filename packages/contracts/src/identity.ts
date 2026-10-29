import { z } from 'zod';

/** Thông số OTP email dùng chung web và api (AD-19). */
export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_SECONDS = 60;
/** Quá số lần nhập sai này trong 24 giờ (cộng dồn qua các mã) thì email bị khóa gửi và xác minh. */
export const OTP_DAILY_FAILURE_LIMIT = 15;
export const OTP_FAILURE_WINDOW_SECONDS = 24 * 60 * 60;

/** Email chuẩn hóa: bỏ khoảng trắng hai đầu, chữ thường. */
export const EmailAddress = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const OtpCode = z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`));

/** `POST /v1/identity/otp` */
export const SendOtpRequest = z.object({ email: EmailAddress });
export type SendOtpRequest = z.input<typeof SendOtpRequest>;

export const SendOtpResponse = z.object({ resendAfterSeconds: z.number().int().positive() });
export type SendOtpResponse = z.infer<typeof SendOtpResponse>;

/** `POST /v1/identity/otp/verify` — thành công thì API set cookie session. */
export const VerifyOtpRequest = z.object({ email: EmailAddress, otp: OtpCode });
export type VerifyOtpRequest = z.input<typeof VerifyOtpRequest>;

export const VerifyOtpResponse = z.object({ consentRequired: z.boolean() });
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponse>;

/** `GET /v1/identity/me`, cũng là kết quả của `POST /v1/identity/consent`. */
export const Me = z.object({
  id: z.uuid(),
  email: z.email(),
  /** Thời điểm đồng ý NĐ 13 (ISO 8601); `null` = chưa đồng ý. */
  consentedAt: z.iso.datetime().nullable(),
});
export type Me = z.infer<typeof Me>;

/** `details` của lỗi `OTP_RATE_LIMITED`. */
export const OtpRateLimitedDetails = z.object({ retryAfterSeconds: z.number().int().positive() });
export type OtpRateLimitedDetails = z.infer<typeof OtpRateLimitedDetails>;

/** `details` của lỗi `OTP_LOCKED`. */
export const OtpLockedDetails = z.object({ retryAfterSeconds: z.number().int().positive() });
export type OtpLockedDetails = z.infer<typeof OtpLockedDetails>;

/** `details` của lỗi `OTP_INVALID`. */
export const OtpInvalidDetails = z.object({ remainingAttempts: z.number().int().min(1) });
export type OtpInvalidDetails = z.infer<typeof OtpInvalidDetails>;

/** Trang mặc định sau đăng nhập hoặc khi `returnTo` không hợp lệ. */
export const DEFAULT_RETURN_TO = '/';
/** Màn đăng nhập của web (cả trang trung gian Google `/dang-nhap/google`). */
export const LOGIN_PATH = '/dang-nhap';
/** Màn đồng ý NĐ 13 của web. */
export const CONSENT_PATH = '/dong-y';
/** Trang trung gian của web mà Google quay về sau khi đăng nhập thành công. */
export const GOOGLE_RETURN_PATH = `${LOGIN_PATH}/google`;

// Ký tự điều khiển, khoảng trắng và dấu `\`: trình duyệt bỏ qua hoặc đổi `\` thành `/`, có thể biến `/\t/x` thành `//x`.
const UNSAFE_RETURN_TO_CHARS = /[\u0000- \u007f\\]/;
const PROBE_ORIGIN = 'http://tickee.invalid';
/** Không quay về chính các màn trong luồng đăng nhập (tránh vòng lặp). */
const FLOW_PATHS = [LOGIN_PATH, CONSENT_PATH];

/**
 * `returnTo` chỉ nhận đường dẫn nội bộ (chống open redirect): bắt đầu bằng `/`, không bắt đầu bằng `//` hoặc `/\`,
 * không có scheme, và khi phân giải vẫn ở cùng origin. Sai hoặc thiếu → `/`. Hợp lệ thì trả dạng đã chuẩn hóa
 * (`pathname + search + hash`): `/..//evil.com` chuẩn hóa thành `//evil.com` nên bị từ chối. Mọi đường dẫn dưới
 * màn đăng nhập/đồng ý (kể cả `/dang-nhap/`, `/dang-nhap/google`) không làm đích quay về để tránh vòng lặp.
 * Dùng chung web và api (api kiểm `returnTo` trước khi bắt đầu đăng nhập Google).
 */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_RETURN_TO;
  if (!raw.startsWith('/') || raw.startsWith('//') || UNSAFE_RETURN_TO_CHARS.test(raw)) return DEFAULT_RETURN_TO;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (url.origin !== PROBE_ORIGIN || url.pathname.startsWith('//')) return DEFAULT_RETURN_TO;
  if (FLOW_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return DEFAULT_RETURN_TO;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Mã `error` mà luồng Google gắn vào `/dang-nhap?error=…` và web phân loại riêng. Mã khác (`state_mismatch`,
 * `invalid_code`…) là lỗi chung.
 */
export const GoogleSignInError = {
  /** Người dùng hủy trên Google: ở lại màn đăng nhập, không báo lỗi. */
  ACCESS_DENIED: 'access_denied',
  /** Google trả `email_verified = false`: không tạo/nối tài khoản. */
  EMAIL_NOT_VERIFIED: 'email_not_verified',
} as const;
export type GoogleSignInError = (typeof GoogleSignInError)[keyof typeof GoogleSignInError];

/** Tham số query mang mã lỗi của luồng Google trên màn đăng nhập. */
export const SIGN_IN_ERROR_PARAM = 'error';
