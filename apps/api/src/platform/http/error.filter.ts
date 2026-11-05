import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import { ErrorCode, FREE_EVENT_TICKET_CAP, type ErrorResponse } from '@tickee/contracts';
import type { Response } from 'express';
import { dbErrorSummary, isDatabaseError } from '../logging/index.js';
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
  TOTP_REQUIRED: 'Bạn cần xác thực hai lớp để tiếp tục.',
  TOTP_INVALID: 'Mã chưa đúng.',
  TOTP_LOCKED: 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau.',
  ALREADY_A_MEMBER: 'Email này đã là thành viên của BTC.',
  INVITATION_INVALID: 'Link mời không hợp lệ.',
  INVITATION_EXPIRED: 'Link mời đã hết hạn.',
  INVITATION_USED: 'Link mời đã được dùng.',
  INVITATION_EMAIL_MISMATCH: 'Lời mời này gửi tới một email khác.',
  INVITATION_LIMIT_REACHED: 'BTC đã gửi quá nhiều lời mời trong 24 giờ. Vui lòng thử lại sau.',
  TWO_FACTOR_NOT_ENABLED: 'Bạn cần bật xác thực hai lớp để tiếp tục.',
  CLOSED_BETA_TRANSITION_INVALID: 'Không chuyển được trạng thái Closed Beta của BTC này.',
  TINGEE_CREDENTIAL_INVALID: 'Client ID hoặc Secret Token không đúng.',
  BANK_NOT_SUPPORTED: 'Ngân hàng này chưa được hỗ trợ.',
  PAYOUT_ACCOUNT_UNAVAILABLE: 'Tài khoản này không còn dùng được trên Tingee.',
  PAYOUT_ACCOUNT_ALREADY_LINKED: 'Tài khoản này đã được liên kết.',
  MERCHANT_SUSPENDED: 'Tài khoản Tingee của BTC đang tạm khóa.',
  PAYMENT_PROVIDER_UNAVAILABLE: 'Tingee tạm lỗi, thử lại sau ít phút.',
  EVENT_NOT_FOUND: 'Không tìm thấy Sự kiện này.',
  TICKET_TYPE_NOT_FOUND: 'Không tìm thấy Hạng vé này.',
  CAPACITY_BELOW_COMMITTED: 'Số suất không được nhỏ hơn số đã bán và đang giữ chỗ.',
  FREE_EVENT_CAPACITY_EXCEEDED: `Sự kiện miễn phí tối đa ${FREE_EVENT_TICKET_CAP} Vé.`,
  TICKET_TYPE_IN_USE: 'Hạng vé đã có người mua hoặc đang giữ chỗ, không xóa được.',
};

/** Lỗi DB chỉ log `{ type, code }` (message/params có thể mang email, token session); lỗi khác log nguyên để giữ stack. */
const loggableError = (err: unknown): unknown => (isDatabaseError(err) ? dbErrorSummary(err) : err);

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
