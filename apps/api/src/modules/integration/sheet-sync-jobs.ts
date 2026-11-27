import { Inject, Injectable, Logger, Module, type DynamicModule, type OnApplicationBootstrap } from '@nestjs/common';
import {
  GOOGLE_SHEET_LOCALE,
  GOOGLE_SHEET_ORDER_STATUSES,
  GOOGLE_SHEET_ORDERS_TAB,
  GOOGLE_SHEET_TIME_ZONE,
  googleSheetTitle,
  JobQueue,
  SheetConnectionStatus,
  SheetInitialSyncPayload,
  type EventOrderCursorValue,
  type SheetSyncErrorCode,
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
import { GoogleApiError, type GoogleSheetsClient, type GridSize } from './google-client.js';
import { GOOGLE_SHEETS_CLIENT, integrationProviders, SHEETS_SECRET_BOX, type IntegrationConfig } from './integration.config.js';
import {
  connectionById,
  connectionExists,
  markSyncFailure,
  markSynced,
  saveSpreadsheet,
} from './sheet-connection-store.js';
import { GOOGLE_SHEET_ORDER_COLUMNS, sheetHeaderRow, sheetOrderRow, sheetRange } from './sheet-rows.js';

/*
 * Lần đẩy đầu của kết nối Google Sheets (Story 6.4, FR-32, AD-23), vai worker. Callback OAuth enqueue job
 * `integration.sheet-initial-sync` `{ connectionId }` bằng chính `tx` tạo kết nối (`syncing`). Worker:
 *   1. đọc kết nối (đã xóa, `active` hay `auth_revoked` → xong, không làm gì), giải mã refresh token, lấy access token;
 *   2. đọc Đơn `paid`/`review`/`cancelled`/`refunded` của Sự kiện qua read model của `ordering`, lô 500, rồi đảo thành cũ →
 *      mới (6.5 thêm Đơn mới vào cuối Sheet);
 *   3. chưa có spreadsheet → tạo "Tickee · <tên Sự kiện>" (locale `vi_VN`, múi giờ `Asia/Ho_Chi_Minh`, một tab "Đơn" id
 *      cố định, cố định dòng 1) và lưu `spreadsheet_id` ngay; lần retry dùng lại id đó, không tạo Sheet thứ hai;
 *   4. nới lưới của tab cho đủ dòng và cột, ghi hàng tiêu đề rồi từng lô 500 Đơn vào đúng các ô cố định
 *      (`valueInputOption=RAW`; retry ghi đè cùng ô);
 *   5. chuyển `active` + `last_synced_at`.
 * Trước mỗi lô và trước bước cuối kiểm kết nối còn tồn tại: "Ngắt kết nối" giữa chừng thì dừng, không cập nhật trạng thái.
 * Không gọi Google trong transaction DB. Lỗi Google: `invalid_grant`, 401, 403 → `auth_revoked`, xong (không retry); 429,
 * 5xx, timeout, lỗi mạng, lỗi cấu hình phía Tickee (`configuration`, Quyết định 4) và phản hồi lạ → `retrying` +
 * `last_error_code`, retry có backoff, hết lượt → dead-letter (luật `dead_letter` của job quét cảnh báo tự báo). Kết nối
 * đã bị xóa lúc ghi lỗi → dừng (`disconnected`). Không log token, `code` hay giá trị Đơn.
 */

/** Số Đơn mỗi lô đọc và ghi. */
export const SHEET_SYNC_BATCH = 500;

/** Id tab "Đơn" đặt lúc tạo spreadsheet: retry nới lưới đúng tab mà không phải lưu thêm id. */
export const SHEET_ORDERS_TAB_ID = 0;

/** Lưới tối thiểu của tab (bằng mặc định của Google Sheets): chỉ nới thêm khi cần, không thu nhỏ. */
export const SHEET_MIN_GRID: GridSize = { rowCount: 1_000, columnCount: 26 };

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

/** Id job cố định theo kết nối: enqueue lặp cho cùng kết nối chỉ có một job. */
export const sheetInitialSyncJobId = (connectionId: string): string =>
  derivedJobId(connectionId, JobQueue.INTEGRATION_SHEET_INITIAL_SYNC);

/** Enqueue lần đẩy đầu bằng chính `tx` tạo kết nối. Người gọi đã `SheetSyncQueues.ready()` trước transaction. */
export async function enqueueSheetInitialSync(boss: PgBoss, tx: Tx, connectionId: string): Promise<void> {
  await SHEET_INITIAL_SYNC_QUEUE.enqueue(boss, tx, { connectionId }, { id: sheetInitialSyncJobId(connectionId) });
}

/** Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` trước transaction của callback OAuth. */
@Injectable()
export class SheetSyncQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, SHEET_INITIAL_SYNC_QUEUE, 'khi kết nối Google Sheets');
  }
}

/** Phụ thuộc của lần đẩy đầu. */
export interface SheetSyncDeps {
  db: Database;
  google: GoogleSheetsClient;
  /** Giải mã refresh token (`GOOGLE_SHEETS_TOKEN_KEYS`). */
  secretBox: SecretBox;
}

/** Kết quả một lần chạy (cho log và test). */
export type SheetInitialSyncOutcome =
  /** Không gọi Google: kết nối không còn, đã `active` / `auth_revoked`, hoặc Sự kiện không còn. */
  | { result: 'skipped'; reason: 'not_found' | 'already_active' | 'auth_revoked' | 'event_not_found' }
  /** Kết nối bị xóa giữa chừng: dừng, không cập nhật trạng thái. */
  | { result: 'disconnected' }
  /** Đã ghi tiêu đề và `orders` Đơn; kết nối `active`. */
  | { result: 'synced'; orders: number; spreadsheetId: string }
  /** Mất quyền: kết nối `auth_revoked`, không retry. */
  | { result: 'auth_revoked'; code: SheetSyncErrorCode }
  /** Lỗi tạm thời: kết nối `retrying`, pg-boss retry. */
  | { result: 'retry'; code: SheetSyncErrorCode };

/**
 * Mọi Đơn của Sự kiện lên Sheet (trạng thái `GOOGLE_SHEET_ORDER_STATUSES`), cũ → mới: đọc từng lô `SHEET_SYNC_BATCH`
 * theo `eventOrdersPageOf` (mới → cũ, keyset) rồi đảo trong bộ nhớ (Sự kiện CLB vài nghìn Đơn).
 */
async function sheetOrdersOf(db: DbExecutor, scope: { organizationId: string }, eventId: string): Promise<EventOrderListRow[]> {
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

/** Lưới cần cho tiêu đề + `orders` dòng và `columns` cột, không nhỏ hơn `SHEET_MIN_GRID`. */
export const sheetGridFor = (orders: number, columns: number): GridSize => ({
  rowCount: Math.max(SHEET_MIN_GRID.rowCount, 1 + orders),
  columnCount: Math.max(SHEET_MIN_GRID.columnCount, columns),
});

/**
 * Một lần chạy job lần đẩy đầu cho kết nối `connectionId` (xem chú thích đầu file). Lỗi DB hay không giải mã được
 * refresh token → ném (pg-boss retry, hết lượt → dead-letter). Lỗi Google → trả `auth_revoked` / `retry` sau khi ghi trạng
 * thái (kết nối đã bị xóa thì không ghi gì).
 */
export async function runSheetInitialSync(deps: SheetSyncDeps, connectionId: string): Promise<SheetInitialSyncOutcome> {
  const { db, google } = deps;
  const connection = await connectionById(db.orm, connectionId);
  if (!connection) return { result: 'skipped', reason: 'not_found' };
  if (connection.status === SheetConnectionStatus.ACTIVE) return { result: 'skipped', reason: 'already_active' };
  if (connection.status === SheetConnectionStatus.AUTH_REVOKED) return { result: 'skipped', reason: 'auth_revoked' };

  let refreshToken: string;
  try {
    refreshToken = deps.secretBox.open(connection.refreshToken);
  } catch (err) {
    // Không có khóa của phiên bản này (xoay khóa sai giữa api và worker): retry rồi dead-letter để vận hành xử lý.
    if (err instanceof SecretBoxError) throw new Error('Không giải mã được refresh token Google (SecretBoxError)');
    throw err;
  }

  const event = await ticketEventById(db.orm, connection.eventId);
  if (!event || event.organizationId !== connection.organizationId) return { result: 'skipped', reason: 'event_not_found' };
  const scope = { organizationId: connection.organizationId };
  const { eventId } = connection;

  try {
    const accessToken = await google.accessToken(refreshToken);
    const [orders, columns] = await Promise.all([sheetOrdersOf(db.orm, scope, eventId), answerColumnsOf(db.orm, scope, eventId)]);
    const columnCount = GOOGLE_SHEET_ORDER_COLUMNS.length + columns.length;
    const grid = sheetGridFor(orders.length, columnCount);

    let spreadsheetId = connection.spreadsheetId;
    if (!spreadsheetId) {
      const created = await google.createSpreadsheet(accessToken, {
        title: googleSheetTitle(event.name),
        locale: GOOGLE_SHEET_LOCALE,
        timeZone: GOOGLE_SHEET_TIME_ZONE,
        sheet: { sheetId: SHEET_ORDERS_TAB_ID, title: GOOGLE_SHEET_ORDERS_TAB, grid, frozenRowCount: 1 },
      });
      spreadsheetId = await saveSpreadsheet(db.orm, connectionId, created);
      if (!spreadsheetId) return { result: 'disconnected' };
    }

    if (!(await connectionExists(db.orm, connectionId))) return { result: 'disconnected' };
    await google.resizeGrid(accessToken, spreadsheetId, SHEET_ORDERS_TAB_ID, grid);
    await google.writeValues(accessToken, spreadsheetId, sheetRange(GOOGLE_SHEET_ORDERS_TAB, 1, 1, columnCount), [
      sheetHeaderRow(columns),
    ]);

    for (let start = 0; start < orders.length; start += SHEET_SYNC_BATCH) {
      if (!(await connectionExists(db.orm, connectionId))) return { result: 'disconnected' };
      const batch = orders.slice(start, start + SHEET_SYNC_BATCH);
      const ids = batch.map((order) => order.id);
      const [answers, checkins] = await Promise.all([
        answersOfOrders(db.orm, ids),
        checkinCountsOfOrders(db.orm, scope, eventId, ids),
      ]);
      const rows = batch.map((order) =>
        sheetOrderRow(order, { answers: answers.get(order.id), checkin: checkins.get(order.id) }, columns),
      );
      // Dòng 1 là tiêu đề: Đơn thứ `start` (đếm từ 0) nằm ở dòng `start + 2`.
      const range = sheetRange(GOOGLE_SHEET_ORDERS_TAB, start + 2, start + 1 + batch.length, columnCount);
      await google.writeValues(accessToken, spreadsheetId, range, rows);
    }

    if (!(await markSynced(db.orm, connectionId))) return { result: 'disconnected' };
    return { result: 'synced', orders: orders.length, spreadsheetId };
  } catch (err) {
    if (!(err instanceof GoogleApiError)) throw err;
    // Kết nối đã bị xóa giữa chừng: không ghi trạng thái, không retry.
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
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, SHEET_INITIAL_SYNC_QUEUE, {
      logger: this.logger,
      label: 'Lần đẩy đầu lên Google Sheets',
      logContext: ({ connectionId }) => ({ connectionId }),
      dedupeBy: ({ connectionId }) => connectionId,
      handle: async ({ connectionId }) => {
        const outcome = await runSheetInitialSync(
          { db: this.db, google: this.google, secretBox: this.secretBox },
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

/**
 * Job nền của `integration` cho vai `worker`: lần đẩy đầu lên Google Sheets (Story 6.4). Cần `DbModule` và `JobsModule`
 * (toàn cục) ở gốc DI.
 */
@Module({})
export class IntegrationJobsModule {
  static forRoot(config: IntegrationConfig): DynamicModule {
    return {
      module: IntegrationJobsModule,
      providers: [...integrationProviders(config), SheetSyncWorker],
    };
  }
}
