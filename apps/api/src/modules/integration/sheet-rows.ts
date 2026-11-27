import {
  csvBuyerPhone,
  eventOrderItemsText,
  formatVnTimestamp,
  GoogleSheetColumn,
  googleSheetQuestionColumn,
  ORDER_STATUS_LABEL,
} from '@tickee/contracts';
import type { EventAnswerColumn, EventOrderListRow } from '../ordering/index.js';
import type { CheckinCounts } from '../ticketing/index.js';
import type { SheetCellValue } from './google-client.js';

/*
 * Dòng Sheet danh sách Đơn (Story 6.4, Quyết định 2; Story 6.5, Quyết định 1 và 3): hàm thuần dựng cột Tickee và giá trị
 * ô của một Đơn theo mã cột, cùng cột và cách định dạng với CSV 6.3 nhưng bỏ cột "Cần xử lý" (`integration` không được gọi
 * `payment`) và thêm "Check-in tay"; cột "Trạng thái" vẫn ghi "Cần xử lý" cho Đơn `review`. Mỗi cột có mã ổn định (giá trị
 * developer metadata `tickee.column` gắn vào cột trên Sheet), nên ô được ghi theo mã cột, không theo vị trí. Chỉ mã Đơn
 * `TK…`: không id nội bộ, Mã QR vé hay token. Ghi bằng `valueInputOption=RAW` nên chữ giữ nguyên là chữ (không thêm `'`
 * như mẹo Excel của CSV), số tiền là số; ô trống là `''` để ghi lại thì xóa giá trị cũ của ô.
 */

/** Một cột Tickee: mã (giá trị metadata `tickee.column`) và tiêu đề ghi lúc tạo cột. */
export interface SheetColumn {
  key: string;
  header: string;
}

/** Cột cố định, theo thứ tự của Sheet mới; sau đó là mỗi câu hỏi form một cột (`answerColumnsOf`). */
export const GOOGLE_SHEET_ORDER_COLUMNS: readonly SheetColumn[] = [
  { key: GoogleSheetColumn.ORDER_CODE, header: 'Mã Đơn' },
  { key: GoogleSheetColumn.BUYER_NAME, header: 'Tên người mua' },
  { key: GoogleSheetColumn.BUYER_EMAIL, header: 'Email' },
  { key: GoogleSheetColumn.BUYER_PHONE, header: 'SĐT' },
  { key: GoogleSheetColumn.ITEMS, header: 'Vé' },
  { key: GoogleSheetColumn.TOTAL_AMOUNT, header: 'Số tiền' },
  { key: GoogleSheetColumn.PAID_AMOUNT, header: 'Đã nhận' },
  { key: GoogleSheetColumn.STATUS, header: 'Trạng thái' },
  { key: GoogleSheetColumn.CREATED_AT, header: 'Thời gian tạo' },
  { key: GoogleSheetColumn.PAID_AT, header: 'Thời gian thanh toán' },
  { key: GoogleSheetColumn.CHECKED_IN, header: 'Đã check-in' },
  { key: GoogleSheetColumn.MANUAL_CHECKED_IN, header: 'Check-in tay' },
  { key: GoogleSheetColumn.TICKET_COUNT, header: 'Số Vé' },
];

/** Mọi cột Tickee của Sự kiện: cột cố định, rồi mỗi câu hỏi form (theo `columns`) một cột, tiêu đề là nhãn hiện tại. */
export const sheetColumnsOf = (columns: readonly EventAnswerColumn[]): SheetColumn[] => [
  ...GOOGLE_SHEET_ORDER_COLUMNS,
  ...columns.map((column) => ({ key: googleSheetQuestionColumn(column.questionId), header: column.label })),
];

/** Hàng tiêu đề của Sheet mới: tiêu đề các cột Tickee theo thứ tự. */
export const sheetHeaderRow = (columns: readonly EventAnswerColumn[]): SheetCellValue[] =>
  sheetColumnsOf(columns).map((column) => column.header);

/** Dữ liệu ghép cho một Đơn: số check-in và câu trả lời theo id câu hỏi. */
export interface SheetOrderExtras {
  checkin: CheckinCounts | undefined;
  answers: ReadonlyMap<string, string> | undefined;
}

/**
 * Giá trị ô của một Đơn theo mã cột (cột cố định và `question:<id>` của mọi câu Đơn đã trả lời):
 * - Số tiền (`total_amount`), Đã nhận (`paid_amount`, trống khi `null`): số nguyên VND;
 * - SĐT "0912 345 678"; Vé "2 × VIP, 1 × Thường"; Trạng thái theo nhãn badge;
 * - thời gian `yyyy-MM-dd HH:mm:ss` giờ Việt Nam; Thời gian thanh toán trống khi chưa thanh toán;
 * - Đã check-in · Check-in tay · Số Vé: ba số trên Vé `valid`; Đơn không có Vé `valid` → cả ba trống;
 * - mỗi câu hỏi form một ô nguyên văn. Câu Đơn không trả lời không có trong Map: `sheetCellOf` trả `''`.
 */
export function sheetOrderValues(order: EventOrderListRow, { checkin, answers }: SheetOrderExtras): Map<string, SheetCellValue> {
  const hasValidTickets = checkin !== undefined && checkin.validTicketCount > 0;
  const values = new Map<string, SheetCellValue>([
    [GoogleSheetColumn.ORDER_CODE, order.code],
    [GoogleSheetColumn.BUYER_NAME, order.buyerName],
    [GoogleSheetColumn.BUYER_EMAIL, order.buyerEmail],
    [GoogleSheetColumn.BUYER_PHONE, csvBuyerPhone(order.buyerPhone)],
    [GoogleSheetColumn.ITEMS, eventOrderItemsText(order.items)],
    [GoogleSheetColumn.TOTAL_AMOUNT, order.totalAmount],
    [GoogleSheetColumn.PAID_AMOUNT, order.paidAmount ?? ''],
    [GoogleSheetColumn.STATUS, ORDER_STATUS_LABEL[order.status]],
    [GoogleSheetColumn.CREATED_AT, formatVnTimestamp(order.createdAt)],
    [GoogleSheetColumn.PAID_AT, order.paidAt ? formatVnTimestamp(order.paidAt) : ''],
    [GoogleSheetColumn.CHECKED_IN, hasValidTickets ? checkin.checkedInCount : ''],
    [GoogleSheetColumn.MANUAL_CHECKED_IN, hasValidTickets ? checkin.manualCheckedInCount : ''],
    [GoogleSheetColumn.TICKET_COUNT, hasValidTickets ? checkin.validTicketCount : ''],
  ]);
  for (const [questionId, answer] of answers ?? []) values.set(googleSheetQuestionColumn(questionId), answer);
  return values;
}

/** Ô của cột `key` trong giá trị của một Đơn; không có (câu không trả lời) → `''`. */
export const sheetCellOf = (values: ReadonlyMap<string, SheetCellValue>, key: string): SheetCellValue =>
  values.get(key) ?? '';

/** Dòng Sheet của một Đơn theo thứ tự cột của Sheet mới (`sheetColumnsOf(columns)`). */
export function sheetOrderRow(
  order: EventOrderListRow,
  extras: SheetOrderExtras,
  columns: readonly EventAnswerColumn[],
): SheetCellValue[] {
  const values = sheetOrderValues(order, extras);
  return sheetColumnsOf(columns).map((column) => sheetCellOf(values, column.key));
}
