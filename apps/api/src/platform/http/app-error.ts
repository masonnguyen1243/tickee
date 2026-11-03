import { ErrorCode } from '@tickee/contracts';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  UNAUTHENTICATED: 401,
  CONSENT_REQUIRED: 403,
  OTP_RATE_LIMITED: 429,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_ATTEMPTS_EXCEEDED: 400,
  OTP_LOCKED: 429,
  NOT_A_MEMBER: 403,
  FORBIDDEN_ROLE: 403,
  TOTP_REQUIRED: 403,
  TOTP_INVALID: 400,
  TOTP_LOCKED: 429,
  ALREADY_A_MEMBER: 409,
  INVITATION_INVALID: 404,
  INVITATION_EXPIRED: 410,
  INVITATION_USED: 409,
  INVITATION_EMAIL_MISMATCH: 403,
  INVITATION_LIMIT_REACHED: 429,
  TWO_FACTOR_NOT_ENABLED: 403,
  CLOSED_BETA_TRANSITION_INVALID: 409,
  TINGEE_CREDENTIAL_INVALID: 422,
  BANK_NOT_SUPPORTED: 422,
  PAYOUT_ACCOUNT_UNAVAILABLE: 409,
  PAYOUT_ACCOUNT_ALREADY_LINKED: 409,
  MERCHANT_SUSPENDED: 409,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  EVENT_NOT_FOUND: 404,
};

/** Lỗi nghiệp vụ có mã khai báo trong `@tickee/contracts`; filter toàn cục chuyển thành dạng lỗi chuẩn. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, options: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details ?? null;
  }
}
