// Mô-đun `tingee`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { TingeeModule, type TingeeConfig } from './tingee.module.js';
export {
  CreateLinkError,
  HttpTingeeClient,
  TINGEE_ACCOUNT_PAGE_SIZE,
  TINGEE_CLIENT,
  TINGEE_CREATE_LINK_PATH,
  TINGEE_GET_ORDER_PATH,
  TINGEE_ORDER_STATUS_TIMEOUT_MS,
  TINGEE_PAYMENT_LINK_TIMEOUT_MS,
  TINGEE_TIMEOUT_MS,
  tingeeError,
  type CreateLinkAmbiguousReason,
  type PaymentLinkInput,
  type TingeeAccount,
  type TingeeClient,
  type TingeeClientOptions,
  type TingeeCredential,
} from './tingee.client.js';
export { domainErrorOf, TINGEE_ERROR_CODES, TINGEE_ORDER_NOT_FOUND_CODE, type TingeeDomainError } from './errors.js';
export { tingeePortalUrl } from './portal.js';
export { parseTingeeTimestamp, sign, tingeeTimestamp, verifySignature } from './signing.js';
