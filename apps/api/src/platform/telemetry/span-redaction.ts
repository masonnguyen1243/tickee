import type { Attributes, AttributeValue, SpanStatus } from '@opentelemetry/api';
import { REDACTED } from '../logging/pino-options.js';

/*
 * Lọc dữ liệu của span trước khi xuất (Story 4.6-a). Hàm thuần, không phụ thuộc SDK: exporter của `sdk.ts` áp cho MỌI span
 * (của instrumentation http, undici, pg, pg-boss, Better Auth, của Tickee). Mục tiêu: không query, không token trong
 * đường dẫn, không header, không IP hay User-Agent, không message lỗi (message của lỗi DB mang câu SQL và params).
 */

/**
 * Tiền tố (chữ thường) của các đường mà đoạn ngay sau nó là bí mật: token link chia sẻ Vé (cầm token là cầm Vé),
 * `ipnKey` của BTC trong URL IPN Tingee, và mọi đường Better Auth (`/v1/auth/*`: callback OAuth, link đặt lại…).
 * Express so khớp route không phân biệt hoa thường, nên so ở dạng chữ thường.
 */
const SECRET_SEGMENT_PREFIXES = ['/v1/shared-tickets/', '/v1/payments/tingee/ipn/'] as const;
/** Toàn bộ phần sau `/v1/auth/` bị che (Better Auth có đường mang token trong path, vd. đặt lại mật khẩu). */
const AUTH_PREFIX = '/v1/auth/';

/** Thuộc tính mang URL đầy đủ (`scheme://host/path?query`): bỏ query, che đoạn bí mật, bỏ thông tin đăng nhập. */
const FULL_URL_KEYS = new Set(['url.full', 'http.url']);
/** Thuộc tính mang đường dẫn (có thể kèm query, có thể ở dạng tuyệt đối như `req.url`): bỏ query, che đoạn bí mật. */
const PATH_KEYS = new Set(['url.path', 'http.target']);

/**
 * Thuộc tính bỏ hẳn: query; IP và User-Agent của người gọi (PII như trong log); params của câu SQL (nếu thư viện nào bật).
 */
const DROPPED_KEYS = new Set([
  'url.query',
  'user_agent.original',
  'http.user_agent',
  'client.address',
  'client.port',
  'network.peer.address',
  'network.peer.port',
  'net.peer.ip',
  'net.sock.peer.addr',
  'http.client_ip',
  'drizzle.query.params',
  'db.statement.parameters',
]);

/** Header (`http.request.header.*`, `http.response.header.*`) và từng param SQL (`db.query.parameter.*`) không bao giờ xuất. */
const DROPPED_PREFIXES = ['http.request.header.', 'http.response.header.', 'db.query.parameter.'];

/** Thuộc tính của event `exception` được giữ: tên lớp lỗi và các khung stack (bỏ dòng message). */
const EXCEPTION_STACKTRACE = 'exception.stacktrace';
const EXCEPTION_KEPT = new Set(['exception.type', EXCEPTION_STACKTRACE, 'exception.escaped']);

/** Che đoạn bí mật của một đường dẫn (không query): `/v1/shared-tickets/<token>/x` → `/v1/shared-tickets/[REDACTED]/x`. */
export function redactPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.startsWith(AUTH_PREFIX)) return `${path.slice(0, AUTH_PREFIX.length)}${REDACTED}`;
  for (const prefix of SECRET_SEGMENT_PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    return `${path.slice(0, prefix.length)}${REDACTED}${slash < 0 ? '' : rest.slice(slash)}`;
  }
  return path;
}

/** Bỏ query và fragment. */
const withoutQuery = (value: string): string => value.split(/[?#]/, 1)[0]!;

/** URL đầy đủ an toàn để xuất; không đọc được thì che cả chuỗi. */
export function redactFullUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return REDACTED;
  }
  return `${url.protocol}//${url.host}${redactPath(url.pathname)}`;
}

/** Đường dẫn của request (`/a?b`, hoặc dạng tuyệt đối `http://host/a?b` mà Node vẫn nhận) an toàn để xuất. */
export function redactTarget(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return redactFullUrl(value);
  return redactPath(withoutQuery(value));
}

function redactValue(key: string, value: AttributeValue | undefined): AttributeValue | undefined {
  if (typeof value !== 'string') return value;
  if (FULL_URL_KEYS.has(key)) return redactFullUrl(value);
  if (PATH_KEYS.has(key)) return redactTarget(value);
  return value;
}

const isDropped = (key: string): boolean => DROPPED_KEYS.has(key) || DROPPED_PREFIXES.some((p) => key.startsWith(p));

/** Thuộc tính của span sau khi lọc (hàm thuần: không sửa `attributes`). */
export function redactSpanAttributes(attributes: Attributes): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isDropped(key)) continue;
    out[key] = redactValue(key, value);
  }
  return out;
}

/** Chỉ giữ các khung `at …` của stack: dòng đầu (và các dòng message nhiều dòng) mang message của lỗi. */
export function stackFramesOnly(stack: string): string {
  return stack
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
    .join('\n');
}

/**
 * Thuộc tính của một event sau khi lọc: event `exception` chỉ còn tên lớp lỗi và khung stack (message có thể chứa câu
 * SQL, params, email); event khác lọc như thuộc tính của span.
 */
export function redactEventAttributes(name: string, attributes: Attributes | undefined): Attributes | undefined {
  if (!attributes) return attributes;
  if (name !== 'exception') return redactSpanAttributes(attributes);
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!EXCEPTION_KEPT.has(key)) continue;
    out[key] = key === EXCEPTION_STACKTRACE && typeof value === 'string' ? stackFramesOnly(value) : value;
  }
  return out;
}

/** Trạng thái của span không mang message (message của lỗi có thể chứa dữ liệu người dùng); giữ mã. */
export function redactStatus(status: SpanStatus): SpanStatus {
  return status.message === undefined ? status : { code: status.code };
}
