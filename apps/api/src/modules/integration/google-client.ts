import { GOOGLE_SHEETS_SCOPE, SheetSyncErrorCode } from '@tickee/contracts';
import { z } from 'zod';

/*
 * Adapter HTTP tối thiểu tới Google cho Google Sheets (Story 6.4, AD-23): OAuth (URL ủy quyền, đổi `code`, làm mới access
 * token) và năm lời gọi Sheets API (tạo spreadsheet, nới lưới, ghi ô). Gọi `fetch` tới ba base URL trong config
 * (`GOOGLE_OAUTH_AUTHORIZE_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_SHEETS_API_URL`), timeout 10 giây, không theo redirect;
 * test và stack e2e trỏ vào Google fake (`test/google-fake`). Không dùng `@googleapis/sheets` (Design Notes của Story 6.4).
 *
 * Lỗi luôn là `GoogleApiError` đã phân loại (`auth_revoked` | `transient` | `failed`) kèm mã `SheetSyncErrorCode`, tên lời
 * gọi và mã HTTP: không bao giờ mang token, `code`, `code_verifier`, body hay URL có tham số.
 */

/** Mỗi lời gọi Google tối đa chừng này mili giây (cả lúc đọc body). */
export const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

/** Lời gọi Google (cho log, lỗi và phân loại). */
export type GoogleOperation = 'exchange_code' | 'refresh_token' | 'create_spreadsheet' | 'resize_grid' | 'write_values';

/**
 * Loại lỗi:
 * - `auth_revoked`: Tickee mất quyền (`invalid_grant`, HTTP 401, 403 còn lại) — không thử lại;
 * - `transient`: HTTP 429, 5xx, timeout, lỗi mạng, và lỗi cấu hình phía Tickee (`configuration`, Quyết định 4 của Story
 *   6.4: `invalid_client`/`unauthorized_client`, `SERVICE_DISABLED`/`accessNotConfigured`) — thử lại có backoff;
 * - `failed`: phản hồi khác (4xx lạ, JSON sai dạng).
 */
export type GoogleFailureKind = 'auth_revoked' | 'transient' | 'failed';

/** Lỗi đã phân loại của một lời gọi Google. `message` chỉ có tên lời gọi, loại, mã và mã HTTP. */
export class GoogleApiError extends Error {
  override readonly name = 'GoogleApiError';

  constructor(
    readonly operation: GoogleOperation,
    readonly kind: GoogleFailureKind,
    readonly code: SheetSyncErrorCode,
    readonly httpStatus: number | null,
  ) {
    super(`Google ${operation}: ${kind} (${code}${httpStatus === null ? '' : `, HTTP ${httpStatus}`})`);
  }
}

export interface GoogleSheetsClientOptions {
  /** `GOOGLE_SHEETS_CLIENT_ID`. */
  clientId: string;
  /** `GOOGLE_SHEETS_CLIENT_SECRET`: chỉ nằm trong body request tới token endpoint. */
  clientSecret: string;
  /** `GOOGLE_OAUTH_AUTHORIZE_URL`. */
  authorizeUrl: string;
  /** `GOOGLE_OAUTH_TOKEN_URL`. */
  tokenUrl: string;
  /** `GOOGLE_SHEETS_API_URL` (origin). */
  sheetsApiUrl: string;
  /** Mặc định `GOOGLE_REQUEST_TIMEOUT_MS`; test đặt ngắn hơn để thử timeout. */
  timeoutMs?: number;
}

/** Kết quả đổi `code`: refresh token (Google có thể không trả) và scope đã cấp (nếu Google trả). */
export interface GoogleGrant {
  refreshToken: string | null;
  scope: string | null;
}

/** Lưới của tab: số dòng, số cột. */
export interface GridSize {
  rowCount: number;
  columnCount: number;
}

/** Spreadsheet mới: tiêu đề, locale, múi giờ và một tab (id cố định, tên, lưới, số dòng cố định ở đầu). */
export interface NewSpreadsheet {
  title: string;
  locale: string;
  timeZone: string;
  sheet: { sheetId: number; title: string; grid: GridSize; frozenRowCount: number };
}

export interface CreatedSpreadsheet {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

/** Giá trị một ô ghi bằng `valueInputOption=RAW`: chữ giữ nguyên là chữ, số là số; ô trống là `''`. */
export type SheetCellValue = string | number;

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
const TokenErrorResponse = z.object({ error: z.string() });
const SpreadsheetResponse = z.object({
  spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  spreadsheetUrl: z.url({ protocol: /^https?$/ }),
});

/** Mã lỗi OAuth của token endpoint do OAuth client của Tickee sai (không phải người cấp mất quyền). */
const CLIENT_CONFIGURATION_ERRORS: ReadonlySet<string> = new Set(['invalid_client', 'unauthorized_client']);
/** Lý do lỗi của Google API khi API chưa bật trong project Google của Tickee. */
const API_CONFIGURATION_REASONS: ReadonlySet<string> = new Set(['SERVICE_DISABLED', 'accessNotConfigured']);

const GoogleApiErrorBody = z.object({
  error: z.object({
    /** `google.rpc.ErrorInfo` (`{ '@type', reason, domain, metadata }`). */
    details: z.array(z.unknown()).optional(),
    /** Dạng cũ: `errors: [{ reason, domain, message }]`. */
    errors: z.array(z.unknown()).optional(),
  }),
});

/** Các `reason` trong body lỗi của Google API (`error.details[].reason`, `error.errors[].reason`); không có → `[]`. */
function googleErrorReasons(json: unknown): string[] {
  const parsed = GoogleApiErrorBody.safeParse(json);
  if (!parsed.success) return [];
  return [...(parsed.data.error.details ?? []), ...(parsed.data.error.errors ?? [])].flatMap((entry) => {
    const reason = (entry as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? [reason] : [];
  });
}

/**
 * Phản hồi HTTP không 2xx → lỗi đã phân loại. `tokenError`: mã `error` của token endpoint; `reasons`: lý do trong body lỗi
 * của Sheets API. Lỗi cấu hình (Quyết định 4) xét trước 401/403.
 */
function httpFailure(
  operation: GoogleOperation,
  status: number,
  tokenError: string | null,
  reasons: readonly string[] = [],
): GoogleApiError {
  if (tokenError === 'invalid_grant') return new GoogleApiError(operation, 'auth_revoked', SheetSyncErrorCode.INVALID_GRANT, status);
  if ((tokenError !== null && CLIENT_CONFIGURATION_ERRORS.has(tokenError)) || reasons.some((r) => API_CONFIGURATION_REASONS.has(r))) {
    return new GoogleApiError(operation, 'transient', SheetSyncErrorCode.CONFIGURATION, status);
  }
  if (status === 401) return new GoogleApiError(operation, 'auth_revoked', SheetSyncErrorCode.UNAUTHORIZED, status);
  if (status === 403) return new GoogleApiError(operation, 'auth_revoked', SheetSyncErrorCode.FORBIDDEN, status);
  if (status === 429) return new GoogleApiError(operation, 'transient', SheetSyncErrorCode.RATE_LIMITED, status);
  if (status >= 500) return new GoogleApiError(operation, 'transient', SheetSyncErrorCode.SERVER_ERROR, status);
  return new GoogleApiError(operation, 'failed', SheetSyncErrorCode.UNEXPECTED_RESPONSE, status);
}

/** Lỗi khi gửi hoặc đọc body (timeout, mạng): không mang URL hay header. */
function transportFailure(operation: GoogleOperation, err: unknown, httpStatus: number | null): GoogleApiError {
  const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return new GoogleApiError(
    operation,
    'transient',
    timeout ? SheetSyncErrorCode.TIMEOUT : SheetSyncErrorCode.NETWORK,
    httpStatus,
  );
}

const unexpected = (operation: GoogleOperation, httpStatus: number): GoogleApiError =>
  new GoogleApiError(operation, 'failed', SheetSyncErrorCode.UNEXPECTED_RESPONSE, httpStatus);

/** Client Google của `integration`: không giữ token nào, mỗi lời gọi nhận token của kết nối đang xử lý. */
export class GoogleSheetsClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: GoogleSheetsClientOptions) {
    this.timeoutMs = options.timeoutMs ?? GOOGLE_REQUEST_TIMEOUT_MS;
  }

  /**
   * URL ủy quyền: scope `drive.file`, `access_type=offline` + `prompt=consent` (luôn có refresh token), PKCE `S256`,
   * `state` dùng một lần. Không gọi mạng.
   */
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL(this.options.authorizeUrl);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SHEETS_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Đổi `code` (kèm `code_verifier`) lấy token. Chỉ trả refresh token và scope; access token bỏ đi. */
  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleGrant> {
    const body = await this.token('exchange_code', {
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    return { refreshToken: body.refresh_token ?? null, scope: body.scope ?? null };
  }

  /** Access token mới từ refresh token. Refresh token hết hiệu lực → `auth_revoked` (`invalid_grant`). */
  async accessToken(refreshToken: string): Promise<string> {
    const body = await this.token('refresh_token', { grant_type: 'refresh_token', refresh_token: refreshToken });
    return body.access_token;
  }

  /** Tạo spreadsheet mới trong Drive của người cấp. */
  async createSpreadsheet(accessToken: string, spec: NewSpreadsheet): Promise<CreatedSpreadsheet> {
    const json = await this.sheets('create_spreadsheet', accessToken, 'POST', '/v4/spreadsheets', {
      properties: { title: spec.title, locale: spec.locale, timeZone: spec.timeZone },
      sheets: [
        {
          properties: {
            sheetId: spec.sheet.sheetId,
            title: spec.sheet.title,
            gridProperties: {
              rowCount: spec.sheet.grid.rowCount,
              columnCount: spec.sheet.grid.columnCount,
              frozenRowCount: spec.sheet.frozenRowCount,
            },
          },
        },
      ],
    });
    const parsed = SpreadsheetResponse.safeParse(json.body);
    if (!parsed.success) throw unexpected('create_spreadsheet', json.status);
    return parsed.data;
  }

  /** Đặt số dòng, số cột của tab `sheetId` (`spreadsheets.batchUpdate` › `updateSheetProperties`). */
  async resizeGrid(accessToken: string, spreadsheetId: string, sheetId: number, grid: GridSize): Promise<void> {
    await this.sheets('resize_grid', accessToken, 'POST', `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { rowCount: grid.rowCount, columnCount: grid.columnCount } },
            fields: 'gridProperties.rowCount,gridProperties.columnCount',
          },
        },
      ],
    });
  }

  /** Ghi `values` (theo dòng) vào đúng vùng `range` (A1), `valueInputOption=RAW`: ghi lại cùng vùng là ghi đè cùng ô. */
  async writeValues(
    accessToken: string,
    spreadsheetId: string,
    range: string,
    values: readonly (readonly SheetCellValue[])[],
  ): Promise<void> {
    const path = `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    await this.sheets('write_values', accessToken, 'PUT', path, { range, majorDimension: 'ROWS', values });
  }

  /** POST form tới token endpoint (client id/secret trong body). */
  private async token(operation: GoogleOperation, params: Record<string, string>): Promise<z.infer<typeof TokenResponse>> {
    const body = new URLSearchParams({
      ...params,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });
    const { status, json } = await this.send(operation, this.options.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (status < 200 || status >= 300) {
      const error = TokenErrorResponse.safeParse(json);
      throw httpFailure(operation, status, error.success ? error.data.error : null);
    }
    const parsed = TokenResponse.safeParse(json);
    if (!parsed.success) throw unexpected(operation, status);
    return parsed.data;
  }

  /** Gọi Sheets API bằng access token; không 2xx → lỗi đã phân loại. */
  private async sheets(
    operation: GoogleOperation,
    accessToken: string,
    method: 'POST' | 'PUT',
    path: string,
    payload: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const { status, json } = await this.send(operation, new URL(path, this.options.sheetsApiUrl), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (status < 200 || status >= 300) throw httpFailure(operation, status, null, googleErrorReasons(json));
    return { status, body: json };
  }

  /**
   * Gửi một request rồi đọc hết body thành JSON (body không phải JSON → `undefined`). Timeout bao cả lúc đọc body. Lỗi gửi
   * hay đọc → `transient` (`timeout` / `network`).
   */
  private async send(
    operation: GoogleOperation,
    url: string | URL,
    init: RequestInit,
  ): Promise<{ status: number; json: unknown }> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: 'error', signal });
    } catch (err) {
      throw transportFailure(operation, err, null);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw transportFailure(operation, err, response.status);
    }
    let json: unknown;
    try {
      json = text === '' ? undefined : (JSON.parse(text) as unknown);
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  }
}
