import { CONSENT_PATH, DEFAULT_RETURN_TO, LOGIN_PATH, safeReturnTo } from '@tickee/contracts';

import { NOTICE_PARAM, type NoticeCode } from '@/lib/notices';

// `safeReturnTo` dùng chung với api (api kiểm `returnTo` khi bắt đầu đăng nhập Google).
export { CONSENT_PATH, DEFAULT_RETURN_TO, GOOGLE_RETURN_PATH, LOGIN_PATH, safeReturnTo } from '@tickee/contracts';

const PROBE_ORIGIN = 'http://tickee.invalid';

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
