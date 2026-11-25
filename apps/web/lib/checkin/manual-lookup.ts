import { CheckinLookupRateLimitedDetails, ScanOutcome, type CheckinLookupResult, type ScanResult } from '@tickee/contracts';

import { ApiError } from '@/lib/api/errors';

/*
 * Phần thuần của `manual-lookup` (Story 5.5, UX-DR32): câu chữ, câu báo `429`, cập nhật kết quả tra sau check-in tay và
 * luật dùng lại `Idempotency-Key`. Kiểm bằng Vitest môi trường node.
 */

/** Gõ dừng chừng này mili giây mới tra. */
export const LOOKUP_DEBOUNCE_MS = 200;

export const MANUAL_LOOKUP_TITLE = 'Tra tay';
/** Nhãn luôn hiện phía trên ô tìm (FR-29). */
export const MANUAL_LOOKUP_LABEL = 'SĐT hoặc email Người mua';
/** Ô có chữ mà chưa đủ dạng SĐT/email: không gửi request. */
export const LOOKUP_INCOMPLETE_TEXT = 'Nhập đủ SĐT hoặc email để tra.';
export const LOOKUP_EMPTY_TEXT = 'Không tìm thấy Vé khớp.';
/** Trình duyệt báo offline: không tra, không check-in tay (không có hàng đợi). */
export const LOOKUP_OFFLINE_TEXT = 'Tra tay cần mạng.';
export const LOOKUP_FAILED_TITLE = 'Chưa tra được';
export const CHECK_IN_FAILED_TITLE = 'Chưa check-in được. Bấm "Check-in" lại.';

/** "N Vé khớp". */
export const lookupCountText = (count: number): string => `${count} Vé khớp`;

/** "Hạng vé · Vé k/N" của một hàng; bỏ Hạng vé rỗng. */
export const lookupTicketMeta = (ticket: { ticketTypeName: string; seq: number; count: number }): string =>
  [ticket.ticketTypeName.trim(), `Vé ${ticket.seq}/${ticket.count}`].filter(Boolean).join(' · ');

/** Câu báo `429 CHECKIN_LOOKUP_RATE_LIMITED`: số giây chờ (thiếu `details` thì 60). */
export function lookupRateLimitedText(error: ApiError): string {
  const parsed = CheckinLookupRateLimitedDetails.safeParse(error.details);
  return `Tra quá nhiều lần. Thử lại sau ${parsed.success ? parsed.data.retryAfterSeconds : 60} giây.`;
}

/** Lỗi mạng (không có phản hồi) hoặc 5xx: bấm "Check-in" lại dùng cùng `Idempotency-Key`. */
export const isRetryableCheckInError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === null || error.status >= 500);

/** Kết quả check-in tay làm Vé thành "Đã check-in" ngay trong kết quả tra: xanh, trung tính, đỏ đã check-in. */
export const marksCheckedIn = (result: ScanResult): boolean => result.outcome !== ScanOutcome.INVALID;

/** Kết quả tra sau khi Vé `ticketId` đã check-in (không tra lại). */
export const withCheckedIn = (data: CheckinLookupResult, ticketId: string): CheckinLookupResult => ({
  tickets: data.tickets.map((ticket) => (ticket.ticketId === ticketId ? { ...ticket, checkedIn: true } : ticket)),
});

/** Còn Vé chưa check-in (khách đi nhóm): đóng overlay thì mở lại Sheet. */
export const hasUncheckedTickets = (data: CheckinLookupResult | undefined): boolean =>
  data?.tickets.some((ticket) => !ticket.checkedIn) ?? false;
