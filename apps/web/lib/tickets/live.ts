import { MY_TICKETS_LIVE_API_PATH, type MyTicketsView } from '@tickee/contracts';

import { isWaiting, ORDER_WAITING_POLL_MS } from '@/lib/order/live';

/*
 * "Vé của tôi" tự cập nhật (Story 3.9, AD-17): stream `GET /v1/me/tickets/live` chỉ lọc theo tập Đơn của người xem lúc mở
 * (payload `RealtimeSignal` không có `userId`), nên web đưa một khóa suy từ tập mã Đơn của danh sách vào đường SSE: tập
 * đổi (Đơn mới hiện ra, Đơn hết hạn rời nhóm) thì đường đổi và `useLiveResource` mở lại stream. Máy chủ bỏ qua query.
 * Hàm thuần, kiểm bằng Vitest môi trường node.
 */

/** Mã Đơn của danh sách (Vé còn hiệu lực + Đơn đang chờ), không trùng, đã xếp. */
export function orderCodesOf(view: Pick<MyTicketsView, 'active' | 'pending'>): string[] {
  return [...new Set([...view.active.map((t) => t.orderCode), ...view.pending.map((o) => o.code)])].sort();
}

/** FNV-1a 32 bit, hex 8 ký tự: khóa ngắn, ổn định cho một tập mã Đơn (không cần chống đụng độ có chủ đích). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Đường SSE của "Vé của tôi" theo dữ liệu hiện có: `/me/tickets/live?orders=<khóa của tập mã Đơn>`. Chưa có dữ liệu → đường
 * không khóa (hook chỉ mở SSE khi đã có dữ liệu).
 */
export function myTicketsLivePath(view: Pick<MyTicketsView, 'active' | 'pending'> | undefined): string {
  if (!view) return MY_TICKETS_LIVE_API_PATH;
  return `${MY_TICKETS_LIVE_API_PATH}?orders=${fnv1a(orderCodesOf(view).join(','))}`;
}

/**
 * Chu kỳ polling khi SSE chưa kết nối: 2 giây khi có Đơn đang chờ tiền (`awaiting_payment`/`confirming`, như màn chờ
 * thanh toán), còn lại không polling (tải lại khi tab visible lại, có mạng lại).
 */
export function myTicketsPollInterval(view: Pick<MyTicketsView, 'pending'> | undefined): number | false {
  return view?.pending.some((o) => isWaiting(o.buyerStatus)) ? ORDER_WAITING_POLL_MS : false;
}
