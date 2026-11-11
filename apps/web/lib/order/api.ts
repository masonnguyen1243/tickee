import {
  BuyerOrderView,
  buyerOrderApiPath,
  CheckoutForm,
  IDEMPOTENCY_KEY_HEADER,
  paymentLinkApiPath,
  SharedTicketView,
  sharedTicketApiPath,
  TicketShareLink,
  ticketShareLinkApiPath,
  type CreateOrderRequest,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';

/*
 * Checkout và Đơn của Người mua (Story 3.2), thử lại link thanh toán (Story 3.4): gọi từ trình duyệt (phiên ở origin
 * API), không bao giờ render ở server.
 */

const eventPath = (slug: string) => `/events/${encodeURIComponent(slug)}`;

/** Khóa TanStack Query: câu hỏi form mua + phần tự điền của Checkout. */
export const checkoutFormQueryKey = (slug: string) => ['order', 'checkout-form', slug] as const;

/** Khóa TanStack Query: một Đơn của chính Người mua. */
export const buyerOrderQueryKey = (code: string) => ['order', 'mine', code] as const;

export function fetchCheckoutForm(slug: string, signal?: AbortSignal): Promise<CheckoutForm> {
  return apiRequest(`${eventPath(slug)}/checkout`, { schema: CheckoutForm, init: { signal } });
}

/**
 * `POST /v1/events/:slug/orders` với header `Idempotency-Key`: cùng khóa cho mọi lần gửi trong một lần mở Checkout (kể
 * cả "Thử lại" sau lỗi mạng), nên gửi lại không tạo Đơn thứ hai.
 */
export function createOrder(slug: string, idempotencyKey: string, body: CreateOrderRequest): Promise<BuyerOrderView> {
  return apiRequest(`${eventPath(slug)}/orders`, {
    schema: BuyerOrderView,
    init: { method: 'POST', body: JSON.stringify(body), headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  });
}

export function fetchBuyerOrder(code: string, signal?: AbortSignal): Promise<BuyerOrderView> {
  return apiRequest(buyerOrderApiPath(code), { schema: BuyerOrderView, init: { signal } });
}

/**
 * `POST /v1/me/orders/:code/payment-link`: thử tạo lại link thanh toán cho cùng Đơn (sau khi Tingee từ chối). Luôn trả
 * Đơn hiện tại; Đơn không đủ điều kiện thì máy chủ không gọi Tingee.
 */
export function retryPaymentLink(code: string): Promise<BuyerOrderView> {
  return apiRequest(paymentLinkApiPath(code), { schema: BuyerOrderView, init: { method: 'POST' } });
}

/**
 * `POST /v1/me/tickets/:ticketId/share-link` (Story 3.8): chủ Vé tạo lại link chia sẻ; link cũ chết ngay, Mã QR vé không
 * đổi. Trả token mới; nơi gọi tải lại Đơn để thẻ Vé dùng link mới.
 */
export function regenerateShareLink(ticketId: string): Promise<TicketShareLink> {
  return apiRequest(ticketShareLinkApiPath(ticketId), { schema: TicketShareLink, init: { method: 'POST' } });
}

/** Khóa TanStack Query: Vé được chia sẻ theo token (chỉ trong bộ nhớ của tab). */
export const sharedTicketQueryKey = (token: string) => ['order', 'shared-ticket', token] as const;

/**
 * `GET /v1/shared-tickets/:token` (Story 3.8, công khai): không kèm cookie (`credentials: 'omit'`), nên người mở link
 * không bị gắn với Vé dù đang đăng nhập. Token sai, Vé hủy, quá hạn → `ApiError` `SHARED_TICKET_NOT_FOUND`.
 */
export function fetchSharedTicket(token: string, signal?: AbortSignal): Promise<SharedTicketView> {
  return apiRequest(sharedTicketApiPath(token), {
    schema: SharedTicketView,
    init: { signal, credentials: 'omit', referrerPolicy: 'no-referrer' },
  });
}
