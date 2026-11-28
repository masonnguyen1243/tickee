import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * Google fake cho Google Sheets (Story 6.4): server HTTP thật trên cổng ngẫu nhiên (hoặc cổng chỉ định, cho stack e2e) giả
 * đúng phần Google mà `integration` gọi, cùng đường dẫn như Google để chỉ cần đổi gốc URL:
 *
 * - `GET /o/oauth2/v2/auth` (màn đồng ý): kiểm `client_id`, `redirect_uri`, `response_type=code`, scope `drive.file`,
 *   `access_type=offline`, `prompt=consent`, `state`, PKCE `S256`; sai → 400 (như trang lỗi của Google). `consent` =
 *   `allow` (mặc định) tự đồng ý: 302 về `redirect_uri?code=…&state=…&scope=…`; `deny`: 302 `?error=access_denied&state=…`.
 * - `POST /token` (form): `client_id`/`client_secret` sai → 401 `invalid_client`. `authorization_code`: `code` lạ, đã
 *   dùng, khác `redirect_uri` hay `code_verifier` không khớp `code_challenge` → 400 `invalid_grant`; đúng → access token +
 *   refresh token. `refresh_token`: token lạ hoặc đã thu hồi (`revokeAll`) → 400 `invalid_grant`; đúng → access token mới.
 *   `tokenReplies` / `refreshReplies` cài trước phản hồi của các lần gọi kế tiếp (`invalid_grant`, 500, thiếu refresh
 *   token, 429, treo…).
 * - Sheets API v4 (cần `Authorization: Bearer <access token còn hiệu lực>`, không thì 401; spreadsheet không có, đã xóa hay
 *   của tài khoản khác → 404 như `drive.file`; mặc định mỗi grant là một tài khoản riêng, `account` đặt trước lần đồng ý
 *   cho các grant cùng tài khoản Google thấy Sheet của nhau, như kết nối lại bằng cùng tài khoản — Story 6.6):
 *   - `POST /v4/spreadsheets` (tạo, giữ tiêu đề, locale, múi giờ, các tab và lưới);
 *   - `GET /v4/spreadsheets/{id}` (tab: `sheetId`, tên, lưới);
 *   - như JSON proto3 của Google, phản hồi của `GET` spreadsheet và `developerMetadata:search` bỏ `sheetId`/`startIndex`
 *     mang giá trị 0;
 *   - `POST /v4/spreadsheets/{id}:batchUpdate`, nguyên khối (một request lỗi → 400, không áp gì): `updateSheetProperties`
 *     (lưới), `appendDimension` (thêm dòng/cột ở cuối), `updateCells` (ghi `userEnteredValue`), `createDeveloperMetadata`
 *     (chỉ metadata gắn vào đúng một cột);
 *   - `POST /v4/spreadsheets/{id}/developerMetadata:search` (`developerMetadataLookup.metadataKey`);
 *   - `POST /v4/spreadsheets/{id}/values:batchGetByDataFilter` và `values:batchUpdateByDataFilter` (chỉ `gridRange`; ghi chỉ
 *     nhận `valueInputOption=RAW`; vùng ngoài lưới hay nhiều giá trị hơn vùng → 400 như Google).
 *   Ô và metadata lưu trong bộ nhớ; `values(id)` đọc lại. Metadata đi theo cột như Google khi BTC chèn, xóa hay di chuyển
 *   cột (helper `insertColumns`, `deleteColumn`, `moveColumn`); helper khác mô phỏng BTC: chèn, xóa, sắp xếp dòng, gõ ô,
 *   đổi tên, thêm hay xóa tab, xóa spreadsheet.
 *   `sheetsReplies` cài trước phản hồi của các lời gọi Sheets kế tiếp (429, 500, 403, treo…); `scriptSheets(refreshToken,
 *   …)` cài riêng cho lời gọi của một grant (khi có job của kết nối khác chạy cùng lúc). `SHEETS_SERVICE_DISABLED` /
 *   `SHEETS_ACCESS_NOT_CONFIGURED`: body 403 của Google khi Sheets API chưa bật trong project (lỗi cấu hình phía Tickee);
 *   `sheetsForbidden(reason)`: 403 kèm lý do (quota, Drive đầy).
 * - `GET /spreadsheets/d/{id}/edit`: trang HTML xem các ô (link "Mở Google Sheet" trên stack e2e).
 *
 * Mọi request được ghi lại (`requests`). Không bao giờ log token hay `code`.
 */

/** `drive.file`: scope duy nhất fake nhận (cùng giá trị `GOOGLE_SHEETS_SCOPE` của contracts). */
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const FAKE_AUTHORIZE_PATH = '/o/oauth2/v2/auth';
export const FAKE_TOKEN_PATH = '/token';

/** Phản hồi cài trước của token endpoint. */
export type FakeTokenReply =
  | 'invalid_grant'
  /** OAuth client của Tickee sai (lỗi cấu hình, 401). */
  | 'invalid_client'
  /** OAuth client không được dùng grant này (lỗi cấu hình, 400). */
  | 'unauthorized_client'
  | 'server_error'
  | 'rate_limited'
  | 'no_refresh_token'
  | 'hang'
  | { status: number; body?: unknown };

/** Phản hồi cài trước của một lời gọi Sheets API; `pass`: lời gọi đó xử lý như thường (để cài lỗi cho lời gọi sau). */
export type FakeSheetsReply = { status: number; body?: unknown } | 'hang' | 'pass';

/** 403 của Sheets API khi API chưa bật trong project Google (`google.rpc.ErrorInfo`, `reason: SERVICE_DISABLED`). */
export const SHEETS_SERVICE_DISABLED: FakeSheetsReply = {
  status: 403,
  body: {
    error: {
      code: 403,
      message: 'Google Sheets API has not been used in project 123 before or it is disabled.',
      status: 'PERMISSION_DENIED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'SERVICE_DISABLED',
          domain: 'googleapis.com',
          metadata: { service: 'sheets.googleapis.com' },
        },
      ],
    },
  },
};

/** 403 dạng cũ (`error.errors[].reason: accessNotConfigured`) cho cùng lỗi cấu hình. */
export const SHEETS_ACCESS_NOT_CONFIGURED: FakeSheetsReply = {
  status: 403,
  body: {
    error: {
      code: 403,
      message: 'Access Not Configured.',
      errors: [{ reason: 'accessNotConfigured', domain: 'usageLimits', message: 'Access Not Configured.' }],
    },
  },
};

/**
 * 403 của Sheets API kèm một lý do (dạng `error.errors[].reason`): `rateLimitExceeded`, `userRateLimitExceeded`,
 * `quotaExceeded` (quota, lỗi tạm thời), `storageQuotaExceeded` (Drive đầy), hay lý do khác.
 */
export const sheetsForbidden = (reason: string): FakeSheetsReply => ({
  status: 403,
  body: { error: { code: 403, message: `Kịch bản test: ${reason}`, errors: [{ reason, domain: 'usageLimits', message: reason }] } },
});

export type FakeCell = string | number;

/** Developer metadata gắn vào đúng một cột của một tab. */
export interface FakeColumnMetadata {
  metadataId: number;
  metadataKey: string;
  metadataValue: string;
  visibility: string;
  sheetId: number;
  column: number;
}

export interface FakeSheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  frozenRowCount: number;
  /** `cells[r][c]`, đếm từ 0. */
  cells: FakeCell[][];
}

export interface FakeSpreadsheet {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  locale: string | null;
  timeZone: string | null;
  /** Refresh token của người tạo (Drive của ai). */
  owner: string;
  tabs: FakeSheetTab[];
  metadata: FakeColumnMetadata[];
}

export interface RecordedGoogleRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Có header `Authorization: Bearer …` không (không ghi giá trị). */
  bearer: boolean;
  /** Body đã parse (form hoặc JSON); `null` khi không có. */
  body: unknown;
}

export interface GoogleFakeOptions {
  clientId: string;
  clientSecret: string;
  port?: number;
  host?: string;
  log?: (line: string) => void;
}

export interface GoogleFake {
  /** Gốc của fake (`GOOGLE_SHEETS_API_URL`). */
  url: string;
  /** `GOOGLE_OAUTH_AUTHORIZE_URL`. */
  authorizeUrl: string;
  /** `GOOGLE_OAUTH_TOKEN_URL`. */
  tokenUrl: string;
  requests: RecordedGoogleRequest[];
  /** Người dùng ở màn đồng ý: `allow` (mặc định) hay `deny`. */
  consent: 'allow' | 'deny';
  /**
   * Tài khoản Google ở màn đồng ý (Story 6.6): grant cấp khi đặt cùng giá trị thì thấy spreadsheet do grant khác của tài
   * khoản đó tạo (Google thật với `drive.file` có thể khác: kiểm tay). `null` (mặc định): mỗi grant là một tài khoản
   * riêng, grant mới nhận 404 với Sheet của grant cũ.
   */
  account: string | null;
  tokenReplies: FakeTokenReply[];
  refreshReplies: FakeTokenReply[];
  sheetsReplies: FakeSheetsReply[];
  /** Cài phản hồi cho các lời gọi Sheets kế tiếp của grant `refreshToken` (xét trước `sheetsReplies`). */
  scriptSheets(refreshToken: string, ...replies: FakeSheetsReply[]): void;
  spreadsheets: Map<string, FakeSpreadsheet>;
  /** Mọi `code`, refresh token và access token fake đã cấp (test kiểm không lọt ra response hay log). */
  issued: { codes: string[]; refreshTokens: string[]; accessTokens: string[] };
  /** Người cấp thu hồi quyền: mọi refresh token và access token đã cấp hết hiệu lực. */
  revokeAll(): void;
  /** Ô của tab `tab` (mặc định tab đầu), bỏ dòng trống ở cuối; ô chưa ghi là `''`. */
  values(spreadsheetId: string, tab?: string): FakeCell[][];
  /** Tab của spreadsheet (mặc định tab đầu). */
  tab(spreadsheetId: string, tab?: string): FakeSheetTab;
  /** Cột (đếm từ 0) mang metadata `tickee.column` = `value` trên tab đầu; không có → `undefined`. */
  columnOf(spreadsheetId: string, value: string): number | undefined;
  /** BTC chèn `count` dòng trống trước dòng `row` (đếm từ 0) của tab đầu. */
  insertRows(spreadsheetId: string, row: number, count?: number): void;
  /** BTC xóa `count` dòng từ dòng `row` (đếm từ 0) của tab đầu. */
  deleteRows(spreadsheetId: string, row: number, count?: number): void;
  /** BTC sắp xếp các dòng dữ liệu (dòng 2 trở đi) của tab đầu theo `compare`. */
  sortRows(spreadsheetId: string, compare: (a: FakeCell[], b: FakeCell[]) => number): void;
  /** BTC gõ một ô (đếm từ 0) của tab đầu. */
  setCell(spreadsheetId: string, row: number, column: number, value: FakeCell): void;
  /** BTC chèn `count` cột trống trước cột `column` (đếm từ 0) của tab đầu; metadata dời theo cột. */
  insertColumns(spreadsheetId: string, column: number, count?: number): void;
  /** BTC xóa cột `column` (đếm từ 0) của tab đầu; metadata gắn vào cột đó mất theo. */
  deleteColumn(spreadsheetId: string, column: number): void;
  /** BTC kéo cột `from` tới vị trí `to` (đếm từ 0, vị trí sau khi di chuyển) của tab đầu; metadata đi theo cột. */
  moveColumn(spreadsheetId: string, from: number, to: number): void;
  /** BTC đổi tên tab `sheetId`. */
  renameTab(spreadsheetId: string, sheetId: number, title: string): void;
  /** BTC thêm tab mới ở cuối; trả `sheetId` mới. */
  addTab(spreadsheetId: string, title: string): number;
  /** BTC xóa tab `sheetId` (metadata của tab đi theo). */
  deleteTab(spreadsheetId: string, sheetId: number): void;
  /** BTC xóa spreadsheet (hay chuyển vào thùng rác): mọi lời gọi sau → 404. */
  deleteSpreadsheet(spreadsheetId: string): void;
  /** Request theo phương thức và tiền tố đường dẫn. */
  calls(method: string, pathPrefix: string): RecordedGoogleRequest[];
  /** Như trình duyệt mở URL ủy quyền: `GET` không theo redirect, trả `Location` (hoặc lỗi khi không phải 302). */
  authorize(authorizationUrl: string): Promise<string>;
  /** Xóa request đã ghi, phản hồi cài trước, và đặt lại `consent`, `account`. Không xóa token hay spreadsheet. */
  reset(): void;
  close(): Promise<void>;
}

interface PendingCode {
  redirectUri: string;
  codeChallenge: string;
  used: boolean;
  /** Tài khoản Google đã đồng ý (`fake.account` lúc đó); `null`: tài khoản riêng của grant. */
  account: string | null;
}

const randomToken = (prefix: string, bytes = 24): string => `${prefix}${randomBytes(bytes).toString('base64url')}`;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function startGoogleFake(options: GoogleFakeOptions): Promise<GoogleFake> {
  const requests: RecordedGoogleRequest[] = [];
  const hanging = new Set<ServerResponse>();
  const codes = new Map<string, PendingCode>();
  /** Refresh token → còn hiệu lực. */
  const refreshTokens = new Map<string, boolean>();
  /** Access token → refresh token đã sinh ra nó (Drive của ai), `null` khi đã thu hồi. */
  const accessTokens = new Map<string, string | null>();
  const spreadsheets = new Map<string, FakeSpreadsheet>();
  const issued = { codes: [] as string[], refreshTokens: [] as string[], accessTokens: [] as string[] };
  /** Phản hồi cài trước theo grant (refresh token). */
  const grantReplies = new Map<string, FakeSheetsReply[]>();
  /** Refresh token → tài khoản Google đã đồng ý (khi `account` được đặt lúc đồng ý). */
  const grantAccounts = new Map<string, string>();
  /** Tài khoản sở hữu của một grant: tài khoản đã đồng ý, không thì chính grant đó. */
  const accountOf = (refreshToken: string): string => grantAccounts.get(refreshToken) ?? `grant:${refreshToken}`;
  const log = options.log ?? (() => undefined);
  let baseUrl = '';
  let nextMetadataId = 1;

  const spreadsheetOf = (spreadsheetId: string): FakeSpreadsheet => {
    const spreadsheet = spreadsheets.get(spreadsheetId);
    if (!spreadsheet) throw new Error(`Google fake: không có spreadsheet ${spreadsheetId}`);
    return spreadsheet;
  };

  const fake: Omit<GoogleFake, 'url' | 'authorizeUrl' | 'tokenUrl' | 'close'> = {
    requests,
    consent: 'allow',
    account: null,
    tokenReplies: [],
    refreshReplies: [],
    sheetsReplies: [],
    scriptSheets(refreshToken, ...replies) {
      grantReplies.set(refreshToken, [...(grantReplies.get(refreshToken) ?? []), ...replies]);
    },
    spreadsheets,
    issued,
    revokeAll() {
      for (const token of refreshTokens.keys()) refreshTokens.set(token, false);
      for (const token of accessTokens.keys()) accessTokens.set(token, null);
    },
    tab(spreadsheetId, title) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      const tab = title === undefined ? spreadsheet.tabs[0] : spreadsheet.tabs.find((t) => t.title === title);
      if (!tab) throw new Error(`Google fake: không có tab ${title ?? '(đầu)'}`);
      return tab;
    },
    columnOf(spreadsheetId, value) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      const sheetId = spreadsheet.tabs[0]!.sheetId;
      const found = spreadsheet.metadata
        .filter((m) => m.sheetId === sheetId && m.metadataKey === 'tickee.column' && m.metadataValue === value)
        .map((m) => m.column);
      return found.length > 0 ? Math.min(...found) : undefined;
    },
    insertRows(spreadsheetId, row, count = 1) {
      const tab = fake.tab(spreadsheetId);
      if (tab.cells.length > row) tab.cells.splice(row, 0, ...Array.from({ length: count }, () => []));
      tab.rowCount += count;
    },
    deleteRows(spreadsheetId, row, count = 1) {
      const tab = fake.tab(spreadsheetId);
      tab.cells.splice(row, count);
      tab.rowCount -= count;
    },
    sortRows(spreadsheetId, compare) {
      const tab = fake.tab(spreadsheetId);
      const rows = fake.values(spreadsheetId).slice(1).sort(compare);
      rows.forEach((row, i) => (tab.cells[i + 1] = [...row]));
    },
    setCell(spreadsheetId, row, column, value) {
      const tab = fake.tab(spreadsheetId);
      (tab.cells[row] ??= [])[column] = value;
    },
    insertColumns(spreadsheetId, column, count = 1) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      const tab = spreadsheet.tabs[0]!;
      for (const row of tab.cells) {
        if (row && row.length > column) row.splice(column, 0, ...Array.from({ length: count }, () => ''));
      }
      for (const m of spreadsheet.metadata) if (m.sheetId === tab.sheetId && m.column >= column) m.column += count;
      tab.columnCount += count;
    },
    deleteColumn(spreadsheetId, column) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      const tab = spreadsheet.tabs[0]!;
      for (const row of tab.cells) if (row && row.length > column) row.splice(column, 1);
      spreadsheet.metadata = spreadsheet.metadata.filter((m) => !(m.sheetId === tab.sheetId && m.column === column));
      for (const m of spreadsheet.metadata) if (m.sheetId === tab.sheetId && m.column > column) m.column -= 1;
      tab.columnCount -= 1;
    },
    moveColumn(spreadsheetId, from, to) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      const tab = spreadsheet.tabs[0]!;
      const order = Array.from({ length: tab.columnCount }, (_, i) => i);
      order.splice(to, 0, ...order.splice(from, 1));
      const newIndex = new Map(order.map((old, index) => [old, index]));
      tab.cells = tab.cells.map((row) => {
        const moved: FakeCell[] = [];
        (row ?? []).forEach((cell, c) => (moved[newIndex.get(c)!] = cell));
        return Array.from({ length: moved.length }, (_, c) => moved[c] ?? '');
      });
      for (const m of spreadsheet.metadata) if (m.sheetId === tab.sheetId) m.column = newIndex.get(m.column)!;
    },
    renameTab(spreadsheetId, sheetId, title) {
      const tab = spreadsheetOf(spreadsheetId).tabs.find((t) => t.sheetId === sheetId);
      if (!tab) throw new Error(`Google fake: không có tab ${sheetId}`);
      tab.title = title;
    },
    addTab(spreadsheetId, title) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      const sheetId = Math.max(...spreadsheet.tabs.map((t) => t.sheetId)) + 1;
      spreadsheet.tabs.push({ sheetId, title, rowCount: 1000, columnCount: 26, frozenRowCount: 0, cells: [] });
      return sheetId;
    },
    deleteTab(spreadsheetId, sheetId) {
      const spreadsheet = spreadsheetOf(spreadsheetId);
      spreadsheet.tabs = spreadsheet.tabs.filter((t) => t.sheetId !== sheetId);
      spreadsheet.metadata = spreadsheet.metadata.filter((m) => m.sheetId !== sheetId);
    },
    deleteSpreadsheet(spreadsheetId) {
      spreadsheetOf(spreadsheetId);
      spreadsheets.delete(spreadsheetId);
    },
    values(spreadsheetId, title) {
      const tab = fake.tab(spreadsheetId, title);
      const rows = Array.from({ length: tab.cells.length }, (_, r) =>
        Array.from({ length: tab.cells[r]?.length ?? 0 }, (_, c) => tab.cells[r]?.[c] ?? ''),
      );
      while (rows.length > 0 && rows.at(-1)!.every((cell) => cell === '')) rows.pop();
      return rows;
    },
    calls(method, pathPrefix) {
      return requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix));
    },
    async authorize(authorizationUrl) {
      const res = await fetch(authorizationUrl, { redirect: 'manual' });
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (res.status !== 302 || !location) throw new Error(`Google fake: màn đồng ý trả HTTP ${res.status}`);
      return location;
    },
    reset() {
      requests.length = 0;
      fake.tokenReplies.length = 0;
      fake.refreshReplies.length = 0;
      fake.sheetsReplies.length = 0;
      grantReplies.clear();
      fake.consent = 'allow';
      fake.account = null;
    },
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const hang = (res: ServerResponse) => {
    hanging.add(res);
    res.on('close', () => hanging.delete(res));
  };
  /** Lỗi theo dạng Sheets API (`{ error: { code, message, status } }`). */
  const sheetsError = (res: ServerResponse, status: number, message: string) =>
    json(res, status, { error: { code: status, message, status: status === 400 ? 'INVALID_ARGUMENT' : 'ERROR' } });

  /** Phản hồi cài trước của token endpoint; `true` khi đã trả lời. */
  function scriptedToken(res: ServerResponse, reply: FakeTokenReply | undefined, issue: () => Record<string, unknown>): boolean {
    if (reply === undefined) return false;
    if (reply === 'hang') hang(res);
    else if (reply === 'invalid_grant') json(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
    else if (reply === 'server_error') json(res, 500, { error: 'internal_failure' });
    else if (reply === 'rate_limited') json(res, 429, { error: 'rate_limit_exceeded' });
    else if (reply === 'invalid_client') json(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
    else if (reply === 'unauthorized_client') {
      json(res, 400, { error: 'unauthorized_client', error_description: 'Unauthorized' });
    }
    else if (reply === 'no_refresh_token') {
      const { refresh_token: _omit, ...rest } = issue();
      json(res, 200, rest);
    } else json(res, reply.status, reply.body ?? {});
    return true;
  }

  function issueAccessToken(refreshToken: string): string {
    const token = randomToken('ya29.fake-');
    accessTokens.set(token, refreshToken);
    issued.accessTokens.push(token);
    return token;
  }

  function issueGrant(account: string | null = null): Record<string, unknown> {
    const refreshToken = randomToken('1//fake-refresh-');
    refreshTokens.set(refreshToken, true);
    if (account !== null) grantAccounts.set(refreshToken, account);
    issued.refreshTokens.push(refreshToken);
    return {
      access_token: issueAccessToken(refreshToken),
      expires_in: 3599,
      refresh_token: refreshToken,
      scope: DRIVE_FILE_SCOPE,
      token_type: 'Bearer',
    };
  }

  function authorizeRoute(res: ServerResponse, query: URLSearchParams) {
    const redirectUri = query.get('redirect_uri');
    const state = query.get('state');
    const challenge = query.get('code_challenge');
    const problems = [
      query.get('client_id') !== options.clientId && 'client_id',
      !redirectUri && 'redirect_uri',
      query.get('response_type') !== 'code' && 'response_type',
      query.get('scope') !== DRIVE_FILE_SCOPE && 'scope',
      query.get('access_type') !== 'offline' && 'access_type',
      query.get('prompt') !== 'consent' && 'prompt',
      !state && 'state',
      !challenge && 'code_challenge',
      query.get('code_challenge_method') !== 'S256' && 'code_challenge_method',
    ].filter(Boolean);
    if (problems.length > 0 || !redirectUri || !state || !challenge) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Google fake: yêu cầu ủy quyền sai (${problems.join(', ')})`);
      return;
    }
    const target = new URL(redirectUri);
    if (fake.consent === 'deny') {
      target.searchParams.set('error', 'access_denied');
    } else {
      const code = randomToken('4/fake-code-', 18);
      codes.set(code, { redirectUri, codeChallenge: challenge, used: false, account: fake.account });
      issued.codes.push(code);
      target.searchParams.set('code', code);
      target.searchParams.set('scope', DRIVE_FILE_SCOPE);
    }
    target.searchParams.set('state', state);
    res.writeHead(302, { location: target.toString() });
    res.end();
  }

  function tokenRoute(res: ServerResponse, form: URLSearchParams) {
    if (form.get('client_id') !== options.clientId || form.get('client_secret') !== options.clientSecret) {
      json(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
      return;
    }
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      if (scriptedToken(res, fake.tokenReplies.shift(), issueGrant)) return;
      const code = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
      if (!code || code.used || code.redirectUri !== form.get('redirect_uri') || code.codeChallenge !== challenge) {
        if (code) code.used = true;
        json(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
        return;
      }
      code.used = true;
      json(res, 200, issueGrant(code.account));
      return;
    }
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? '';
      const issueRefresh = () => ({
        access_token: issueAccessToken(refreshToken),
        expires_in: 3599,
        scope: DRIVE_FILE_SCOPE,
        token_type: 'Bearer',
      });
      if (scriptedToken(res, fake.refreshReplies.shift(), issueRefresh)) return;
      if (refreshTokens.get(refreshToken) !== true) {
        json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return;
      }
      json(res, 200, issueRefresh());
      return;
    }
    json(res, 400, { error: 'unsupported_grant_type' });
  }

  function createSpreadsheet(res: ServerResponse, owner: string, body: unknown) {
    const spec = body as {
      properties?: { title?: unknown; locale?: unknown; timeZone?: unknown };
      sheets?: { properties?: { sheetId?: unknown; title?: unknown; gridProperties?: Record<string, unknown> } }[];
    } | null;
    const title = spec?.properties?.title;
    if (typeof title !== 'string') return sheetsError(res, 400, 'Thiếu properties.title');
    const spreadsheetId = randomBytes(33).toString('base64url');
    const tabs: FakeSheetTab[] = (spec?.sheets ?? [{}]).map((sheet, index) => {
      const grid = sheet.properties?.gridProperties ?? {};
      return {
        sheetId: typeof sheet.properties?.sheetId === 'number' ? sheet.properties.sheetId : index,
        title: typeof sheet.properties?.title === 'string' ? sheet.properties.title : `Sheet${index + 1}`,
        rowCount: typeof grid.rowCount === 'number' ? grid.rowCount : 1000,
        columnCount: typeof grid.columnCount === 'number' ? grid.columnCount : 26,
        frozenRowCount: typeof grid.frozenRowCount === 'number' ? grid.frozenRowCount : 0,
        cells: [],
      };
    });
    const spreadsheet: FakeSpreadsheet = {
      spreadsheetId,
      spreadsheetUrl: `${baseUrl}/spreadsheets/d/${spreadsheetId}/edit`,
      title,
      locale: typeof spec?.properties?.locale === 'string' ? spec.properties.locale : null,
      timeZone: typeof spec?.properties?.timeZone === 'string' ? spec.properties.timeZone : null,
      owner,
      tabs,
      metadata: [],
    };
    spreadsheets.set(spreadsheetId, spreadsheet);
    log(`Tạo spreadsheet ${spreadsheetId} (${tabs.length} tab)`);
    json(res, 200, {
      spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      properties: { title, locale: spreadsheet.locale, timeZone: spreadsheet.timeZone },
      sheets: tabs.map((tab) => ({
        properties: {
          sheetId: tab.sheetId,
          title: tab.title,
          gridProperties: { rowCount: tab.rowCount, columnCount: tab.columnCount, frozenRowCount: tab.frozenRowCount },
        },
      })),
    });
  }

  /** Lỗi 400 của một request trong lô: `batchUpdate` không áp gì. */
  class FakeBadRequest extends Error {}

  const cloneSpreadsheet = (spreadsheet: FakeSpreadsheet) => ({
    tabs: spreadsheet.tabs.map((tab) => ({ ...tab, cells: tab.cells.map((row) => (row ? [...row] : [])) })),
    metadata: spreadsheet.metadata.map((m) => ({ ...m })),
  });

  type GridRangeBody = {
    sheetId?: unknown;
    startRowIndex?: unknown;
    endRowIndex?: unknown;
    startColumnIndex?: unknown;
    endColumnIndex?: unknown;
  };

  /** `gridRange` → tab và góc (đếm từ 0, cuối không tính); thiếu cận dưới → 0, thiếu cận trên → hết lưới. */
  function resolveGridRange(tabs: FakeSheetTab[], range: GridRangeBody | undefined) {
    const sheetId = typeof range?.sheetId === 'number' ? range.sheetId : 0;
    const tab = tabs.find((t) => t.sheetId === sheetId);
    if (!tab) throw new FakeBadRequest(`No grid with id: ${sheetId}`);
    const num = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);
    const area = {
      tab,
      startRow: num(range?.startRowIndex, 0),
      endRow: num(range?.endRowIndex, tab.rowCount),
      startCol: num(range?.startColumnIndex, 0),
      endCol: num(range?.endColumnIndex, tab.columnCount),
    };
    if (area.endRow > tab.rowCount || area.endCol > tab.columnCount) {
      throw new FakeBadRequest(`Range exceeds grid limits. Max rows: ${tab.rowCount}, max columns: ${tab.columnCount}`);
    }
    return area;
  }

  function writeCell(tab: FakeSheetTab, row: number, column: number, value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false;
    (tab.cells[row] ??= [])[column] = typeof value === 'boolean' ? String(value).toUpperCase() : value;
    return true;
  }

  function applyRequest(state: ReturnType<typeof cloneSpreadsheet>, request: Record<string, unknown>) {
    const tabOf = (sheetId: unknown) => {
      const tab = state.tabs.find((t) => t.sheetId === sheetId);
      if (!tab) throw new FakeBadRequest(`No grid with id: ${String(sheetId)}`);
      return tab;
    };
    if (request.updateSheetProperties) {
      const update = request.updateSheetProperties as { properties?: Record<string, unknown>; fields?: unknown };
      const tab = tabOf(update.properties?.sheetId);
      const grid = (update.properties?.gridProperties ?? {}) as Record<string, unknown>;
      const fields = typeof update.fields === 'string' ? update.fields.split(',') : [];
      if (fields.includes('gridProperties.rowCount') && typeof grid.rowCount === 'number') {
        tab.rowCount = grid.rowCount;
        tab.cells.length = Math.min(tab.cells.length, grid.rowCount);
      }
      if (fields.includes('gridProperties.columnCount') && typeof grid.columnCount === 'number') {
        tab.columnCount = grid.columnCount;
      }
      return;
    }
    if (request.appendDimension) {
      const append = request.appendDimension as { sheetId?: unknown; dimension?: unknown; length?: unknown };
      const tab = tabOf(append.sheetId);
      if (typeof append.length !== 'number' || append.length < 1) throw new FakeBadRequest('appendDimension: length');
      if (append.dimension === 'ROWS') tab.rowCount += append.length;
      else if (append.dimension === 'COLUMNS') tab.columnCount += append.length;
      else throw new FakeBadRequest('appendDimension: dimension');
      return;
    }
    if (request.updateCells) {
      const update = request.updateCells as {
        start?: { sheetId?: unknown; rowIndex?: unknown; columnIndex?: unknown };
        rows?: { values?: { userEnteredValue?: Record<string, unknown> }[] }[];
        fields?: unknown;
      };
      if (update.fields !== 'userEnteredValue') throw new FakeBadRequest('Fake chỉ hiểu updateCells fields=userEnteredValue');
      const tab = tabOf(update.start?.sheetId);
      const row0 = typeof update.start?.rowIndex === 'number' ? update.start.rowIndex : 0;
      const col0 = typeof update.start?.columnIndex === 'number' ? update.start.columnIndex : 0;
      (update.rows ?? []).forEach((row, r) =>
        (row.values ?? []).forEach((cell, c) => {
          if (row0 + r >= tab.rowCount || col0 + c >= tab.columnCount) throw new FakeBadRequest('updateCells ngoài lưới');
          const value = cell.userEnteredValue;
          writeCell(tab, row0 + r, col0 + c, value?.stringValue ?? value?.numberValue ?? value?.boolValue);
        }),
      );
      return;
    }
    if (request.createDeveloperMetadata) {
      const metadata = (request.createDeveloperMetadata as { developerMetadata?: Record<string, unknown> }).developerMetadata;
      const range = (metadata?.location as { dimensionRange?: Record<string, unknown> } | undefined)?.dimensionRange;
      if (typeof metadata?.metadataKey !== 'string' || typeof metadata.metadataValue !== 'string') {
        throw new FakeBadRequest('createDeveloperMetadata: thiếu key/value');
      }
      if (!range || range.dimension !== 'COLUMNS' || typeof range.startIndex !== 'number' || range.endIndex !== range.startIndex + 1) {
        throw new FakeBadRequest('Fake chỉ hiểu metadata gắn vào đúng một cột');
      }
      const tab = tabOf(range.sheetId);
      if (range.startIndex >= tab.columnCount) throw new FakeBadRequest('createDeveloperMetadata ngoài lưới');
      state.metadata.push({
        metadataId: nextMetadataId++,
        metadataKey: metadata.metadataKey,
        metadataValue: metadata.metadataValue,
        visibility: typeof metadata.visibility === 'string' ? metadata.visibility : 'DOCUMENT',
        sheetId: tab.sheetId,
        column: range.startIndex,
      });
      return;
    }
    throw new FakeBadRequest(`Fake không hiểu request ${Object.keys(request).join(',')}`);
  }

  function batchUpdate(res: ServerResponse, spreadsheet: FakeSpreadsheet, body: unknown) {
    const requestsOf = (body as { requests?: unknown } | null)?.requests;
    if (!Array.isArray(requestsOf)) return sheetsError(res, 400, 'Thiếu requests');
    // Nguyên khối như Google: áp lên bản sao, một request lỗi thì bỏ cả lô.
    const state = cloneSpreadsheet(spreadsheet);
    try {
      for (const request of requestsOf as Record<string, unknown>[]) applyRequest(state, request);
    } catch (err) {
      if (err instanceof FakeBadRequest) return sheetsError(res, 400, err.message);
      throw err;
    }
    spreadsheet.tabs = state.tabs;
    spreadsheet.metadata = state.metadata;
    json(res, 200, { spreadsheetId: spreadsheet.spreadsheetId, replies: requestsOf.map(() => ({})) });
  }

  /** Như JSON proto3 của Google: trường số mang giá trị 0 bị bỏ khỏi phản hồi (`sheetId: 0`, `startIndex: 0`). */
  const nonZero = <K extends string>(key: K, value: number): Partial<Record<K, number>> =>
    value === 0 ? {} : ({ [key]: value } as Record<K, number>);

  function spreadsheetInfo(res: ServerResponse, spreadsheet: FakeSpreadsheet) {
    json(res, 200, {
      spreadsheetId: spreadsheet.spreadsheetId,
      sheets: spreadsheet.tabs.map((tab) => ({
        properties: {
          ...nonZero('sheetId', tab.sheetId),
          title: tab.title,
          gridProperties: { rowCount: tab.rowCount, columnCount: tab.columnCount, frozenRowCount: tab.frozenRowCount },
        },
      })),
    });
  }

  function searchMetadata(res: ServerResponse, spreadsheet: FakeSpreadsheet, body: unknown) {
    const filters = (body as { dataFilters?: { developerMetadataLookup?: { metadataKey?: unknown } }[] } | null)?.dataFilters;
    if (!Array.isArray(filters) || filters.length === 0) return sheetsError(res, 400, 'Thiếu dataFilters');
    const keys = filters.map((f) => f.developerMetadataLookup?.metadataKey);
    if (keys.some((key) => typeof key !== 'string')) return sheetsError(res, 400, 'Fake chỉ hiểu developerMetadataLookup.metadataKey');
    const matched = spreadsheet.metadata
      .filter((m) => keys.includes(m.metadataKey))
      .map((m) => ({
        developerMetadata: {
          metadataId: m.metadataId,
          metadataKey: m.metadataKey,
          metadataValue: m.metadataValue,
          location: {
            locationType: 'COLUMN',
            dimensionRange: {
              ...nonZero('sheetId', m.sheetId),
              dimension: 'COLUMNS',
              ...nonZero('startIndex', m.column),
              endIndex: m.column + 1,
            },
          },
          visibility: m.visibility,
        },
        dataFilters: [{ developerMetadataLookup: { metadataKey: m.metadataKey } }],
      }));
    json(res, 200, matched.length > 0 ? { matchedDeveloperMetadata: matched } : {});
  }

  function batchGetByDataFilter(res: ServerResponse, spreadsheet: FakeSpreadsheet, body: unknown) {
    const request = body as { dataFilters?: { gridRange?: GridRangeBody }[]; majorDimension?: unknown } | null;
    if (!Array.isArray(request?.dataFilters)) return sheetsError(res, 400, 'Thiếu dataFilters');
    const byColumns = request.majorDimension === 'COLUMNS';
    try {
      const valueRanges = request.dataFilters.map((filter) => {
        if (!filter.gridRange) throw new FakeBadRequest('Fake chỉ hiểu dataFilter gridRange');
        const area = resolveGridRange(spreadsheet.tabs, filter.gridRange);
        const cell = (r: number, c: number) => {
          const value = area.tab.cells[r]?.[c];
          return value === undefined ? '' : String(value);
        };
        const lines = byColumns
          ? Array.from({ length: area.endCol - area.startCol }, (_, c) =>
              Array.from({ length: area.endRow - area.startRow }, (_, r) => cell(area.startRow + r, area.startCol + c)),
            )
          : Array.from({ length: area.endRow - area.startRow }, (_, r) =>
              Array.from({ length: area.endCol - area.startCol }, (_, c) => cell(area.startRow + r, area.startCol + c)),
            );
        // Như Google: bỏ ô trống ở cuối mỗi hàng/cột và hàng/cột trống ở cuối.
        for (const line of lines) while (line.length > 0 && line.at(-1) === '') line.pop();
        while (lines.length > 0 && lines.at(-1)!.length === 0) lines.pop();
        return {
          valueRange: {
            range: `'${area.tab.title.replace(/'/g, "''")}'`,
            majorDimension: byColumns ? 'COLUMNS' : 'ROWS',
            ...(lines.length > 0 ? { values: lines } : {}),
          },
          dataFilters: [filter],
        };
      });
      json(res, 200, { spreadsheetId: spreadsheet.spreadsheetId, valueRanges });
    } catch (err) {
      if (err instanceof FakeBadRequest) return sheetsError(res, 400, err.message);
      throw err;
    }
  }

  function batchUpdateByDataFilter(res: ServerResponse, spreadsheet: FakeSpreadsheet, body: unknown) {
    const request = body as {
      valueInputOption?: unknown;
      data?: { dataFilter?: { gridRange?: GridRangeBody }; majorDimension?: unknown; values?: unknown }[];
    } | null;
    if (request?.valueInputOption !== 'RAW') return sheetsError(res, 400, 'Fake chỉ nhận valueInputOption=RAW');
    if (!Array.isArray(request.data)) return sheetsError(res, 400, 'Thiếu data');
    try {
      // Kiểm mọi vùng trước khi ghi: một vùng lỗi thì không ghi gì.
      const writes = request.data.map((entry) => {
        if (!entry.dataFilter?.gridRange) throw new FakeBadRequest('Fake chỉ hiểu dataFilter gridRange');
        if (entry.majorDimension !== undefined && entry.majorDimension !== 'ROWS') throw new FakeBadRequest('Fake chỉ hiểu ROWS');
        const area = resolveGridRange(spreadsheet.tabs, entry.dataFilter.gridRange);
        const values = entry.values;
        if (!Array.isArray(values)) throw new FakeBadRequest('Thiếu values');
        const height = area.endRow - area.startRow;
        const width = area.endCol - area.startCol;
        if (values.length > height || values.some((row) => !Array.isArray(row) || row.length > width)) {
          throw new FakeBadRequest('Requested writing within range, but tried writing beyond it');
        }
        return { area, values: values as unknown[][] };
      });
      let cells = 0;
      for (const { area, values } of writes) {
        values.forEach((row, r) =>
          row.forEach((value, c) => {
            if (writeCell(area.tab, area.startRow + r, area.startCol + c, value)) cells += 1;
          }),
        );
      }
      json(res, 200, { spreadsheetId: spreadsheet.spreadsheetId, totalUpdatedCells: cells, totalUpdatedSheets: 1 });
    } catch (err) {
      if (err instanceof FakeBadRequest) return sheetsError(res, 400, err.message);
      throw err;
    }
  }

  function viewSpreadsheet(res: ServerResponse, spreadsheetId: string) {
    const spreadsheet = spreadsheets.get(spreadsheetId);
    if (!spreadsheet) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Google fake: không có spreadsheet này');
      return;
    }
    const rows = fake.values(spreadsheetId);
    const table = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`)
      .join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${escapeHtml(spreadsheet.title)}</title>` +
        `<h1>${escapeHtml(spreadsheet.title)}</h1><p>Google Sheets fake · tab ${escapeHtml(spreadsheet.tabs[0]?.title ?? '')}</p>` +
        `<table border="1" cellpadding="4">${table}</table>`,
    );
  }

  async function sheetsRoute(req: IncomingMessage, res: ServerResponse, path: string, body: unknown) {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const owner = bearer ? accessTokens.get(bearer) : undefined;
    if (!owner) return sheetsError(res, 401, 'Request had invalid authentication credentials.');
    const scripted = grantReplies.get(owner)?.shift() ?? fake.sheetsReplies.shift();
    if (scripted === 'hang') return hang(res);
    if (scripted && scripted !== 'pass') return json(res, scripted.status, scripted.body ?? { error: { code: scripted.status, message: 'Kịch bản test' } });

    if (req.method === 'POST' && path === '/v4/spreadsheets') return createSpreadsheet(res, owner, body);
    const match = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(path);
    const spreadsheet = spreadsheets.get(decodeURIComponent(match?.[1] ?? ''));
    if (!match || !spreadsheet || accountOf(spreadsheet.owner) !== accountOf(owner)) {
      // drive.file: chỉ thấy file do tài khoản này tạo qua Tickee; file đã xóa → 404.
      return sheetsError(res, 404, 'Requested entity was not found.');
    }
    const action = `${req.method} ${match[2]}`;
    if (action === 'GET ') return spreadsheetInfo(res, spreadsheet);
    if (action === 'POST :batchUpdate') return batchUpdate(res, spreadsheet, body);
    if (action === 'POST /developerMetadata:search') return searchMetadata(res, spreadsheet, body);
    if (action === 'POST /values:batchGetByDataFilter') return batchGetByDataFilter(res, spreadsheet, body);
    if (action === 'POST /values:batchUpdateByDataFilter') return batchUpdateByDataFilter(res, spreadsheet, body);
    return sheetsError(res, 404, 'Not found');
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const raw = await readBody(req);
      const isForm = (req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
      let body: unknown = null;
      if (raw !== '') {
        try {
          body = isForm ? Object.fromEntries(new URLSearchParams(raw)) : (JSON.parse(raw) as unknown);
        } catch {
          body = raw;
        }
      }
      requests.push({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        bearer: /^Bearer /.test(req.headers.authorization ?? ''),
        body,
      });

      if (req.method === 'GET' && url.pathname === FAKE_AUTHORIZE_PATH) return authorizeRoute(res, url.searchParams);
      if (req.method === 'POST' && url.pathname === FAKE_TOKEN_PATH) return tokenRoute(res, new URLSearchParams(raw));
      const view = /^\/spreadsheets\/d\/([^/]+)\/edit$/.exec(url.pathname);
      if (req.method === 'GET' && view) return viewSpreadsheet(res, view[1]!);
      if (url.pathname.startsWith('/v4/')) return sheetsRoute(req, res, url.pathname, body);
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Google fake: không có đường này');
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://${host}:${port}`;

  return {
    ...fake,
    url: baseUrl,
    authorizeUrl: `${baseUrl}${FAKE_AUTHORIZE_PATH}`,
    tokenUrl: `${baseUrl}${FAKE_TOKEN_PATH}`,
    // `consent` đọc/ghi qua object trả về: các route đọc `fake.consent`.
    get consent() {
      return fake.consent;
    },
    set consent(value) {
      fake.consent = value;
    },
    get account() {
      return fake.account;
    },
    set account(value) {
      fake.account = value;
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
