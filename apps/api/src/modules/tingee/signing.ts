import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Ký request gọi Tingee (và kiểm chữ ký ở Tingee fake). Chỉ phụ thuộc `node:crypto` để fake chạy độc lập được.
 */

/** Việt Nam không có giờ mùa hè: `Asia/Ho_Chi_Minh` luôn là UTC+7. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * `x-request-timestamp`: `yyyyMMddHHmmssSSS` theo giờ `Asia/Ho_Chi_Minh`, cho mọi API Tingee, kể cả `create-link` của
 * Cổng thanh toán. Trang tài liệu `create-link` ghi UNIX ms, nhưng Tingee production trả 90 "Timestamp is not in correct
 * format." cho UNIX ms và nhận định dạng này (chẩn đoán 10/11/2026).
 */
export function tingeeTimestamp(now: Date): string {
  const t = new Date(now.getTime() + VN_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}${pad(t.getUTCMilliseconds(), 3)}`
  );
}

/** Đọc ngược `tingeeTimestamp`; sai dạng → `null`. */
export function parseTingeeTimestamp(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m.map(Number) as [number, number, number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi, s, ms) - VN_OFFSET_MS;
  const date = new Date(utc);
  return tingeeTimestamp(date) === value ? date : null;
}

/** `x-signature`: hex thường của `HMAC_SHA512(timestamp + ':' + body, secret)`; `body` là đúng chuỗi JSON gửi đi. */
export function sign(timestamp: string, body: string, secret: string): string {
  return createHmac('sha512', secret).update(`${timestamp}:${body}`).digest('hex');
}

/** So chữ ký thời gian hằng. */
export function verifySignature(timestamp: string, body: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(sign(timestamp, body, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
