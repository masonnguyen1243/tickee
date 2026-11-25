import {
  AcceptedCheckerInvite,
  CHECKER_INVITE_ACCEPT_API_PATH,
  CHECKER_INVITE_PREVIEW_API_PATH,
  checkerInviteApiPath,
  CheckerInvitePreview,
  CheckerInviteResponse,
  CheckinEvent,
  checkinEventApiPath,
  CheckinLookupResult,
  checkinLookupApiPath,
  checkinManualCheckinApiPath,
  checkinScanApiPath,
  CreatedCheckerInvite,
  IDEMPOTENCY_KEY_HEADER,
  lookupQueryKey,
  ScanResult,
  type CheckerInviteTokenRequest,
  type CheckinLookupRequest,
  type LookupQuery,
  type ScanRequest,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';
import { serviceUnavailableError } from '@/lib/api/errors';

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

/** Hạn chờ của mỗi lần gửi quét (kể cả gửi lại): quá hạn thì hủy request và coi như lỗi mạng (Story 5.4, UX-DR31). */
export const SCAN_TIMEOUT_MS = 3000;

/**
 * Gọi `request` với một `signal` có hạn `SCAN_TIMEOUT_MS`: chưa xong (kể cả lúc đang đọc body) thì hủy request và ném
 * `serviceUnavailableError` (`isNetworkError`), để nơi gọi gửi lại (cùng `scanId` / `Idempotency-Key`). `AbortController`
 * + `setTimeout`, không `AbortSignal.timeout` (thiếu ở iOS 15); timer luôn được xóa. `signal` của nơi gọi (vd. rời Màn
 * quét, TanStack Query hủy) hủy theo kiểu thường: ném lại nguyên trạng, không phải lỗi mạng.
 */
async function withScanTimeout<T>(
  signal: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SCAN_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    return await request(controller.signal);
  } catch (error) {
    if (timedOut) throw serviceUnavailableError(error);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * `POST /v1/checkin/events/:eventId/scans` (`checkin.scan`, Story 5.3): chuỗi camera vừa đọc (`code`) và `scanId` của
 * lần đọc này → `ScanResult` (xanh / trung tính / đỏ). Không có quyền → `403 NOT_A_MEMBER`; CTV bị thu hồi → `403
 * CHECKER_REVOKED`. `code` chỉ đi trong body, không bao giờ trong đường dẫn, query hay log. Mỗi lần gọi có hạn
 * `SCAN_TIMEOUT_MS` (Story 5.4, `withScanTimeout`), để nơi gọi gửi lại cùng `scanId`.
 */
export const submitScan = (eventId: string, body: ScanRequest, signal?: AbortSignal) =>
  withScanTimeout(signal, (timed) =>
    apiRequest(checkinScanApiPath(eventId), {
      schema: ScanResult,
      init: { method: 'POST', body: JSON.stringify(body), signal: timed },
    }),
  );

// ---------------------------------------------------------------------------------------------------------------
// Tra tay và check-in tay (Story 5.5)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Khóa TanStack Query: kết quả tra tay của một giá trị đã chuẩn hóa (`lookupQueryKey`: `phone:+84…` / `email:…`), nên mọi
 * cách gõ cùng một SĐT/email dùng chung một kết quả trong bộ nhớ của tab.
 */
export const checkinLookupQueryKey = (eventId: string, query: LookupQuery) =>
  [...checkinLookupQueryPrefix(eventId), lookupQueryKey(query)] as const;

/** Tiền tố khóa của mọi kết quả tra tay của một Sự kiện ("Tra tay" mở mới thì xóa hết). */
export const checkinLookupQueryPrefix = (eventId: string) => ['checkin', 'lookup', eventId] as const;

/** Giá trị gửi lên api: dạng đã chuẩn hóa (email chữ thường, SĐT E.164); api kiểm lại bằng cùng `parseLookupQuery`. */
const lookupValue = (query: LookupQuery): string => (query.kind === 'email' ? query.email : query.phone);

/**
 * `POST /v1/checkin/events/:eventId/lookups` (`checkin.lookup`): Vé hợp lệ của Sự kiện có SĐT/email Người mua khớp đầy
 * đủ. Giá trị tra chỉ đi trong body, không bao giờ trên URL. Vượt giới hạn → `429 CHECKIN_LOOKUP_RATE_LIMITED`
 * (`details.retryAfterSeconds`); không có quyền → `403 NOT_A_MEMBER` / `CHECKER_REVOKED`. Hạn `SCAN_TIMEOUT_MS` như khi
 * quét: quá hạn là lỗi mạng (dải lỗi kèm "Thử lại").
 */
export const lookupCheckinTickets = (eventId: string, query: LookupQuery, signal?: AbortSignal) =>
  withScanTimeout(signal, (timed) =>
    apiRequest(checkinLookupApiPath(eventId), {
      schema: CheckinLookupResult,
      init: {
        method: 'POST',
        body: JSON.stringify({ query: lookupValue(query) } satisfies CheckinLookupRequest),
        signal: timed,
      },
    }),
  );

/**
 * `POST /v1/checkin/events/:eventId/tickets/:ticketId/check-in` (`checkin.lookup`) với header `Idempotency-Key`: nơi gọi
 * sinh một khóa mỗi lượt bấm và giữ nguyên khi bấm lại sau lỗi mạng hay 5xx (api phát lại kết quả lần đầu) → `ScanResult`
 * như khi quét. Hạn `SCAN_TIMEOUT_MS` như khi quét: quá hạn là lỗi mạng, bấm lại dùng cùng khóa.
 */
export const checkInManually = (eventId: string, ticketId: string, idempotencyKey: string, signal?: AbortSignal) =>
  withScanTimeout(signal, (timed) =>
    apiRequest(checkinManualCheckinApiPath(eventId, ticketId), {
      schema: ScanResult,
      init: { method: 'POST', headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }, signal: timed },
    }),
  );
