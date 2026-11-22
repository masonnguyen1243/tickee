import { z } from 'zod';

import { EventDateTime } from './event.js';

// ---------------------------------------------------------------------------------------------------------------
// Link mời CTV (FR-26, AD-30, Story 5.1)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Mỗi Sự kiện có một link mời CTV chung: `{WEB_ORIGIN}/loi-moi-ctv#<token>`. Token 128 bit ngẫu nhiên (base64url 22 ký
 * tự), DB chỉ lưu SHA-256 hex; token chỉ có trong response `POST` lúc tạo, không bao giờ trong `GET`, audit hay log. Token
 * nằm sau `#` nên không tới server web. "Tạo link mới" thu hồi link cũ ngay trong cùng transaction (không có lệnh thu hồi
 * riêng). Hạn link = min(lúc tạo + `CHECKER_INVITE_TTL_DAYS` ngày, `effective_end_at` của Sự kiện).
 */

/** Màn nhận lời mời CTV của web (Story 5.2); token sau `#`, như `/loi-moi-btc`. */
export const CHECKER_INVITE_PATH = '/loi-moi-ctv';

/** Link mời CTV hết hạn sau chừng này ngày kể từ lúc tạo, hoặc sớm hơn ở `effective_end_at` của Sự kiện (AD-30). */
export const CHECKER_INVITE_TTL_DAYS = 7;

/** Token link mời CTV: 16 byte, base64url không đệm (22 ký tự). */
export const CHECKER_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Link mời CTV: `{webOrigin}/loi-moi-ctv#<token>` (bỏ `/` thừa ở cuối origin). */
export const checkerInviteUrl = (webOrigin: string, token: string): string =>
  `${webOrigin.replace(/\/+$/, '')}${CHECKER_INVITE_PATH}#${token}`;

/** Đường API (sau `/v1`) của link mời CTV: `GET` (link mới nhất) và `POST` ("Tạo link mới"). */
export const checkerInviteApiPath = (organizationId: string, eventId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/checker-invite`;

/**
 * Một link mời CTV (không có token). `expiresAt` = min(hạn lưu lúc tạo, `effective_end_at` hiện tại của Sự kiện), nên
 * "Kết thúc" sớm sau khi tạo link kéo hạn về lúc kết thúc. `active`: chưa bị thu hồi, đồng hồ DB còn trước `expiresAt`
 * và Sự kiện chưa hủy (api tính bằng `now()` của DB).
 */
export const CheckerInvite = z.object({
  id: z.uuid(),
  createdAt: EventDateTime,
  expiresAt: EventDateTime,
  active: z.boolean(),
});
export type CheckerInvite = z.infer<typeof CheckerInvite>;

/** `GET /v1/orgs/:orgId/events/:eventId/checker-invite` (`checkers.manage`): link mới nhất, chưa có thì `null`. */
export const CheckerInviteResponse = z.object({ invite: CheckerInvite.nullable() });
export type CheckerInviteResponse = z.infer<typeof CheckerInviteResponse>;

/**
 * `POST /v1/orgs/:orgId/events/:eventId/checker-invite` (`checkers.manage`, không body, `201`): link mới kèm token, lần
 * duy nhất token rời server. Link cũ (nếu có) hết hiệu lực ngay. Sự kiện nháp → `409 EVENT_STATUS_CONFLICT`
 * (`details.status`); đã hủy → `409 EVENT_CANCELLED`; đã kết thúc (kể cả "Kết thúc" sớm) → `409 EVENT_ALREADY_ENDED`.
 */
export const CreatedCheckerInvite = z.object({
  invite: CheckerInvite,
  token: z.string().regex(CHECKER_INVITE_TOKEN_PATTERN),
});
export type CreatedCheckerInvite = z.infer<typeof CreatedCheckerInvite>;
