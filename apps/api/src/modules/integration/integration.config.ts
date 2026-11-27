import type { Provider } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox } from '../../platform/crypto/index.js';
import { GoogleSheetsClient } from './google-client.js';

/** Biến env của `integration` (vai api và worker đọc cùng nhóm `GOOGLE_SHEETS_*`, `GOOGLE_OAUTH_*`). */
export type IntegrationConfig = Pick<
  ApiConfig,
  | 'GOOGLE_SHEETS_CLIENT_ID'
  | 'GOOGLE_SHEETS_CLIENT_SECRET'
  | 'GOOGLE_SHEETS_TOKEN_KEYS'
  | 'GOOGLE_OAUTH_AUTHORIZE_URL'
  | 'GOOGLE_OAUTH_TOKEN_URL'
  | 'GOOGLE_SHEETS_API_URL'
>;

/** Token DI: `GoogleSheetsClient` dựng từ config (test thay bằng client trỏ vào Google fake với timeout ngắn). */
export const GOOGLE_SHEETS_CLIENT = Symbol('GOOGLE_SHEETS_CLIENT');

/** Token DI: `SecretBox` của `GOOGLE_SHEETS_TOKEN_KEYS` (mã hóa refresh token và `code_verifier`). */
export const SHEETS_SECRET_BOX = Symbol('SHEETS_SECRET_BOX');

export const googleSheetsClientOf = (config: IntegrationConfig): GoogleSheetsClient =>
  new GoogleSheetsClient({
    clientId: config.GOOGLE_SHEETS_CLIENT_ID,
    clientSecret: config.GOOGLE_SHEETS_CLIENT_SECRET,
    authorizeUrl: config.GOOGLE_OAUTH_AUTHORIZE_URL,
    tokenUrl: config.GOOGLE_OAUTH_TOKEN_URL,
    sheetsApiUrl: config.GOOGLE_SHEETS_API_URL,
  });

export const sheetsSecretBoxOf = (config: Pick<IntegrationConfig, 'GOOGLE_SHEETS_TOKEN_KEYS'>): SecretBox =>
  new SecretBox(parseCredentialKeys(config.GOOGLE_SHEETS_TOKEN_KEYS));

/** Provider dùng chung của hai vai: client Google và `SecretBox`. */
export const integrationProviders = (config: IntegrationConfig): Provider[] => [
  { provide: GOOGLE_SHEETS_CLIENT, useValue: googleSheetsClientOf(config) },
  { provide: SHEETS_SECRET_BOX, useValue: sheetsSecretBoxOf(config) },
];
