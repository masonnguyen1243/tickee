import { createHash, randomBytes } from 'node:crypto';

/** Token lời mời: 128 bit ngẫu nhiên, base64url (22 ký tự), chỉ nằm trong email. */
export function generateInvitationToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Dạng lưu DB của token (`organization_invitations.token_hash`): SHA-256 hex. Token đủ 128 bit ngẫu nhiên nên không cần
 * HMAC có khóa; lộ DB không suy ra được link.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
