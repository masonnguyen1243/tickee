// Mô-đun `integration`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
// Google Sheets (Story 6.4): route BTC và callback OAuth (vai api), lần đẩy đầu (vai worker). Story 6.5: đánh dấu dòng bẩn
// (`sheet_row_changed`, queue khai báo ở `ticketing`) và flush lên Sheet (vai worker).
export { IntegrationModule, type IntegrationApiConfig } from './integration.module.js';
export { type IntegrationConfig } from './integration.config.js';
export { IntegrationJobsModule, type IntegrationJobsOptions } from './integration-jobs.module.js';
export { SheetFlushWorker } from './sheet-flush-jobs.js';
export { SheetSyncWorker } from './sheet-sync-jobs.js';
