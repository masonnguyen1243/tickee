import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import { ErrorCode, type ErrorResponse } from '@tickee/contracts';
import type { Response } from 'express';
import { dbErrorSummary, isDatabaseError } from '../logging/index.js';
import { AppError } from './app-error.js';

/** Mã lỗi `codeForStatus` trả cho lỗi HTTP không phải `AppError` (lỗi miền mang message của chính nó). */
type StatusErrorCode =
  | typeof ErrorCode.NOT_FOUND
  | typeof ErrorCode.VALIDATION_FAILED
  | typeof ErrorCode.INTERNAL_ERROR
  | typeof ErrorCode.SERVICE_UNAVAILABLE
  | typeof ErrorCode.UNAUTHENTICATED;

const MESSAGES: Record<StatusErrorCode, string> = {
  NOT_FOUND: 'Không tìm thấy tài nguyên.',
  VALIDATION_FAILED: 'Yêu cầu không hợp lệ.',
  INTERNAL_ERROR: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
  SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời không sẵn sàng.',
  UNAUTHENTICATED: 'Bạn cần đăng nhập để tiếp tục.',
};

/** Lỗi DB chỉ log `{ type, code }` (message/params có thể mang email, token session); lỗi khác log nguyên để giữ stack. */
const loggableError = (err: unknown): unknown => (isDatabaseError(err) ? dbErrorSummary(err) : err);

function codeForStatus(status: number): StatusErrorCode {
  if (status === 401) return ErrorCode.UNAUTHENTICATED;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 503) return ErrorCode.SERVICE_UNAVAILABLE;
  if (status >= 400 && status < 500) return ErrorCode.VALIDATION_FAILED;
  return ErrorCode.INTERNAL_ERROR;
}

/** Mọi lỗi HTTP ra đúng một dạng `{ error: { code, message, details } }`; không lộ stack. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status: number;
    let body: ErrorResponse;

    if (exception instanceof AppError) {
      status = exception.status;
      body = { error: { code: exception.code, message: exception.message, details: exception.details } };
      if (status >= 500) {
        this.logger.error({ err: loggableError(exception.cause ?? exception), code: exception.code }, exception.message);
      }
    } else if (exception instanceof HttpException && exception.getStatus() < 500) {
      status = exception.getStatus();
      const code = codeForStatus(status);
      body = { error: { code, message: MESSAGES[code], details: null } };
    } else {
      status = exception instanceof HttpException ? exception.getStatus() : 500;
      const code = codeForStatus(status);
      this.logger.error({ err: loggableError(exception) }, 'Lỗi không bắt được');
      body = { error: { code, message: MESSAGES[code], details: null } };
    }

    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
