// Mô-đun `ordering`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { type OrderingJobsConfig } from './buyer-email-jobs.js';
export { enqueueEventChangeEmail, EventChangeEmailQueues, paidBuyerCount } from './event-change-email-jobs.js';
export {
  eventRevenueOf,
  pendingPaymentCountOf,
  recentOrdersOf,
  reviewOrdersOf,
  type EventOrdersScope,
  type EventRevenue,
  type RecentOrderRow,
  type ReviewOrderRow,
} from './event-overview-read.js';
export {
  changeCapacity,
  createInventory,
  deleteInventory,
  inventoryOf,
  lockInventoryForEvent,
  type InventoryRow,
} from './inventory.service.js';
export {
  OrderPayments,
  OrderPaymentsModule,
  orderForPayment,
  type GatewaySource,
  type ManualApproval,
  type ManualSourceStatus,
  type MarkPaidOptions,
  type MarkPaidOutcome,
  type MarkPaidResult,
  type OrderForPayment,
} from './mark-paid.js';
export {
  matchableOrderOf,
  matchCandidatesOf,
  type MatchableOrder,
  type MatchCandidateRow,
  type MatchScope,
} from './match-read.js';
export { notifyEventOrdersChanged } from './order-changed.js';
export { ORDER_CODE_GENERATOR, type OrderCodeGenerator } from './order-code.js';
export { markExpired, OrderingJobsModule, type MarkExpiredResult } from './order-jobs.js';
export { type OrderingConfig } from './order-rate-limit.js';
export { OrderReviewDecisions, type OrderDecision } from './order-review.js';
export { OrderingModule } from './ordering.module.js';
export { ORDER_HOLD } from './orders.service.js';
export {
  enqueueReconciliation,
  orderForReconciliation,
  RECONCILE_AFTER_EXPIRY_MS,
  RECONCILE_MAX_FAILURES,
  RECONCILE_ORDER_QUEUE,
  RECONCILE_RESUMED_EXPIRED_WINDOW_MS,
  reconcilableOrderIdsOf,
  ReconcileOrderPayload,
  scheduleNextReconciliation,
  scheduleReconciliationRetry,
  type OrderForReconciliation,
} from './reconciliation-jobs.js';
export { AVAILABILITY_CLOCK, type AvailabilityClock } from './public-availability.controller.js';
export { type PaidSource } from './schema.js';
export { saleStatusOf, sellability, sellabilityOf } from './sellability.js';
