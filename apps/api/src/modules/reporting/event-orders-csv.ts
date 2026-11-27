import {
  CSV_BOM,
  csvBuyerPhone,
  csvDigitsAsText,
  csvRow,
  eventOrderItemsText,
  formatVnTimestamp,
  ORDER_STATUS_LABEL,
  REVIEW_TYPE_LABEL,
} from '@tickee/contracts';
import type { EventAnswerColumn, EventOrderListRow } from '../ordering/index.js';
import type { OpenReview } from '../payment/index.js';
import type { CheckinCounts } from '../ticketing/index.js';

/*
 * Định dạng CSV danh sách Đơn (Story 6.3, FR-31): hàm thuần dựng phần đầu file và dòng của một Đơn từ dữ liệu một lô, tách
 * khỏi stream để test. Thoát ô theo chuẩn chung `csvRow` của contracts (BOM, CRLF, chống CSV injection). Chỉ dùng mã Đơn
 * `TK…`: không có id nội bộ, Mã QR vé hay token chia sẻ.
 */

/** Cột cố định, theo thứ tự; sau đó là mỗi câu hỏi form một cột. */
export const EVENT_ORDERS_CSV_COLUMNS = [
  'Mã Đơn',
  'Tên người mua',
  'Email',
  'SĐT',
  'Vé',
  'Số tiền',
  'Đã nhận',
  'Trạng thái',
  'Cần xử lý',
  'Thời gian tạo',
  'Thời gian thanh toán',
  'Đã check-in',
  'Số Vé',
] as const;

/** Phần đầu file: BOM rồi hàng tiêu đề (cột cố định, rồi nhãn câu hỏi form theo thứ tự cột). */
export const eventOrdersCsvHead = (columns: readonly EventAnswerColumn[]): string =>
  `${CSV_BOM}${csvRow([...EVENT_ORDERS_CSV_COLUMNS, ...columns.map((column) => column.label)])}`;

/** Dữ liệu ghép cho một Đơn của lô: mục Cần xử lý `open` cũ nhất, số check-in, câu trả lời theo id câu hỏi. */
export interface EventOrderCsvExtras {
  review: OpenReview | undefined;
  checkin: CheckinCounts | undefined;
  answers: ReadonlyMap<string, string> | undefined;
}

/**
 * Dòng CSV của một Đơn:
 * - Số tiền (`total_amount`), Đã nhận (`paid_amount`, trống khi `null`): số nguyên VND, không dấu chấm, không "đ";
 * - Trạng thái: nhãn như badge; Cần xử lý: tên loại của mục `open` cũ nhất ở mọi trạng thái Đơn, trống nếu không có;
 * - thời gian: `yyyy-MM-dd HH:mm:ss` giờ Việt Nam; Thời gian thanh toán trống khi chưa thanh toán;
 * - Đã check-in · Số Vé: hai số trên Vé `valid` (số đã check-in, số Vé), không gộp thành "k/N" vì Excel và Google
 *   Sheets đổi "2/3" thành ngày; Đơn không có Vé `valid` → cả hai trống;
 * - mỗi câu hỏi form (theo `columns`) một ô, trống khi Đơn không trả lời câu đó; câu trả lời toàn chữ số dễ bị Excel làm
 *   hỏng (CCCD, SĐT) giữ là chữ (`csvDigitsAsText`).
 */
export function eventOrderCsvLine(
  order: EventOrderListRow,
  { review, checkin, answers }: EventOrderCsvExtras,
  columns: readonly EventAnswerColumn[],
): string {
  const hasValidTickets = checkin !== undefined && checkin.validTicketCount > 0;
  return csvRow([
    order.code,
    order.buyerName,
    order.buyerEmail,
    csvBuyerPhone(order.buyerPhone),
    eventOrderItemsText(order.items),
    order.totalAmount,
    order.paidAmount,
    ORDER_STATUS_LABEL[order.status],
    review ? REVIEW_TYPE_LABEL[review.type] : null,
    formatVnTimestamp(order.createdAt),
    order.paidAt ? formatVnTimestamp(order.paidAt) : null,
    hasValidTickets ? checkin.checkedInCount : null,
    hasValidTickets ? checkin.validTicketCount : null,
    ...columns.map((column) => csvDigitsAsText(answers?.get(column.questionId) ?? null)),
  ]);
}
