// Mô-đun `tingee`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { TingeeModule, type TingeeConfig } from './tingee.module.js';
export {
  HttpTingeeClient,
  TINGEE_CLIENT,
  TINGEE_TIMEOUT_MS,
  tingeeError,
  type ConfirmVaInput,
  type CreateMerchantInput,
  type CreateVaInput,
  type CreateVaResult,
  type LinkedVa,
  type TingeeClient,
  type TingeeClientOptions,
} from './tingee.client.js';
export { domainErrorOf, TINGEE_ERROR_CODES, type TingeeDomainError } from './errors.js';
export { parseTingeeTimestamp, sign, tingeeTimestamp, verifySignature } from './signing.js';
