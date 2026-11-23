// Mô-đun `identity`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { ConsentExempt } from './consent.guard.js';
export { IdentityJanitorModule } from './identity-janitor.js';
export { IdentityModule } from './identity.module.js';
export type { IdentityConfig } from './identity.config.js';
export {
  assertReauth,
  consumeReauth,
  reauthProof,
  type ReauthProof,
  type SessionRequest,
} from './reauth.service.js';
export { findUserIdByEmail, hasTwoFactorEnabled, setPlatformAdmin, userContacts, type UserContact } from './user-directory.js';
/**
 * Route không bắt buộc đăng nhập (`SessionGuard` vẫn tra session): ẩn danh vẫn qua; có session thì gắn `req.user`, và
 * guard 2FA, đồng ý NĐ 13 vẫn áp. Xuất lại ở đây vì nơi khác không được import Better Auth (AD-19).
 */
export { OptionalAuth } from '@thallesp/nestjs-better-auth';
