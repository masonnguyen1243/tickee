import type { ApiConfig } from '../../platform/config/index.js';

/** Phần cấu hình `identity` cần (tách khỏi `APP_CONFIG` để mô-đun không phụ thuộc gốc DI của vai api). */
export type IdentityConfig = Pick<
  ApiConfig,
  | 'NODE_ENV'
  | 'BETTER_AUTH_SECRET'
  | 'API_PUBLIC_URL'
  | 'WEB_ORIGIN'
  | 'AUTH_COOKIE_DOMAIN'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
>;

export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');
