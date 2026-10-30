import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import { ErrorCode, type ErrorResponse } from '@tickee/contracts';
import type { Response } from 'express';
import { AppError } from './app-error.js';

const MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: 'Không tìm thấy tài nguyên.',
  VALIDATION_FAILED: 'Yêu cầu không hợp lệ.',
  INTERNAL_ERROR: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
  SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời không sẵn sàng.',
  UNAUTHENTICATED: 'Bạn cần đăng nhập để tiếp tục.',
  CONSENT_REQUIRED: 'Bạn cần đồng ý xử lý dữ liệu cá nhân để tiếp tục.',
  OTP_RATE_LIMITED: 'Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau.',
  OTP_INVALID: 'Mã chưa đúng.',
  OTP_EXPIRED: 'Mã đã hết hạn.',
  OTP_ATTEMPTS_EXCEEDED: 'Mã đã hết hiệu lực.',
  OTP_LOCKED: 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau.',
  NOT_A_MEMBER: 'Bạn không phải thành viên của BTC này.',
  FORBIDDEN_ROLE: 'Vai trò của bạn không được thực hiện thao tác này.',
};

function codeForStatus(status: number): ErrorCode {
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
      if (status >= 500) this.logger.error({ err: exception.cause ?? exception, code: exception.code }, exception.message);
    } else if (exception instanceof HttpException && exception.getStatus() < 500) {
      status = exception.getStatus();
      const code = codeForStatus(status);
      body = { error: { code, message: MESSAGES[code], details: null } };
    } else {
      status = exception instanceof HttpException ? exception.getStatus() : 500;
      const code = codeForStatus(status);
      this.logger.error({ err: exception }, 'Lỗi không bắt được');
      body = { error: { code, message: MESSAGES[code], details: null } };
    }

    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
