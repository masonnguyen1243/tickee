// Mô-đun `identity`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { ConsentExempt } from './consent.guard.js';
export { IdentityJanitorModule } from './identity-janitor.js';
export { IdentityModule } from './identity.module.js';
export type { IdentityConfig } from './identity.config.js';
export { consumeReauth, type ReauthProof } from './reauth.service.js';
export { findUserIdByEmail, setPlatformAdmin, userContacts, type UserContact } from './user-directory.js';
