import type { CellBlock, ColumnMetadata, GridSize, SheetCellValue } from './google-client.js';
import { sheetCellOf } from './sheet-rows.js';

/*
 * Bố cục Sheet dùng chung cho lần đẩy đầu và flush (Story 6.4, 6.5): lưới tối thiểu, vị trí cột Tickee theo developer
 * metadata, và vùng ô cần ghi. Hàm thuần, không gọi Google hay DB.
 */

/** Số Đơn mỗi lô đọc và ghi của lần đẩy đầu; số dòng bẩn tối đa mỗi lượt flush. */
export const SHEET_SYNC_BATCH = 500;

/** Id tab "Đơn" đặt lúc tạo spreadsheet (cũng là mặc định của `sheet_connections.sheet_tab_id`). */
export const SHEET_ORDERS_TAB_ID = 0;

/** Lưới tối thiểu của tab mới (bằng mặc định của Google Sheets): chỉ nới thêm khi cần, không bao giờ thu nhỏ. */
export const SHEET_MIN_GRID: GridSize = { rowCount: 1_000, columnCount: 26 };

/** Lưới cần cho tiêu đề + `orders` dòng và `columns` cột, không nhỏ hơn `SHEET_MIN_GRID`. */
export const sheetGridFor = (orders: number, columns: number): GridSize => ({
  rowCount: Math.max(SHEET_MIN_GRID.rowCount, 1 + orders),
  columnCount: Math.max(SHEET_MIN_GRID.columnCount, columns),
});

/**
 * Vị trí cột Tickee trên tab `sheetId` theo developer metadata: mã cột → chỉ số cột (đếm từ 0). Metadata của tab khác bị
 * bỏ qua; cùng mã ở nhiều cột (vd. BTC chép cột) → cột trái nhất.
 */
export function columnPositions(metadata: readonly ColumnMetadata[], sheetId: number): Map<string, number> {
  const positions = new Map<string, number>();
  for (const { value, sheetId: tab, columnIndex } of metadata) {
    if (tab !== sheetId) continue;
    const known = positions.get(value);
    if (known === undefined || columnIndex < known) positions.set(value, columnIndex);
  }
  return positions;
}

/** Một dòng cần ghi: chỉ số dòng (đếm từ 0; dòng 0 là tiêu đề) và giá trị ô theo mã cột. */
export interface SheetRowWrite {
  row: number;
  values: ReadonlyMap<string, SheetCellValue>;
}

/**
 * Vùng ô cần ghi cho `rows` trên tab `sheetId`: chỉ các cột trong `positions` (cột Tickee). Cột Tickee không liền nhau
 * (BTC chèn cột ở giữa) tách thành nhiều đoạn; các dòng liền nhau gộp thành một vùng cho mỗi đoạn. Mã cột Đơn không có
 * giá trị (câu không trả lời) → `''`, để ghi lại thì xóa giá trị cũ. Ô của cột không phải cột Tickee không bao giờ nằm
 * trong vùng nào.
 */
export function cellBlocks(
  sheetId: number,
  positions: ReadonlyMap<string, number>,
  rows: readonly SheetRowWrite[],
): CellBlock[] {
  const columns = [...positions].sort((a, b) => a[1] - b[1]);
  const runs: { start: number; keys: string[] }[] = [];
  for (const [key, index] of columns) {
    const last = runs.at(-1);
    if (last && last.start + last.keys.length === index) last.keys.push(key);
    else runs.push({ start: index, keys: [key] });
  }
  const sorted = [...rows].sort((a, b) => a.row - b.row);
  const groups: SheetRowWrite[][] = [];
  for (const row of sorted) {
    const group = groups.at(-1);
    if (group && group.at(-1)!.row + 1 === row.row) group.push(row);
    else groups.push([row]);
  }
  return groups.flatMap((group) =>
    runs.map((run) => ({
      sheetId,
      row: group[0]!.row,
      column: run.start,
      values: group.map((row) => run.keys.map((key) => sheetCellOf(row.values, key))),
    })),
  );
}
