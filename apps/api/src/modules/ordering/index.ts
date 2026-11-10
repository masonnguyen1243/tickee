// Mô-đun `ordering`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export {
  changeCapacity,
  createInventory,
  deleteInventory,
  inventoryOf,
  lockInventoryForEvent,
  type InventoryRow,
} from './inventory.service.js';
export { OrderPayments, type MarkPaidResult } from './mark-paid.js';
export { ORDER_CODE_GENERATOR, type OrderCodeGenerator } from './order-code.js';
export { OrderingJobsModule } from './order-jobs.js';
export { type OrderingConfig } from './order-rate-limit.js';
export { OrderingModule } from './ordering.module.js';
export { ORDER_HOLD } from './orders.service.js';
export { AVAILABILITY_CLOCK, type AvailabilityClock } from './public-availability.controller.js';
export { type PaidSource } from './schema.js';
export { saleStatusOf, sellability, sellabilityOf } from './sellability.js';
