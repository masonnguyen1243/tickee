import { csvBuyerPhone, eventOrderItemsText, formatVnTimestamp, ORDER_STATUS_LABEL } from '@tickee/contracts';
import type { EventAnswerColumn, EventOrderListRow } from '../ordering/index.js';
import type { CheckinCounts } from '../ticketing/index.js';
import type { SheetCellValue } from './google-client.js';

/*
 * Dòng Sheet danh sách Đơn (Story 6.4, Quyết định 2): hàm thuần dựng hàng tiêu đề và dòng của một Đơn, cùng cột và cách
 * định dạng với CSV 6.3 nhưng bỏ cột "Cần xử lý" (`integration` không được gọi `payment`); cột "Trạng thái" vẫn ghi "Cần
 * xử lý" cho Đơn `review`. Chỉ mã Đơn `TK…`: không id nội bộ, Mã QR vé hay token. Ghi bằng `valueInputOption=RAW` nên chữ
 * giữ nguyên là chữ (không thêm `'` như mẹo Excel của CSV), số tiền là số; ô trống là `''` để ghi lại cùng vùng thì xóa
 * giá trị cũ của ô.
 */

/** Cột cố định, theo thứ tự; sau đó là mỗi câu hỏi form một cột (`answerColumnsOf`). */
export const GOOGLE_SHEET_ORDER_COLUMNS = [
  'Mã Đơn',
  'Tên người mua',
  'Email',
  'SĐT',
  'Vé',
  'Số tiền',
  'Đã nhận',
  'Trạng thái',
  'Thời gian tạo',
  'Thời gian thanh toán',
  'Đã check-in',
  'Số Vé',
] as const;

/** Hàng tiêu đề: cột cố định, rồi nhãn câu hỏi form theo thứ tự cột. */
export const sheetHeaderRow = (columns: readonly EventAnswerColumn[]): SheetCellValue[] => [
  ...GOOGLE_SHEET_ORDER_COLUMNS,
  ...columns.map((column) => column.label),
];

/** Dữ liệu ghép cho một Đơn: số check-in và câu trả lời theo id câu hỏi. */
export interface SheetOrderExtras {
  checkin: CheckinCounts | undefined;
  answers: ReadonlyMap<string, string> | undefined;
}

/**
 * Dòng Sheet của một Đơn:
 * - Số tiền (`total_amount`), Đã nhận (`paid_amount`, trống khi `null`): số nguyên VND;
 * - SĐT "0912 345 678"; Vé "2 × VIP, 1 × Thường"; Trạng thái theo nhãn badge;
 * - thời gian `yyyy-MM-dd HH:mm:ss` giờ Việt Nam; Thời gian thanh toán trống khi chưa thanh toán;
 * - Đã check-in · Số Vé: hai số trên Vé `valid`; Đơn không có Vé `valid` → cả hai trống;
 * - mỗi câu hỏi form (theo `columns`) một ô nguyên văn, trống khi Đơn không trả lời câu đó.
 */
export function sheetOrderRow(
  order: EventOrderListRow,
  { checkin, answers }: SheetOrderExtras,
  columns: readonly EventAnswerColumn[],
): SheetCellValue[] {
  const hasValidTickets = checkin !== undefined && checkin.validTicketCount > 0;
  return [
    order.code,
    order.buyerName,
    order.buyerEmail,
    csvBuyerPhone(order.buyerPhone),
    eventOrderItemsText(order.items),
    order.totalAmount,
    order.paidAmount ?? '',
    ORDER_STATUS_LABEL[order.status],
    formatVnTimestamp(order.createdAt),
    order.paidAt ? formatVnTimestamp(order.paidAt) : '',
    hasValidTickets ? checkin.checkedInCount : '',
    hasValidTickets ? checkin.validTicketCount : '',
    ...columns.map((column) => answers?.get(column.questionId) ?? ''),
  ];
}

/** Tên cột A1 của cột thứ `index` (đếm từ 1): 1 → `A`, 26 → `Z`, 27 → `AA`. */
export function sheetColumnName(index: number): string {
  if (!Number.isInteger(index) || index < 1) throw new RangeError('sheetColumnName: cột đếm từ 1');
  let name = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * Vùng A1 từ dòng `firstRow` tới `lastRow` (đếm từ 1), cột A tới cột thứ `columnCount` của tab `tab`. Tên tab luôn bọc
 * `'…'` (`'` bên trong nhân đôi): `'Đơn'!A2:N501`.
 */
export function sheetRange(tab: string, firstRow: number, lastRow: number, columnCount: number): string {
  return `'${tab.replace(/'/g, "''")}'!A${firstRow}:${sheetColumnName(columnCount)}${lastRow}`;
}
