import type { Page, Request } from '@playwright/test';
import type { CheckinLookupTicket } from '@tickee/contracts';

import { apiError, corsHeaders, WEB_ORIGIN, type Call, type Reply } from './identity-mock';

/*
 * API CTV giả bằng `page.route`: `/v1/checkin/**` (nhận lời mời `POST /checkin/invites/{preview,accept}` và Sự kiện của
 * Màn quét `GET /checkin/events/:eventId`, Story 5.2; quét `POST /checkin/events/:eventId/scans`, Story 5.3; tra tay
 * `POST /checkin/events/:eventId/lookups` và check-in tay `POST /checkin/events/:eventId/tickets/:ticketId/check-in`,
 * Story 5.5 — handler đọc header `Idempotency-Key` bằng `request.headers()`). Lời gọi
 * không có handler → 500; handler trả `'abort'` → lỗi mạng (không có phản hồi). Handler treo quá hạn 3 giây của client
 * (Story 5.4): client đã hủy request nên trả lời sau đó có thể ném; bỏ qua lỗi đó. Trả về danh sách lời gọi để kiểm.
 */

/** Handler của API CTV giả: một phản hồi, hoặc `'abort'` để giả lỗi mạng. */
export type CheckinHandler = (request: Request) => Reply | 'abort' | Promise<Reply | 'abort'>;

const CHECKIN_PATH = /\/v1\/checkin\//;

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

export const notAMember = (): Reply => checkinError(403, 'NOT_A_MEMBER', NOT_A_MEMBER_MESSAGE);
export const checkerRevoked = (): Reply => checkinError(403, 'CHECKER_REVOKED', CHECKER_REVOKED_MESSAGE);
export const inviteInvalid = (): Reply => checkinError(404, 'CHECKER_INVITE_INVALID', CHECKER_INVITE_INVALID_MESSAGE);

/** `CheckerInvitePreview`. */
export const invitePreview = (eventName: string, organizationName: string, scanEventId: string | null = null): Reply => ({
  status: 200,
  body: { eventName, organizationName, scanEventId },
});

/** `CheckinEvent`: mặc định chưa có Vé nào (số đã check-in / tổng Vé hợp lệ của Story 5.3). */
export const checkinEvent = (
  eventId: string,
  eventName: string,
  counts: { checkedInCount: number; validTicketCount: number } = { checkedInCount: 0, validTicketCount: 0 },
): Reply => ({ status: 200, body: { eventId, eventName, ...counts } });

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
  await page.route(
    (url) => CHECKIN_PATH.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const path = new URL(request.url()).pathname.replace(/^.*\/v1/, '');
      const key = `${request.method()} ${path}`;
      calls.push({ method: request.method(), path, body: request.postDataJSON() as unknown });
      const handler = handlers[key];
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
