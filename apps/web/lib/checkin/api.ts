import { checkerInviteApiPath, CheckerInviteResponse, CreatedCheckerInvite } from '@tickee/contracts';

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
