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
 * - Sheets API v4 (cần `Authorization: Bearer <access token còn hiệu lực>`, không thì 401): `POST /v4/spreadsheets` (tạo,
 *   giữ tiêu đề, locale, múi giờ, các tab và lưới), `POST /v4/spreadsheets/{id}:batchUpdate` (`updateSheetProperties` lưới),
 *   `PUT /v4/spreadsheets/{id}/values/{range}?valueInputOption=RAW` (ghi ô; vùng ngoài lưới hay nhiều giá trị hơn vùng →
 *   400 như Google). Ô lưu trong bộ nhớ; `values(id)` đọc lại. `sheetsReplies` cài trước phản hồi của các lời gọi Sheets
 *   kế tiếp (429, 500, 403, treo…); `scriptSheets(refreshToken, …)` cài riêng cho lời gọi của một grant (khi có job của
 *   kết nối khác chạy cùng lúc). `SHEETS_SERVICE_DISABLED` / `SHEETS_ACCESS_NOT_CONFIGURED`: body 403 của Google khi Sheets
 *   API chưa bật trong project (lỗi cấu hình phía Tickee).
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

export type FakeCell = string | number;

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
  /** Request theo phương thức và tiền tố đường dẫn. */
  calls(method: string, pathPrefix: string): RecordedGoogleRequest[];
  /** Như trình duyệt mở URL ủy quyền: `GET` không theo redirect, trả `Location` (hoặc lỗi khi không phải 302). */
  authorize(authorizationUrl: string): Promise<string>;
  /** Xóa request đã ghi, phản hồi cài trước, và đặt lại `consent`. Không xóa token hay spreadsheet. */
  reset(): void;
  close(): Promise<void>;
}

interface PendingCode {
  redirectUri: string;
  codeChallenge: string;
  used: boolean;
}

const randomToken = (prefix: string, bytes = 24): string => `${prefix}${randomBytes(bytes).toString('base64url')}`;

/** Tên cột A1 (`A`, `Z`, `AA`) → chỉ số đếm từ 1. */
function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

interface ParsedRange {
  tab: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** `'Đơn'!A2:L501` hoặc `Đơn!A1:B2` → tab và góc (đếm từ 1); sai dạng → `null`. */
function parseRange(range: string): ParsedRange | null {
  const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!match) return null;
  const tab = match[1] !== undefined ? match[1].replace(/''/g, "'") : match[2]!;
  return {
    tab,
    startCol: columnIndex(match[3]!),
    startRow: Number(match[4]),
    endCol: columnIndex(match[5]!),
    endRow: Number(match[6]),
  };
}

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
  const log = options.log ?? (() => undefined);
  let baseUrl = '';

  const fake: Omit<GoogleFake, 'url' | 'authorizeUrl' | 'tokenUrl' | 'close'> = {
    requests,
    consent: 'allow',
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
      const spreadsheet = spreadsheets.get(spreadsheetId);
      if (!spreadsheet) throw new Error(`Google fake: không có spreadsheet ${spreadsheetId}`);
      const tab = title === undefined ? spreadsheet.tabs[0] : spreadsheet.tabs.find((t) => t.title === title);
      if (!tab) throw new Error(`Google fake: không có tab ${title ?? '(đầu)'}`);
      return tab;
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

  function issueGrant(): Record<string, unknown> {
    const refreshToken = randomToken('1//fake-refresh-');
    refreshTokens.set(refreshToken, true);
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
      codes.set(code, { redirectUri, codeChallenge: challenge, used: false });
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
      json(res, 200, issueGrant());
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

  function batchUpdate(res: ServerResponse, spreadsheet: FakeSpreadsheet, body: unknown) {
    const requestsOf = (body as { requests?: unknown } | null)?.requests;
    if (!Array.isArray(requestsOf)) return sheetsError(res, 400, 'Thiếu requests');
    for (const request of requestsOf as { updateSheetProperties?: { properties?: Record<string, unknown>; fields?: unknown } }[]) {
      const update = request.updateSheetProperties;
      if (!update) return sheetsError(res, 400, 'Fake chỉ hiểu updateSheetProperties');
      const tab = spreadsheet.tabs.find((t) => t.sheetId === update.properties?.sheetId);
      if (!tab) return sheetsError(res, 400, 'Không có sheetId này');
      const grid = (update.properties?.gridProperties ?? {}) as Record<string, unknown>;
      const fields = typeof update.fields === 'string' ? update.fields.split(',') : [];
      if (fields.includes('gridProperties.rowCount') && typeof grid.rowCount === 'number') {
        tab.rowCount = grid.rowCount;
        tab.cells.length = Math.min(tab.cells.length, grid.rowCount);
      }
      if (fields.includes('gridProperties.columnCount') && typeof grid.columnCount === 'number') {
        tab.columnCount = grid.columnCount;
      }
    }
    json(res, 200, { spreadsheetId: spreadsheet.spreadsheetId, replies: requestsOf.map(() => ({})) });
  }

  function writeValues(res: ServerResponse, spreadsheet: FakeSpreadsheet, rawRange: string, query: URLSearchParams, body: unknown) {
    if (query.get('valueInputOption') !== 'RAW') return sheetsError(res, 400, 'Fake chỉ nhận valueInputOption=RAW');
    const range = parseRange(rawRange);
    if (!range) return sheetsError(res, 400, `Unable to parse range: ${rawRange}`);
    const tab = spreadsheet.tabs.find((t) => t.title === range.tab);
    if (!tab) return sheetsError(res, 400, `Unable to parse range: ${rawRange}`);
    if (range.endRow > tab.rowCount || range.endCol > tab.columnCount) {
      return sheetsError(res, 400, `Range (${rawRange}) exceeds grid limits.`);
    }
    const values = (body as { values?: unknown } | null)?.values;
    if (!Array.isArray(values)) return sheetsError(res, 400, 'Thiếu values');
    const height = range.endRow - range.startRow + 1;
    const width = range.endCol - range.startCol + 1;
    if (values.length > height || values.some((row) => !Array.isArray(row) || row.length > width)) {
      return sheetsError(res, 400, 'Requested writing within range, but tried writing beyond it');
    }
    let cells = 0;
    values.forEach((row: unknown[], r) => {
      const rowIndex = range.startRow - 1 + r;
      const target = (tab.cells[rowIndex] ??= []);
      row.forEach((value, c) => {
        if (value === null || value === undefined) return;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
        target[range.startCol - 1 + c] = typeof value === 'boolean' ? String(value).toUpperCase() : value;
        cells += 1;
      });
    });
    json(res, 200, {
      spreadsheetId: spreadsheet.spreadsheetId,
      updatedRange: rawRange,
      updatedRows: values.length,
      updatedColumns: Math.max(0, ...values.map((row: unknown[]) => row.length)),
      updatedCells: cells,
    });
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

  async function sheetsRoute(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams, body: unknown) {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const owner = bearer ? accessTokens.get(bearer) : undefined;
    if (!owner) return sheetsError(res, 401, 'Request had invalid authentication credentials.');
    const scripted = grantReplies.get(owner)?.shift() ?? fake.sheetsReplies.shift();
    if (scripted === 'hang') return hang(res);
    if (scripted && scripted !== 'pass') return json(res, scripted.status, scripted.body ?? { error: { code: scripted.status, message: 'Kịch bản test' } });

    if (req.method === 'POST' && path === '/v4/spreadsheets') return createSpreadsheet(res, owner, body);
    const update = /^\/v4\/spreadsheets\/([^/:]+):batchUpdate$/.exec(path);
    const write = /^\/v4\/spreadsheets\/([^/:]+)\/values\/([^/]+)$/.exec(path);
    const id = decodeURIComponent((update ?? write)?.[1] ?? '');
    const spreadsheet = spreadsheets.get(id);
    if (!spreadsheet || spreadsheet.owner !== owner) {
      // drive.file: chỉ thấy file do chính grant này tạo.
      return sheetsError(res, 404, 'Requested entity was not found.');
    }
    if (req.method === 'POST' && update) return batchUpdate(res, spreadsheet, body);
    if (req.method === 'PUT' && write) return writeValues(res, spreadsheet, decodeURIComponent(write[2]!), query, body);
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
      if (url.pathname.startsWith('/v4/')) return sheetsRoute(req, res, url.pathname, url.searchParams, body);
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
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
