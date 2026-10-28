import { ErrorCode } from '@tickee/contracts';

/** Lỗi duy nhất mà API client ném ra. `code` lấy từ `ErrorCode` của `@tickee/contracts`. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  readonly details: unknown;
  /** HTTP status; `null` khi không nhận được phản hồi (lỗi mạng). */
  readonly status: number | null;

  constructor(code: ErrorCode, message: string, details: unknown = null, status: number | null = null) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function serviceUnavailableError(cause: unknown): ApiError {
  const error = new ApiError(
    ErrorCode.SERVICE_UNAVAILABLE,
    'Không kết nối được máy chủ. Vui lòng thử lại.',
    null,
    null,
  );
  error.cause = cause;
  return error;
}

export function invalidResponseError(status: number, details: unknown = null): ApiError {
  return new ApiError(ErrorCode.INTERNAL_ERROR, 'Máy chủ trả về dữ liệu không hợp lệ.', details, status);
}
