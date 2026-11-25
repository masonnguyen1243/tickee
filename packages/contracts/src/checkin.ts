import { z } from 'zod';

import { EventDateTime } from './event.js';
import { EmailAddress } from './identity.js';
import { BuyerPhone } from './order.js';

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
// CTV của Sự kiện: danh sách, thu hồi, khôi phục (FR-26, AD-14, AD-30, Story 5.6)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Owner và Admin (`checkers.manage`) xem CTV đã nhận lời mời của Sự kiện, "Thu hồi" và "Khôi phục". Thu hồi có hiệu lực
 * ở request kế tiếp của CTV (quyền đọc lại ở mỗi request, không cache); CTV bị thu hồi không tự nhận lại bằng link mời.
 * Khôi phục xóa người/lúc thu hồi (lịch sử nằm ở audit) và chỉ được khi Sự kiện chưa kết thúc. Sự kiện lạ, sai dạng hoặc
 * của BTC khác → `404 EVENT_NOT_FOUND`, kiểm trước mọi thứ khác. Mọi response `cache-control: no-store`.
 */

/** Trạng thái của một CTV ở Sự kiện: `active` quét và tra tay được; `revoked` bị Owner/Admin thu hồi. */
export const CheckerStatus = { ACTIVE: 'active', REVOKED: 'revoked' } as const;
export type CheckerStatus = (typeof CheckerStatus)[keyof typeof CheckerStatus];

/** Đường API (sau `/v1`) danh sách CTV của Sự kiện: `GET` (`CheckerList`). */
export const checkersApiPath = (organizationId: string, eventId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/checkers`;

/** Thao tác trên một CTV: "Thu hồi" hoặc "Khôi phục". */
export const CheckerAction = { REVOKE: 'revoke', RESTORE: 'restore' } as const;
export type CheckerAction = (typeof CheckerAction)[keyof typeof CheckerAction];

/** Đường API (sau `/v1`) thu hồi / khôi phục một CTV: `POST`, không body, `204`. */
export const checkerActionApiPath = (
  organizationId: string,
  eventId: string,
  checkerId: string,
  action: CheckerAction,
): string => `${checkersApiPath(organizationId, eventId)}/${encodeURIComponent(checkerId)}/${action}`;

/**
 * Một CTV của Sự kiện. `name`: tên hiển thị của tài khoản (đã trim), không có (tài khoản OTP, hoặc tài khoản không còn)
 * → `null`; `email`: `null` khi tài khoản không còn. `acceptedAt`: lúc nhận lời mời lần đầu. `revokedAt`: lúc bị thu hồi,
 * `null` khi `active` (khôi phục xóa mốc này).
 */
export const CheckerListItem = z.object({
  id: z.uuid(),
  name: z.string().min(1).nullable(),
  email: z.string().nullable(),
  acceptedAt: EventDateTime,
  status: z.enum(CheckerStatus),
  revokedAt: EventDateTime.nullable(),
});
export type CheckerListItem = z.infer<typeof CheckerListItem>;

/**
 * `GET /v1/orgs/:orgId/events/:eventId/checkers` (`checkers.manage`): mọi CTV đã nhận lời mời của Sự kiện, kể cả đã bị
 * thu hồi, sắp theo `acceptedAt` tăng dần (hàng không đổi chỗ khi đổi trạng thái).
 */
export const CheckerList = z.object({ checkers: z.array(CheckerListItem) });
export type CheckerList = z.infer<typeof CheckerList>;

/*
 * `POST /v1/orgs/:orgId/events/:eventId/checkers/:checkerId/{revoke,restore}` (`checkers.manage`, không body, `204`):
 * - CTV đã ở trạng thái đích (kể cả hai người bấm cùng lúc) → `204`, không ghi gì;
 * - `checkerId` sai dạng, lạ hoặc của Sự kiện khác → `404 NOT_FOUND`;
 * - "Khôi phục" khi Sự kiện đã kết thúc (kể cả "Kết thúc" sớm) → `409 EVENT_ALREADY_ENDED`; "Thu hồi" luôn được.
 * Không nhận `Idempotency-Key`: gửi lại luôn ra cùng trạng thái đích.
 */

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
 * - `EVENT_ENDED`: Sự kiện đã kết thúc (đã bấm "Kết thúc", hoặc đồng hồ DB đã tới `effective_end_at`). Từ Story 5.6 chỉ
 *   Owner/Admin còn nhận `invalid EVENT_ENDED`: CTV bị guard chặn trước bằng `403 EVENT_ENDED`.
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

// ---------------------------------------------------------------------------------------------------------------
// Tra tay và check-in tay (FR-29, AD-31, AD-35, Story 5.5)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Khách không mở được Mã QR vé: CTV (hoặc Owner/Admin) tra Vé của Sự kiện theo SĐT hoặc email **đầy đủ** của Người mua
 * (bản chụp trên Đơn lúc đặt, không theo tài khoản hiện tại), rồi check-in tay một Vé. Cả hai route cần `checkin.lookup`.
 * Giá trị đã tra chỉ đi trong body `POST`, không bao giờ trên URL, log, span hay `details` của lỗi.
 */

/** Đường API (sau `/v1`) tra tay: `POST` (`CheckinLookupRequest` → `CheckinLookupResult`). */
export const checkinLookupApiPath = (eventId: string): string =>
  `/checkin/events/${encodeURIComponent(eventId)}/lookups`;

/** Đường API (sau `/v1`) check-in tay một Vé: `POST`, header `Idempotency-Key`, không body (→ `ScanResult`). */
export const checkinManualCheckinApiPath = (eventId: string, ticketId: string): string =>
  `/checkin/events/${encodeURIComponent(eventId)}/tickets/${encodeURIComponent(ticketId)}/check-in`;

/** Ô tra tay dài tối đa chừng này ký tự (email dài nhất 254 ký tự). */
export const CHECKIN_LOOKUP_QUERY_MAX = 254;

/** Giá trị tra tay đã chuẩn hóa: email (trim, chữ thường) hoặc SĐT E.164 (cùng luật với form mua). */
export type LookupQuery = { kind: 'email'; email: string } | { kind: 'phone'; phone: string };

/**
 * Phân loại và chuẩn hóa giá trị tra tay, dùng chung web (chỉ gửi khi nhận ra) và api (kiểm lại). Có `@` → email
 * (`EmailAddress`); còn lại → SĐT (`BuyerPhone`: `0912 345 678`, `+84 912.345.678`… → `+84912345678`). Không đủ dạng
 * (vd. `0912345`, `minh@`) → `null`: không khớp một phần.
 */
export function parseLookupQuery(raw: string): LookupQuery | null {
  if (raw.length > CHECKIN_LOOKUP_QUERY_MAX) return null;
  if (raw.includes('@')) {
    const email = EmailAddress.safeParse(raw);
    return email.success ? { kind: 'email', email: email.data } : null;
  }
  const phone = BuyerPhone.safeParse(raw);
  return phone.success ? { kind: 'phone', phone: phone.data } : null;
}

/** Khóa ổn định của một giá trị tra tay đã chuẩn hóa (cache của web): `email:<email>` hoặc `phone:<E.164>`. */
export const lookupQueryKey = (query: LookupQuery): string =>
  query.kind === 'email' ? `email:${query.email}` : `phone:${query.phone}`;

/**
 * Body `POST /v1/checkin/events/:eventId/lookups` (`checkin.lookup`): `query` là chữ trong ô tra; đầu ra đã phân loại và
 * chuẩn hóa (`parseLookupQuery`). Sai dạng → `400 VALIDATION_FAILED` (không lặp lại giá trị, không tính vào giới hạn).
 */
export const CheckinLookupRequest = z.object({
  query: z
    .string()
    .max(CHECKIN_LOOKUP_QUERY_MAX)
    .transform((raw, ctx) => {
      const parsed = parseLookupQuery(raw);
      if (parsed) return parsed;
      ctx.addIssue({ code: 'custom', message: 'Nhập đủ SĐT hoặc email.' });
      return z.NEVER;
    }),
});
export type CheckinLookupRequest = z.input<typeof CheckinLookupRequest>;

/**
 * Một Vé khớp: chỉ bản chụp trên Vé (tên Người mua, Hạng vé, Vé k/N) và trạng thái check-in. Không bao giờ có Mã QR vé,
 * SĐT hay email.
 */
export const CheckinLookupTicket = z.object({
  ticketId: z.uuid(),
  holderName: z.string(),
  ticketTypeName: z.string(),
  seq: z.number().int().min(1),
  count: z.number().int().min(1),
  checkedIn: z.boolean(),
});
export type CheckinLookupTicket = z.infer<typeof CheckinLookupTicket>;

/**
 * Response `POST /v1/checkin/events/:eventId/lookups` (`200`, `no-store`): Vé `valid` của Sự kiện thuộc các Đơn có SĐT
 * hoặc email Người mua khớp đầy đủ, sắp theo mã Đơn rồi `seq`. Vé đã hủy hay bị vô hiệu không có; không khớp → `[]`.
 */
export const CheckinLookupResult = z.object({ tickets: z.array(CheckinLookupTicket) });
export type CheckinLookupResult = z.infer<typeof CheckinLookupResult>;

/**
 * Giới hạn tốc độ tra tay (AD-31), đếm trong Postgres theo cửa sổ trượt: mỗi lần tra đủ dạng tới server (kể cả không
 * khớp) là một lượt. Theo tài khoản là giới hạn chính; theo IP nới rộng vì WiFi sự kiện hay CGNAT dồn nhiều CTV vào một
 * IP. Check-in tay không bị giới hạn.
 */
export const CHECKIN_LOOKUP_RATE_LIMITS = {
  windowSeconds: 600,
  perUser: 60,
  perIp: 600,
} as const;

/** `details` của `429 CHECKIN_LOOKUP_RATE_LIMITED`: số giây tới khi giới hạn chặn lâu nhất cho tra lại. */
export const CheckinLookupRateLimitedDetails = z.object({ retryAfterSeconds: z.number().int().positive() });
export type CheckinLookupRateLimitedDetails = z.infer<typeof CheckinLookupRateLimitedDetails>;
