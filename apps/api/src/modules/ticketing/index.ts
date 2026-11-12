// Mô-đun `ticketing`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { type OwnTicket, type OwnTicketDetail } from './my-tickets.js';
export { signTicketQr, TICKET_QR_KEYS, TicketQrKeys, verifyTicketQr, type VerifiedTicketQr } from './qr.js';
export { hashShareToken, shareTokenOf } from './share-token.js';
export { TicketingModule, TicketingRoutesModule, type TicketingConfig } from './ticketing.module.js';
export {
  TicketsService,
  type IssuedTicket,
  type IssueTicketsInput,
  type TicketIssueLine,
} from './tickets.service.js';
