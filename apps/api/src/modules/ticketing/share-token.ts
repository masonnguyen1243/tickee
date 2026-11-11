import { createHash, createHmac } from 'node:crypto';
import type { TicketQrKeys } from './qr.js';

/*
 * Token link chia sẻ Vé (AD-29, Story 3.8). Suy ra, không ngẫu nhiên: token = 16 byte đầu của HMAC-SHA256(khóa con,
 * `share:<ticketId>:<share_version>`), base64url (22 ký tự). Khóa con = HMAC-SHA256(khóa `TICKET_QR_KEYS` phiên bản
 * `tickets.qr_key_version` của Vé, `SHARE_KEY_LABEL`), tách miền với chữ ký Mã QR vé. Không cần biến env mới.
 *
 * DB chỉ lưu `share_token_hash` (SHA-256 hex, unique) và `share_version`: lộ DB không lộ link (thiếu khóa thì không tính
 * được token từ hash). Máy chủ tính lại token khi cần (trang Đơn của chủ Vé, email Vé), nên bấm "Chia sẻ Vé" nhiều lần ra
 * cùng một link. "Tạo lại link" tăng `share_version` và ghi hash mới: link cũ không còn khớp hash nào.
 */

/** Nhãn tách miền của khóa con ký token link chia sẻ (đổi nhãn = mọi link hiện có chết). */
export const SHARE_KEY_LABEL = 'tickee:ticket-share-link:v1';

/** Số byte của token (128 bit). */
const SHARE_TOKEN_BYTES = 16;

/**
 * Token link chia sẻ của Vé `ticketId` (uuid, so chữ thường) ở phiên bản link `shareVersion`, bằng khóa QR `keyVersion`
 * của Vé. Khóa `keyVersion` không còn trong `TICKET_QR_KEYS` → ném lỗi cấu hình (như `signTicketQr`).
 */
export function shareTokenOf(keys: TicketQrKeys, ticketId: string, keyVersion: number, shareVersion: number): string {
  const subKey = keys.derive(keyVersion, SHARE_KEY_LABEL);
  if (subKey === null) throw new Error(`TICKET_QR_KEYS không còn khóa phiên bản v${keyVersion} để tính link chia sẻ Vé`);
  return createHmac('sha256', subKey)
    .update(`share:${ticketId.toLowerCase()}:${shareVersion}`, 'utf8')
    .digest()
    .subarray(0, SHARE_TOKEN_BYTES)
    .toString('base64url');
}

/** Dạng lưu DB của token (`tickets.share_token_hash`): SHA-256 hex. Token đã 128 bit khó đoán nên không cần khóa. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
