import { Logger } from '@nestjs/common';
import { dbErrorSummary, isDatabaseError, REDACTED } from '../../platform/logging/index.js';

const EMAIL_PATTERN = /[^\s"'<>@]+@[^\s"'<>@]+\.[^\s"'<>@]+/g;
/** Message của `DrizzleQueryError` là `Failed query: <sql>\nparams: <params>`: mọi thứ từ `\nparams:` trở đi bị che. */
const PARAMS_PATTERN = /\nparams:[\s\S]*/;
const authLogger = new Logger('BetterAuth');

const scrub = (text: string): string => text.replace(PARAMS_PATTERN, `\nparams: ${REDACTED}`).replace(EMAIL_PATTERN, REDACTED);

/**
 * Logger của Better Auth đi qua pino nhưng chỉ giữ thông điệp (đã che email và params) và tên/mã lỗi:
 * tham số kèm theo (object request…) không bao giờ được ghi nguyên. Lỗi DB chỉ còn `{ type, code }`.
 */
export function logBetterAuth(level: string, message: unknown, ...args: unknown[]): void {
  // Better Auth có chỗ gọi `logger.error(e)` với chính object lỗi làm thông điệp.
  const errors = [message, ...args]
    .filter((a): a is Error & { code?: unknown } => a instanceof Error)
    .map((e) => (isDatabaseError(e) ? dbErrorSummary(e) : { type: e.name, code: e.code, message: scrub(String(e.message)) }));
  const meta = errors.length > 0 ? { errors } : {};
  const msg = isDatabaseError(message) ? dbErrorSummary(message).type : scrub(String(message ?? ''));
  if (level === 'error') authLogger.error(meta, msg);
  else if (level === 'warn') authLogger.warn(meta, msg);
  else authLogger.log(meta, msg);
}
