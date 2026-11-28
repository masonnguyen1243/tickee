import {
  eventGoogleSheetsApiPath,
  eventGoogleSheetsConnectApiPath,
  EventSheetConnectionResponse,
  formatVnDateTime,
  SHEET_CONNECTION_STATUS_LABEL,
  SHEET_CONNECTION_STATUS_TONE,
  SHEET_SYNC_ERROR_LABEL,
  SheetConnectionStatus,
  SheetConnectStartResponse,
  SHEETS_KEPT_CHANGES_NOTE,
  type EventSheetConnection,
  type SheetConnectionTone,
} from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

/*
 * Mục "Google Sheets" của tab Cài đặt Sự kiện (Story 6.4, FR-32): gọi api, nhịp tải lại khi đang đồng bộ và câu chữ của
 * từng trạng thái. Story 6.6: kết nối "Mất quyền" có "Kết nối lại" (cùng `POST …/connect`) và câu giữ dòng bẩn. Giao
 * diện ở `google-sheets-section.tsx`, được kiểm bằng Playwright.
 */

/** Tiền tố khóa TanStack Query: kết nối Google Sheets của mọi Sự kiện trong BTC (tải lại khi có tín hiệu cấp BTC). */
export const googleSheetsQueryPrefix = (orgId: string) => ['integration', 'google-sheets', orgId] as const;

/** Khóa TanStack Query: kết nối Google Sheets của một Sự kiện. */
export const googleSheetsQueryKey = (orgId: string, eventId: string) =>
  [...googleSheetsQueryPrefix(orgId), eventId] as const;

/** `GET /v1/orgs/:orgId/events/:eventId/google-sheets`: `{ connection }` (`null` khi chưa kết nối). */
export const fetchGoogleSheets = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(eventGoogleSheetsApiPath(orgId, eventId), { schema: EventSheetConnectionResponse, init: { signal } });

/**
 * `POST …/google-sheets/connect` (không body): `{ authorizationUrl }` để chuyển cả trang tới Google. Dùng cho cả "Kết nối
 * Google Sheets" lẫn "Kết nối lại" khi kết nối đang `auth_revoked` (Story 6.6). Lỗi (2FA, 401, 409) đi qua luồng mutation
 * thường.
 */
export const startSheetsConnect = (orgId: string, eventId: string) =>
  apiRequest(eventGoogleSheetsConnectApiPath(orgId, eventId), {
    schema: SheetConnectStartResponse,
    init: { method: 'POST' },
  });

/** `DELETE …/google-sheets` (204): ngắt kết nối; Sheet giữ nguyên trong Drive. */
export const disconnectSheets = (orgId: string, eventId: string) =>
  apiRequest(eventGoogleSheetsApiPath(orgId, eventId), { schema: z.undefined(), init: { method: 'DELETE' } });

/** Đang đồng bộ lần đầu (worker tạo Sheet và đẩy Đơn): tải lại trạng thái mỗi 3 giây. */
export const SHEETS_SYNCING_POLL_MS = 3_000;
/** Đang thử lại sau lỗi Google (backoff của worker từ 30 giây): tải lại chậm hơn, mỗi 15 giây. */
export const SHEETS_RETRYING_POLL_MS = 15_000;

/**
 * `refetchInterval` của query trạng thái: 3 giây khi `syncing`, 15 giây khi `retrying` (lần thử lại thành công thì tự về
 * "Đã kết nối"), không tải lại tự động ở trạng thái khác.
 */
export function sheetsRefetchInterval(connection: EventSheetConnection | null | undefined): number | false {
  if (connection?.status === SheetConnectionStatus.SYNCING) return SHEETS_SYNCING_POLL_MS;
  if (connection?.status === SheetConnectionStatus.RETRYING) return SHEETS_RETRYING_POLL_MS;
  return false;
}

export const SHEETS_TITLE = 'Google Sheets';
export const SHEETS_DESCRIPTION =
  'Đồng bộ danh sách Đơn sang một Google Sheet mới trong Google Drive của bạn. Tickee chỉ ghi vào Sheet do Tickee tạo; sửa trên Sheet không ảnh hưởng Tickee.';
export const SHEETS_CONNECT_LABEL = 'Kết nối Google Sheets';
/** Nút chính khi kết nối "Mất quyền" (Story 6.6): chạy lại OAuth trên chính kết nối đó. */
export const SHEETS_RECONNECT_LABEL = 'Kết nối lại';
export const SHEETS_OPEN_LABEL = 'Mở Google Sheet';
export const SHEETS_CREATING_LABEL = 'Đang tạo Sheet…';
export const SHEETS_DISCONNECT_LABEL = 'Ngắt kết nối';
export const SHEETS_DISCONNECT_TITLE = 'Ngắt kết nối Google Sheets?';
/** Hậu quả nêu trong `ConfirmDialog` "Ngắt kết nối". */
export const SHEETS_DISCONNECT_CONSEQUENCES =
  'Tickee sẽ dừng đồng bộ Đơn sang Sheet. Sheet giữ nguyên trong Google Drive, không bị xóa; Đơn mới sẽ không được ghi thêm vào đó. Kết nối lại sau này sẽ tạo một Sheet mới.';
export const SHEETS_KEEP_LABEL = 'Giữ kết nối';
export const SHEETS_DISCONNECTED_TOAST = 'Đã ngắt kết nối Google Sheets. Sheet vẫn còn trong Google Drive.';
export const SHEETS_ALREADY_CONNECTED_TOAST = 'Sự kiện này đã kết nối Google Sheets.';
export const SHEETS_ALREADY_DISCONNECTED_TOAST = 'Kết nối Google Sheets này đã được ngắt.';
export const SHEETS_CONNECT_FAILED = 'Chưa bắt đầu kết nối Google Sheets được.';

/** Nội dung của mục khi Sự kiện đã kết nối. */
export interface SheetsConnectionView {
  badge: { label: string; tone: SheetConnectionTone };
  /** Câu lỗi gần nhất (dưới badge) khi đang thử lại hoặc mất quyền; không thì `null`. */
  error: string | null;
  /** Mất quyền (Story 6.6): hiện nút chính "Kết nối lại". */
  reconnect: boolean;
  /** Mất quyền: câu nhắc thay đổi được giữ lại và ghi lên Sheet khi kết nối lại; không thì `null`. */
  keptChanges: string | null;
  /** "Đồng bộ lần cuối: 10:04 08/11/2026 (giờ Việt Nam)", hoặc câu thay khi chưa đồng bộ xong lần nào. */
  lastSynced: string;
  /** "Kết nối bởi Trần Thu Hà", hoặc câu chung khi người cấp không còn trong BTC hay không có tên. */
  connectedBy: string;
  /** Chưa có link mà worker còn đang tạo Sheet (`syncing`, `retrying`): hiện "Đang tạo Sheet…". */
  creating: boolean;
  /**
   * Sheet nằm trong Drive của tài khoản Google đã đồng ý lúc kết nối (`drive.file`; có thể khác email Tickee của người
   * kết nối): thành viên khác phải được chia sẻ trên Google mới mở được.
   */
  driveNote: string;
}

export function sheetsConnectionView(connection: EventSheetConnection): SheetsConnectionView {
  const revoked = connection.status === SheetConnectionStatus.AUTH_REVOKED;
  const failing = connection.status === SheetConnectionStatus.RETRYING || revoked;
  let lastSynced: string;
  if (connection.lastSyncedAt) lastSynced = `Đồng bộ lần cuối: ${formatVnDateTime(connection.lastSyncedAt)} (giờ Việt Nam)`;
  else if (connection.status === SheetConnectionStatus.SYNCING) lastSynced = 'Đang đẩy các Đơn hiện có lên Sheet.';
  else lastSynced = 'Đồng bộ lần cuối: chưa có.';
  return {
    badge: {
      label: SHEET_CONNECTION_STATUS_LABEL[connection.status],
      tone: SHEET_CONNECTION_STATUS_TONE[connection.status],
    },
    error: failing && connection.lastErrorCode ? SHEET_SYNC_ERROR_LABEL[connection.lastErrorCode] : null,
    reconnect: revoked,
    keptChanges: revoked ? SHEETS_KEPT_CHANGES_NOTE : null,
    lastSynced,
    connectedBy: connection.connectedByName
      ? `Kết nối bởi ${connection.connectedByName}`
      : 'Kết nối bởi một thành viên của BTC',
    creating:
      connection.spreadsheetUrl === null &&
      (connection.status === SheetConnectionStatus.SYNCING || connection.status === SheetConnectionStatus.RETRYING),
    driveNote: `Sheet nằm trong Google Drive của tài khoản Google mà ${connection.connectedByName ?? 'người kết nối'} dùng khi kết nối. Thành viên khác cần được chia sẻ Sheet trên Google mới mở được.`,
  };
}
