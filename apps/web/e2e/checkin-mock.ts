import type { Page } from '@playwright/test';

import { apiError, corsHeaders, WEB_ORIGIN, type Call, type Handler, type Reply } from './identity-mock';

/*
 * API CTV giả bằng `page.route`: `/v1/checkin/**` (nhận lời mời `POST /checkin/invites/{preview,accept}` và Sự kiện của
 * Màn quét `GET /checkin/events/:eventId`, Story 5.2). Lời gọi không có handler → 500. Trả về danh sách lời gọi để kiểm.
 */

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

/** `CheckinEvent`. */
export const checkinEvent = (eventId: string, eventName: string): Reply => ({ status: 200, body: { eventId, eventName } });

export async function mockCheckinApi(page: Page, handlers: Record<string, Handler> = {}): Promise<Call[]> {
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
      return route.fulfill({
        status: reply.status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: reply.body === undefined ? '' : JSON.stringify(reply.body),
      });
    },
  );
  return calls;
}
