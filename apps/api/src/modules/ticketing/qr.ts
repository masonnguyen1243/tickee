import { createHmac, timingSafeEqual } from 'node:crypto';
import { TICKET_QR_PATTERN } from '@tickee/contracts';
import { parseCredentialKeys, type CredentialKey } from '../../platform/crypto/index.js';

/*
 * Mã QR vé (AD-16, Story 3.3): `t<k>.<ticketId>.<sig>`, `sig` = base64url(HMAC-SHA256(khóa k, `t<k>.<ticketId>`)). Khóa
 * từ env `TICKET_QR_KEYS` (cùng dạng `TINGEE_CREDENTIAL_KEYS`); Vé mới ký bằng khóa có `k` lớn nhất và lưu `k`
 * (`tickets.qr_key_version`). Chuỗi QR và chữ ký không bao giờ vào DB hay log: tính lại khi đọc. Lỗi không chứa khóa.
 */

/** Token DI của `TicketQrKeys` (dựng từ `TICKET_QR_KEYS`). */
export const TICKET_QR_KEYS = Symbol('TICKET_QR_KEYS');

/** Các khóa ký Mã QR vé theo phiên bản. */
export class TicketQrKeys {
  private readonly keys: ReadonlyMap<number, Buffer>;
  /** Phiên bản ký Vé mới: lớn nhất trong danh sách. */
  readonly currentVersion: number;

  constructor(keys: readonly CredentialKey[]) {
    if (keys.length === 0) throw new Error('TICKET_QR_KEYS cần ít nhất một khóa');
    const map = new Map<number, Buffer>();
    for (const { version, key } of keys) {
      if (map.has(version)) throw new Error(`TICKET_QR_KEYS trùng phiên bản v${version}`);
      map.set(version, Buffer.from(key));
    }
    this.keys = map;
    this.currentVersion = Math.max(...map.keys());
  }

  /** Từ giá trị env đã kiểm (`v<k>:<base64>,…`). */
  static parse(raw: string): TicketQrKeys {
    return new TicketQrKeys(parseCredentialKeys(raw));
  }

  has(version: number): boolean {
    return this.keys.has(version);
  }

  /** Chữ ký base64url (43 ký tự) của `payload` bằng khóa `version`; không có khóa → `null`. */
  mac(version: number, payload: string): string | null {
    const key = this.keys.get(version);
    return key ? createHmac('sha256', key).update(payload, 'utf8').digest('base64url') : null;
  }

  /**
   * Khóa con 32 byte = HMAC-SHA256(khóa `version`, `label`), cho việc khác chữ ký QR (vd. token link chia sẻ Vé). Nhãn
   * tách miền: khóa con không bao giờ là chữ ký của một Mã QR (`label` không có dạng `t<k>.<ticketId>`), và chữ ký QR
   * không bao giờ dùng khóa con. Không có khóa → `null`.
   */
  derive(version: number, label: string): Buffer | null {
    const key = this.keys.get(version);
    return key ? createHmac('sha256', key).update(label, 'utf8').digest() : null;
  }
}

/** Kết quả kiểm một Mã QR vé hợp lệ. */
export interface VerifiedTicketQr {
  ticketId: string;
  keyVersion: number;
}

/**
 * Mã QR của Vé `ticketId` (uuid chữ thường) ký bằng khóa `version` (mặc định khóa hiện hành). Khóa `version` không còn
 * trong `TICKET_QR_KEYS` (bị gỡ khi Vé còn dùng) → ném lỗi cấu hình.
 */
export function signTicketQr(keys: TicketQrKeys, ticketId: string, version = keys.currentVersion): string {
  const payload = `t${version}.${ticketId.toLowerCase()}`;
  const sig = keys.mac(version, payload);
  if (sig === null) throw new Error(`TICKET_QR_KEYS không còn khóa phiên bản v${version} để tính Mã QR vé`);
  return `${payload}.${sig}`;
}

/**
 * Kiểm Mã QR vé (cho check-in, Epic 5): sai dạng, `k` không có trong `TICKET_QR_KEYS`, hay chữ ký không khớp → `null`.
 * So chữ ký bằng `timingSafeEqual`. Chỉ nói chữ ký đúng; Vé còn hiệu lực hay không là việc của người gọi.
 */
export function verifyTicketQr(keys: TicketQrKeys, qr: string): VerifiedTicketQr | null {
  if (!TICKET_QR_PATTERN.test(qr)) return null;
  const lastDot = qr.lastIndexOf('.');
  const payload = qr.slice(0, lastDot);
  const sig = qr.slice(lastDot + 1);
  const firstDot = payload.indexOf('.');
  const keyVersion = Number(payload.slice(1, firstDot));
  const expected = keys.mac(keyVersion, payload);
  if (expected === null) return null;
  const given = Buffer.from(sig, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  return { ticketId: payload.slice(firstDot + 1), keyVersion };
}
