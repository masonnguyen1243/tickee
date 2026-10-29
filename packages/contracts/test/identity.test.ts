import { describe, expect, it } from 'vitest';
import { Me, SendOtpRequest, VerifyOtpRequest } from '../src/identity.js';

describe('schema identity', () => {
  it('email được chuẩn hóa: bỏ khoảng trắng, chữ thường', () => {
    expect(SendOtpRequest.parse({ email: '  An.Nguyen@Example.VN ' })).toEqual({ email: 'an.nguyen@example.vn' });
  });

  it.each(['', 'khong-phai-email', 'a@', '@b.vn'])('email sai dạng "%s" bị từ chối', (email) => {
    expect(SendOtpRequest.safeParse({ email }).success).toBe(false);
  });

  it.each([
    ['123456', true],
    ['12345', false],
    ['1234567', false],
    ['12a456', false],
    [' 123456', false],
  ])('mã OTP "%s" hợp lệ: %s', (otp, ok) => {
    expect(VerifyOtpRequest.safeParse({ email: 'a@b.vn', otp }).success).toBe(ok);
  });

  it('Me: consentedAt là ISO 8601 hoặc null', () => {
    const base = { id: '019a3b2c-1234-7abc-8def-0123456789ab', email: 'a@b.vn' };
    expect(Me.safeParse({ ...base, consentedAt: null }).success).toBe(true);
    expect(Me.safeParse({ ...base, consentedAt: '2026-10-29T01:02:03.456Z' }).success).toBe(true);
    expect(Me.safeParse({ ...base, consentedAt: 'hôm qua' }).success).toBe(false);
  });
});
