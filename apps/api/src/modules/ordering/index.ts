// Mô-đun `ordering`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export {
  changeCapacity,
  createInventory,
  deleteInventory,
  inventoryOf,
  lockInventoryForEvent,
  type InventoryRow,
} from './inventory.service.js';
export { OrderingModule } from './ordering.module.js';
export { AVAILABILITY_CLOCK, type AvailabilityClock } from './public-availability.controller.js';
export { sellability, sellabilityOf } from './sellability.js';
