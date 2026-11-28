import { GOOGLE_SHEETS_SCOPE, SheetSyncErrorCode } from '@tickee/contracts';
import { z } from 'zod';

/*
 * Adapter HTTP tối thiểu tới Google cho Google Sheets (Story 6.4, 6.5, AD-23): OAuth (URL ủy quyền, đổi `code`, làm mới
 * access token) và các lời gọi Sheets API mà lần đẩy đầu và flush cần: tạo spreadsheet, đọc tab và lưới, tìm developer
 * metadata của cột, đọc một cột và ghi ô theo `gridRange` (`…ByDataFilter`, theo `sheetId`, không theo tên tab), nới lưới
 * (`appendDimension`, không bao giờ thu nhỏ), thêm cột Tickee kèm tiêu đề và metadata. Gọi `fetch` tới ba base URL trong
 * config (`GOOGLE_OAUTH_AUTHORIZE_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_SHEETS_API_URL`), timeout 10 giây, không theo
 * redirect; test và stack e2e trỏ vào Google fake (`test/google-fake`). Không dùng `@googleapis/sheets` (Design Notes của
 * Story 6.4).
 *
 * Lỗi luôn là `GoogleApiError` đã phân loại (`auth_revoked` | `transient` | `not_found` | `failed`) kèm mã
 * `SheetSyncErrorCode`, tên lời gọi và mã HTTP: không bao giờ mang token, `code`, `code_verifier`, body hay URL có tham số.
 */

/** Mỗi lời gọi Google tối đa chừng này mili giây (cả lúc đọc body). */
export const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

/** Lời gọi Google (cho log, lỗi và phân loại). */
export type GoogleOperation =
  | 'exchange_code'
  | 'refresh_token'
  | 'create_spreadsheet'
  | 'spreadsheet_info'
  | 'search_metadata'
  | 'read_values'
  | 'write_values'
  | 'batch_update';

/**
 * Loại lỗi:
 * - `auth_revoked`: Tickee mất quyền (`invalid_grant`, HTTP 401, 403 còn lại) — không thử lại;
 * - `transient`: HTTP 429, 5xx, timeout, lỗi mạng, lỗi cấu hình phía Tickee (`configuration`, Quyết định 4 của Story
 *   6.4: `invalid_client`/`unauthorized_client`, `SERVICE_DISABLED`/`accessNotConfigured`), và 403 vì quota
 *   (`rateLimitExceeded`/`userRateLimitExceeded`/`quotaExceeded` → `rate_limited`) hay Drive đầy (`storageQuotaExceeded` →
 *   `storage_quota`, Story 6.5) — thử lại có backoff;
 * - `not_found`: Sheets API trả 404 cho một spreadsheet (BTC xóa Sheet hay chuyển vào thùng rác, hoặc `drive.file` không
 *   còn thấy file) — lần đẩy đầu và flush nhận ra để tạo Sheet mới (Quyết định 2 của Story 6.5); mã lưu là
 *   `unexpected_response`;
 * - `failed`: phản hồi khác (4xx lạ, JSON sai dạng).
 */
export type GoogleFailureKind = 'auth_revoked' | 'transient' | 'not_found' | 'failed';

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

/** Một tab của spreadsheet: `sheetId`, tên, lưới. */
export interface SpreadsheetTab {
  sheetId: number;
  title: string;
  grid: GridSize;
}

/** Developer metadata gắn vào một cột: giá trị, tab và chỉ số cột (đếm từ 0). */
export interface ColumnMetadata {
  value: string;
  sheetId: number;
  columnIndex: number;
}

/** Cột Tickee mới thêm ở cuối lưới: mã (giá trị metadata) và tiêu đề ghi ở dòng 1. */
export interface NewSheetColumn {
  key: string;
  header: string;
}

/**
 * Một vùng ô hình chữ nhật cần ghi, theo `gridRange` (đếm từ 0): dòng đầu `row`, cột đầu `column` của tab `sheetId`, và
 * `values` theo dòng (mọi dòng cùng độ dài).
 */
export interface CellBlock {
  sheetId: number;
  row: number;
  column: number;
  values: readonly (readonly SheetCellValue[])[];
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
const SpreadsheetInfoResponse = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({
          // JSON của Google bỏ trường mang giá trị mặc định (`sheetId: 0`, `startIndex: 0`).
          sheetId: z.number().int().min(0).default(0),
          title: z.string().default(''),
          gridProperties: z
            .object({ rowCount: z.number().int().min(0), columnCount: z.number().int().min(0) })
            .partial()
            .optional(),
        }),
      }),
    )
    .default([]),
});
const MetadataSearchResponse = z.object({
  matchedDeveloperMetadata: z
    .array(
      z.object({
        developerMetadata: z.object({
          metadataKey: z.string().optional(),
          metadataValue: z.string().optional(),
          location: z
            .object({
              dimensionRange: z
                .object({
                  sheetId: z.number().int().min(0).default(0),
                  dimension: z.string(),
                  startIndex: z.number().int().min(0).default(0),
                  endIndex: z.number().int().min(0).optional(),
                })
                .optional(),
            })
            .optional(),
        }),
      }),
    )
    .default([]),
});
const BatchGetByDataFilterResponse = z.object({
  valueRanges: z
    .array(
      z.object({
        valueRange: z
          .object({ values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).optional() })
          .optional(),
      }),
    )
    .default([]),
});

/** Mã lỗi OAuth của token endpoint do OAuth client của Tickee sai (không phải người cấp mất quyền). */
const CLIENT_CONFIGURATION_ERRORS: ReadonlySet<string> = new Set(['invalid_client', 'unauthorized_client']);
/** Lý do lỗi của Google API khi API chưa bật trong project Google của Tickee. */
const API_CONFIGURATION_REASONS: ReadonlySet<string> = new Set(['SERVICE_DISABLED', 'accessNotConfigured']);
/** Lý do của 403 vì quota hay giới hạn tốc độ (không phải mất quyền, Story 6.5); `RATE_LIMIT_EXCEEDED` là dạng `ErrorInfo`. */
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'RATE_LIMIT_EXCEEDED',
]);
/** Lý do của 403 khi Drive của người cấp đầy (Story 6.5). */
const STORAGE_QUOTA_REASONS: ReadonlySet<string> = new Set(['storageQuotaExceeded']);

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
 * của Sheets API; `sheets`: lời gọi Sheets API (404 là spreadsheet không còn). Lỗi cấu hình (Quyết định 4) xét trước
 * 401/403; 403 vì quota hay Drive đầy là lỗi tạm thời (Story 6.5), 403 còn lại là mất quyền.
 */
function httpFailure(
  operation: GoogleOperation,
  status: number,
  tokenError: string | null,
  reasons: readonly string[] = [],
  sheets = false,
): GoogleApiError {
  if (tokenError === 'invalid_grant') return new GoogleApiError(operation, 'auth_revoked', SheetSyncErrorCode.INVALID_GRANT, status);
  if ((tokenError !== null && CLIENT_CONFIGURATION_ERRORS.has(tokenError)) || reasons.some((r) => API_CONFIGURATION_REASONS.has(r))) {
    return new GoogleApiError(operation, 'transient', SheetSyncErrorCode.CONFIGURATION, status);
  }
  if (status === 401) return new GoogleApiError(operation, 'auth_revoked', SheetSyncErrorCode.UNAUTHORIZED, status);
  if (status === 403 && reasons.some((r) => STORAGE_QUOTA_REASONS.has(r))) {
    return new GoogleApiError(operation, 'transient', SheetSyncErrorCode.STORAGE_QUOTA, status);
  }
  if (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r))) {
    return new GoogleApiError(operation, 'transient', SheetSyncErrorCode.RATE_LIMITED, status);
  }
  if (status === 403) return new GoogleApiError(operation, 'auth_revoked', SheetSyncErrorCode.FORBIDDEN, status);
  if (status === 404 && sheets) return new GoogleApiError(operation, 'not_found', SheetSyncErrorCode.UNEXPECTED_RESPONSE, status);
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

/** Đường Sheets API của một spreadsheet (id đã mã hóa). */
const spreadsheetPath = (spreadsheetId: string): string => `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;

/** Request `appendDimension`: thêm `length` dòng hay cột ở cuối lưới của tab. */
const appendDimension = (sheetId: number, dimension: 'ROWS' | 'COLUMNS', length: number) => ({
  appendDimension: { sheetId, dimension, length },
});

/** Request `updateCells` ghi chữ `header` (nguyên văn, như `RAW`) vào ô dòng 1 của cột `columnIndex`. */
const headerCell = (sheetId: number, columnIndex: number, header: string) => ({
  updateCells: {
    start: { sheetId, rowIndex: 0, columnIndex },
    rows: [{ values: [{ userEnteredValue: { stringValue: header } }] }],
    fields: 'userEnteredValue',
  },
});

/** Request `createDeveloperMetadata` gắn vào đúng một cột (`visibility: PROJECT`: chỉ project Google của Tickee thấy). */
const createColumnMetadata = (sheetId: number, columnIndex: number, metadataKey: string, metadataValue: string) => ({
  createDeveloperMetadata: {
    developerMetadata: {
      metadataKey,
      metadataValue,
      location: { dimensionRange: { sheetId, dimension: 'COLUMNS', startIndex: columnIndex, endIndex: columnIndex + 1 } },
      visibility: 'PROJECT',
    },
  },
});

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

  /** Các tab của spreadsheet: `sheetId`, tên, lưới (`GET spreadsheets/{id}`, chỉ các trường này). */
  async spreadsheetInfo(accessToken: string, spreadsheetId: string): Promise<SpreadsheetTab[]> {
    const fields = encodeURIComponent('sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))');
    const json = await this.sheets('spreadsheet_info', accessToken, 'GET', `${spreadsheetPath(spreadsheetId)}?fields=${fields}`);
    const parsed = SpreadsheetInfoResponse.safeParse(json.body);
    if (!parsed.success) throw unexpected('spreadsheet_info', json.status);
    return parsed.data.sheets.map(({ properties }) => ({
      sheetId: properties.sheetId,
      title: properties.title,
      grid: {
        rowCount: properties.gridProperties?.rowCount ?? 0,
        columnCount: properties.gridProperties?.columnCount ?? 0,
      },
    }));
  }

  /**
   * Developer metadata khóa `metadataKey` gắn vào cột (`developerMetadata:search`), trên mọi tab: giá trị, tab, chỉ số
   * cột. Metadata không gắn vào cột (dòng, tab, cả spreadsheet) bị bỏ qua.
   */
  async columnMetadata(accessToken: string, spreadsheetId: string, metadataKey: string): Promise<ColumnMetadata[]> {
    const json = await this.sheets('search_metadata', accessToken, 'POST', `${spreadsheetPath(spreadsheetId)}/developerMetadata:search`, {
      dataFilters: [{ developerMetadataLookup: { metadataKey } }],
    });
    const parsed = MetadataSearchResponse.safeParse(json.body ?? {});
    if (!parsed.success) throw unexpected('search_metadata', json.status);
    return parsed.data.matchedDeveloperMetadata.flatMap(({ developerMetadata: metadata }) => {
      const range = metadata.location?.dimensionRange;
      if (metadata.metadataKey !== metadataKey || metadata.metadataValue === undefined) return [];
      if (!range || range.dimension !== 'COLUMNS') return [];
      return [{ value: metadata.metadataValue, sheetId: range.sheetId, columnIndex: range.startIndex }];
    });
  }

  /**
   * Toàn bộ một cột (đếm từ 0) của tab `sheetId`, từ dòng 1, dạng chữ đã định dạng (`values:batchGetByDataFilter`,
   * `majorDimension=COLUMNS`). Ô trống là `''`; Google bỏ các ô trống ở cuối.
   */
  async readColumn(accessToken: string, spreadsheetId: string, sheetId: number, columnIndex: number): Promise<string[]> {
    const json = await this.sheets(
      'read_values',
      accessToken,
      'POST',
      `${spreadsheetPath(spreadsheetId)}/values:batchGetByDataFilter`,
      {
        dataFilters: [{ gridRange: { sheetId, startRowIndex: 0, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 } }],
        majorDimension: 'COLUMNS',
        valueRenderOption: 'FORMATTED_VALUE',
      },
    );
    const parsed = BatchGetByDataFilterResponse.safeParse(json.body ?? {});
    if (!parsed.success) throw unexpected('read_values', json.status);
    const column = parsed.data.valueRanges[0]?.valueRange?.values?.[0] ?? [];
    return column.map((value) => String(value));
  }

  /**
   * Ghi các vùng `blocks` theo `gridRange` (`values:batchUpdateByDataFilter`, `valueInputOption=RAW`) trong một request:
   * ghi lại cùng vùng là ghi đè cùng ô; ô ngoài các vùng không bị chạm. `blocks` rỗng → không gọi Google.
   */
  async writeCells(accessToken: string, spreadsheetId: string, blocks: readonly CellBlock[]): Promise<void> {
    if (blocks.length === 0) return;
    await this.sheets('write_values', accessToken, 'POST', `${spreadsheetPath(spreadsheetId)}/values:batchUpdateByDataFilter`, {
      valueInputOption: 'RAW',
      data: blocks.map((block) => ({
        dataFilter: {
          gridRange: {
            sheetId: block.sheetId,
            startRowIndex: block.row,
            endRowIndex: block.row + block.values.length,
            startColumnIndex: block.column,
            endColumnIndex: block.column + Math.max(0, ...block.values.map((row) => row.length)),
          },
        },
        majorDimension: 'ROWS',
        values: block.values,
      })),
    });
  }

  /**
   * Nới lưới của tab `sheetId` từ `current` (vừa đọc) lên tối thiểu `needed`, bằng `appendDimension` (thêm dòng, cột ở
   * cuối): không bao giờ thu nhỏ, kể cả khi BTC vừa thêm dòng sau lần đọc. Đã đủ → không gọi Google.
   */
  async expandGrid(accessToken: string, spreadsheetId: string, sheetId: number, current: GridSize, needed: GridSize): Promise<void> {
    const requests = [
      ...(needed.rowCount > current.rowCount ? [appendDimension(sheetId, 'ROWS', needed.rowCount - current.rowCount)] : []),
      ...(needed.columnCount > current.columnCount
        ? [appendDimension(sheetId, 'COLUMNS', needed.columnCount - current.columnCount)]
        : []),
    ];
    if (requests.length > 0) await this.batchUpdate(accessToken, spreadsheetId, requests);
  }

  /**
   * Gắn các cột đã có của tab `sheetId` làm cột Tickee: với mỗi `entries[i]`, ghi tiêu đề `header` vào dòng 1 của cột
   * `columnIndex` (`updateCells`, chữ nguyên văn) và gắn developer metadata `metadataKey` = `value` (`visibility:
   * PROJECT`) vào cột đó. Một `batchUpdate` nguyên khối (Google áp hết hoặc không áp gì), nên lần chạy lỗi giữa chừng
   * không để lại cột có metadata mà thiếu tiêu đề.
   */
  async tagColumns(
    accessToken: string,
    spreadsheetId: string,
    sheetId: number,
    metadataKey: string,
    entries: readonly { columnIndex: number; value: string; header: string }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.batchUpdate(accessToken, spreadsheetId, [
      ...entries.map((entry) => headerCell(sheetId, entry.columnIndex, entry.header)),
      ...entries.map((entry) => createColumnMetadata(sheetId, entry.columnIndex, metadataKey, entry.value)),
    ]);
  }

  /**
   * Thêm `columns` ở cuối lưới của tab `sheetId` (lưới hiện có `columnCount` cột), trong một `batchUpdate` nguyên khối:
   * `appendDimension` cột, tiêu đề ở dòng 1 (`updateCells`, chữ nguyên văn), và developer metadata `metadataKey` gắn vào
   * từng cột mới. Cột mới thứ `i` nằm ở chỉ số `columnCount + i`.
   */
  async appendColumns(
    accessToken: string,
    spreadsheetId: string,
    sheetId: number,
    columnCount: number,
    metadataKey: string,
    columns: readonly NewSheetColumn[],
  ): Promise<void> {
    if (columns.length === 0) return;
    await this.batchUpdate(accessToken, spreadsheetId, [
      appendDimension(sheetId, 'COLUMNS', columns.length),
      ...columns.map((column, i) => headerCell(sheetId, columnCount + i, column.header)),
      ...columns.map((column, i) => createColumnMetadata(sheetId, columnCount + i, metadataKey, column.key)),
    ]);
  }

  /** `spreadsheets.batchUpdate` với các request đã dựng. */
  private async batchUpdate(accessToken: string, spreadsheetId: string, requests: readonly unknown[]): Promise<void> {
    await this.sheets('batch_update', accessToken, 'POST', `${spreadsheetPath(spreadsheetId)}:batchUpdate`, { requests });
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

  /** Gọi Sheets API bằng access token (`GET` không có body); không 2xx → lỗi đã phân loại. */
  private async sheets(
    operation: GoogleOperation,
    accessToken: string,
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const { status, json } = await this.send(operation, new URL(path, this.options.sheetsApiUrl), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    });
    if (status < 200 || status >= 300) throw httpFailure(operation, status, null, googleErrorReasons(json), true);
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
