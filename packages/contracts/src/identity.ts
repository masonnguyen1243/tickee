import { z } from 'zod';

/** Thông số OTP email dùng chung web và api (AD-19). */
export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_SECONDS = 60;
/** Quá số lần nhập sai này trong 24 giờ (cộng dồn qua các mã) thì email bị khóa gửi và xác minh. */
export const OTP_DAILY_FAILURE_LIMIT = 15;
export const OTP_FAILURE_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Mỗi IP được bắt đầu đăng nhập Google (`GET /v1/identity/google`) tối đa chừng này lần trong cửa sổ trượt một giờ.
 * Đủ rộng cho Wi-Fi dùng chung, vẫn chặn spam ghi `verifications`.
 */
export const GOOGLE_START_PER_IP_PER_HOUR = 60;

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
  /** Đã đăng ký (và xác nhận) TOTP. */
  twoFactorEnabled: z.boolean(),
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
/** Màn đăng ký TOTP của web (QR, khóa nhập tay, mã 6 số, rồi mã khôi phục). */
export const TOTP_ENROLL_PATH = '/bao-mat/totp';
/** Trang trung gian của web mà Google quay về sau khi đăng nhập thành công. */
export const GOOGLE_RETURN_PATH = `${LOGIN_PATH}/google`;

// Ký tự điều khiển, khoảng trắng và dấu `\`: trình duyệt bỏ qua hoặc đổi `\` thành `/`, có thể biến `/\t/x` thành `//x`.
const UNSAFE_RETURN_TO_CHARS = /[\u0000- \u007f\\]/;
const PROBE_ORIGIN = 'http://tickee.invalid';
/** Không quay về chính các màn trong luồng đăng nhập (tránh vòng lặp). */
const FLOW_PATHS = [LOGIN_PATH, CONSENT_PATH, TOTP_ENROLL_PATH];

/**
 * `returnTo` chỉ nhận đường dẫn nội bộ (chống open redirect): bắt đầu bằng `/`, không bắt đầu bằng `//` hoặc `/\`,
 * không có scheme, và khi phân giải vẫn ở cùng origin. Sai hoặc thiếu → `/`. Hợp lệ thì trả dạng đã chuẩn hóa
 * (`pathname + search + hash`): `/..//evil.com` chuẩn hóa thành `//evil.com` nên bị từ chối. Mọi đường dẫn dưới
 * màn đăng nhập/đồng ý/đăng ký TOTP (kể cả `/dang-nhap/`, `/dang-nhap/google`) không làm đích quay về để tránh vòng lặp.
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
  /** IP này đã bắt đầu đăng nhập Google quá `GOOGLE_START_PER_IP_PER_HOUR` lần trong một giờ. */
  RATE_LIMITED: 'rate_limited',
  /** Lỗi phía server khi bắt đầu (DB, Better Auth…): web hiện banner lỗi chung. */
  START_FAILED: 'start_failed',
} as const;
export type GoogleSignInError = (typeof GoogleSignInError)[keyof typeof GoogleSignInError];

/** Tham số query mang mã lỗi của luồng Google trên màn đăng nhập. */
export const SIGN_IN_ERROR_PARAM = 'error';

// ---------------------------------------------------------------------------------------------------------------
// TOTP cho Owner (FR-1, NFR-6, AD-26)
// ---------------------------------------------------------------------------------------------------------------

/** Mã TOTP: 6 số, chu kỳ 30 giây, issuer "Tickee" (ứng dụng xác thực hiển thị tên này). */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_ISSUER = 'Tickee';

/** Step-up có hiệu lực 12 giờ kể từ lần xác minh TOTP (hoặc mã khôi phục) gần nhất của session. */
export const STEP_UP_TTL_MS = 12 * 60 * 60 * 1000;

/** Sai liên tiếp chừng này lần (TOTP và mã khôi phục, cả xác nhận đăng ký lẫn step-up) thì khóa xác minh. */
export const TOTP_MAX_FAILURES = 5;
/** Thời gian khóa xác minh TOTP theo user. */
export const TOTP_LOCK_MS = 15 * 60 * 1000;

/** Số mã khôi phục sinh mỗi lần đăng ký; mỗi mã dùng một lần. */
export const RECOVERY_CODE_COUNT = 10;
/** Bảng chữ của mã khôi phục: bỏ ký tự dễ nhầm (0/O, 1/I/L, U). */
export const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
/** Mã khôi phục gồm 10 ký tự, hiển thị dạng `XXXXX-XXXXX`. */
export const RECOVERY_CODE_LENGTH = 10;

export const TotpCode = z.string().regex(new RegExp(`^\\d{${TOTP_DIGITS}}$`));

/**
 * Mã khôi phục người dùng nhập: bỏ khoảng trắng và dấu gạch, chữ hoa → đúng `RECOVERY_CODE_LENGTH` ký tự trong
 * `RECOVERY_CODE_ALPHABET`. Dạng chuẩn hóa này là thứ được băm và so khớp.
 */
export const RecoveryCode = z
  .string()
  .transform((s) => s.replace(/[\s-]+/g, '').toUpperCase())
  .pipe(z.string().regex(new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`)));

/** `XXXXXXXXXX` → `XXXXX-XXXXX` (dạng hiển thị, tải xuống). */
export function formatRecoveryCode(normalized: string): string {
  const half = RECOVERY_CODE_LENGTH / 2;
  return `${normalized.slice(0, half)}-${normalized.slice(half)}`;
}

/** `POST /v1/identity/totp/enroll`: bắt đầu (hoặc bắt đầu lại) đăng ký. */
export const TotpEnrollResponse = z.object({
  /** `otpauth://totp/...` để dựng QR. */
  totpUri: z.string().startsWith('otpauth://totp/'),
  /** Khóa base32 để nhập tay vào ứng dụng xác thực. */
  manualKey: z.string().min(1),
});
export type TotpEnrollResponse = z.infer<typeof TotpEnrollResponse>;

/** `POST /v1/identity/totp/enroll/verify` và `POST /v1/identity/totp/step-up`. */
export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.input<typeof TotpCodeRequest>;

/**
 * Kết quả xác nhận đăng ký: 10 mã khôi phục (dạng `XXXXX-XXXXX`) chỉ trả đúng lần này. API set cookie session mới
 * (đã step-up).
 */
export const TotpEnrollVerifyResponse = z.object({
  recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
});
export type TotpEnrollVerifyResponse = z.infer<typeof TotpEnrollVerifyResponse>;

/** Kết quả step-up bằng TOTP. */
export const StepUpResponse = z.object({ stepUpAt: z.iso.datetime() });
export type StepUpResponse = z.infer<typeof StepUpResponse>;

/** `POST /v1/identity/totp/recovery` */
export const RecoveryCodeRequest = z.object({ recoveryCode: RecoveryCode });
export type RecoveryCodeRequest = z.input<typeof RecoveryCodeRequest>;

/**
 * Step-up bằng mã khôi phục thành công: mã đã hết hiệu lực và TOTP hiện tại bị gỡ, nên phải đăng ký lại
 * (`reenrollRequired` luôn `true`).
 */
export const RecoveryCodeResponse = z.object({
  stepUpAt: z.iso.datetime(),
  reenrollRequired: z.literal(true),
});
export type RecoveryCodeResponse = z.infer<typeof RecoveryCodeResponse>;

/** Lý do của `TOTP_REQUIRED`: chưa đăng ký → màn đăng ký; đã đăng ký mà chưa/hết step-up → dialog step-up. */
export const TotpRequiredReason = {
  ENROLL: 'enroll',
  STEP_UP: 'step_up',
} as const;
export type TotpRequiredReason = (typeof TotpRequiredReason)[keyof typeof TotpRequiredReason];

/** `details` của lỗi `TOTP_REQUIRED`. */
export const TotpRequiredDetails = z.object({ reason: z.enum(TotpRequiredReason) });
export type TotpRequiredDetails = z.infer<typeof TotpRequiredDetails>;

/** `details` của lỗi `TOTP_INVALID`. */
export const TotpInvalidDetails = z.object({ remainingAttempts: z.number().int().min(1) });
export type TotpInvalidDetails = z.infer<typeof TotpInvalidDetails>;

/** `details` của lỗi `TOTP_LOCKED` (cùng dạng `OtpLockedDetails`). */
export const TotpLockedDetails = OtpLockedDetails;
export type TotpLockedDetails = z.infer<typeof TotpLockedDetails>;

/**
 * Endpoint không bao giờ trả `TOTP_REQUIRED` (dạng `METHOD /v1/...` như Express khai báo route), khai báo một chỗ.
 * Owner chưa đăng ký hay chưa step-up vẫn phải gọi được các route này để đăng ký, step-up, đăng xuất và để web
 * dựng khung trang.
 */
export const TOTP_EXEMPT_ROUTES: readonly string[] = [
  'POST /v1/identity/totp/enroll',
  'POST /v1/identity/totp/enroll/verify',
  'POST /v1/identity/totp/step-up',
  'POST /v1/identity/totp/recovery',
  'POST /v1/identity/sign-out',
  'GET /v1/identity/me',
  'GET /v1/me/memberships',
];

/** Route `METHOD path` (path theo khai báo route, vd. `/v1/orgs/:orgId`) có trong `TOTP_EXEMPT_ROUTES` không. */
export function isTotpExemptRoute(method: string, path: string): boolean {
  return TOTP_EXEMPT_ROUTES.includes(`${method.toUpperCase()} ${path}`);
}
