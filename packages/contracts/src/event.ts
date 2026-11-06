import { z } from 'zod';

import { organizationDashboardPath } from './organizer.js';

// ---------------------------------------------------------------------------------------------------------------
// Sự kiện (FR-6, Story 2.7): tạo, sửa, đọc Sự kiện nháp
// ---------------------------------------------------------------------------------------------------------------

/**
 * Múi giờ của mọi giờ Sự kiện. Việt Nam không đổi giờ mùa hè từ 1975 nên offset cố định `+07:00`: các hàm dưới đây tính
 * bằng offset này, không phụ thuộc múi giờ của máy chạy (trình duyệt hay server).
 */
export const EVENT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const OFFSET = '+07:00';
const OFFSET_MS = 7 * 60 * 60 * 1000;

/** Trạng thái Sự kiện (`draft` → `published` ↔ `hidden`; `published`/`hidden` → `cancelled`). Story 2.7 chỉ ghi `draft`. */
export const EventStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  HIDDEN: 'hidden',
  CANCELLED: 'cancelled',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];
export const eventStatusSchema = z.enum(EventStatus);

export const EVENT_NAME_MAX = 200;
export const EVENT_VENUE_MAX = 300;
export const EVENT_DESCRIPTION_MAX = 10_000;
export const EVENT_REFUND_POLICY_MAX = 5_000;
/** Phần slug sinh từ tên dài tối đa chừng này ký tự (trước `-` và hậu tố ngẫu nhiên). */
export const EVENT_SLUG_BASE_MAX = 60;
/** Phần slug khi tên không còn ký tự chữ/số nào. */
export const EVENT_SLUG_FALLBACK = 'su-kien';
/** Hậu tố ngẫu nhiên của slug: chừng này ký tự `[a-z0-9]`. */
export const EVENT_SLUG_SUFFIX_LENGTH = 4;
export const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Mốc thời gian ISO 8601 có offset (vd. `2026-11-16T07:00:00+07:00`). */
export const EventDateTime = z.iso.datetime({ offset: true });

/** Năm (theo giờ Việt Nam) của giờ Sự kiện nhận từ người dùng phải trong khoảng này. */
export const EVENT_YEAR_MIN = 2000;
export const EVENT_YEAR_MAX = 2100;

/** `iso` có năm (theo giờ Việt Nam) trong `EVENT_YEAR_MIN`–`EVENT_YEAR_MAX`. Sai dạng → `false`. */
export function isEventYearInRange(iso: string): boolean {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  const year = vnParts(new Date(time)).year;
  return year >= EVENT_YEAR_MIN && year <= EVENT_YEAR_MAX;
}

/**
 * Giờ Sự kiện nhận từ người dùng: ISO có offset, đủ giây và không có phần lẻ của giây (`toEventIso` trả về theo giây,
 * nên client gửi lại giá trị vừa nhận không bị tính là đổi giờ), năm trong 2000–2100 (chặn năm 0–99, mà `Date.UTC` hiểu
 * thành 19xx, và năm 9999, mà `effectiveEndAt` đẩy sang năm 5 chữ số).
 */
export const EventInputDateTime = z.iso.datetime({ offset: true, precision: 0 }).refine(isEventYearInRange, {
  message: `năm phải trong khoảng ${EVENT_YEAR_MIN}–${EVENT_YEAR_MAX}`,
});

/** Ô văn bản tùy chọn: thiếu, `null` hoặc chỉ khoảng trắng → `null`; còn lại bỏ khoảng trắng hai đầu. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * `POST /v1/orgs/:orgId/events` và `PATCH /v1/orgs/:orgId/events/:eventId` (thay toàn bộ các trường dưới đây).
 * Lưu nháp cần tên, giờ bắt đầu và giờ kết thúc (`endsAt` > `startsAt`, lỗi ở `endsAt`); các trường khác để trống được,
 * kể cả chính sách hoàn vé (bắt buộc khi mở bán, Story 2.10).
 */
export const EventDraftInput = z
  .object({
    name: z.string().trim().min(1).max(EVENT_NAME_MAX),
    startsAt: EventInputDateTime,
    endsAt: EventInputDateTime,
    venue: optionalText(EVENT_VENUE_MAX),
    description: optionalText(EVENT_DESCRIPTION_MAX),
    refundPolicy: optionalText(EVENT_REFUND_POLICY_MAX),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    path: ['endsAt'],
    message: 'endsAt phải sau startsAt',
  });
export type EventDraftInput = z.input<typeof EventDraftInput>;

/** Các trường của `EventDraftInput`, theo thứ tự (cũng là tên trường trong `changedFields` của audit `event.updated`). */
export const EVENT_DRAFT_FIELDS = ['name', 'startsAt', 'endsAt', 'venue', 'description', 'refundPolicy'] as const;
export type EventDraftField = (typeof EVENT_DRAFT_FIELDS)[number];

/** Một hàng của danh sách Sự kiện (`event-card`). */
export const EventSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: eventStatusSchema,
  startsAt: EventDateTime,
  endsAt: EventDateTime,
});
export type EventSummary = z.infer<typeof EventSummary>;

/** `GET /v1/orgs/:orgId/events`: Sự kiện mới tạo trước. */
export const EventList = z.array(EventSummary);
export type EventList = z.infer<typeof EventList>;

/** Giới hạn Vé/Đơn của Sự kiện (Story 2.8): mặc định 10, trong khoảng 1–50. */
export const MAX_TICKETS_PER_ORDER_DEFAULT = 10;
export const MAX_TICKETS_PER_ORDER_MIN = 1;
export const MAX_TICKETS_PER_ORDER_MAX = 50;

/** `GET`/`POST`/`PATCH /v1/orgs/:orgId/events[/:eventId]`. */
export const EventDetail = EventSummary.extend({
  organizationId: z.uuid(),
  /** Mốc tự kết thúc (`effectiveEndAt`), tính lại mỗi lần sửa giờ. */
  effectiveEndAt: EventDateTime,
  venue: z.string().nullable(),
  description: z.string().nullable(),
  refundPolicy: z.string().nullable(),
  /** Số Vé tối đa trong một Đơn (Story 2.8). */
  maxTicketsPerOrder: z.number().int(),
  createdAt: EventDateTime,
  updatedAt: EventDateTime,
});
export type EventDetail = z.infer<typeof EventDetail>;

// `PublicEvent` (`GET /v1/events/:slug`) nằm ở `sellability.ts`: nó dùng schema Hạng vé, mà `ticket-type.ts` lại import
// file này.

// ---------------------------------------------------------------------------------------------------------------
// Hàm dùng chung api và web
// ---------------------------------------------------------------------------------------------------------------

/** Lịch (năm, tháng 1–12, ngày, giờ, phút, giây, thứ 0 = Chủ nhật) của `date` theo giờ Việt Nam. */
function vnParts(date: Date) {
  const local = new Date(date.getTime() + OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: local.getUTCDay(),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Mốc tự kết thúc của Sự kiện: muộn hơn trong hai mốc 23:59:59 ngày kết thúc và `endsAt` + 6 giờ, theo giờ
 * `Asia/Ho_Chi_Minh`. Kết thúc 16/11 17:00 → 16/11 23:59:59; kết thúc 16/11 20:00 → 17/11 02:00.
 */
export function effectiveEndAt(endsAt: Date): Date {
  const { year, month, day } = vnParts(endsAt);
  const endOfDay = Date.UTC(year, month - 1, day, 23, 59, 59) - OFFSET_MS;
  return new Date(Math.max(endOfDay, endsAt.getTime() + 6 * 60 * 60 * 1000));
}

/**
 * Phần slug sinh từ tên: bỏ dấu, `đ` → `d`, chữ thường, mỗi cụm ký tự khác chữ/số thành một `-`, tối đa
 * `EVENT_SLUG_BASE_MAX` ký tự; không còn gì thì `su-kien`. "Giải chạy Hà Nội 2026" → `giai-chay-ha-noi-2026`.
 */
export function slugBase(name: string): string {
  const base = name
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, EVENT_SLUG_BASE_MAX)
    .replace(/-+$/, '');
  return base === '' ? EVENT_SLUG_FALLBACK : base;
}

/** `date` dạng ISO 8601 theo giờ Việt Nam, có offset: `2026-11-16T07:00:00+07:00`. */
export function toEventIso(date: Date): string {
  const p = vnParts(date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${OFFSET}`;
}

/**
 * Giá trị `<input type="datetime-local">` (`2026-11-16T07:00`, luôn hiểu theo giờ Việt Nam, không theo múi giờ của
 * máy) → ISO có offset `2026-11-16T07:00:00+07:00`. Chuỗi rỗng hoặc sai dạng → `''`.
 */
export function eventLocalToIso(local: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!match) return '';
  return `${match[1]}T${match[2]}:${match[3] ?? '00'}${OFFSET}`;
}

/** Ngược lại của `eventLocalToIso`: ISO (offset bất kỳ) → `2026-11-16T07:00` theo giờ Việt Nam. Sai dạng → `''`. */
export function eventIsoToLocal(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const p = vnParts(new Date(time));
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'] as const;

/** Ngày-giờ hiển thị theo giờ Việt Nam: "Chủ nhật, 16/11/2026 · 07:00". */
export function formatEventDateTime(iso: string): string {
  const p = vnParts(new Date(iso));
  return `${WEEKDAYS[p.weekday]}, ${pad(p.day)}/${pad(p.month)}/${p.year} · ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Trang con của một Sự kiện trong dashboard (sau `/btc/{id}/su-kien/{eventId}`). */
export type EventSubPath = 'thiet-lap';

/** `/btc/{orgId}/su-kien/{eventId}` (khung tab) hoặc `/btc/{orgId}/su-kien/{eventId}/{sub}`. */
export function eventPath(organizationId: string, eventId: string, sub?: EventSubPath): string {
  const base = `${organizationDashboardPath(organizationId)}/su-kien/${eventId}`;
  return sub ? `${base}/${sub}` : base;
}
