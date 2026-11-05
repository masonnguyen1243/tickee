import {
  EventDetail,
  EventList,
  TicketTypeDetail,
  TicketTypeList,
  type EventDraftInput,
  type EventOrderLimitInput,
  type TicketTypeInput,
} from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

/** Khóa TanStack Query: danh sách Sự kiện của một BTC. */
export const eventsQueryKey = (orgId: string) => ['event', 'list', orgId] as const;
/** Một Sự kiện của BTC (tab Tổng quan, wizard thiết lập). */
export const eventQueryKey = (orgId: string, eventId: string) => ['event', 'detail', orgId, eventId] as const;
/** Hạng vé (kèm tồn kho) của một Sự kiện: wizard bước 2 và tab "Hạng vé" dùng chung. */
export const ticketTypesQueryKey = (orgId: string, eventId: string) =>
  ['event', 'ticket-types', orgId, eventId] as const;

const json = (method: 'POST' | 'PATCH', body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const eventsPath = (orgId: string) => `/orgs/${encodeURIComponent(orgId)}/events`;

export const fetchEvents = (orgId: string, signal?: AbortSignal) =>
  apiRequest(eventsPath(orgId), { schema: EventList, init: { signal } });

export const fetchEvent = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(`${eventsPath(orgId)}/${encodeURIComponent(eventId)}`, { schema: EventDetail, init: { signal } });

/** Tạo Sự kiện nháp (201). Giờ gửi dạng ISO có offset `+07:00`. */
export const createEvent = (orgId: string, body: EventDraftInput) =>
  apiRequest(eventsPath(orgId), { schema: EventDetail, init: json('POST', body) });

/** Sửa Sự kiện (thay toàn bộ các trường thông tin); slug không đổi. */
export const updateEvent = (orgId: string, eventId: string, body: EventDraftInput) =>
  apiRequest(`${eventsPath(orgId)}/${encodeURIComponent(eventId)}`, { schema: EventDetail, init: json('PATCH', body) });

const eventPath = (orgId: string, eventId: string) => `${eventsPath(orgId)}/${encodeURIComponent(eventId)}`;
const ticketTypesPath = (orgId: string, eventId: string) => `${eventPath(orgId, eventId)}/ticket-types`;

export const fetchTicketTypes = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(ticketTypesPath(orgId, eventId), { schema: TicketTypeList, init: { signal } });

/** Tạo Hạng vé (201). Giá là số nguyên đồng; giờ bán dạng ISO `+07:00` hoặc `null`. */
export const createTicketType = (orgId: string, eventId: string, body: TicketTypeInput) =>
  apiRequest(ticketTypesPath(orgId, eventId), { schema: TicketTypeDetail, init: json('POST', body) });

/** Sửa Hạng vé (thay toàn bộ các trường). Số suất dưới đã bán + đang giữ chỗ → `CAPACITY_BELOW_COMMITTED`. */
export const updateTicketType = (orgId: string, eventId: string, ticketTypeId: string, body: TicketTypeInput) =>
  apiRequest(`${ticketTypesPath(orgId, eventId)}/${encodeURIComponent(ticketTypeId)}`, {
    schema: TicketTypeDetail,
    init: json('PATCH', body),
  });

/** 204 No Content. Đã bán hoặc đang giữ chỗ → `TICKET_TYPE_IN_USE`. */
export const deleteTicketType = (orgId: string, eventId: string, ticketTypeId: string) =>
  apiRequest(`${ticketTypesPath(orgId, eventId)}/${encodeURIComponent(ticketTypeId)}`, {
    schema: z.undefined(),
    init: { method: 'DELETE' },
  });

/** Đổi giới hạn Vé/Đơn (1–50); trả lại Sự kiện. */
export const updateOrderLimit = (orgId: string, eventId: string, body: EventOrderLimitInput) =>
  apiRequest(`${eventPath(orgId, eventId)}/order-limit`, { schema: EventDetail, init: json('PATCH', body) });
