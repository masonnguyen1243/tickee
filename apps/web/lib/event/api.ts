import { EventDetail, EventList, type EventDraftInput } from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';

/** Khóa TanStack Query: danh sách Sự kiện của một BTC. */
export const eventsQueryKey = (orgId: string) => ['event', 'list', orgId] as const;
/** Một Sự kiện của BTC (tab Tổng quan, wizard thiết lập). */
export const eventQueryKey = (orgId: string, eventId: string) => ['event', 'detail', orgId, eventId] as const;

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
