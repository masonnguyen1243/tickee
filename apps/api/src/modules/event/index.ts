// Mô-đun `event`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { EventModule } from './event.module.js';
export { EVENT_SLUG_SUFFIX, type SlugSuffixGenerator } from './event.service.js';
export {
  assertPublicSlug,
  eventNotFound,
  publicEventBySlug,
  saleEventById,
  type PublicEventRef,
} from './public-event.js';
export { organizationLocked, paidSalesAllowed, refundPolicySet, type PaidSalesRules } from './sale-rules.js';
export {
  assertEventOfOrganization,
  assertTicketTypeId,
  deleteTicketTypeRow,
  insertTicketType,
  lockEventForTicketTypes,
  ticketTypeChangedFields,
  ticketTypeDetailOf,
  ticketTypeNotFound,
  ticketTypesOf,
  updateTicketTypeRow,
  type TicketTypeRow,
  type TicketTypeValues,
} from './ticket-type.service.js';
