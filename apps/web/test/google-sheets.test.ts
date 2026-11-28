import type { EventSheetConnection } from '@tickee/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disconnectSheets,
  fetchGoogleSheets,
  googleSheetsQueryKey,
  sheetsConnectionView,
  sheetsRefetchInterval,
  SHEETS_RETRYING_POLL_MS,
  SHEETS_SYNCING_POLL_MS,
  SHEETS_RECONNECT_LABEL,
  startSheetsConnect,
} from '@/lib/integration/google-sheets';
import { noticeMessage } from '@/lib/notices';

/* Story 6.4: mục "Google Sheets" của tab Cài đặt — gọi api, nhịp tải lại khi đang đồng bộ, câu chữ theo trạng thái. */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';
const PATH = `http://api.test/v1/orgs/${ORG}/events/${EVENT}/google-sheets`;

const connection = (overrides: Partial<EventSheetConnection> = {}): EventSheetConnection => ({
  status: 'active',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit',
  lastSyncedAt: '2026-11-27T03:04:05.000Z',
  lastErrorCode: null,
  connectedByName: 'Trần Thu Hà',
  createdAt: '2026-11-27T03:00:00.000Z',
  ...overrides,
});

describe('api', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('khóa query theo BTC và Sự kiện', () => {
    expect(googleSheetsQueryKey(ORG, EVENT)).toEqual(['integration', 'google-sheets', ORG, EVENT]);
  });

  it('GET trạng thái kèm cookie; { connection: null } khi chưa kết nối', async () => {
    fetchMock.mockResolvedValue(Response.json({ connection: null }));
    expect(await fetchGoogleSheets(ORG, EVENT)).toEqual({ connection: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(PATH);
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBeUndefined();
  });

  it('POST connect trả authorizationUrl; DELETE ngắt kết nối (204)', async () => {
    const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=x';
    fetchMock.mockResolvedValueOnce(Response.json({ authorizationUrl }));
    expect(await startSheetsConnect(ORG, EVENT)).toEqual({ authorizationUrl });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${PATH}/connect`);
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('POST');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(disconnectSheets(ORG, EVENT)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1]![0]).toBe(PATH);
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('DELETE');
  });

  it('409 SHEETS_ALREADY_CONNECTED → ApiError mang mã', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: 'SHEETS_ALREADY_CONNECTED', message: 'Sự kiện này đã kết nối Google Sheets.', details: null } },
        { status: 409 },
      ),
    );
    await expect(startSheetsConnect(ORG, EVENT)).rejects.toMatchObject({ code: 'SHEETS_ALREADY_CONNECTED', status: 409 });
  });
});

describe('nhịp tải lại', () => {
  it('3 giây khi đang đồng bộ lần đầu, 15 giây khi đang thử lại; không tải lại tự động ở trạng thái khác hay khi chưa kết nối', () => {
    expect(SHEETS_SYNCING_POLL_MS).toBe(3_000);
    expect(SHEETS_RETRYING_POLL_MS).toBe(15_000);
    expect(sheetsRefetchInterval(connection({ status: 'syncing' }))).toBe(3_000);
    expect(sheetsRefetchInterval(connection({ status: 'retrying' }))).toBe(15_000);
    for (const status of ['active', 'auth_revoked'] as const) {
      expect(sheetsRefetchInterval(connection({ status })), status).toBe(false);
    }
    expect(sheetsRefetchInterval(null)).toBe(false);
    expect(sheetsRefetchInterval(undefined)).toBe(false);
  });
});

describe('câu chữ theo trạng thái', () => {
  it('Đã kết nối: badge success, giờ đồng bộ theo giờ Việt Nam, tên người kết nối', () => {
    expect(sheetsConnectionView(connection())).toEqual({
      badge: { label: 'Đã kết nối', tone: 'success' },
      error: null,
      reconnect: false,
      keptChanges: null,
      lastSynced: 'Đồng bộ lần cuối: 10:04 27/11/2026 (giờ Việt Nam)',
      connectedBy: 'Kết nối bởi Trần Thu Hà',
      creating: false,
      driveNote:
        'Sheet nằm trong Google Drive của tài khoản Google mà Trần Thu Hà dùng khi kết nối. Thành viên khác cần được chia sẻ Sheet trên Google mới mở được.',
    });
  });

  it('Đang đồng bộ (chưa có link, chưa đồng bộ lần nào): badge neutral, câu đang đẩy Đơn', () => {
    expect(
      sheetsConnectionView(connection({ status: 'syncing', spreadsheetUrl: null, lastSyncedAt: null, connectedByName: null })),
    ).toEqual({
      badge: { label: 'Đang đồng bộ', tone: 'neutral' },
      error: null,
      reconnect: false,
      keptChanges: null,
      lastSynced: 'Đang đẩy các Đơn hiện có lên Sheet.',
      connectedBy: 'Kết nối bởi một thành viên của BTC',
      creating: true,
      driveNote:
        'Sheet nằm trong Google Drive của tài khoản Google mà người kết nối dùng khi kết nối. Thành viên khác cần được chia sẻ Sheet trên Google mới mở được.',
    });
  });

  it('Lỗi, đang thử lại: badge warning kèm lý do; Mất quyền: badge danger kèm lý do', () => {
    const retrying = sheetsConnectionView(connection({ status: 'retrying', lastErrorCode: 'rate_limited', lastSyncedAt: null }));
    expect(retrying.badge).toEqual({ label: 'Lỗi, đang thử lại', tone: 'warning' });
    expect(retrying.error).toBe('Google đang giới hạn số lần ghi.');
    expect(retrying.lastSynced).toBe('Đồng bộ lần cuối: chưa có.');
    const revoked = sheetsConnectionView(connection({ status: 'auth_revoked', lastErrorCode: 'invalid_grant' }));
    expect(revoked.badge).toEqual({ label: 'Mất quyền', tone: 'danger' });
    expect(revoked.error).toBe('Quyền truy cập Google Drive đã bị thu hồi.');
    const configuration = sheetsConnectionView(connection({ status: 'retrying', lastErrorCode: 'configuration' }));
    expect(configuration.error).toBe('Cấu hình Google của Tickee đang lỗi; Tickee sẽ tự thử lại khi đã sửa.');
  });

  it('Story 6.6: mất quyền → "Kết nối lại" và câu giữ dòng bẩn; người cấp rời BTC có lý do riêng; trạng thái khác thì không', () => {
    const revoked = sheetsConnectionView(connection({ status: 'auth_revoked', lastErrorCode: 'invalid_grant' }));
    expect(revoked.reconnect).toBe(true);
    expect(revoked.keptChanges).toBe('Thay đổi trong lúc mất quyền được giữ lại và ghi lên Sheet khi kết nối lại.');
    expect(SHEETS_RECONNECT_LABEL).toBe('Kết nối lại');
    const grantorRemoved = sheetsConnectionView(
      connection({ status: 'auth_revoked', lastErrorCode: 'grantor_removed', connectedByName: null }),
    );
    expect(grantorRemoved.error).toBe('Người kết nối đã rời BTC.');
    expect(grantorRemoved.reconnect).toBe(true);
    // Mất quyền trước khi có Sheet: vẫn kết nối lại được, không quay "Đang tạo Sheet…".
    const noSheet = sheetsConnectionView(
      connection({ status: 'auth_revoked', lastErrorCode: 'forbidden', spreadsheetUrl: null, lastSyncedAt: null }),
    );
    expect(noSheet).toMatchObject({ reconnect: true, creating: false });
    for (const status of ['active', 'syncing', 'retrying'] as const) {
      expect(sheetsConnectionView(connection({ status, lastErrorCode: status === 'retrying' ? 'timeout' : null })), status).toMatchObject({
        reconnect: false,
        keptChanges: null,
      });
    }
  });

  it('"Đang tạo Sheet…" chỉ khi chưa có link mà còn syncing/retrying; mất quyền khi chưa tạo Sheet → không quay mãi', () => {
    const noLink = { spreadsheetUrl: null, lastSyncedAt: null };
    expect(sheetsConnectionView(connection({ ...noLink, status: 'syncing' })).creating).toBe(true);
    expect(sheetsConnectionView(connection({ ...noLink, status: 'retrying', lastErrorCode: 'timeout' })).creating).toBe(true);
    expect(sheetsConnectionView(connection({ ...noLink, status: 'auth_revoked', lastErrorCode: 'forbidden' })).creating).toBe(
      false,
    );
    expect(sheetsConnectionView(connection({ status: 'retrying', lastErrorCode: 'timeout' })).creating).toBe(false);
  });
});

describe('notice khi callback OAuth quay về', () => {
  it('năm mã của Google Sheets có câu toast (kể cả kết nối lại, Story 6.6); mã lạ → không', () => {
    expect(noticeMessage('sheets-connected')).toBe('Đã kết nối Google Sheets. Tickee đang tạo Sheet và đẩy các Đơn hiện có.');
    expect(noticeMessage('sheets-denied')).toBe('Bạn chưa cho phép Tickee truy cập Google Drive nên chưa kết nối Google Sheets.');
    expect(noticeMessage('sheets-failed')).toBe('Chưa kết nối được Google Sheets. Vui lòng thử lại.');
    expect(noticeMessage('sheets-already-connected')).toBe('Sự kiện này đã kết nối Google Sheets.');
    expect(noticeMessage('sheets-reconnected')).toBe('Đã kết nối lại Google Sheets.');
    expect(noticeMessage('sheets-khac')).toBeNull();
  });
});
