import { NOTICE_PARAM, type NoticeCode } from '@/lib/notices';

/** Trang mặc định sau đăng nhập hoặc khi `returnTo` không hợp lệ. */
export const DEFAULT_RETURN_TO = '/';

export const LOGIN_PATH = '/dang-nhap';
export const CONSENT_PATH = '/dong-y';

// Ký tự điều khiển, khoảng trắng và dấu `\`: trình duyệt bỏ qua hoặc đổi `\` thành `/`, có thể biến `/\t/x` thành `//x`.
const UNSAFE_CHARS = /[\u0000- \u007f\\]/;
const PROBE_ORIGIN = 'http://tickee.invalid';

/**
 * `returnTo` chỉ nhận đường dẫn nội bộ (chống open redirect): bắt đầu bằng `/`, không bắt đầu bằng `//` hoặc `/\`,
 * không có scheme, và khi phân giải vẫn ở cùng origin. Sai hoặc thiếu → `/`. Hợp lệ thì trả dạng đã chuẩn hóa
 * (`pathname + search + hash`): `/..//evil.com` chuẩn hóa thành `//evil.com` nên bị từ chối, không lọt sang
 * `router.replace`. Màn đăng nhập/đồng ý không làm đích quay về để tránh vòng lặp.
 */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_RETURN_TO;
  if (!raw.startsWith('/') || raw.startsWith('//') || UNSAFE_CHARS.test(raw)) return DEFAULT_RETURN_TO;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (url.origin !== PROBE_ORIGIN || url.pathname.startsWith('//')) return DEFAULT_RETURN_TO;
  if (url.pathname === LOGIN_PATH || url.pathname === CONSENT_PATH) return DEFAULT_RETURN_TO;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/dang-nhap?returnTo=…` hoặc `/dong-y?returnTo=…` (bỏ tham số khi đích là trang chủ). */
export function withReturnTo(path: typeof LOGIN_PATH | typeof CONSENT_PATH, returnTo: string): string {
  const target = safeReturnTo(returnTo);
  return target === DEFAULT_RETURN_TO ? path : `${path}?returnTo=${encodeURIComponent(target)}`;
}

/** Thêm `?notice=<mã>` vào một đường dẫn nội bộ, giữ nguyên query sẵn có. */
export function withNotice(returnTo: string, notice: NoticeCode): string {
  const url = new URL(safeReturnTo(returnTo), PROBE_ORIGIN);
  url.searchParams.set(NOTICE_PARAM, notice);
  return `${url.pathname}${url.search}${url.hash}`;
}
