import type { Page, Request } from '@playwright/test';
import type { CheckinLookupTicket, CheckinTicketTypeProgress } from '@tickee/contracts';

import { apiError, corsHeaders, WEB_ORIGIN, type Call, type Reply } from './identity-mock';

/*
 * API CTV giả bằng `page.route`: `/v1/checkin/**` (nhận lời mời `POST /checkin/invites/{preview,accept}` và Sự kiện của
 * Màn quét `GET /checkin/events/:eventId`, Story 5.2; quét `POST /checkin/events/:eventId/scans`, Story 5.3; tra tay
 * `POST /checkin/events/:eventId/lookups` và check-in tay `POST /checkin/events/:eventId/tickets/:ticketId/check-in`,
 * Story 5.5 — handler đọc header `Idempotency-Key` bằng `request.headers()`; hết quyền `403 CHECKER_REVOKED` / `403
 * EVENT_ENDED`, Story 5.6). Mặc định SSE số liệu check-in `GET /checkin/events/:eventId/live` (Story 5.7) → 503 (không
 * realtime: polling 10 giây; spec cần realtime dùng `fakeEventSource`). Lời gọi khác
 * không có handler → 500; handler trả `'abort'` → lỗi mạng (không có phản hồi). Handler treo quá hạn 3 giây của client
 * (Story 5.4): client đã hủy request nên trả lời sau đó có thể ném; bỏ qua lỗi đó. Trả về danh sách lời gọi để kiểm.
 */

/** Handler của API CTV giả: một phản hồi, hoặc `'abort'` để giả lỗi mạng. */
export type CheckinHandler = (request: Request) => Reply | 'abort' | Promise<Reply | 'abort'>;

const CHECKIN_PATH = /\/v1\/checkin\//;
const CHECKIN_EVENT_LIVE_KEY = /^GET \/checkin\/events\/[^/]+\/live$/;

/** Đường SSE số liệu check-in (Story 5.7), để `fakeEventSource` chọn đúng stream. */
export const CHECKIN_LIVE_URL = /\/v1\/checkin\/events\/[^/]+\/live$/;

/** Trang đã cài API CTV giả. */
const mockedPages = new WeakSet<Page>();

/**
 * Trang đã cài `mockCheckinApi`: `mockOrganizerApi` nhường mọi `/v1/checkin/**` cho API CTV giả, bất kể cài trước hay
 * sau (mặc định số liệu check-in của tab Check-in, Story 5.7, không đè handler của spec).
 */
export const hasCheckinMock = (page: Page): boolean => mockedPages.has(page);

/** Lỗi kèm câu của api thật (màn hiện nguyên câu này). */
export const checkinError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message, details: null } },
});

/** Câu của api cho `403 NOT_A_MEMBER` ở route CTV. */
export const NOT_A_MEMBER_MESSAGE = 'Bạn không có quyền soát vé cho Sự kiện này.';
/** Câu của api cho `403 CHECKER_REVOKED`. */
export const CHECKER_REVOKED_MESSAGE = 'Bạn không còn quyền soát vé cho Sự kiện này.';
/** Câu của api cho `404 CHECKER_INVITE_INVALID`. */
export const CHECKER_INVITE_INVALID_MESSAGE = 'Link mời đã hết hạn. Liên hệ BTC để nhận link mới.';

/** Câu của api cho `403 EVENT_ENDED` (CTV khi Sự kiện đã kết thúc, Story 5.6): cùng câu với `CHECKER_REVOKED`. */
export const EVENT_ENDED_MESSAGE = 'Bạn không còn quyền soát vé cho Sự kiện này.';
/** Dòng mô tả thêm của màn hết quyền khi lý do là `EVENT_ENDED`. */
export const EVENT_ENDED_NOTE = 'Sự kiện đã kết thúc.';

export const notAMember = (): Reply => checkinError(403, 'NOT_A_MEMBER', NOT_A_MEMBER_MESSAGE);
export const checkerRevoked = (): Reply => checkinError(403, 'CHECKER_REVOKED', CHECKER_REVOKED_MESSAGE);
export const eventEnded = (): Reply => checkinError(403, 'EVENT_ENDED', EVENT_ENDED_MESSAGE);
export const inviteInvalid = (): Reply => checkinError(404, 'CHECKER_INVITE_INVALID', CHECKER_INVITE_INVALID_MESSAGE);

/** `CheckerInvitePreview`. */
export const invitePreview = (eventName: string, organizationName: string, scanEventId: string | null = null): Reply => ({
  status: 200,
  body: { eventName, organizationName, scanEventId },
});

/** Số check-in của một Hạng vé (`CheckinTicketTypeProgress`, Story 5.7). */
export type TicketTypeProgress = CheckinTicketTypeProgress;

/**
 * `CheckinEvent`: mặc định chưa có Vé nào (số đã check-in / tổng Vé hợp lệ của Story 5.3) và chưa có Hạng vé nào (Story
 * 5.7; Màn quét không hiện số theo Hạng vé).
 */
export const checkinEvent = (
  eventId: string,
  eventName: string,
  counts: { checkedInCount: number; validTicketCount: number } = { checkedInCount: 0, validTicketCount: 0 },
  ticketTypes: TicketTypeProgress[] = [],
): Reply => ({ status: 200, body: { eventId, eventName, ...counts, ticketTypes } });

/** `ScanResult` `200` của `POST /checkin/events/:eventId/scans` (và của check-in tay). */
export const scanResult = (body: Record<string, unknown>): Reply => ({ status: 200, body });

/** Một Vé của kết quả tra tay. */
export type LookupTicket = CheckinLookupTicket;

/** `CheckinLookupResult` `200` của `POST /checkin/events/:eventId/lookups`. */
export const lookupResult = (tickets: LookupTicket[]): Reply => ({ status: 200, body: { tickets } });

/** `429 CHECKIN_LOOKUP_RATE_LIMITED` kèm `retryAfterSeconds`. */
export const lookupRateLimited = (retryAfterSeconds: number): Reply => ({
  status: 429,
  body: {
    error: {
      code: 'CHECKIN_LOOKUP_RATE_LIMITED',
      message: 'Tra quá nhiều lần. Vui lòng thử lại sau.',
      details: { retryAfterSeconds },
    },
  },
});

export async function mockCheckinApi(page: Page, handlers: Record<string, CheckinHandler> = {}): Promise<Call[]> {
  const calls: Call[] = [];
  const cors = corsHeaders(WEB_ORIGIN);
  mockedPages.add(page);
  await page.route(
    (url) => CHECKIN_PATH.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const path = new URL(request.url()).pathname.replace(/^.*\/v1/, '');
      const key = `${request.method()} ${path}`;
      calls.push({ method: request.method(), path, body: request.postDataJSON() as unknown });
      const fallback = CHECKIN_EVENT_LIVE_KEY.test(key) ? () => apiError(503, 'SERVICE_UNAVAILABLE') : undefined;
      const handler = handlers[key] ?? fallback;
      const reply = handler ? await handler(request) : apiError(500, 'INTERNAL_ERROR');
      try {
        if (reply === 'abort') return await route.abort('failed');
        return await route.fulfill({
          status: reply.status,
          headers: { ...cors, 'content-type': 'application/json' },
          body: reply.body === undefined ? '' : JSON.stringify(reply.body),
        });
      } catch {
        // Client đã hủy request (hết hạn 3 giây, rời trang) trong lúc handler còn chờ: không còn ai nhận phản hồi.
      }
    },
  );
  return calls;
}
