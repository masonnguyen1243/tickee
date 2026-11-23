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

// ---------------------------------------------------------------------------------------------------------------
// Nhận lời mời CTV và Màn quét (FR-26, FR-29, AD-26, AD-30, Story 5.2)
// ---------------------------------------------------------------------------------------------------------------

/** Màn quét của một Sự kiện trên web (route group `(checkin)`): `/events/<eventId>`. */
export const checkinScanPath = (eventId: string): string => `/events/${encodeURIComponent(eventId)}`;

/** Đường API (sau `/v1`) xem trước link mời CTV: `POST`, token trong body. */
export const CHECKER_INVITE_PREVIEW_API_PATH = '/checkin/invites/preview';

/** Đường API (sau `/v1`) nhận lời mời CTV: `POST`, token trong body. */
export const CHECKER_INVITE_ACCEPT_API_PATH = '/checkin/invites/accept';

/** Đường API (sau `/v1`) của Sự kiện trên Màn quét: `GET` (`CheckinEvent`). */
export const checkinEventApiPath = (eventId: string): string => `/checkin/events/${encodeURIComponent(eventId)}`;

/*
 * Link mời còn hiệu lực khi: chưa thu hồi, đồng hồ DB còn trước min(`expires_at`, `effective_end_at`), Sự kiện chưa hủy
 * và chưa bấm "Kết thúc" (cùng luật với `CheckerInvite.active`). Mọi lỗi về link là `404 CHECKER_INVITE_INVALID`, không
 * lộ tên Sự kiện. Cả hai route trả `cache-control: no-store`.
 */

/**
 * Body `POST /v1/checkin/invites/preview` và `POST /v1/checkin/invites/accept`. Token chỉ đi trong body, không bao giờ
 * trong đường dẫn hay query. Chuỗi 1–256 ký tự; token đúng độ dài mà sai dạng (không khớp `CHECKER_INVITE_TOKEN_PATTERN`)
 * xử lý như token sai (`404 CHECKER_INVITE_INVALID`).
 */
export const CheckerInviteTokenRequest = z.object({ token: z.string().min(1).max(256) });
export type CheckerInviteTokenRequest = z.input<typeof CheckerInviteTokenRequest>;

/**
 * `POST /v1/checkin/invites/preview` (không bắt buộc đăng nhập): tên Sự kiện và tên BTC của link. `scanEventId`: id Sự
 * kiện khi người xem đã đăng nhập và đã có quyền quét (CTV `active`, hoặc Owner/Admin của BTC sở hữu), kể cả khi link đã
 * hết hiệu lực (mở lại link để quay lại Màn quét); còn lại `null`.
 */
export const CheckerInvitePreview = z.object({
  eventName: z.string(),
  organizationName: z.string(),
  scanEventId: z.uuid().nullable(),
});
export type CheckerInvitePreview = z.infer<typeof CheckerInvitePreview>;

/**
 * `POST /v1/checkin/invites/accept` (cần đăng nhập): tài khoản đang đăng nhập quét được Sự kiện `eventId`. Nhận lại khi
 * đã là CTV `active`, hoặc là Owner/Admin, trả cùng kết quả mà không ghi gì. Đã bị thu hồi → `403 CHECKER_REVOKED`.
 */
export const AcceptedCheckerInvite = z.object({ eventId: z.uuid() });
export type AcceptedCheckerInvite = z.infer<typeof AcceptedCheckerInvite>;

/**
 * `GET /v1/checkin/events/:eventId` (`checkin.scan`): Sự kiện của Màn quét, kèm số Vé đã check-in trên tổng số Vé hợp lệ
 * (Story 5.3). Cả hai chỉ đếm Vé `valid` của Sự kiện (Vé đã hủy hay bị vô hiệu không tính, kể cả khi đã check-in);
 * `checkedInCount` đếm thêm điều kiện đã check-in.
 */
export const CheckinEvent = z.object({
  eventId: z.uuid(),
  eventName: z.string(),
  checkedInCount: z.number().int().min(0),
  validTicketCount: z.number().int().min(0),
});
export type CheckinEvent = z.infer<typeof CheckinEvent>;

// ---------------------------------------------------------------------------------------------------------------
// Quét Mã QR vé (FR-27, FR-28, AD-15, AD-16, Story 5.3)
// ---------------------------------------------------------------------------------------------------------------

/** Đường API (sau `/v1`) quét Mã QR vé của Màn quét: `POST` (`ScanRequest` → `ScanResult`). */
export const checkinScanApiPath = (eventId: string): string =>
  `/checkin/events/${encodeURIComponent(eventId)}/scans`;

/** Độ dài tối đa của chuỗi đọc được từ mã QR (Mã QR vé thật ngắn hơn nhiều; dài hơn → `400`). */
export const SCAN_CODE_MAX = 512;

/**
 * Body `POST /v1/checkin/events/:eventId/scans` (`checkin.scan`): `code` là chuỗi camera đọc được (1–`SCAN_CODE_MAX` ký
 * tự; không kiểm dạng ở đây: sai dạng là `invalid BAD_SIGNATURE`), `scanId` là uuid client sinh cho mỗi lần đọc. Gửi lại
 * cùng `scanId` (mất phản hồi) bằng cùng tài khoản nhận lại kết quả xanh của lần đầu. Sai schema → `400
 * VALIDATION_FAILED`.
 */
export const ScanRequest = z.object({ code: z.string().min(1).max(SCAN_CODE_MAX), scanId: z.uuid() });
export type ScanRequest = z.infer<typeof ScanRequest>;

/** Kết quả một lần quét: xanh, trung tính (cùng người vừa quét Vé này), đỏ đã check-in, đỏ Vé không hợp lệ. */
export const ScanOutcome = {
  OK: 'ok',
  RECENT: 'recent',
  ALREADY: 'already',
  INVALID: 'invalid',
} as const;
export type ScanOutcome = (typeof ScanOutcome)[keyof typeof ScanOutcome];

/**
 * Lý do "Vé không hợp lệ":
 * - `BAD_SIGNATURE`: mã sai dạng, sai chữ ký, khóa `k` lạ, hoặc chữ ký đúng mà không có Vé;
 * - `CANCELLED`: Vé đã hủy, hoặc Sự kiện đã hủy;
 * - `VOIDED`: Vé bị vô hiệu (`cancel_reason = 'voided'`);
 * - `OTHER_EVENT`: Vé của Sự kiện khác (cùng hoặc khác BTC; không lộ gì thêm);
 * - `EVENT_ENDED`: Sự kiện đã kết thúc (đã bấm "Kết thúc", hoặc đồng hồ DB đã tới `effective_end_at`).
 * `EXPIRED` và `CHECKER_REVOKED` của AD-15 không có ở đây: Vé hết hiệu lực đúng lúc Sự kiện kết thúc (trùng
 * `EVENT_ENDED`), còn CTV bị thu hồi nhận `403 CHECKER_REVOKED` từ guard.
 */
export const ScanInvalidReason = {
  BAD_SIGNATURE: 'BAD_SIGNATURE',
  CANCELLED: 'CANCELLED',
  VOIDED: 'VOIDED',
  OTHER_EVENT: 'OTHER_EVENT',
  EVENT_ENDED: 'EVENT_ENDED',
} as const;
export type ScanInvalidReason = (typeof ScanInvalidReason)[keyof typeof ScanInvalidReason];
export const scanInvalidReasonSchema = z.enum(ScanInvalidReason);

/** Vai của người quét trước khi không có tên: Owner, Admin của BTC, hoặc CTV (không phải thành viên BTC). */
export const ScanCheckerRole = { OWNER: 'owner', ADMIN: 'admin', CHECKER: 'checker' } as const;
export type ScanCheckerRole = (typeof ScanCheckerRole)[keyof typeof ScanCheckerRole];

/**
 * Người đã check-in Vé (kết quả `already`), không bao giờ là email: chính người đang quét → `self` ("bạn"); có tên (tài
 * khoản Google, đã trim) → `name`; còn lại → vai trong BTC, hoặc `checker` khi không phải thành viên ("CTV khác").
 */
export const ScanCheckedBy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('name'), name: z.string().min(1) }),
  z.object({ kind: z.literal('role'), role: z.enum(ScanCheckerRole) }),
]);
export type ScanCheckedBy = z.infer<typeof ScanCheckedBy>;

/**
 * Response `POST /v1/checkin/events/:eventId/scans` (`200`, `no-store`), union theo `outcome`:
 * - `ok`: tên Người mua · Vé k/N (`seq`/`count`) · Hạng vé, từ bản chụp trên Vé;
 * - `recent`: cùng người quét đã check-in Vé này chưa tới 60 giây (trung tính, không đỏ);
 * - `already`: đã check-in lúc `checkedInAt` bởi `checkedBy`;
 * - `invalid`: Vé không hợp lệ kèm `reason`.
 * Không bao giờ chứa Mã QR vé, SĐT hay email.
 */
export const ScanResult = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal(ScanOutcome.OK),
    holderName: z.string(),
    seq: z.number().int().min(1),
    count: z.number().int().min(1),
    ticketTypeName: z.string(),
  }),
  z.object({ outcome: z.literal(ScanOutcome.RECENT) }),
  z.object({ outcome: z.literal(ScanOutcome.ALREADY), checkedInAt: EventDateTime, checkedBy: ScanCheckedBy }),
  z.object({ outcome: z.literal(ScanOutcome.INVALID), reason: scanInvalidReasonSchema }),
]);
export type ScanResult = z.infer<typeof ScanResult>;
