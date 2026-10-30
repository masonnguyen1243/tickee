import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  isTotpExemptRoute,
  Me,
  RecoveryCodeRequest,
  safeReturnTo,
  SendOtpRequest,
  STEP_UP_TTL_MS,
  TOTP_ENROLL_PATH,
  TOTP_EXEMPT_ROUTES,
  TOTP_LOCK_MS,
  TOTP_MAX_FAILURES,
  TotpCodeRequest,
  TotpRequiredDetails,
  VerifyOtpRequest,
} from '../src/identity.js';
import { ErrorCode } from '../src/errors.js';

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
    const base = { id: '019a3b2c-1234-7abc-8def-0123456789ab', email: 'a@b.vn', twoFactorEnabled: false };
    expect(Me.safeParse({ ...base, consentedAt: null }).success).toBe(true);
    expect(Me.safeParse({ ...base, consentedAt: '2026-10-29T01:02:03.456Z' }).success).toBe(true);
    expect(Me.safeParse({ ...base, consentedAt: 'hôm qua' }).success).toBe(false);
  });
});

describe('TOTP', () => {
  it('thông số: step-up 12 giờ, khóa 15 phút sau 5 lần sai', () => {
    expect(STEP_UP_TTL_MS).toBe(12 * 3_600_000);
    expect(TOTP_MAX_FAILURES).toBe(5);
    expect(TOTP_LOCK_MS).toBe(15 * 60_000);
  });

  it('mã lỗi TOTP có trong ErrorCode', () => {
    expect(ErrorCode.TOTP_REQUIRED).toBe('TOTP_REQUIRED');
    expect(ErrorCode.TOTP_INVALID).toBe('TOTP_INVALID');
    expect(ErrorCode.TOTP_LOCKED).toBe('TOTP_LOCKED');
  });

  it.each([
    ['123456', true],
    ['12345', false],
    ['1234567', false],
    ['abcdef', false],
  ])('mã TOTP "%s" hợp lệ: %s', (code, ok) => {
    expect(TotpCodeRequest.safeParse({ code }).success).toBe(ok);
  });

  it('mã khôi phục chuẩn hóa: bỏ gạch/khoảng trắng, chữ hoa', () => {
    expect(RecoveryCodeRequest.parse({ recoveryCode: ' abcde-fgh23 ' })).toEqual({ recoveryCode: 'ABCDEFGH23' });
    expect(formatRecoveryCode('ABCDEFGH23')).toBe('ABCDE-FGH23');
  });

  it.each(['ABCDE-FGH2', 'ABCDE-FGH234', 'ABCDE-FGH0O', 'ABCDE-FGHI1'])('mã khôi phục "%s" bị từ chối', (recoveryCode) => {
    expect(RecoveryCodeRequest.safeParse({ recoveryCode }).success).toBe(false);
  });

  it('TotpRequiredDetails chỉ nhận enroll | step_up', () => {
    expect(TotpRequiredDetails.safeParse({ reason: 'enroll' }).success).toBe(true);
    expect(TotpRequiredDetails.safeParse({ reason: 'step_up' }).success).toBe(true);
    expect(TotpRequiredDetails.safeParse({ reason: 'khac' }).success).toBe(false);
  });

  it('danh sách route miễn đúng AD-26', () => {
    expect([...TOTP_EXEMPT_ROUTES].sort()).toEqual(
      [
        'POST /v1/identity/totp/enroll',
        'POST /v1/identity/totp/enroll/verify',
        'POST /v1/identity/totp/step-up',
        'POST /v1/identity/totp/recovery',
        'POST /v1/identity/sign-out',
        'GET /v1/identity/me',
        'GET /v1/me/memberships',
      ].sort(),
    );
    expect(isTotpExemptRoute('get', '/v1/identity/me')).toBe(true);
    expect(isTotpExemptRoute('GET', '/v1/orgs/:orgId')).toBe(false);
  });

  it('màn đăng ký TOTP không làm đích returnTo', () => {
    expect(safeReturnTo(TOTP_ENROLL_PATH)).toBe('/');
    expect(safeReturnTo(`${TOTP_ENROLL_PATH}?returnTo=/x`)).toBe('/');
  });
});
