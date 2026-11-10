import { createHmac } from 'node:crypto';
import { TICKET_QR_PATTERN } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';
import { signTicketQr, TicketQrKeys, verifyTicketQr } from '../../src/modules/ticketing/index.js';
import { testCredentialKey } from '../helpers.js';

/*
 * Story 3.3, AD-16: Mã QR vé `t<k>.<ticketId>.<sig>`, `sig` = base64url(HMAC-SHA256(khóa k, `t<k>.<ticketId>`)). Ký
 * bằng khóa có `k` lớn nhất; QR của Vé cũ không đổi khi thêm khóa mới; sai chữ ký hay `k` lạ → không hợp lệ.
 */

const TICKET = '019a3b2c-0b00-7abc-8def-000000000001';
const OTHER = '019a3b2c-0b00-7abc-8def-000000000002';
const v1 = testCredentialKey(1, 0x11);
const v2 = testCredentialKey(2, 0x22);

/** Đổi ký tự ở vị trí `at` sang một ký tự khác cùng bảng chữ (giữ đúng mẫu). */
function flip(qr: string, at: number): string {
  const c = qr[at]!;
  const replacement = c === 'a' ? 'b' : c === '0' ? '1' : /[0-9a-f]/.test(c) ? 'a' : c === 'A' ? 'B' : 'A';
  return `${qr.slice(0, at)}${replacement}${qr.slice(at + 1)}`;
}

describe('signTicketQr', () => {
  it('đúng mẫu t<k>.<ticketId>.<sig>, ký bằng khóa có k lớn nhất, cùng Vé ra cùng chuỗi', () => {
    const keys = TicketQrKeys.parse(`${v1},${v2}`);
    expect(keys.currentVersion).toBe(2);
    const qr = signTicketQr(keys, TICKET);
    expect(qr).toMatch(TICKET_QR_PATTERN);
    expect(qr.startsWith(`t2.${TICKET}.`)).toBe(true);
    expect(signTicketQr(keys, TICKET)).toBe(qr);
    expect(signTicketQr(keys, OTHER)).not.toBe(qr);
    // Đúng thuật toán của AD-16: base64url của HMAC-SHA256 trên `t<k>.<ticketId>`, không đệm.
    const expected = createHmac('sha256', Buffer.alloc(32, 0x22)).update(`t2.${TICKET}`).digest('base64url');
    expect(qr).toBe(`t2.${TICKET}.${expected}`);
  });

  it('ticketId chữ hoa được đưa về chữ thường; khóa phiên bản không có → lỗi cấu hình (không in khóa)', () => {
    const keys = TicketQrKeys.parse(v1);
    expect(signTicketQr(keys, TICKET.toUpperCase())).toBe(signTicketQr(keys, TICKET));
    expect(() => signTicketQr(keys, TICKET, 7)).toThrow(/v7/);
    try {
      signTicketQr(keys, TICKET, 7);
    } catch (err) {
      expect(String(err)).not.toContain(v1.slice(3));
    }
  });
});

describe('verifyTicketQr', () => {
  const keys = TicketQrKeys.parse(`${v1},${v2}`);
  const qr = signTicketQr(keys, TICKET);

  it('QR hợp lệ → ticketId và phiên bản khóa', () => {
    expect(verifyTicketQr(keys, qr)).toEqual({ ticketId: TICKET, keyVersion: 2 });
    expect(verifyTicketQr(keys, signTicketQr(keys, TICKET, 1))).toEqual({ ticketId: TICKET, keyVersion: 1 });
  });

  it('đổi một ký tự trong ticketId hoặc chữ ký → không hợp lệ', () => {
    const idStart = qr.indexOf('.') + 1;
    for (const at of [idStart, idStart + 20, qr.length - 1, qr.length - 10]) {
      const tampered = flip(qr, at);
      expect(tampered).not.toBe(qr);
      expect(tampered).toMatch(TICKET_QR_PATTERN);
      expect(verifyTicketQr(keys, tampered), tampered).toBeNull();
    }
    // Ghép chữ ký của Vé này vào Vé khác.
    expect(verifyTicketQr(keys, qr.replace(TICKET, OTHER))).toBeNull();
  });

  it('k không có trong TICKET_QR_KEYS, hoặc đổi k → không hợp lệ', () => {
    const onlyV1 = TicketQrKeys.parse(v1);
    expect(verifyTicketQr(onlyV1, qr)).toBeNull();
    expect(verifyTicketQr(keys, qr.replace(/^t2\./, 't1.'))).toBeNull();
    expect(verifyTicketQr(keys, qr.replace(/^t2\./, 't9.'))).toBeNull();
    // Cùng k nhưng khóa khác giá trị.
    expect(verifyTicketQr(TicketQrKeys.parse(`${v1},${testCredentialKey(2, 0x33)}`), qr)).toBeNull();
  });

  it('sai dạng → không hợp lệ', () => {
    for (const bad of ['', 'abc', `t2.${TICKET}`, `${qr}=`, ` ${qr}`, qr.toUpperCase(), `x${qr.slice(1)}`]) {
      expect(verifyTicketQr(keys, bad), bad).toBeNull();
    }
  });

  it('xoay khóa: thêm v2 thì Vé đã ký bằng v1 vẫn ra đúng QR cũ và vẫn hợp lệ; gỡ v1 thì QR cũ hết hợp lệ', () => {
    const before = TicketQrKeys.parse(v1);
    const old = signTicketQr(before, TICKET);
    const after = TicketQrKeys.parse(`${v1},${v2}`);
    expect(signTicketQr(after, TICKET, 1)).toBe(old);
    expect(verifyTicketQr(after, old)).toEqual({ ticketId: TICKET, keyVersion: 1 });
    expect(signTicketQr(after, TICKET)).not.toBe(old);
    expect(verifyTicketQr(TicketQrKeys.parse(v2), old)).toBeNull();
  });
});
