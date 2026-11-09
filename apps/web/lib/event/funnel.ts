import type { FunnelEventInput } from '@tickee/contracts';

import { apiBaseUrl } from '@/lib/api/client';

/*
 * Phễu mua (Story 3.1, SM-C2): `buy_clicked` khi bấm "Mua", `login_completed` khi tới Checkout sau đăng nhập. Gửi kiểu
 * fire-and-forget: không chờ, không báo lỗi, không bao giờ chặn điều hướng. Không gửi cookie (API không cần biết ai
 * bấm).
 */

/** Uuid v4 nối `buy_clicked` với `login_completed`. `crypto.randomUUID` chỉ có ở secure context nên có dự phòng. */
export function newFunnelId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `POST /v1/events/:slug/funnel-events` với `keepalive` (request vẫn đi khi trang chuyển đi). Trình duyệt không gửi
 * được bản `keepalive` (vd. chưa hỗ trợ preflight cho `keepalive`) thì thử lại một lần bản thường; trùng thì API bỏ qua
 * (unique `(funnel_id, type)`). Mọi lỗi bị nuốt.
 */
export function sendFunnelEvent(slug: string, input: FunnelEventInput): void {
  try {
    const url = `${apiBaseUrl()}/events/${encodeURIComponent(slug)}/funnel-events`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'omit',
      keepalive: true,
    };
    void fetch(url, init).catch(() => fetch(url, { ...init, keepalive: false }).catch(() => undefined));
  } catch {
    // `apiBaseUrl` thiếu biến môi trường hoặc `fetch` ném đồng bộ: bỏ qua, phễu không bao giờ chặn luồng mua.
  }
}
