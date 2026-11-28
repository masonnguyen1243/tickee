import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  GOOGLE_SHEET_COLUMN_METADATA_KEY,
  GOOGLE_SHEET_ORDER_STATUSES,
  GoogleSheetColumn,
  SheetConnectionStatus,
  type SheetRowChangedPayload,
  type SheetSyncErrorCode,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import type { SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { BOSS, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import { ticketEventById } from '../event/index.js';
import { answerColumnsOf, answersOfOrders, eventOrdersPageOf } from '../ordering/index.js';
import { checkinCountsOfOrders, SHEET_ROW_CHANGED_QUEUE } from '../ticketing/index.js';
import { GoogleApiError, type GoogleSheetsClient } from './google-client.js';
import { GOOGLE_SHEETS_CLIENT, SHEETS_SECRET_BOX } from './integration.config.js';
import {
  clearDirty,
  connectionById,
  connectionExists,
  connectionOfEventForShare,
  dirtyRowsOf,
  markDirty,
  markSynced,
  resetSpreadsheet,
  type SheetConnectionRow,
} from './sheet-connection-store.js';
import {
  scheduleSheetFlush,
  SHEET_FLUSH_QUEUE,
  SHEET_FLUSH_SETTINGS,
  type SheetFlushSettings,
} from './sheet-flush-queue.js';
import { cellBlocks, columnPositions, SHEET_SYNC_BATCH } from './sheet-layout.js';
import { sheetColumnsOf, sheetOrderValues } from './sheet-rows.js';
import {
  enqueueSheetInitialSync,
  openRefreshToken,
  recordGoogleFailure,
  scheduleFlushIfDirty,
  SHEET_INITIAL_SYNC_QUEUE,
  sheetOrdersOf,
  type SheetSyncDeps,
} from './sheet-sync-jobs.js';

/*
 * Đồng bộ Đơn và check-in lên Google Sheets trong 1 phút (Story 6.5, FR-32, AD-23), vai worker.
 *
 * Handler `integration.sheet_row_changed` `{ eventId, orderId }` (producer: `ordering`, `ticketing`): trong một transaction,
 * khóa kết nối của Sự kiện `FOR SHARE`; không có kết nối → xong; có (mọi trạng thái) → upsert dòng bẩn và tăng `version`;
 * chỉ hẹn flush khi lần đẩy đầu đã xong (`last_synced_at` có) và kết nối không `auth_revoked`. Lần đẩy đầu chưa xong → chỉ
 * đánh dấu (lần đẩy đầu xong thì tự hẹn flush); `auth_revoked` → chỉ đánh dấu, giữ cho 6.6.
 *
 * Flush `integration.sheet-flush` `{ connectionId }` (debounce theo kết nối, policy `singleton`), mỗi lượt:
 *   1. đọc kết nối (không còn, `auth_revoked`, lần đẩy đầu chưa xong → xong, không gọi Google) và tối đa 500 dòng bẩn
 *      `(order_id, version)`, đánh dấu gần nhất trước (không có → xong);
 *   2. tìm tab theo `sheet_tab_id`, đọc lưới; tìm cột Tickee theo developer metadata `tickee.column`. Spreadsheet 404, mất
 *      tab hay mất cột Mã Đơn (cả Sheet của 6.4 chưa có metadata) → tạo Sheet mới (Quyết định 2): đặt lại Sheet của kết nối,
 *      chuyển `syncing`, enqueue lần đẩy đầu với id job mới trong cùng transaction, giữ dòng bẩn; không báo BTC;
 *   3. đọc Đơn qua read model của `ordering`/`ticketing`, lọc theo BTC của kết nối và bốn trạng thái đồng bộ (Đơn khác →
 *      bỏ qua, vẫn xóa dấu);
 *   4. đọc toàn bộ cột Mã Đơn (kể cả dòng 1, phòng BTC xóa hay dời dòng tiêu đề), khớp nguyên chuỗi `TK…`, trùng mã thì
 *      dòng đầu; không thấy → thêm sau dòng cuối cùng có giá trị trong cột Mã Đơn (Đơn mới theo thứ tự tạo). Không dùng
 *      `values:append`;
 *   5. cột Tickee thiếu (BTC xóa cột trừ Mã Đơn, câu hỏi form mới đã có câu trả lời) → đánh dấu bẩn mọi Đơn đồng bộ của Sự
 *      kiện (không đè dấu đã có), rồi thêm cột ở cuối lưới kèm tiêu đề (nhãn hiện tại) và metadata;
 *   6. nới lưới cho đủ dòng (chỉ nới), ghi đúng các ô của cột Tickee theo `gridRange` (`RAW`), kể cả khi cột Tickee không
 *      liền nhau; ô của cột BTC không bị chạm;
 *   7. xóa dòng bẩn đã đọc khi `version` vẫn bằng giá trị đã đọc (Đơn đổi giữa lượt giữ dấu), `active` + `last_synced_at`,
 *      xóa `last_error_code`; còn dòng bẩn → hẹn lượt sau.
 * Trước khi ghi và trước khi cập nhật trạng thái kiểm kết nối còn tồn tại ("Ngắt kết nối" xóa luôn dòng bẩn). Không gọi
 * Google trong transaction DB. Lỗi Google phân loại như lần đẩy đầu: mất quyền → `auth_revoked` (không retry, giữ dòng
 * bẩn); lỗi tạm thời (kể cả 403 quota) → `retrying` + `last_error_code`, pg-boss retry có backoff, hết lượt → dead-letter.
 * Không log token hay giá trị Đơn.
 */

/** Số dòng bẩn tối đa mỗi lượt flush (còn thì hẹn lượt sau). */
export const SHEET_FLUSH_BATCH = SHEET_SYNC_BATCH;

/** Phụ thuộc của handler `sheet_row_changed`. */
export type SheetRowChangedDeps = Pick<SheetSyncDeps, 'db' | 'boss' | 'flushWindowSeconds'>;

/** Kết quả handler `sheet_row_changed` (cho log và test). */
export type SheetRowChangedOutcome =
  /** Sự kiện chưa kết nối: không ghi gì. */
  | 'no_connection'
  /** Đã đánh dấu bẩn; chưa hẹn flush (lần đẩy đầu chưa xong, hoặc `auth_revoked`). */
  | 'marked'
  /** Đã đánh dấu bẩn và hẹn flush. */
  | 'scheduled';

/** Handler `sheet_row_changed` (xem chú thích đầu file): một transaction, không gọi Google. */
export async function markSheetRowChanged(
  deps: SheetRowChangedDeps,
  { eventId, orderId }: SheetRowChangedPayload,
): Promise<SheetRowChangedOutcome> {
  return deps.db.transaction(async (tx) => {
    const connection = await connectionOfEventForShare(tx, eventId);
    if (!connection) return 'no_connection';
    await markDirty(tx, connection.id, [orderId]);
    if (connection.lastSyncedAt === null || connection.status === SheetConnectionStatus.AUTH_REVOKED) return 'marked';
    await scheduleSheetFlush(deps.boss, tx, connection.id, deps.flushWindowSeconds);
    return 'scheduled';
  });
}

/** Lý do tạo Sheet mới (Quyết định 2). */
export type SheetRecreateReason = 'spreadsheet_not_found' | 'tab_not_found' | 'order_code_column_missing';

/** Kết quả một lượt flush (cho log và test). */
export type SheetFlushOutcome =
  /** Không gọi Google. */
  | {
      result: 'skipped';
      reason: 'not_found' | 'auth_revoked' | 'initial_sync_pending' | 'clean' | 'event_not_found';
    }
  /** Kết nối bị xóa giữa chừng: dừng, không cập nhật trạng thái. */
  | { result: 'disconnected' }
  /**
   * Đã ghi: `updated` dòng có sẵn, `appended` dòng thêm mới, `skipped` dòng bẩn của Đơn ngoài bốn trạng thái (bỏ qua, đã
   * xóa dấu), `columnsAdded` cột Tickee thêm ở cuối lưới; `more`: còn dòng bẩn, đã hẹn lượt sau.
   */
  | { result: 'flushed'; updated: number; appended: number; skipped: number; columnsAdded: number; more: boolean }
  /** Sheet mất: đã đặt lại kết nối về `syncing` và enqueue lần đẩy đầu mới; dòng bẩn giữ nguyên. */
  | { result: 'recreating'; reason: SheetRecreateReason }
  /** Mất quyền: kết nối `auth_revoked`, không retry; dòng bẩn giữ nguyên. */
  | { result: 'auth_revoked'; code: SheetSyncErrorCode }
  /** Lỗi tạm thời: kết nối `retrying`, pg-boss retry; dòng bẩn giữ nguyên. */
  | { result: 'retry'; code: SheetSyncErrorCode };

/**
 * Sheet của kết nối không còn dùng được (Quyết định 2): trong một transaction, CAS đặt lại Sheet (`syncing`, không
 * `spreadsheet_id`, không `last_synced_at`) và enqueue lần đẩy đầu với id job suy từ spreadsheet bị thay. Dòng bẩn giữ
 * nguyên; lần đẩy đầu xong thì hẹn flush. Sheet cũ (nếu còn) giữ nguyên trong Drive.
 */
async function recreateSheet(
  deps: SheetSyncDeps,
  connection: SheetConnectionRow,
  spreadsheetId: string,
  reason: SheetRecreateReason,
): Promise<SheetFlushOutcome> {
  const reset = await deps.db.transaction(async (tx) => {
    if (!(await resetSpreadsheet(tx, connection.id, spreadsheetId))) return false;
    await enqueueSheetInitialSync(deps.boss, tx, connection.id, spreadsheetId);
    return true;
  });
  return reset ? { result: 'recreating', reason } : { result: 'disconnected' };
}

/** Id mọi Đơn đồng bộ của Sự kiện (để điền cột vừa thêm). */
async function syncedOrderIdsOf(db: Database, scope: { organizationId: string }, eventId: string): Promise<string[]> {
  return (await sheetOrdersOf(db.orm, scope, eventId)).map((order) => order.id);
}

/**
 * Một lượt flush cho kết nối `connectionId` (xem chú thích đầu file). Lỗi DB hay không giải mã được refresh token → ném
 * (pg-boss retry, hết lượt → dead-letter). Lỗi Google → trả `recreating` / `auth_revoked` / `retry` sau khi ghi trạng thái
 * (kết nối đã bị xóa thì không ghi gì).
 */
export async function runSheetFlush(deps: SheetSyncDeps, connectionId: string): Promise<SheetFlushOutcome> {
  const { db, google } = deps;
  const connection = await connectionById(db.orm, connectionId);
  if (!connection) return { result: 'skipped', reason: 'not_found' };
  if (connection.status === SheetConnectionStatus.AUTH_REVOKED) return { result: 'skipped', reason: 'auth_revoked' };
  const { spreadsheetId } = connection;
  if (connection.lastSyncedAt === null || !spreadsheetId) return { result: 'skipped', reason: 'initial_sync_pending' };
  const dirty = await dirtyRowsOf(db.orm, connectionId, SHEET_FLUSH_BATCH);
  if (dirty.length === 0) return { result: 'skipped', reason: 'clean' };

  const refreshToken = openRefreshToken(deps.secretBox, connection);
  const event = await ticketEventById(db.orm, connection.eventId);
  if (!event || event.organizationId !== connection.organizationId) return { result: 'skipped', reason: 'event_not_found' };
  const scope = { organizationId: connection.organizationId };
  const { eventId } = connection;

  try {
    const accessToken = await google.accessToken(refreshToken);
    const tab = (await google.spreadsheetInfo(accessToken, spreadsheetId)).find(
      (candidate) => candidate.sheetId === connection.sheetTabId,
    );
    if (!tab) return await recreateSheet(deps, connection, spreadsheetId, 'tab_not_found');
    const tagged = columnPositions(
      await google.columnMetadata(accessToken, spreadsheetId, GOOGLE_SHEET_COLUMN_METADATA_KEY),
      tab.sheetId,
    );
    const codeColumn = tagged.get(GoogleSheetColumn.ORDER_CODE);
    if (codeColumn === undefined) return await recreateSheet(deps, connection, spreadsheetId, 'order_code_column_missing');

    const [page, answerColumns] = await Promise.all([
      eventOrdersPageOf(db.orm, scope, eventId, {
        orderIds: dirty.map((row) => row.orderId),
        statuses: GOOGLE_SHEET_ORDER_STATUSES,
        limit: dirty.length,
      }),
      answerColumnsOf(db.orm, scope, eventId),
    ]);
    // Read model trả mới → cũ: Đơn chưa có trên Sheet được thêm theo thứ tự tạo.
    const orders = [...page.orders].reverse();
    const columns = sheetColumnsOf(answerColumns);
    const required = new Set(columns.map((column) => column.key));
    const positions = new Map([...tagged].filter(([key]) => required.has(key)));
    const missing = columns.filter((column) => !positions.has(column.key));

    // Dòng của từng Đơn theo cột Mã Đơn: khớp nguyên chuỗi, trùng mã thì dòng đầu. Xét cả dòng 0: BTC có thể đã xóa hay
    // dời dòng tiêu đề (chữ tiêu đề không bao giờ trùng mã `TK…`).
    const codes = await google.readColumn(accessToken, spreadsheetId, tab.sheetId, codeColumn);
    const rowOfCode = new Map<string, number>();
    let lastRow = 0;
    codes.forEach((value, row) => {
      if (value === '') return;
      lastRow = row;
      if (!rowOfCode.has(value)) rowOfCode.set(value, row);
    });
    let appended = 0;
    const targets = orders.map((order) => {
      let row = rowOfCode.get(order.code);
      if (row === undefined) {
        row = ++lastRow;
        appended += 1;
      }
      return { order, row };
    });

    if (!(await connectionExists(db.orm, connectionId))) return { result: 'disconnected' };
    let grid = tab.grid;
    if (missing.length > 0) {
      // Đánh dấu trước khi thêm cột: lượt này lỗi sau khi thêm cột thì các lượt sau vẫn điền đủ cột đó.
      await markDirty(db.orm, connectionId, await syncedOrderIdsOf(db, scope, eventId), 'keep');
      await google.appendColumns(
        accessToken,
        spreadsheetId,
        tab.sheetId,
        grid.columnCount,
        GOOGLE_SHEET_COLUMN_METADATA_KEY,
        missing,
      );
      missing.forEach((column, i) => positions.set(column.key, grid.columnCount + i));
      grid = { ...grid, columnCount: grid.columnCount + missing.length };
    }
    const rowCount = Math.max(0, ...targets.map((target) => target.row + 1));
    await google.expandGrid(accessToken, spreadsheetId, tab.sheetId, grid, { rowCount, columnCount: grid.columnCount });

    const ids = orders.map((order) => order.id);
    const [answers, checkins] = await Promise.all([
      answersOfOrders(db.orm, ids),
      checkinCountsOfOrders(db.orm, scope, eventId, ids),
    ]);
    const rows = targets.map(({ order, row }) => ({
      row,
      values: sheetOrderValues(order, { answers: answers.get(order.id), checkin: checkins.get(order.id) }),
    }));
    await google.writeCells(accessToken, spreadsheetId, cellBlocks(tab.sheetId, positions, rows));

    if (!(await connectionExists(db.orm, connectionId))) return { result: 'disconnected' };
    await clearDirty(db.orm, connectionId, dirty);
    if (!(await markSynced(db.orm, connectionId))) return { result: 'disconnected' };
    const more = await scheduleFlushIfDirty(deps, connectionId);
    return {
      result: 'flushed',
      updated: targets.length - appended,
      appended,
      skipped: dirty.length - orders.length,
      columnsAdded: missing.length,
      more,
    };
  } catch (err) {
    if (!(err instanceof GoogleApiError)) throw err;
    if (err.kind === 'not_found') return recreateSheet(deps, connection, spreadsheetId, 'spreadsheet_not_found');
    return recordGoogleFailure(db, connectionId, err);
  }
}

/**
 * Vai `worker`: tạo queue `sheet_row_changed` và queue flush (kèm dead-letter), rồi đăng ký hai handler. Queue lần đẩy đầu
 * (flush enqueue khi tạo lại Sheet) được tạo trước.
 */
@Injectable()
export class SheetFlushWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('SheetFlushWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(GOOGLE_SHEETS_CLIENT) private readonly google: GoogleSheetsClient,
    @Inject(SHEETS_SECRET_BOX) private readonly secretBox: SecretBox,
    @Inject(SHEET_FLUSH_SETTINGS) private readonly settings: SheetFlushSettings,
  ) {}

  private get deps(): SheetSyncDeps {
    return {
      db: this.db,
      google: this.google,
      secretBox: this.secretBox,
      boss: this.boss,
      flushWindowSeconds: this.settings.windowSeconds,
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    await SHEET_INITIAL_SYNC_QUEUE.ensure(this.boss);
    // Queue flush đăng ký trước: handler `sheet_row_changed` enqueue vào nó.
    await registerQueueWorker(this.boss, SHEET_FLUSH_QUEUE, {
      logger: this.logger,
      label: 'Flush dòng bẩn lên Google Sheets',
      logContext: ({ connectionId }) => ({ connectionId }),
      // Fetch của policy `singleton` chỉ trả tối đa một job mỗi kết nối, nên các job trong lô là các kết nối khác nhau.
      parallel: true,
      handle: async ({ connectionId }) => {
        const outcome = await runSheetFlush(this.deps, connectionId);
        if (outcome.result === 'retry') {
          this.logger.warn({ code: outcome.code }, 'Google Sheets lỗi tạm thời khi flush; pg-boss sẽ thử lại');
          return { status: 'retry', reason: `Google Sheets lỗi tạm thời (${outcome.code})` };
        }
        if (outcome.result === 'auth_revoked') {
          this.logger.warn({ code: outcome.code }, 'Google Sheets: mất quyền ghi khi flush; giữ dòng bẩn, không thử lại');
        } else if (outcome.result === 'recreating') {
          this.logger.warn({ reason: outcome.reason }, 'Google Sheets: Sheet không còn dùng được; tạo Sheet mới');
        } else if (outcome.result === 'flushed') {
          const { updated, appended, skipped, columnsAdded, more } = outcome;
          this.logger.log({ updated, appended, skipped, columnsAdded, more }, 'Google Sheets: đã flush dòng bẩn');
        } else {
          this.logger.log({ result: outcome.result }, 'Google Sheets: flush không chạy tiếp');
        }
        return JOB_COMPLETED;
      },
    });
    await registerQueueWorker(this.boss, SHEET_ROW_CHANGED_QUEUE, {
      logger: this.logger,
      label: 'Đánh dấu dòng bẩn Google Sheets',
      logContext: ({ eventId, orderId }) => ({ eventId, orderId }),
      // Cùng Đơn nhiều lần trong một lô: một lần đánh dấu là đủ (chưa lượt flush nào đọc giữa các lần đó).
      dedupeBy: ({ eventId, orderId }) => `${eventId}:${orderId}`,
      handle: async (payload) => {
        await markSheetRowChanged(this.deps, payload);
        return JOB_COMPLETED;
      },
    });
  }
}
