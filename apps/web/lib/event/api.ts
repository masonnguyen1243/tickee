import {
  EventDetail,
  EventForm,
  EventList,
  FormQuestion,
  PublishReadiness,
  TicketTypeDetail,
  TicketTypeList,
  type EventDraftInput,
  type EventOrderLimitInput,
  type FormOrderInput,
  type FormQuestionInput,
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
/** Câu hỏi riêng của form mua: wizard bước 3–4 và tab "Form mua" dùng chung. */
export const eventFormQueryKey = (orgId: string, eventId: string) => ['event', 'form', orgId, eventId] as const;
/** Điều kiện mở bán của một Sự kiện (wizard bước 4). */
export const eventReadinessQueryKey = (orgId: string, eventId: string) =>
  ['event', 'publish-readiness', orgId, eventId] as const;

const json = (method: 'POST' | 'PATCH' | 'PUT', body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
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

const formPath = (orgId: string, eventId: string) => `${eventPath(orgId, eventId)}/form`;
const questionPath = (orgId: string, eventId: string, questionId: string) =>
  `${formPath(orgId, eventId)}/questions/${encodeURIComponent(questionId)}`;

/** Câu hỏi riêng theo thứ tự (trường mặc định cố định, không có ở đây). */
export const fetchEventForm = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(formPath(orgId, eventId), { schema: EventForm, init: { signal } });

/** Thêm câu hỏi vào cuối form (201). Sự kiện đã đủ 20 câu → `FORM_QUESTION_LIMIT_REACHED`. */
export const addFormQuestion = (orgId: string, eventId: string, body: FormQuestionInput) =>
  apiRequest(`${formPath(orgId, eventId)}/questions`, { schema: FormQuestion, init: json('POST', body) });

/** Sửa câu hỏi (thay toàn bộ các trường). Phương án có `id` giữ id; phương án mới không gửi `id`. */
export const updateFormQuestion = (orgId: string, eventId: string, questionId: string, body: FormQuestionInput) =>
  apiRequest(questionPath(orgId, eventId, questionId), { schema: FormQuestion, init: json('PATCH', body) });

/** 204 No Content. */
export const deleteFormQuestion = (orgId: string, eventId: string, questionId: string) =>
  apiRequest(questionPath(orgId, eventId, questionId), { schema: z.undefined(), init: { method: 'DELETE' } });

/** Sắp thứ tự: đúng tập id câu hỏi hiện có theo thứ tự mới; trả form sau khi sắp. */
export const reorderFormQuestions = (orgId: string, eventId: string, body: FormOrderInput) =>
  apiRequest(`${formPath(orgId, eventId)}/order`, { schema: EventForm, init: json('PUT', body) });

/** Điều kiện mở bán: chỉ các mã áp dụng cho Sự kiện, kèm đạt hay chưa (luật nằm ở server). */
export const fetchPublishReadiness = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(`${eventPath(orgId, eventId)}/publish-readiness`, { schema: PublishReadiness, init: { signal } });

/**
 * Mở bán (không body): trả Sự kiện đã `published`. Còn điều kiện chưa đạt → `EVENT_NOT_READY` (`details.unmet`); không
 * còn nháp → `EVENT_NOT_DRAFT`.
 */
export const publishEvent = (orgId: string, eventId: string) =>
  apiRequest(`${eventPath(orgId, eventId)}/publish`, { schema: EventDetail, init: { method: 'POST' } });

/**
 * Ẩn (không body): `published` → `hidden`. Sai trạng thái → `EVENT_STATUS_CONFLICT` (`details.status`); đã kết thúc
 * (`effective_end_at <= now`) → `EVENT_ALREADY_ENDED`.
 */
export const hideEvent = (orgId: string, eventId: string) =>
  apiRequest(`${eventPath(orgId, eventId)}/hide`, { schema: EventDetail, init: { method: 'POST' } });

/**
 * Hiện lại (không body): `hidden` → `published`. Sai trạng thái → `EVENT_STATUS_CONFLICT`; đã kết thúc
 * (`effective_end_at <= now`) → `EVENT_ALREADY_ENDED`.
 */
export const unhideEvent = (orgId: string, eventId: string) =>
  apiRequest(`${eventPath(orgId, eventId)}/unhide`, { schema: EventDetail, init: { method: 'POST' } });

/**
 * Kết thúc sớm (không body, không hoàn tác): `endedManuallyAt` = `effectiveEndAt` = lúc bấm. Đã kết thúc →
 * `EVENT_ALREADY_ENDED`; chưa bắt đầu → `EVENT_NOT_STARTED`; nháp/đã hủy → `EVENT_STATUS_CONFLICT`.
 */
export const endEvent = (orgId: string, eventId: string) =>
  apiRequest(`${eventPath(orgId, eventId)}/end`, { schema: EventDetail, init: { method: 'POST' } });
