import { createHash, randomBytes } from 'node:crypto';

/*
 * Chép từ `organizer/invitation-token.ts`: `checkin` không được import `organizer` (module-graph, AD-10).
 */

/** Token link mời CTV: 128 bit ngẫu nhiên, base64url (22 ký tự), chỉ nằm trong response lúc tạo. */
export function generateCheckerInviteToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Dạng lưu DB của token (`checker_invites.token_hash`): SHA-256 hex. Token đủ 128 bit ngẫu nhiên nên không cần HMAC có
 * khóa; lộ DB không suy ra được link.
 */
export function hashCheckerInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
