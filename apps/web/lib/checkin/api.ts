import {
  AcceptedCheckerInvite,
  CHECKER_INVITE_ACCEPT_API_PATH,
  CHECKER_INVITE_PREVIEW_API_PATH,
  checkerInviteApiPath,
  CheckerInvitePreview,
  CheckerInviteResponse,
  CheckinEvent,
  checkinEventApiPath,
  CreatedCheckerInvite,
  type CheckerInviteTokenRequest,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';

/** Khóa TanStack Query: link mời CTV mới nhất của một Sự kiện (không có token). */
export const checkerInviteQueryKey = (orgId: string, eventId: string) =>
  ['checkin', 'checker-invite', orgId, eventId] as const;

/**
 * Khóa TanStack Query giữ token của link vừa tạo (`{ inviteId, token }`), chỉ trong bộ nhớ của tab trình duyệt: không
 * `sessionStorage`, không bao giờ gọi mạng (`skipToken`). Chuyển tab trong app vẫn sao chép được; tải lại hay đóng trang
 * thì mất, đăng xuất thì bị xóa cùng cache.
 */
export const checkerInviteTokenQueryKey = (orgId: string, eventId: string) =>
  ['checkin', 'checker-invite-token', orgId, eventId] as const;

/** Token của link vừa tạo, gắn với id link để không bao giờ sao chép token của link đã bị thay. */
export type CheckerInviteToken = { inviteId: string; token: string };

/** `GET /v1/orgs/:orgId/events/:eventId/checker-invite`: link mới nhất (`invite: null` khi chưa có). */
export const fetchCheckerInvite = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(checkerInviteApiPath(orgId, eventId), { schema: CheckerInviteResponse, init: { signal } });

/** `POST …/checker-invite` ("Tạo link mới", không body): link mới kèm token; link cũ hết hiệu lực ngay. */
export const createCheckerInvite = (orgId: string, eventId: string) =>
  apiRequest(checkerInviteApiPath(orgId, eventId), { schema: CreatedCheckerInvite, init: { method: 'POST' } });

// ---------------------------------------------------------------------------------------------------------------
// Nhận lời mời CTV và Màn quét (Story 5.2)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Khóa TanStack Query: xem trước link mời CTV `token` (chỉ trong bộ nhớ của tab). Đăng nhập OTP xong cache bị làm mới,
 * nên quay về `/loi-moi-ctv` thì xem trước tải lại với phiên mới (có `scanEventId` khi đã có quyền quét).
 */
export const checkerInvitePreviewQueryKey = (token: string) => ['checkin', 'invite-preview', token] as const;

/** Khóa TanStack Query: Sự kiện của Màn quét. */
export const checkinEventQueryKey = (eventId: string) => ['checkin', 'event', eventId] as const;

/** Token chỉ đi trong body `POST`, không bao giờ trong đường dẫn hay query. */
const tokenBody = (token: string, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify({ token } satisfies CheckerInviteTokenRequest),
  signal,
});

/**
 * `POST /v1/checkin/invites/preview` (không bắt buộc đăng nhập): tên Sự kiện, tên BTC, và `scanEventId` khi phiên hiện
 * tại đã quét được Sự kiện. Link hỏng → `404 CHECKER_INVITE_INVALID`.
 */
export const previewCheckerInvite = (token: string, signal?: AbortSignal) =>
  apiRequest(CHECKER_INVITE_PREVIEW_API_PATH, { schema: CheckerInvitePreview, init: tokenBody(token, signal) });

/**
 * `POST /v1/checkin/invites/accept` (cần đăng nhập): `{ eventId }` của Màn quét. Link hỏng → `404
 * CHECKER_INVITE_INVALID`; đã bị thu hồi → `403 CHECKER_REVOKED`.
 */
export const acceptCheckerInvite = (token: string) =>
  apiRequest(CHECKER_INVITE_ACCEPT_API_PATH, { schema: AcceptedCheckerInvite, init: tokenBody(token) });

/**
 * `GET /v1/checkin/events/:eventId` (`checkin.scan`): Sự kiện của Màn quét. Không có quyền → `403 NOT_A_MEMBER`; CTV bị
 * thu hồi → `403 CHECKER_REVOKED`.
 */
export const fetchCheckinEvent = (eventId: string, signal?: AbortSignal) =>
  apiRequest(checkinEventApiPath(eventId), { schema: CheckinEvent, init: { signal } });
