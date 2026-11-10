import {
  BuyerOrder,
  buyerOrderApiPath,
  CheckoutForm,
  IDEMPOTENCY_KEY_HEADER,
  paymentLinkApiPath,
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
export function createOrder(slug: string, idempotencyKey: string, body: CreateOrderRequest): Promise<BuyerOrder> {
  return apiRequest(`${eventPath(slug)}/orders`, {
    schema: BuyerOrder,
    init: { method: 'POST', body: JSON.stringify(body), headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  });
}

export function fetchBuyerOrder(code: string, signal?: AbortSignal): Promise<BuyerOrder> {
  return apiRequest(buyerOrderApiPath(code), { schema: BuyerOrder, init: { signal } });
}

/**
 * `POST /v1/me/orders/:code/payment-link`: thử tạo lại link thanh toán cho cùng Đơn (sau khi Tingee từ chối). Luôn trả
 * Đơn hiện tại; Đơn không đủ điều kiện thì máy chủ không gọi Tingee.
 */
export function retryPaymentLink(code: string): Promise<BuyerOrder> {
  return apiRequest(paymentLinkApiPath(code), { schema: BuyerOrder, init: { method: 'POST' } });
}
