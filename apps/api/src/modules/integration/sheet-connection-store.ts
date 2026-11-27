import { SheetConnectionStatus, type SheetSyncErrorCode } from '@tickee/contracts';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { orgScope } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { sheetConnections } from './schema.js';

/*
 * Đọc và ghi dòng `sheet_connections` (Story 6.4), dùng chung cho route BTC, callback OAuth và worker. Mọi lệnh ghi của
 * worker theo `id` kết nối: dòng đã bị xóa ("Ngắt kết nối") thì không ghi gì và báo cho người gọi dừng.
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
