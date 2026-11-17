import { PinoLogger } from 'nestjs-pino';
import type { Bindings } from 'pino';

/*
 * Ngữ cảnh log ngoài DI (Story 4.6-a): trường gắn vào mọi log còn lại của một request (`organizationId` sau
 * `PermissionGuard`) hay của một job (`queue`, `jobId`, id trong payload). Dựa trên ngữ cảnh của nestjs-pino
 * (`PinoLogger.assign`, `PinoLogger.runInContext`), nên log qua `Logger` của Nest cũng mang các trường này.
 */

let contextLogger: PinoLogger | undefined;

/**
 * `PinoLogger` dùng chung (mọi instance cùng một logger gốc của nestjs-pino). Chưa có `LoggerModule` (unit test không dựng
 * Nest) thì không có logger gốc: trả `undefined`, ngữ cảnh log thành no-op.
 */
function pinoLogger(): PinoLogger | undefined {
  if (!PinoLogger.root) return undefined;
  contextLogger ??= new PinoLogger({});
  return contextLogger;
}

/** Chạy `fn` trong một ngữ cảnh log mới: mọi log bên trong (kể cả sau `await`) mang `bindings`. */
export function runInLogContext<T>(bindings: Bindings, fn: () => T): T {
  const logger = pinoLogger();
  return logger ? logger.runInContext(fn, { bindings }) : fn();
}

/**
 * Gắn `fields` vào mọi log còn lại của ngữ cảnh hiện tại (request: cả dòng log kết thúc request của pino-http). Ngoài mọi
 * ngữ cảnh (không có request hay job) thì không làm gì.
 */
export function assignLogContext(fields: Bindings): void {
  const logger = pinoLogger();
  if (!logger) return;
  try {
    logger.assign(fields);
  } catch {
    // nestjs-pino ném khi không có ngữ cảnh (gọi ngoài request): không có log nào để gắn.
  }
}
