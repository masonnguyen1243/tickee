import { z } from 'zod';

import { eventPath } from './event.js';
import { OrderStatus } from './order.js';

// ---------------------------------------------------------------------------------------------------------------
// Kết nối Google Sheets của Sự kiện (FR-32, AD-23, Story 6.4)
// ---------------------------------------------------------------------------------------------------------------

/*
 * Mỗi Sự kiện tối đa một kết nối, tạo ở tab Cài đặt. OAuth riêng với scope `drive.file` (chỉ file do Tickee tạo), tách
 * khỏi đăng nhập Google: `POST …/google-sheets/connect` trả `authorizationUrl` để web chuyển trang; Google điều hướng về
 * `GET /v1/integrations/google-sheets/callback`, callback luôn 302 về tab Cài đặt kèm `?notice=`. Refresh token chỉ nằm
 * trong DB dạng mã hóa, không bao giờ trong response hay log. Worker tạo spreadsheet mới trong Drive của người cấp rồi đẩy
 * Đơn hiện có; đồng bộ một chiều.
 */

/** Scope OAuth duy nhất Tickee xin cho Google Sheets: chỉ đọc/ghi file do chính Tickee tạo (không nhạy cảm). */
export const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** `state` của lượt OAuth hết hạn sau chừng này giây kể từ lúc bấm "Kết nối Google Sheets". */
export const SHEETS_OAUTH_STATE_TTL_SECONDS = 600;

/** Đường callback OAuth (sau `/v1`); redirect URI đăng ký trên Google là `<API_PUBLIC_URL>/v1` + đường này. */
export const GOOGLE_SHEETS_CALLBACK_API_PATH = '/integrations/google-sheets/callback';

/** Redirect URI của OAuth client Google Sheets: `<API_PUBLIC_URL>/v1/integrations/google-sheets/callback`. */
export const googleSheetsRedirectUri = (apiPublicUrl: string): string =>
  `${apiPublicUrl.replace(/\/+$/, '')}/v1${GOOGLE_SHEETS_CALLBACK_API_PATH}`;

/** Đường API (sau `/v1`) của kết nối Google Sheets của một Sự kiện: `GET` (trạng thái) và `DELETE` (ngắt kết nối). */
export const eventGoogleSheetsApiPath = (organizationId: string, eventId: string): string =>
  `/orgs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/google-sheets`;

/** `POST` bắt đầu kết nối: trả `SheetConnectStartResponse`. */
export const eventGoogleSheetsConnectApiPath = (organizationId: string, eventId: string): string =>
  `${eventGoogleSheetsApiPath(organizationId, eventId)}/connect`;

/** Trạng thái kết nối (`sheet_connections.status`). */
export const SheetConnectionStatus = {
  /** Đã tạo Sheet và đẩy xong Đơn hiện có. */
  ACTIVE: 'active',
  /** Vừa kết nối: worker đang tạo Sheet và đẩy Đơn hiện có. */
  SYNCING: 'syncing',
  /** Google lỗi tạm thời hoặc hết quota: worker tự thử lại có backoff (`lastErrorCode`). */
  RETRYING: 'retrying',
  /** Tickee mất quyền ghi (người cấp thu hồi quyền, `invalid_grant`, 401, 403): dừng thử lại. */
  AUTH_REVOKED: 'auth_revoked',
} as const;
export type SheetConnectionStatus = (typeof SheetConnectionStatus)[keyof typeof SheetConnectionStatus];
export const SHEET_CONNECTION_STATUSES = Object.values(SheetConnectionStatus) as [
  SheetConnectionStatus,
  ...SheetConnectionStatus[],
];
export const sheetConnectionStatusSchema = z.enum(SheetConnectionStatus);

/** Chữ của `status-badge` trạng thái kết nối (UX: Đã kết nối · đang đồng bộ · lỗi/thử lại · mất quyền). */
export const SHEET_CONNECTION_STATUS_LABEL: Readonly<Record<SheetConnectionStatus, string>> = {
  [SheetConnectionStatus.ACTIVE]: 'Đã kết nối',
  [SheetConnectionStatus.SYNCING]: 'Đang đồng bộ',
  [SheetConnectionStatus.RETRYING]: 'Lỗi, đang thử lại',
  [SheetConnectionStatus.AUTH_REVOKED]: 'Mất quyền',
};

/** Tone của `status-badge` (trùng `StatusTone` của web; không bao giờ coral). */
export type SheetConnectionTone = 'success' | 'warning' | 'danger' | 'neutral';

export const SHEET_CONNECTION_STATUS_TONE: Readonly<Record<SheetConnectionStatus, SheetConnectionTone>> = {
  [SheetConnectionStatus.ACTIVE]: 'success',
  [SheetConnectionStatus.SYNCING]: 'neutral',
  [SheetConnectionStatus.RETRYING]: 'warning',
  [SheetConnectionStatus.AUTH_REVOKED]: 'danger',
};

/**
 * Mã lỗi gần nhất của kết nối (`sheet_connections.last_error_code`): loại lỗi khi gọi Google, không bao giờ mang body,
 * token hay URL.
 */
export const SheetSyncErrorCode = {
  /** HTTP 429 (quota). */
  RATE_LIMITED: 'rate_limited',
  /** HTTP 5xx. */
  SERVER_ERROR: 'server_error',
  /** Google không trả lời trong thời hạn. */
  TIMEOUT: 'timeout',
  /** Lỗi mạng (DNS, kết nối bị đóng…). */
  NETWORK: 'network',
  /** Refresh token không còn dùng được (người cấp thu hồi quyền, đổi mật khẩu…). */
  INVALID_GRANT: 'invalid_grant',
  /** HTTP 401. */
  UNAUTHORIZED: 'unauthorized',
  /** HTTP 403. */
  FORBIDDEN: 'forbidden',
  /** Phản hồi khác (4xx lạ, JSON sai dạng): worker vẫn thử lại, hết lượt thì vào dead-letter. */
  UNEXPECTED_RESPONSE: 'unexpected_response',
  /**
   * Lỗi cấu hình phía Tickee (Quyết định 4 của Story 6.4), không phải mất quyền: token endpoint trả `invalid_client` /
   * `unauthorized_client`, hoặc Sheets API trả lý do `SERVICE_DISABLED` / `accessNotConfigured` (API chưa bật trong
   * project Google). Worker thử lại có backoff, hết lượt thì vào dead-letter; sửa cấu hình rồi requeue là chạy tiếp.
   */
  CONFIGURATION: 'configuration',
} as const;
export type SheetSyncErrorCode = (typeof SheetSyncErrorCode)[keyof typeof SheetSyncErrorCode];
export const sheetSyncErrorCodeSchema = z.enum(SheetSyncErrorCode);

/** Câu ngắn cho `lastErrorCode` (dòng phụ dưới badge "Lỗi, đang thử lại"). */
export const SHEET_SYNC_ERROR_LABEL: Readonly<Record<SheetSyncErrorCode, string>> = {
  [SheetSyncErrorCode.RATE_LIMITED]: 'Google đang giới hạn số lần ghi.',
  [SheetSyncErrorCode.SERVER_ERROR]: 'Google đang gặp sự cố.',
  [SheetSyncErrorCode.TIMEOUT]: 'Google không phản hồi kịp.',
  [SheetSyncErrorCode.NETWORK]: 'Không kết nối được tới Google.',
  [SheetSyncErrorCode.INVALID_GRANT]: 'Quyền truy cập Google Drive đã bị thu hồi.',
  [SheetSyncErrorCode.UNAUTHORIZED]: 'Quyền truy cập Google Drive không còn hiệu lực.',
  [SheetSyncErrorCode.FORBIDDEN]: 'Google từ chối quyền ghi Sheet.',
  [SheetSyncErrorCode.UNEXPECTED_RESPONSE]: 'Google trả về phản hồi không mong đợi.',
  [SheetSyncErrorCode.CONFIGURATION]: 'Cấu hình Google của Tickee đang lỗi; Tickee sẽ tự thử lại khi đã sửa.',
};

/** ISO 8601 có offset (api trả `…Z`). */
const IsoDateTime = z.iso.datetime({ offset: true });

/**
 * Kết nối Google Sheets của một Sự kiện, như `GET …/google-sheets` trả. Không có token, id nội bộ hay id spreadsheet:
 * - `spreadsheetUrl`: link mở Sheet (tab mới); `null` khi worker chưa tạo xong Sheet;
 * - `lastSyncedAt`: lần đẩy xong gần nhất; `null` khi chưa đẩy xong lần nào;
 * - `lastErrorCode`: lỗi gần nhất khi gọi Google (`retrying`, `auth_revoked`); `null` khi không có;
 * - `connectedByName`: tên người cấp OAuth khi người đó còn trong BTC và có tên; không thì `null`;
 * - `createdAt`: lúc kết nối.
 */
export const EventSheetConnection = z.object({
  status: sheetConnectionStatusSchema,
  spreadsheetUrl: z.url({ protocol: /^https?$/ }).nullable(),
  lastSyncedAt: IsoDateTime.nullable(),
  lastErrorCode: sheetSyncErrorCodeSchema.nullable(),
  connectedByName: z.string().min(1).nullable(),
  createdAt: IsoDateTime,
});
export type EventSheetConnection = z.infer<typeof EventSheetConnection>;

/** `GET /v1/orgs/:orgId/events/:eventId/google-sheets`: `connection: null` khi Sự kiện chưa kết nối. */
export const EventSheetConnectionResponse = z.object({ connection: EventSheetConnection.nullable() });
export type EventSheetConnectionResponse = z.infer<typeof EventSheetConnectionResponse>;

/** `POST …/google-sheets/connect`: URL ủy quyền của Google (web chuyển cả trang tới đây). */
export const SheetConnectStartResponse = z.object({ authorizationUrl: z.url({ protocol: /^https?$/ }) });
export type SheetConnectStartResponse = z.infer<typeof SheetConnectStartResponse>;

/** Mã `?notice=` callback OAuth gắn khi 302 về web (web ánh xạ sang câu toast). */
export const SheetsNotice = {
  CONNECTED: 'sheets-connected',
  DENIED: 'sheets-denied',
  FAILED: 'sheets-failed',
  ALREADY_CONNECTED: 'sheets-already-connected',
} as const;
export type SheetsNotice = (typeof SheetsNotice)[keyof typeof SheetsNotice];

/** Tham số `?tab=` của tab Cài đặt Sự kiện. */
export const EVENT_SETTINGS_TAB = 'cai-dat';

/**
 * Đích 302 của callback OAuth (đường dẫn web, chưa có origin): tab Cài đặt của Sự kiện khi biết Sự kiện
 * (`/btc/<orgId>/su-kien/<eventId>?tab=cai-dat&notice=…`), không thì trang gốc (`/?notice=…`).
 */
export function googleSheetsReturnPath(notice: SheetsNotice, target?: { organizationId: string; eventId: string }): string {
  if (!target) return `/?notice=${notice}`;
  return `${eventPath(target.organizationId, target.eventId)}?tab=${EVENT_SETTINGS_TAB}&notice=${notice}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Sheet do Tickee tạo
// ---------------------------------------------------------------------------------------------------------------

/** Tên spreadsheet mới: "Tickee · <tên Sự kiện>". */
export const googleSheetTitle = (eventName: string): string => `Tickee · ${eventName}`;

/** Tên tab chứa danh sách Đơn. */
export const GOOGLE_SHEET_ORDERS_TAB = 'Đơn';

/** Locale và múi giờ của spreadsheet mới. */
export const GOOGLE_SHEET_LOCALE = 'vi_VN';
export const GOOGLE_SHEET_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Trạng thái Đơn có mặt trên Sheet (Quyết định 1 của Story 6.4): đúng các trạng thái kích hoạt đồng bộ ở 6.5. Đơn
 * `pending` lên Sheet khi chuyển `paid`; Đơn `expired` không bao giờ lên Sheet.
 */
export const GOOGLE_SHEET_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.REVIEW,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];
