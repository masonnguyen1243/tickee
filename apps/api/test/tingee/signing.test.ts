import { describe, expect, it } from 'vitest';
import { parseTingeeTimestamp, sign, tingeeTimestamp, verifySignature } from '../../src/modules/tingee/index.js';

describe('ký request Tingee', () => {
  it('timestamp yyyyMMddHHmmssSSS theo giờ Asia/Ho_Chi_Minh (UTC+7)', () => {
    expect(tingeeTimestamp(new Date('2026-11-03T01:02:03.004Z'))).toBe('20261103080203004');
    // Qua nửa đêm giờ Việt Nam: sang ngày mới (và năm mới).
    expect(tingeeTimestamp(new Date('2026-12-31T17:00:00.000Z'))).toBe('20270101000000000');
    expect(parseTingeeTimestamp('20261103080203004')?.toISOString()).toBe('2026-11-03T01:02:03.004Z');
    expect(parseTingeeTimestamp('2026110308020300')).toBeNull();
    expect(parseTingeeTimestamp('20261332080203004')).toBeNull();
  });

  it('chữ ký = hex thường của HMAC_SHA512(ts + ":" + body, secret) — vector cố định', () => {
    const body = JSON.stringify({ merchantId: 1001, bankBin: '970422' });
    const signature = sign('20261103080203004', body, 'tingee-test-secret');
    expect(signature).toBe(
      'd409e28fb41b9ab419983f1ce4b18707b7f3fe316012ed7a1ef5c8a112a52b6d41a333a8b0890468f8d8a8093f0196328afa2eef8ea777399374c585959e5632',
    );
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifySignature('20261103080203004', body, 'tingee-test-secret', signature)).toBe(true);
    // Body khác một khoảng trắng → chữ ký khác: phải ký đúng chuỗi gửi đi.
    expect(verifySignature('20261103080203004', `${body} `, 'tingee-test-secret', signature)).toBe(false);
    expect(verifySignature('20261103080203004', body, 'sai', signature)).toBe(false);
    expect(verifySignature('20261103080203004', body, 'tingee-test-secret', 'ngan')).toBe(false);
  });
});
