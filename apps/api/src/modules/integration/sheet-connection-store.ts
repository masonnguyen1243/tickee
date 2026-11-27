import { SheetConnectionStatus, type SheetSyncErrorCode } from '@tickee/contracts';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { orgScope } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { sheetConnections, sheetDirtyRows } from './schema.js';

/*
 * Đọc và ghi dòng `sheet_connections` (Story 6.4) và `sheet_dirty_rows` (Story 6.5), dùng chung cho route BTC, callback
 * OAuth và worker. Mọi lệnh ghi của worker theo `id` kết nối: dòng đã bị xóa ("Ngắt kết nối") thì không ghi gì và báo cho
 * người gọi dừng.
 */

export type SheetConnectionRow = typeof sheetConnections.$inferSelect;

/** Kết nối của Sự kiện `eventId` thuộc BTC `scope`; chưa kết nối → `null`. */
export async function connectionOfEvent(
  db: DbExecutor,
  scope: { organizationId: string },
  eventId: string,
): Promise<SheetConnectionRow | null> {
  const [row] = await db
    .select()
    .from(sheetConnections)
    .where(and(orgScope(scope)(sheetConnections), eq(sheetConnections.eventId, eventId)));
  return row ?? null;
}

/**
 * Kết nối của Sự kiện `eventId` cho handler `sheet_row_changed` (vai worker, payload chỉ có id), khóa `FOR SHARE` trong
 * `tx` của handler: "Ngắt kết nối" chờ handler commit rồi mới xóa (dòng bẩn đi theo), và lần cập nhật trạng thái cuối của
 * lần đẩy đầu (`markSynced`) chờ handler commit, nên lần đẩy đầu luôn thấy dòng bẩn của handler khi kiểm `hasDirty`, hoặc
 * handler thấy `last_synced_at` đã có và tự hẹn flush. Chưa kết nối → `null`.
 */
export async function connectionOfEventForShare(db: DbExecutor, eventId: string): Promise<SheetConnectionRow | null> {
  const [row] = await db.select().from(sheetConnections).where(eq(sheetConnections.eventId, eventId)).for('share');
  return row ?? null;
}

/** Kết nối theo id (worker); đã bị xóa → `null`. */
export async function connectionById(db: DbExecutor, connectionId: string): Promise<SheetConnectionRow | null> {
  const [row] = await db.select().from(sheetConnections).where(eq(sheetConnections.id, connectionId));
  return row ?? null;
}

/** Kết nối còn tồn tại không (worker kiểm trước mỗi lô ghi). */
export async function connectionExists(db: DbExecutor, connectionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sheetConnections.id })
    .from(sheetConnections)
    .where(eq(sheetConnections.id, connectionId));
  return row !== undefined;
}

/**
 * Lưu spreadsheet vừa tạo vào kết nối, chỉ khi kết nối chưa có spreadsheet: trả id spreadsheet kết nối đang giữ (id vừa
 * lưu, hoặc id đã có từ một lần chạy khác), `null` khi kết nối đã bị xóa.
 */
export async function saveSpreadsheet(
  db: DbExecutor,
  connectionId: string,
  spreadsheet: { spreadsheetId: string; spreadsheetUrl: string },
): Promise<string | null> {
  const [saved] = await db
    .update(sheetConnections)
    .set({ ...spreadsheet, updatedAt: sql`now()` })
    .where(and(eq(sheetConnections.id, connectionId), isNull(sheetConnections.spreadsheetId)))
    .returning({ spreadsheetId: sheetConnections.spreadsheetId });
  if (saved?.spreadsheetId) return saved.spreadsheetId;
  return (await connectionById(db, connectionId))?.spreadsheetId ?? null;
}

/**
 * Ghi lỗi Google của lần chạy: `retrying` (lỗi tạm thời) hoặc `auth_revoked` (mất quyền), kèm `last_error_code`. Không
 * đụng kết nối đã `auth_revoked` (giữ mã lỗi đã chốt). Trả `false` khi kết nối đã bị xóa (hoặc đã `auth_revoked`).
 */
export async function markSyncFailure(
  db: DbExecutor,
  connectionId: string,
  status: typeof SheetConnectionStatus.RETRYING | typeof SheetConnectionStatus.AUTH_REVOKED,
  code: SheetSyncErrorCode,
): Promise<boolean> {
  const rows = await db
    .update(sheetConnections)
    .set({ status, lastErrorCode: code, updatedAt: sql`now()` })
    .where(and(eq(sheetConnections.id, connectionId), ne(sheetConnections.status, SheetConnectionStatus.AUTH_REVOKED)))
    .returning({ id: sheetConnections.id });
  return rows.length > 0;
}

/** Lần đẩy xong: `active`, `last_synced_at` = đồng hồ DB, xóa mã lỗi. `false` khi kết nối đã bị xóa. */
export async function markSynced(db: DbExecutor, connectionId: string): Promise<boolean> {
  const rows = await db
    .update(sheetConnections)
    .set({
      status: SheetConnectionStatus.ACTIVE,
      lastSyncedAt: sql`now()`,
      lastErrorCode: null,
      updatedAt: sql`now()`,
    })
    .where(eq(sheetConnections.id, connectionId))
    .returning({ id: sheetConnections.id });
  return rows.length > 0;
}

/**
 * Sheet của kết nối không còn dùng được (spreadsheet 404, mất tab, mất cột Mã Đơn; Quyết định 2 của Story 6.5): CAS theo
 * `spreadsheet_id` đang giữ, đặt lại `spreadsheet_id`, `spreadsheet_url`, `last_synced_at`, `last_error_code` và
 * `sheet_tab_id` (mặc định 0), chuyển `syncing`. Dòng bẩn giữ nguyên. `false` khi kết nối đã bị xóa hoặc đã đổi Sheet.
 */
export async function resetSpreadsheet(db: DbExecutor, connectionId: string, spreadsheetId: string): Promise<boolean> {
  const rows = await db
    .update(sheetConnections)
    .set({
      status: SheetConnectionStatus.SYNCING,
      spreadsheetId: null,
      spreadsheetUrl: null,
      lastSyncedAt: null,
      lastErrorCode: null,
      sheetTabId: sql`DEFAULT`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sheetConnections.id, connectionId), eq(sheetConnections.spreadsheetId, spreadsheetId)))
    .returning({ id: sheetConnections.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Dòng bẩn (Story 6.5, AD-23)
// ---------------------------------------------------------------------------------------------------------------

/** Một dòng bẩn: Đơn và `version` lúc đọc (flush chỉ xóa khi `version` vẫn bằng giá trị này). */
export interface DirtyRow {
  orderId: string;
  version: number;
}

/**
 * Đánh dấu bẩn các Đơn `orderIds` của kết nối. `bump` (mặc định, handler `sheet_row_changed`): dòng đã có thì tăng
 * `version` và cập nhật `marked_at`, nên flush đang ghi bản cũ không xóa được dấu này. `keep` (điền cột vừa thêm cho mọi
 * Đơn): dòng đã có giữ nguyên (nó sẽ được ghi đủ mọi cột Tickee ở lượt nào đó). `orderIds` rỗng → không truy vấn.
 */
export async function markDirty(
  db: DbExecutor,
  connectionId: string,
  orderIds: readonly string[],
  mode: 'bump' | 'keep' = 'bump',
): Promise<void> {
  if (orderIds.length === 0) return;
  const insert = db
    .insert(sheetDirtyRows)
    .values([...new Set(orderIds)].map((orderId) => ({ connectionId, orderId })));
  if (mode === 'keep') {
    await insert.onConflictDoNothing({ target: [sheetDirtyRows.connectionId, sheetDirtyRows.orderId] });
    return;
  }
  await insert.onConflictDoUpdate({
    target: [sheetDirtyRows.connectionId, sheetDirtyRows.orderId],
    set: { version: sql`${sheetDirtyRows.version} + 1`, markedAt: sql`now()` },
  });
}

/**
 * Tối đa `limit` dòng bẩn của kết nối, đánh dấu gần nhất trước (rồi theo id Đơn): sau khi điền cột vừa thêm cho hàng
 * nghìn Đơn (`keep`), thanh toán và check-in mới (`bump` đặt `marked_at = now()`) vẫn lên Sheet ở lượt kế, không chờ
 * ⌈N/500⌉ lượt.
 */
export async function dirtyRowsOf(db: DbExecutor, connectionId: string, limit: number): Promise<DirtyRow[]> {
  return db
    .select({ orderId: sheetDirtyRows.orderId, version: sheetDirtyRows.version })
    .from(sheetDirtyRows)
    .where(eq(sheetDirtyRows.connectionId, connectionId))
    .orderBy(desc(sheetDirtyRows.markedAt), asc(sheetDirtyRows.orderId))
    .limit(limit);
}

/**
 * Xóa các dòng bẩn đã ghi xong, chỉ dòng có `version` vẫn bằng giá trị đã đọc: Đơn đổi lại giữa lượt (`version` đã tăng)
 * giữ dấu cho lượt sau. Trả số dòng đã xóa.
 */
export async function clearDirty(db: DbExecutor, connectionId: string, rows: readonly DirtyRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const deleted = await db
    .delete(sheetDirtyRows)
    .where(
      and(
        eq(sheetDirtyRows.connectionId, connectionId),
        sql`(${sheetDirtyRows.orderId}, ${sheetDirtyRows.version}) IN (SELECT * FROM jsonb_to_recordset(${JSON.stringify(
          rows.map((row) => ({ order_id: row.orderId, version: row.version })),
        )}::jsonb) AS r(order_id uuid, version integer))`,
      ),
    )
    .returning({ orderId: sheetDirtyRows.orderId });
  return deleted.length;
}

/** Kết nối còn dòng bẩn nào không. */
export async function hasDirty(db: DbExecutor, connectionId: string): Promise<boolean> {
  const [row] = await db
    .select({ orderId: sheetDirtyRows.orderId })
    .from(sheetDirtyRows)
    .where(eq(sheetDirtyRows.connectionId, connectionId))
    .limit(1);
  return row !== undefined;
}
