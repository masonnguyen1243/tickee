import { describe, expect, it } from 'vitest';
import {
  eventGoogleSheetsApiPath,
  eventGoogleSheetsConnectApiPath,
  EventSheetConnectionResponse,
  GOOGLE_SHEET_COLUMN_METADATA_KEY,
  GOOGLE_SHEET_ORDER_STATUSES,
  GOOGLE_SHEET_QUESTION_COLUMN_PREFIX,
  GOOGLE_SHEETS_SCOPE,
  GoogleSheetColumn,
  googleSheetQuestionColumn,
  googleSheetsRedirectUri,
  googleSheetsReturnPath,
  googleSheetTitle,
  SHEET_CONNECTION_STATUS_LABEL,
  SHEET_CONNECTION_STATUS_TONE,
  SHEET_CONNECTION_STATUSES,
  SHEET_SYNC_ERROR_LABEL,
  SheetConnectStartResponse,
  SheetSyncErrorCode,
  SheetsNotice,
} from '../src/google-sheets.js';
import { ErrorCode } from '../src/errors.js';
import { JobQueue, SheetFlushPayload, SheetInitialSyncPayload, SheetRowChangedPayload } from '../src/jobs.js';
import { PII_KEYS } from '../src/pii.js';

/* Story 6.4: hợp đồng kết nối Google Sheets dùng chung api/web. */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';

describe('đường dẫn và OAuth', () => {
  it('route BTC, redirect URI theo API_PUBLIC_URL, scope drive.file', () => {
    expect(eventGoogleSheetsApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/google-sheets`);
    expect(eventGoogleSheetsConnectApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/google-sheets/connect`);
    expect(googleSheetsRedirectUri('https://api.tickee.vn')).toBe(
      'https://api.tickee.vn/v1/integrations/google-sheets/callback',
    );
    expect(googleSheetsRedirectUri('http://localhost:3001/')).toBe(
      'http://localhost:3001/v1/integrations/google-sheets/callback',
    );
    expect(GOOGLE_SHEETS_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });

  it('đích 302 của callback: tab Cài đặt khi biết Sự kiện, không thì trang gốc', () => {
    expect(googleSheetsReturnPath(SheetsNotice.CONNECTED, { organizationId: ORG, eventId: EVENT })).toBe(
      `/btc/${ORG}/su-kien/${EVENT}?tab=cai-dat&notice=sheets-connected`,
    );
    expect(googleSheetsReturnPath(SheetsNotice.FAILED)).toBe('/?notice=sheets-failed');
    expect(Object.values(SheetsNotice)).toEqual([
      'sheets-connected',
      'sheets-denied',
      'sheets-failed',
      'sheets-already-connected',
    ]);
  });
});

describe('trạng thái kết nối', () => {
  it('bốn trạng thái, mỗi trạng thái có nhãn và tone (không coral)', () => {
    expect(SHEET_CONNECTION_STATUSES).toEqual(['active', 'syncing', 'retrying', 'auth_revoked']);
    expect(SHEET_CONNECTION_STATUS_LABEL).toEqual({
      active: 'Đã kết nối',
      syncing: 'Đang đồng bộ',
      retrying: 'Lỗi, đang thử lại',
      auth_revoked: 'Mất quyền',
    });
    expect(SHEET_CONNECTION_STATUS_TONE).toEqual({
      active: 'success',
      syncing: 'neutral',
      retrying: 'warning',
      auth_revoked: 'danger',
    });
    for (const code of Object.values(SheetSyncErrorCode)) expect(SHEET_SYNC_ERROR_LABEL[code], code).toBeTruthy();
  });

  it('response: đúng sáu trường, không token; connection null khi chưa kết nối', () => {
    expect(EventSheetConnectionResponse.parse({ connection: null })).toEqual({ connection: null });
    const connection = {
      status: 'active',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit',
      lastSyncedAt: '2026-11-27T03:04:05.000Z',
      lastErrorCode: null,
      connectedByName: 'Trần Thu Hà',
      createdAt: '2026-11-27T03:00:00.000+07:00',
    };
    expect(EventSheetConnectionResponse.parse({ connection })).toEqual({ connection });
    // Trường lạ (vd. token lỡ trả) bị bỏ khi parse.
    expect(EventSheetConnectionResponse.parse({ connection: { ...connection, refreshToken: 'x' } })).toEqual({ connection });
    for (const bad of [
      { ...connection, status: 'pending' },
      { ...connection, lastErrorCode: 'la' },
      { ...connection, spreadsheetUrl: 'javascript:alert(1)' },
      { ...connection, connectedByName: '' },
    ]) {
      expect(EventSheetConnectionResponse.safeParse({ connection: bad }).success).toBe(false);
    }
    expect(SheetConnectStartResponse.safeParse({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }).success).toBe(
      true,
    );
  });

  it('mã lỗi route', () => {
    expect(ErrorCode.SHEETS_ALREADY_CONNECTED).toBe('SHEETS_ALREADY_CONNECTED');
    expect(ErrorCode.SHEETS_NOT_CONNECTED).toBe('SHEETS_NOT_CONNECTED');
  });
});

describe('Sheet và job', () => {
  it('tên Sheet, trạng thái Đơn lên Sheet (không pending, expired)', () => {
    expect(googleSheetTitle('Giải bơi mùa đông')).toBe('Tickee · Giải bơi mùa đông');
    expect(GOOGLE_SHEET_ORDER_STATUSES).toEqual(['paid', 'review', 'cancelled', 'refunded']);
  });

  it('queue lần đẩy đầu và dead-letter; payload chỉ id kết nối', () => {
    expect(JobQueue.INTEGRATION_SHEET_INITIAL_SYNC).toBe('integration.sheet-initial-sync');
    expect(JobQueue.INTEGRATION_SHEET_INITIAL_SYNC_DEAD_LETTER).toBe('integration.sheet-initial-sync.dead-letter');
    expect(SheetInitialSyncPayload.parse({ connectionId: EVENT, refreshToken: 'x' })).toEqual({ connectionId: EVENT });
    expect(SheetInitialSyncPayload.safeParse({ connectionId: 'khong-phai-uuid' }).success).toBe(false);
  });

  it('Story 6.5: queue sheet_row_changed và flush, mỗi queue kèm dead-letter; payload chỉ id', () => {
    expect(JobQueue.INTEGRATION_SHEET_ROW_CHANGED).toBe('integration.sheet_row_changed');
    expect(JobQueue.INTEGRATION_SHEET_ROW_CHANGED_DEAD_LETTER).toBe('integration.sheet_row_changed.dead-letter');
    expect(JobQueue.INTEGRATION_SHEET_FLUSH).toBe('integration.sheet-flush');
    expect(JobQueue.INTEGRATION_SHEET_FLUSH_DEAD_LETTER).toBe('integration.sheet-flush.dead-letter');
    // Tên queue pg-boss chỉ gồm chữ, số, `_`, `-`, `.`, `/`.
    for (const name of [JobQueue.INTEGRATION_SHEET_ROW_CHANGED, JobQueue.INTEGRATION_SHEET_FLUSH]) {
      expect(name).toMatch(/^[\w.\-/]+$/);
    }
    expect(SheetRowChangedPayload.parse({ eventId: EVENT, orderId: ORG, buyerEmail: 'a@vidu.vn' })).toEqual({
      eventId: EVENT,
      orderId: ORG,
    });
    expect(SheetRowChangedPayload.safeParse({ eventId: EVENT }).success).toBe(false);
    expect(SheetFlushPayload.parse({ connectionId: EVENT, token: 'x' })).toEqual({ connectionId: EVENT });
    expect(SheetFlushPayload.safeParse({ connectionId: 'khong-phai-uuid' }).success).toBe(false);
  });

  it('Story 6.5: 403 quota/Drive đầy có mã và nhãn riêng (lỗi tạm thời)', () => {
    expect(SheetSyncErrorCode.RATE_LIMITED).toBe('rate_limited');
    expect(SheetSyncErrorCode.STORAGE_QUOTA).toBe('storage_quota');
    expect(SHEET_SYNC_ERROR_LABEL.storage_quota).toBe('Google Drive của người kết nối đã đầy; Tickee sẽ tự thử lại.');
  });

  it('Story 6.5: cột Tickee nhận ra bằng developer metadata tickee.column; mã cột cố định và cột câu hỏi', () => {
    expect(GOOGLE_SHEET_COLUMN_METADATA_KEY).toBe('tickee.column');
    expect(Object.values(GoogleSheetColumn)).toEqual([
      'order_code',
      'buyer_name',
      'buyer_email',
      'buyer_phone',
      'items',
      'total_amount',
      'paid_amount',
      'status',
      'created_at',
      'paid_at',
      'checked_in',
      'manual_checked_in',
      'ticket_count',
    ]);
    expect(googleSheetQuestionColumn(EVENT)).toBe(`question:${EVENT}`);
    expect(googleSheetQuestionColumn(EVENT).startsWith(GOOGLE_SHEET_QUESTION_COLUMN_PREFIX)).toBe(true);
  });

  it('token OAuth và code_verifier luôn bị che trong log (cả snake_case và camelCase)', () => {
    for (const key of ['refresh_token', 'refreshToken', 'access_token', 'accessToken', 'code_verifier', 'codeVerifier']) {
      expect(PII_KEYS).toContain(key);
    }
  });
});
