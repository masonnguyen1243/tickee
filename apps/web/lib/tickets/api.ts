import { MY_TICKETS_API_PATH, MyTicketDetail, myTicketApiPath, MyTicketsView } from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';

/*
 * "Vé của tôi" và Chi tiết Vé (Story 3.9): gọi từ trình duyệt kèm cookie phiên (phiên ở origin API), không bao giờ render
 * ở server. Chỉ trong bộ nhớ của tab: không lưu Chi tiết Vé để xem offline.
 */

/** Khóa TanStack Query: ba nhóm của "Vé của tôi" (`[domain, kind]`). */
export const myTicketsQueryKey = ['tickets', 'mine'] as const;

/** Khóa TanStack Query: Chi tiết một Vé của chính Người mua. */
export const myTicketQueryKey = (ticketId: string) => ['tickets', 'detail', ticketId] as const;

/** `GET /v1/me/tickets`: Vé còn hiệu lực · Đơn đang chờ · Lịch sử, kèm `serverNow`. */
export function fetchMyTickets(signal?: AbortSignal): Promise<MyTicketsView> {
  return apiRequest(MY_TICKETS_API_PATH, { schema: MyTicketsView, init: { signal } });
}

/** `GET /v1/me/tickets/:ticketId`: Vé không thuộc người gọi hay id sai → `ApiError` `TICKET_NOT_FOUND`. */
export function fetchMyTicket(ticketId: string, signal?: AbortSignal): Promise<MyTicketDetail> {
  return apiRequest(myTicketApiPath(ticketId), { schema: MyTicketDetail, init: { signal } });
}
