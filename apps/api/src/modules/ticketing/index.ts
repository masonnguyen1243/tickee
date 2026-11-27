// Mô-đun `ticketing`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
// Check-in đúng một lần (Story 5.3): quét (`flows`), số đã check-in / tổng Vé hợp lệ theo Hạng vé (`checkin`, Story 5.7).
export {
  CHECKIN_RECENT_SECONDS,
  checkIn,
  checkinCountsByTicketType,
  type CheckedInTicket,
  type CheckinCounts,
  type CheckInInput,
  type CheckInResult,
  type TicketTypeCheckinCounts,
} from './check-in.js';
export { issuedTicketCountsByType } from './issued-counts.js';
// Tra tay (Story 5.5): Vé `valid` của các Đơn khớp SĐT/email (`flows`).
export { validTicketsOfOrders, type LookupTicketRow } from './lookup-read.js';
export { type OwnTicket, type OwnTicketDetail } from './my-tickets.js';
// CSV danh sách Đơn (Story 6.3): số Vé `valid` / đã check-in theo Đơn, cho cột "Check-in" "k/N" (`reporting`).
export { checkinCountsOfOrders } from './order-checkin-counts.js';
// Tab Đơn (Story 6.1): Vé của một Đơn cho `Sheet` chi tiết (`reporting`).
export { orderTicketsOf, type OrderTicketRow } from './order-tickets-read.js';
export { signTicketQr, TICKET_QR_KEYS, TicketQrKeys, verifyTicketQr, type VerifiedTicketQr } from './qr.js';
export { hashShareToken, shareTokenOf } from './share-token.js';
export { TicketingModule, TicketingRoutesModule, TicketQrKeyCheck, type TicketingConfig } from './ticketing.module.js';
export {
  TICKET_QR_KEY_MISSING_ALERT,
  TicketsService,
  type IssuedTicket,
  type IssueTicketsInput,
  type TicketIssueLine,
} from './tickets.service.js';
