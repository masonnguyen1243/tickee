import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  GOOGLE_SHEET_COLUMN_METADATA_KEY,
  GOOGLE_SHEET_LOCALE,
  GOOGLE_SHEET_ORDER_STATUSES,
  GOOGLE_SHEET_ORDERS_TAB,
  GOOGLE_SHEET_TIME_ZONE,
  GoogleSheetColumn,
  googleSheetTitle,
  JobQueue,
  SheetConnectionStatus,
  SheetInitialSyncPayload,
  SheetSyncErrorCode,
  type EventOrderCursorValue,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { SecretBoxError, type SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import {
  BOSS,
  defineQueue,
  derivedJobId,
  JOB_COMPLETED,
  QueueProducer,
  registerQueueWorker,
} from '../../platform/jobs/index.js';
import { ticketEventById } from '../event/index.js';
import { answerColumnsOf, answersOfOrders, eventOrdersPageOf, type EventOrderListRow } from '../ordering/index.js';
import { checkinCountsOfOrders } from '../ticketing/index.js';
import { GoogleApiError, type GoogleSheetsClient, type SpreadsheetTab } from './google-client.js';
import { GOOGLE_SHEETS_CLIENT, SHEETS_SECRET_BOX } from './integration.config.js';
import {
  connectionById,
  connectionExists,
  hasDirty,
  markSyncFailure,
  markSynced,
  resetSpreadsheet,
  saveSpreadsheet,
  type SheetConnectionRow,
} from './sheet-connection-store.js';
import {
  scheduleSheetFlush,
  SHEET_FLUSH_QUEUE,
  SHEET_FLUSH_SETTINGS,
  type SheetFlushSettings,
} from './sheet-flush-queue.js';
import { cellBlocks, columnPositions, SHEET_ORDERS_TAB_ID, SHEET_SYNC_BATCH, sheetGridFor } from './sheet-layout.js';
import { sheetColumnsOf, sheetOrderValues } from './sheet-rows.js';

/*
 * Lần đẩy đầu của kết nối Google Sheets (Story 6.4, 6.5, FR-32, AD-23), vai worker. Callback OAuth enqueue job
 * `integration.sheet-initial-sync` `{ connectionId }` bằng chính `tx` tạo kết nối (`syncing`); flush enqueue lại (id job
 * mới) khi Sheet mất (Quyết định 2 của Story 6.5). Worker:
 *   1. đọc kết nối (đã xóa, đã đẩy xong — `active` hay `last_synced_at` có —, hay `auth_revoked` → xong, không gọi
 *      Google; đã đẩy xong mà còn dòng bẩn thì hẹn lại flush, phòng lần trước hẹn lỗi sau `markSynced`), giải mã refresh
 *      token, lấy access token;
 *   2. đọc Đơn `paid`/`review`/`cancelled`/`refunded` của Sự kiện qua read model của `ordering`, lô 500, rồi đảo thành cũ →
 *      mới (flush thêm Đơn mới vào cuối Sheet);
 *   3. đã có spreadsheet (lần retry) → tìm tab theo `sheet_tab_id` (không theo tên) và cột Tickee theo metadata;
 *      spreadsheet 404, mất tab, hay có cột Tickee mà mất cột Mã Đơn → bỏ Sheet đó (CAS `resetSpreadsheet`) và tạo mới.
 *      Chưa có → tạo "Tickee · <tên Sự kiện>" (locale `vi_VN`, múi giờ
 *      `Asia/Ho_Chi_Minh`, một tab "Đơn" id cố định, cố định dòng 1) và lưu `spreadsheet_id` ngay; lần retry dùng lại id
 *      đó, không tạo Sheet thứ hai;
 *   4. nới lưới cho đủ dòng và cột (chỉ nới, không bao giờ thu nhỏ); Sheet chưa có cột Tickee nào → ghi tiêu đề các cột
 *      Tickee ở A1… và gắn developer metadata `tickee.column` cho từng cột trong một `batchUpdate`; đã có (lần retry) →
 *      giữ vị trí đã gắn, câu hỏi form mới thêm cột ở cuối lưới;
 *   5. ghi từng lô 500 Đơn theo `gridRange` của tab vào các dòng cố định 2… (`valueInputOption=RAW`; retry ghi đè cùng ô),
 *      chỉ các cột Tickee;
 *   6. chuyển `active` + `last_synced_at`; còn dòng bẩn (Đơn đổi trong lúc đẩy đầu, kể cả Đơn chuyển `paid` sau khi trang
 *      chứa nó đã được đọc) → hẹn flush.
 * Trước mỗi lô và trước bước cuối kiểm kết nối còn tồn tại: "Ngắt kết nối" giữa chừng thì dừng, không cập nhật trạng thái.
 * Không gọi Google trong transaction DB. Lỗi Google: `invalid_grant`, 401, 403 (trừ quota/Drive đầy) → `auth_revoked`, xong
 * (không retry); 429, 5xx, 403 quota/Drive đầy, timeout, lỗi mạng, lỗi cấu hình phía Tickee (`configuration`) và phản hồi
 * lạ → `retrying` + `last_error_code`, retry có backoff, hết lượt → dead-letter (luật `dead_letter` của job quét cảnh báo
 * tự báo). Kết nối đã bị xóa lúc ghi lỗi → dừng (`disconnected`). Không log token, `code` hay giá trị Đơn.
 */

export { SHEET_MIN_GRID, SHEET_ORDERS_TAB_ID, SHEET_SYNC_BATCH, sheetGridFor } from './sheet-layout.js';

/**
 * Queue lần đẩy đầu: retry 5 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 10 phút); hết lượt thì sang dead-letter. Tuần tự
 * trong lô; cùng kết nối trong một lô chỉ chạy một lần.
 */
export const SHEET_INITIAL_SYNC_QUEUE = defineQueue({
  name: JobQueue.INTEGRATION_SHEET_INITIAL_SYNC,
  deadLetter: JobQueue.INTEGRATION_SHEET_INITIAL_SYNC_DEAD_LETTER,
  options: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 },
  work: { batchSize: 5, perJobResults: true },
  payload: SheetInitialSyncPayload,
});

/**
 * Id job cố định theo kết nối: enqueue lặp cho cùng kết nối chỉ có một job. Lần tạo lại Sheet (Quyết định 2 của Story
 * 6.5) suy id từ spreadsheet bị thay (`replacedSpreadsheetId`): khác job của lần kết nối và của mỗi lần tạo lại trước,
 * nhưng cố định nếu chính lần tạo lại đó enqueue lặp.
 */
export const sheetInitialSyncJobId = (connectionId: string, replacedSpreadsheetId?: string): string =>
  derivedJobId(
    connectionId,
    replacedSpreadsheetId === undefined
      ? JobQueue.INTEGRATION_SHEET_INITIAL_SYNC
      : `${JobQueue.INTEGRATION_SHEET_INITIAL_SYNC}:replaces:${replacedSpreadsheetId}`,
  );

/**
 * Enqueue lần đẩy đầu bằng chính `tx` tạo kết nối (hay `tx` đặt lại Sheet khi tạo lại, kèm `replacedSpreadsheetId`).
 * Người gọi đã `SheetSyncQueues.ready()` (vai api) hoặc queue đã có (vai worker) trước transaction.
 */
export async function enqueueSheetInitialSync(
  boss: PgBoss,
  tx: Tx,
  connectionId: string,
  replacedSpreadsheetId?: string,
): Promise<void> {
  await SHEET_INITIAL_SYNC_QUEUE.enqueue(
    boss,
    tx,
    { connectionId },
    { id: sheetInitialSyncJobId(connectionId, replacedSpreadsheetId) },
  );
}

/** Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` trước transaction của callback OAuth. */
@Injectable()
export class SheetSyncQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, SHEET_INITIAL_SYNC_QUEUE, 'khi kết nối Google Sheets');
  }
}

/** Phụ thuộc của lần đẩy đầu và flush (vai worker). */
export interface SheetSyncDeps {
  db: Database;
  google: GoogleSheetsClient;
  /** Giải mã refresh token (`GOOGLE_SHEETS_TOKEN_KEYS`). */
  secretBox: SecretBox;
  /** Hẹn flush (lần đẩy đầu xong mà còn dòng bẩn) và enqueue lại lần đẩy đầu (flush tạo lại Sheet). */
  boss: PgBoss;
  /** Cửa sổ debounce của flush (giây). */
  flushWindowSeconds: number;
}

/** Kết quả một lần chạy (cho log và test). */
export type SheetInitialSyncOutcome =
  /** Không gọi Google: kết nối không còn, đã đẩy xong / `auth_revoked`, hoặc Sự kiện không còn. */
  | { result: 'skipped'; reason: 'not_found' | 'already_active' | 'auth_revoked' | 'event_not_found' }
  /** Kết nối bị xóa giữa chừng: dừng, không cập nhật trạng thái. */
  | { result: 'disconnected' }
  /** Đã ghi tiêu đề và `orders` Đơn; kết nối `active`. */
  | { result: 'synced'; orders: number; spreadsheetId: string }
  /** Mất quyền: kết nối `auth_revoked`, không retry. */
  | { result: 'auth_revoked'; code: SheetSyncErrorCode }
  /** Lỗi tạm thời: kết nối `retrying`, pg-boss retry. */
  | { result: 'retry'; code: SheetSyncErrorCode };

/** Refresh token gốc của kết nối. Không có khóa của phiên bản này (xoay khóa sai giữa api và worker) → ném (retry rồi dead-letter). */
export function openRefreshToken(secretBox: SecretBox, connection: SheetConnectionRow): string {
  try {
    return secretBox.open(connection.refreshToken);
  } catch (err) {
    if (err instanceof SecretBoxError) throw new Error('Không giải mã được refresh token Google (SecretBoxError)');
    throw err;
  }
}

/**
 * Mọi Đơn của Sự kiện lên Sheet (trạng thái `GOOGLE_SHEET_ORDER_STATUSES`), cũ → mới: đọc từng lô `SHEET_SYNC_BATCH`
 * theo `eventOrdersPageOf` (mới → cũ, keyset) rồi đảo trong bộ nhớ (Sự kiện CLB vài nghìn Đơn).
 */
export async function sheetOrdersOf(
  db: DbExecutor,
  scope: { organizationId: string },
  eventId: string,
): Promise<EventOrderListRow[]> {
  const all: EventOrderListRow[] = [];
  let cursor: EventOrderCursorValue | undefined;
  do {
    const page = await eventOrdersPageOf(db, scope, eventId, {
      statuses: GOOGLE_SHEET_ORDER_STATUSES,
      cursor,
      limit: SHEET_SYNC_BATCH,
    });
    all.push(...page.orders);
    cursor = page.next ?? undefined;
  } while (cursor);
  return all.reverse();
}

/**
 * Còn dòng bẩn thì hẹn flush (trong một transaction ngắn của riêng nó). Gọi sau `markSynced`: handler `sheet_row_changed`
 * khóa kết nối `FOR SHARE`, nên dòng bẩn nào chưa thấy ở đây thì handler của nó đã thấy `last_synced_at` và tự hẹn flush.
 */
export async function scheduleFlushIfDirty(deps: SheetSyncDeps, connectionId: string): Promise<boolean> {
  if (!(await hasDirty(deps.db.orm, connectionId))) return false;
  await deps.db.transaction((tx) => scheduleSheetFlush(deps.boss, tx, connectionId, deps.flushWindowSeconds));
  return true;
}

/** Tab theo `sheetId` của spreadsheet đã có; spreadsheet không còn (404) hoặc không có tab đó → `undefined`. */
async function existingTab(
  google: GoogleSheetsClient,
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
): Promise<SpreadsheetTab | undefined> {
  try {
    return (await google.spreadsheetInfo(accessToken, spreadsheetId)).find((tab) => tab.sheetId === sheetId);
  } catch (err) {
    if (err instanceof GoogleApiError && err.kind === 'not_found') return undefined;
    throw err;
  }
}

/**
 * Một lần chạy job lần đẩy đầu cho kết nối `connectionId` (xem chú thích đầu file). Lỗi DB hay không giải mã được
 * refresh token → ném (pg-boss retry, hết lượt → dead-letter). Lỗi Google → trả `auth_revoked` / `retry` sau khi ghi trạng
 * thái (kết nối đã bị xóa thì không ghi gì).
 */
export async function runSheetInitialSync(deps: SheetSyncDeps, connectionId: string): Promise<SheetInitialSyncOutcome> {
  const { db, google } = deps;
  const connection = await connectionById(db.orm, connectionId);
  if (!connection) return { result: 'skipped', reason: 'not_found' };
  // `last_synced_at` có mà không `active` (flush đang `retrying`): job cũ bị requeue không được đẩy đè lên Sheet BTC đã
  // sắp xếp.
  if (connection.status === SheetConnectionStatus.ACTIVE || connection.lastSyncedAt !== null) {
    // Lần chạy trước đã `markSynced` mà hẹn flush lỗi (pg-boss chạy lại job này): còn dòng bẩn thì hẹn lại.
    if (connection.lastSyncedAt !== null && connection.status !== SheetConnectionStatus.AUTH_REVOKED) {
      await scheduleFlushIfDirty(deps, connectionId);
    }
    return { result: 'skipped', reason: 'already_active' };
  }
  if (connection.status === SheetConnectionStatus.AUTH_REVOKED) return { result: 'skipped', reason: 'auth_revoked' };

  const refreshToken = openRefreshToken(deps.secretBox, connection);
  const event = await ticketEventById(db.orm, connection.eventId);
  if (!event || event.organizationId !== connection.organizationId) return { result: 'skipped', reason: 'event_not_found' };
  const scope = { organizationId: connection.organizationId };
  const { eventId } = connection;

  try {
    const accessToken = await google.accessToken(refreshToken);
    const [orders, answerColumns] = await Promise.all([
      sheetOrdersOf(db.orm, scope, eventId),
      answerColumnsOf(db.orm, scope, eventId),
    ]);
    const columns = sheetColumnsOf(answerColumns);
    const needed = sheetGridFor(orders.length, columns.length);

    let spreadsheetId = connection.spreadsheetId;
    let tab: SpreadsheetTab | undefined;
    /** Cột Tickee đã gắn trên Sheet của lần chạy trước; Sheet vừa tạo chưa có cột nào. */
    let tagged = new Map<string, number>();
    if (spreadsheetId) {
      tab = await existingTab(google, accessToken, spreadsheetId, connection.sheetTabId);
      if (tab) {
        tagged = columnPositions(
          await google.columnMetadata(accessToken, spreadsheetId, GOOGLE_SHEET_COLUMN_METADATA_KEY),
          tab.sheetId,
        );
        // Có cột Tickee mà mất cột Mã Đơn (BTC xóa giữa hai lần chạy): gắn lại tại chỗ sẽ để metadata cũ trên các cột đã
        // dời, nên bỏ Sheet này như khi mất tab (Quyết định 2).
        if (tagged.size > 0 && !tagged.has(GoogleSheetColumn.ORDER_CODE)) tab = undefined;
      }
      if (!tab) {
        // Sheet của lần chạy trước không dùng được (BTC xóa Sheet, tab hay cột Mã Đơn giữa chừng): bỏ nó, tạo Sheet mới
        // ngay lần này.
        if (!(await resetSpreadsheet(db.orm, connectionId, spreadsheetId))) return { result: 'disconnected' };
        spreadsheetId = null;
        tagged = new Map();
      }
    }
    if (!spreadsheetId) {
      const created = await google.createSpreadsheet(accessToken, {
        title: googleSheetTitle(event.name),
        locale: GOOGLE_SHEET_LOCALE,
        timeZone: GOOGLE_SHEET_TIME_ZONE,
        sheet: { sheetId: SHEET_ORDERS_TAB_ID, title: GOOGLE_SHEET_ORDERS_TAB, grid: needed, frozenRowCount: 1 },
      });
      spreadsheetId = await saveSpreadsheet(db.orm, connectionId, created);
      if (!spreadsheetId) return { result: 'disconnected' };
      if (spreadsheetId === created.spreadsheetId) {
        tab = { sheetId: SHEET_ORDERS_TAB_ID, title: GOOGLE_SHEET_ORDERS_TAB, grid: needed };
      } else {
        // Một lần chạy khác đã lưu Sheet của nó trước: dùng Sheet đó.
        tab = await existingTab(google, accessToken, spreadsheetId, SHEET_ORDERS_TAB_ID);
        if (!tab) throw new GoogleApiError('spreadsheet_info', 'failed', SheetSyncErrorCode.UNEXPECTED_RESPONSE, null);
        tagged = columnPositions(
          await google.columnMetadata(accessToken, spreadsheetId, GOOGLE_SHEET_COLUMN_METADATA_KEY),
          tab.sheetId,
        );
      }
    }
    const sheet = { spreadsheetId, tab: tab! };

    if (!(await connectionExists(db.orm, connectionId))) return { result: 'disconnected' };
    await google.expandGrid(accessToken, sheet.spreadsheetId, sheet.tab.sheetId, sheet.tab.grid, needed);
    let columnCount = Math.max(sheet.tab.grid.columnCount, needed.columnCount);

    let positions: Map<string, number>;
    if (tagged.size === 0) {
      // Sheet chưa có cột Tickee nào (Sheet mới, hay Sheet của lần chạy trước chưa kịp gắn): cột Tickee ở A…, tiêu đề và
      // metadata trong một lần ghi.
      await google.tagColumns(
        accessToken,
        sheet.spreadsheetId,
        sheet.tab.sheetId,
        GOOGLE_SHEET_COLUMN_METADATA_KEY,
        columns.map((column, columnIndex) => ({ columnIndex, value: column.key, header: column.header })),
      );
      positions = new Map(columns.map((column, index) => [column.key, index]));
    } else {
      // Lần retry: giữ vị trí đã gắn; câu hỏi form mới từ lần chạy trước thêm cột ở cuối lưới.
      const required = new Set(columns.map((column) => column.key));
      positions = new Map([...tagged].filter(([key]) => required.has(key)));
      const missing = columns.filter((column) => !positions.has(column.key));
      if (missing.length > 0) {
        await google.appendColumns(
          accessToken,
          sheet.spreadsheetId,
          sheet.tab.sheetId,
          columnCount,
          GOOGLE_SHEET_COLUMN_METADATA_KEY,
          missing,
        );
        missing.forEach((column, i) => positions.set(column.key, columnCount + i));
        columnCount += missing.length;
      }
    }

    for (let start = 0; start < orders.length; start += SHEET_SYNC_BATCH) {
      if (!(await connectionExists(db.orm, connectionId))) return { result: 'disconnected' };
      const batch = orders.slice(start, start + SHEET_SYNC_BATCH);
      const ids = batch.map((order) => order.id);
      const [answers, checkins] = await Promise.all([
        answersOfOrders(db.orm, ids),
        checkinCountsOfOrders(db.orm, scope, eventId, ids),
      ]);
      // Dòng 0 là tiêu đề: Đơn thứ `start + i` (đếm từ 0) nằm ở dòng `start + i + 1`.
      const rows = batch.map((order, i) => ({
        row: start + i + 1,
        values: sheetOrderValues(order, { answers: answers.get(order.id), checkin: checkins.get(order.id) }),
      }));
      await google.writeCells(accessToken, sheet.spreadsheetId, cellBlocks(sheet.tab.sheetId, positions, rows));
    }

    if (!(await markSynced(db.orm, connectionId))) return { result: 'disconnected' };
    await scheduleFlushIfDirty(deps, connectionId);
    return { result: 'synced', orders: orders.length, spreadsheetId: sheet.spreadsheetId };
  } catch (err) {
    if (!(err instanceof GoogleApiError)) throw err;
    return recordGoogleFailure(db, connectionId, err);
  }
}

/**
 * Ghi lỗi Google của lần chạy (lần đẩy đầu hay flush): mất quyền → `auth_revoked` (không retry); còn lại → `retrying`
 * (pg-boss retry). Kết nối đã bị xóa giữa chừng: không ghi trạng thái, không retry.
 */
export async function recordGoogleFailure(
  db: Database,
  connectionId: string,
  err: GoogleApiError,
): Promise<{ result: 'disconnected' } | { result: 'auth_revoked' | 'retry'; code: SheetSyncErrorCode }> {
  if (err.kind === 'auth_revoked') {
    if (!(await markSyncFailure(db.orm, connectionId, SheetConnectionStatus.AUTH_REVOKED, err.code))) {
      return { result: 'disconnected' };
    }
    return { result: 'auth_revoked', code: err.code };
  }
  if (!(await markSyncFailure(db.orm, connectionId, SheetConnectionStatus.RETRYING, err.code))) {
    return { result: 'disconnected' };
  }
  return { result: 'retry', code: err.code };
}

/** Vai `worker`: tạo queue (và dead-letter) rồi đăng ký handler lần đẩy đầu. */
@Injectable()
export class SheetSyncWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('SheetSyncWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(GOOGLE_SHEETS_CLIENT) private readonly google: GoogleSheetsClient,
    @Inject(SHEETS_SECRET_BOX) private readonly secretBox: SecretBox,
    @Inject(SHEET_FLUSH_SETTINGS) private readonly settings: SheetFlushSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Lần đẩy đầu xong thì hẹn flush: queue flush phải có trước job đầu tiên.
    await SHEET_FLUSH_QUEUE.ensure(this.boss);
    await registerQueueWorker(this.boss, SHEET_INITIAL_SYNC_QUEUE, {
      logger: this.logger,
      label: 'Lần đẩy đầu lên Google Sheets',
      logContext: ({ connectionId }) => ({ connectionId }),
      dedupeBy: ({ connectionId }) => connectionId,
      handle: async ({ connectionId }) => {
        const outcome = await runSheetInitialSync(
          {
            db: this.db,
            google: this.google,
            secretBox: this.secretBox,
            boss: this.boss,
            flushWindowSeconds: this.settings.windowSeconds,
          },
          connectionId,
        );
        if (outcome.result === 'retry') {
          this.logger.warn({ code: outcome.code }, 'Google Sheets lỗi tạm thời; pg-boss sẽ thử lại');
          return { status: 'retry', reason: `Google Sheets lỗi tạm thời (${outcome.code})` };
        }
        if (outcome.result === 'auth_revoked') {
          this.logger.warn({ code: outcome.code }, 'Google Sheets: mất quyền ghi; dừng, không thử lại');
        } else if (outcome.result === 'synced') {
          this.logger.log({ orders: outcome.orders }, 'Google Sheets: đã đẩy xong Đơn hiện có');
        } else {
          this.logger.log({ result: outcome.result }, 'Google Sheets: lần đẩy đầu không chạy tiếp');
        }
        return JOB_COMPLETED;
      },
    });
  }
}
