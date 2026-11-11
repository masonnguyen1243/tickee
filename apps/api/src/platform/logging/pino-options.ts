import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PII_KEYS, REAUTH_HEADER } from '@tickee/contracts';
import type { LoggerOptions } from 'pino';

export const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const REDACTED = '[REDACTED]';

/**
 * Khóa PII trùng tên trường log thông dụng (`name`: tên logger của pino, tên queue/job của pg-boss, `Error.name`):
 * che theo khóa trần sẽ che nhầm các trường đó, nên chỉ che dưới đối tượng người dùng (`user.<k>`).
 * `organization.name` (tên BTC công khai) không bị che.
 */
export const GENERIC_PII_KEYS: ReadonlySet<string> = new Set(['name']);

/** IP và User-Agent trong log request của pino-http (`req` đã qua serializer chuẩn), gồm header IP của CDN/LB. */
const REQUEST_PII_PATHS = [
  'req.remoteAddress',
  'req.headers["user-agent"]',
  'req.headers["x-forwarded-for"]',
  'req.headers["x-real-ip"]',
  'req.headers.forwarded',
  'req.headers["cf-connecting-ip"]',
  'req.headers["true-client-ip"]',
  'req.headers["x-client-ip"]',
  'req.headers["x-cluster-client-ip"]',
  'req.headers["fastly-client-ip"]',
  'req.headers["fly-client-ip"]',
];

/**
 * Đường dẫn `redact` của pino sinh từ danh sách khóa PII trong `@tickee/contracts` (tới độ sâu 3); khóa chung chung
 * (`GENERIC_PII_KEYS`) chỉ che dưới `user`.
 */
export function buildRedactPaths(keys: readonly string[] = PII_KEYS): string[] {
  const paths = keys.flatMap((k) =>
    GENERIC_PII_KEYS.has(k) ? [`user.${k}`, `*.user.${k}`, `*.*.user.${k}`] : [k, `*.${k}`, `*.*.${k}`],
  );
  return [
    ...paths,
    'req.headers.authorization',
    'req.headers.cookie',
    // Lần xác nhận lại trước thao tác nhạy cảm (Story 2.13): token dùng được 5 phút, không bao giờ vào log.
    `req.headers["${REAUTH_HEADER}"]`,
    // Chữ ký IPN Tingee (Story 3.5): không bao giờ vào log.
    'req.headers["x-signature"]',
    ...REQUEST_PII_PATHS,
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

/** Tiền tố (chữ thường) của đường công khai mang token link chia sẻ Vé trong đường dẫn (Story 3.8, AD-29). */
const SHARED_TICKET_PREFIX = '/v1/shared-tickets/';

/** Đường dẫn của `url` (`originalUrl`): nhận cả dạng tuyệt đối `http://host/…` mà router Express vẫn khớp route. */
function pathOf(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url.split('?', 1)[0]!;
  }
}

/**
 * Che token link chia sẻ Vé trong URL của request (cầm token là cầm Vé): đường dẫn (so chữ thường như router Express,
 * kể cả URL dạng tuyệt đối) bắt đầu bằng `/v1/shared-tickets/` → `<tiền tố như đã gửi>[REDACTED]<phần sau token><query>`
 * (`http://host/V1/Shared-Tickets/<token>?a=1` → `/V1/Shared-Tickets/[REDACTED]?a=1`). Đường khác giữ nguyên.
 */
export function redactSharedTicketPath(url: string): string {
  const path = pathOf(url);
  if (!path.toLowerCase().startsWith(SHARED_TICKET_PREFIX)) return url;
  const rest = path.slice(SHARED_TICKET_PREFIX.length);
  const slash = rest.indexOf('/');
  const q = url.indexOf('?');
  return `${path.slice(0, SHARED_TICKET_PREFIX.length)}${REDACTED}${slash < 0 ? '' : rest.slice(slash)}${q < 0 ? '' : url.slice(q)}`;
}

type SerializedReq = { url?: unknown; query?: unknown; params?: unknown };
type SerializedRes = { headers?: Record<string, unknown> | null };

/**
 * Serializer cho pino-http (chạy sau serializer chuẩn): che giá trị query và token link chia sẻ Vé trong `req.url`, bỏ
 * `req.query` và `req.params` (tham số đường dẫn như token đã có, đã che, trong `url`), và che header `location` của
 * response (URL ủy quyền Google chứa `state`; redirect về web chứa `returnTo`).
 */
export const httpSerializers = {
  req(req: SerializedReq): SerializedReq {
    if (typeof req.url === 'string') req.url = redactSharedTicketPath(redactUrlQuery(req.url));
    req.query = undefined;
    req.params = undefined;
    return req;
  },
  res(res: SerializedRes): SerializedRes {
    if (res.headers && 'location' in res.headers) res.headers = { ...res.headers, location: REDACTED };
    return res;
  },
};
