// ---------------------------------------------------------------------------------------------------------------
// Chuẩn CSV dùng chung (Story 6.3, FR-31; Story 7.2 dùng lại cho danh sách hoàn tiền)
// ---------------------------------------------------------------------------------------------------------------

/*
 * File CSV của Tickee mở đúng bằng Excel và Google Sheets: UTF-8 bắt đầu bằng BOM (Excel mới nhận ra UTF-8 và hiện đúng
 * tiếng Việt), phân cách bằng dấu phẩy (RFC 4180), mỗi dòng kết thúc bằng CRLF. Không có dòng `sep=`: Excel thấy dòng
 * này thì bỏ qua BOM. Máy đặt Region Việt Nam (List separator `;`) mở qua Data › From Text/CSV.
 *
 * Chống CSV injection (OWASP): ô bắt đầu bằng `=`, `+`, `-`, `@`, tab hoặc CR được thêm `'` ở đầu, nên Excel không bao giờ
 * chạy công thức (Excel hiện dấu `'` ở ô đó). Sau đó ô chứa `"`, dấu phẩy, CR hoặc LF được bọc `"…"` và `"` bên trong
 * nhân đôi. Số (`number`) do Tickee tự dựng (số tiền nguyên VND) ghi nguyên, không thoát.
 */

/** Byte order mark UTF-8 (`EF BB BF`): ký tự đầu tiên của file. */
export const CSV_BOM = '\uFEFF';
/** Ký tự phân cách ô. */
export const CSV_DELIMITER = ',';
/** Kết thúc mỗi dòng (kể cả dòng cuối). */
export const CSV_LINE_END = '\r\n';

/** Ô có thể bị bảng tính hiểu là công thức. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Ô phải bọc ngoặc kép: có ngoặc kép, dấu phẩy, CR hoặc LF. */
const NEEDS_QUOTES = /[",\r\n]/;

/** Giá trị một ô: chữ, số nguyên do Tickee dựng, hoặc trống (`null`/`undefined`). */
export type CsvValue = string | number | null | undefined;

/**
 * Một ô đã thoát: `null`/`undefined` → ô trống; số → nguyên văn (phải hữu hạn); chữ bắt đầu bằng `=`, `+`, `-`, `@`, tab
 * hoặc CR → thêm `'` ở đầu, rồi chữ có `"`, `,`, CR hoặc LF → bọc `"…"`, `"` bên trong nhân đôi.
 * `=HYPERLINK("x")` → `"'=HYPERLINK(""x"")"`; `-1` → `'-1`; `A, "B"` → `"A, ""B"""`.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('csvCell: số phải hữu hạn');
    return String(value);
  }
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Chỉ gồm chữ số, và bắt đầu bằng `0` hoặc dài từ 12 chữ số: Excel mất số 0 đầu hoặc hiện dạng khoa học. */
const DIGITS_EXCEL_MANGLES = /^(?:0\d*|\d{12,})$/;

/**
 * Câu trả lời form toàn chữ số mà Excel sẽ làm hỏng (bắt đầu bằng `0`, hoặc dài từ 12 chữ số: CCCD `001203004567`, SĐT
 * người thân `0987654321`) → thêm `'` ở đầu như ô bị thoát, để Excel giữ đủ chữ số (ô hiện dấu `'`). Chữ khác (kể cả số
 * ngắn như `42`) giữ nguyên; `null` giữ nguyên. Chỉ dùng cho ô câu trả lời form, trước `csvCell`.
 */
export function csvDigitsAsText(value: string | null): string | null {
  return value !== null && DIGITS_EXCEL_MANGLES.test(value) ? `'${value}` : value;
}

/** Một dòng CSV: các ô đã thoát nối bằng dấu phẩy, kết thúc bằng CRLF. */
export const csvRow = (values: readonly CsvValue[]): string => `${values.map(csvCell).join(CSV_DELIMITER)}${CSV_LINE_END}`;
