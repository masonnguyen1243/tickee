// Mô-đun `ticketing`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
// Check-in đúng một lần (Story 5.3): quét (`flows`), số đã check-in / tổng Vé hợp lệ (`checkin`).
export {
  CHECKIN_RECENT_SECONDS,
  checkIn,
  checkinCountsOf,
  type CheckedInTicket,
  type CheckinCounts,
  type CheckInInput,
  type CheckInResult,
} from './check-in.js';
export { issuedTicketCountsByType } from './issued-counts.js';
// Tra tay (Story 5.5): Vé `valid` của các Đơn khớp SĐT/email (`flows`).
export { validTicketsOfOrders, type LookupTicketRow } from './lookup-read.js';
export { type OwnTicket, type OwnTicketDetail } from './my-tickets.js';
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
