import { Logger } from '@nestjs/common';

const EMAIL_PATTERN = /[^\s"'<>@]+@[^\s"'<>@]+\.[^\s"'<>@]+/g;
const authLogger = new Logger('BetterAuth');

/**
 * Logger của Better Auth đi qua pino nhưng chỉ giữ thông điệp (đã che email) và tên/mã lỗi:
 * tham số kèm theo (lỗi DB có `detail` chứa email, object request…) không bao giờ được ghi nguyên.
 */
export function logBetterAuth(level: string, message: unknown, ...args: unknown[]): void {
  // Better Auth có chỗ gọi `logger.error(e)` với chính object lỗi làm thông điệp.
  const errors = [message, ...args]
    .filter((a): a is Error & { code?: unknown } => a instanceof Error)
    .map((e) => ({ type: e.name, code: e.code, message: String(e.message).replace(EMAIL_PATTERN, '[REDACTED]') }));
  const meta = errors.length > 0 ? { errors } : {};
  const msg = String(message ?? '').replace(EMAIL_PATTERN, '[REDACTED]');
  if (level === 'error') authLogger.error(meta, msg);
  else if (level === 'warn') authLogger.warn(meta, msg);
  else authLogger.log(meta, msg);
}
