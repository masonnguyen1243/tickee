import { createHash, randomBytes } from 'node:crypto';

/*
 * `state` và PKCE của lượt OAuth Google Sheets (Story 6.4). Mỗi mô-đun tự có hàm hash token của mình (như `reauth_grants`
 * của `identity`, `checkin/invite-token.ts`); không dùng chung qua `platform`.
 */

/** `state` và `code_verifier`: 32 byte ngẫu nhiên, base64url không đệm (43 ký tự, hợp lệ cho PKCE). */
export const OAUTH_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 byte ngẫu nhiên, base64url không đệm. */
export const newOauthSecret = (): string => randomBytes(32).toString('base64url');

/** SHA-256 hex của `state`: thứ duy nhất DB lưu (`sheet_oauth_states.state_hash`). */
export const hashOauthState = (state: string): string => createHash('sha256').update(state, 'utf8').digest('hex');

/** `code_challenge` PKCE phương thức `S256`: base64url(SHA-256(`code_verifier`)). */
export const pkceChallengeOf = (codeVerifier: string): string =>
  createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
