import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PII_KEYS } from '@tickee/contracts';
import type { LoggerOptions } from 'pino';

export const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const REDACTED = '[REDACTED]';

/** Đường dẫn `redact` của pino sinh từ danh sách khóa PII trong `@tickee/contracts` (tới độ sâu 3). */
export function buildRedactPaths(keys: readonly string[] = PII_KEYS): string[] {
  const paths = keys.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);
  return [
    ...paths,
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
  ];
}

export function basePinoOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: buildRedactPaths(), censor: REDACTED },
  };
}

/** Đọc `x-request-id` nếu hợp lệ, không thì sinh mới; luôn trả lại trong response header. */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
