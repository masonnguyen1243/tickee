// Mô-đun `tingee`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { TingeeModule, type TingeeConfig } from './tingee.module.js';
export {
  HttpTingeeClient,
  TINGEE_ACCOUNT_PAGE_SIZE,
  TINGEE_CLIENT,
  TINGEE_TIMEOUT_MS,
  tingeeError,
  type TingeeAccount,
  type TingeeClient,
  type TingeeClientOptions,
  type TingeeCredential,
} from './tingee.client.js';
export { domainErrorOf, TINGEE_ERROR_CODES, type TingeeDomainError } from './errors.js';
export { tingeePortalUrl } from './portal.js';
export { parseTingeeTimestamp, sign, tingeeTimestamp, verifySignature } from './signing.js';
