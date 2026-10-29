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

/**
 * Giữ tên tham số query nhưng che giá trị: query có thể mang bí mật một lần (`code`, `state` của callback OAuth) hoặc
 * dữ liệu người dùng. `/v1/auth/callback/google?code=x&state=y` → `/v1/auth/callback/google?code=[REDACTED]&state=[REDACTED]`.
 */
export function redactUrlQuery(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const keys = [...new Set(new URLSearchParams(url.slice(q + 1)).keys())];
  return keys.length === 0 ? url.slice(0, q) : `${url.slice(0, q)}?${keys.map((k) => `${encodeURIComponent(k)}=${REDACTED}`).join('&')}`;
}

type SerializedReq = { url?: unknown; query?: unknown };
type SerializedRes = { headers?: Record<string, unknown> | null };

/**
 * Serializer cho pino-http (chạy sau serializer chuẩn): che giá trị query trong `req.url`, bỏ `req.query`, và che
 * header `location` của response (URL ủy quyền Google chứa `state`; redirect về web chứa `returnTo`).
 */
export const httpSerializers = {
  req(req: SerializedReq): SerializedReq {
    if (typeof req.url === 'string') req.url = redactUrlQuery(req.url);
    req.query = undefined;
    return req;
  },
  res(res: SerializedRes): SerializedRes {
    if (res.headers && 'location' in res.headers) res.headers = { ...res.headers, location: REDACTED };
    return res;
  },
};
