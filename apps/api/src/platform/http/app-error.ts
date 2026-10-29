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
