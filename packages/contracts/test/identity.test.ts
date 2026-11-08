import { describe, expect, it } from 'vitest';
import * as identity from '../src/identity.js';
import {
  ACCOUNT_SECURITY_PATH,
  formatRecoveryCode,
  isTotpExemptRoute,
  Me,
  RecoveryCodeRequest,
  safeReturnTo,
  SendOtpRequest,
  TOTP_ENROLL_PATH,
  TOTP_EXEMPT_ROUTES,
  TOTP_LOCK_MS,
  TOTP_MAX_FAILURES,
  TotpCodeRequest,
  TotpDisableRequest,
  TotpDisableResponse,
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
  it('thông số: khóa 15 phút sau 5 lần sai; step-up hiệu lực hết session (không có mốc giờ)', () => {
    expect(TOTP_MAX_FAILURES).toBe(5);
    expect(TOTP_LOCK_MS).toBe(15 * 60_000);
    expect('STEP_UP_TTL_MS' in identity).toBe(false);
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

  it('TotpRequiredDetails chỉ nhận step_up (không còn lý do enroll)', () => {
    expect(TotpRequiredDetails.safeParse({ reason: 'step_up' }).success).toBe(true);
    expect(TotpRequiredDetails.safeParse({ reason: 'enroll' }).success).toBe(false);
    expect(TotpRequiredDetails.safeParse({ reason: 'khac' }).success).toBe(false);
  });

  it('danh sách route miễn đúng AD-26: nhập mã, mã khôi phục, đăng xuất, me', () => {
    expect([...TOTP_EXEMPT_ROUTES].sort()).toEqual(
      [
        'POST /v1/identity/totp/step-up',
        'POST /v1/identity/totp/recovery',
        'POST /v1/identity/sign-out',
        'GET /v1/identity/me',
      ].sort(),
    );
    expect(isTotpExemptRoute('get', '/v1/identity/me')).toBe(true);
    expect(isTotpExemptRoute('GET', '/v1/orgs/:orgId')).toBe(false);
    expect(isTotpExemptRoute('GET', '/v1/me/memberships')).toBe(false);
    expect(isTotpExemptRoute('POST', '/v1/identity/totp/disable')).toBe(false);
  });

  it('tắt 2FA: đúng một trong mã TOTP hoặc mã khôi phục (chuẩn hóa)', () => {
    expect(TotpDisableRequest.parse({ code: '123456' })).toEqual({ code: '123456' });
    expect(TotpDisableRequest.parse({ recoveryCode: ' abcde-fgh23 ' })).toEqual({ recoveryCode: 'ABCDEFGH23' });
    for (const body of [{}, { code: '12345' }, { recoveryCode: 'abc' }, { code: '123456', recoveryCode: 'ABCDE-FGH23' }]) {
      expect(TotpDisableRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(TotpDisableResponse.safeParse({ twoFactorEnabled: false }).success).toBe(true);
    expect(TotpDisableResponse.safeParse({ twoFactorEnabled: true }).success).toBe(false);
  });

  it('màn đăng ký TOTP không làm đích returnTo; trang Bảo mật thì được', () => {
    expect(safeReturnTo(TOTP_ENROLL_PATH)).toBe('/');
    expect(safeReturnTo(`${TOTP_ENROLL_PATH}?returnTo=/x`)).toBe('/');
    expect(ACCOUNT_SECURITY_PATH).toBe('/tai-khoan/bao-mat');
    expect(safeReturnTo(ACCOUNT_SECURITY_PATH)).toBe(ACCOUNT_SECURITY_PATH);
  });
});

describe('xác nhận lại (Story 2.13)', () => {
  it('thông số: header chữ thường, hiệu lực 5 phút; mã lỗi có trong ErrorCode', () => {
    expect(identity.REAUTH_HEADER).toBe('x-reauth-token');
    expect(identity.REAUTH_TTL_SECONDS).toBe(300);
    expect(ErrorCode.REAUTH_REQUIRED).toBe('REAUTH_REQUIRED');
    expect(ErrorCode.REAUTH_METHOD_MISMATCH).toBe('REAUTH_METHOD_MISMATCH');
  });

  it('ReauthRequest: đúng 6 chữ số (TOTP hoặc mã email); mã khôi phục bị từ chối', () => {
    expect(identity.ReauthRequest.parse({ code: '012345' })).toEqual({ code: '012345' });
    for (const code of ['12345', '1234567', 'ABCDE-FGH23', 'ABCDEFGH23', 123456]) {
      expect(identity.ReauthRequest.safeParse({ code }).success, String(code)).toBe(false);
    }
  });

  it('ReauthRequiredDetails: method là totp hoặc email_otp', () => {
    expect(identity.ReauthRequiredDetails.parse({ method: 'totp' })).toEqual({ method: 'totp' });
    expect(identity.ReauthRequiredDetails.parse({ method: 'email_otp' })).toEqual({ method: 'email_otp' });
    expect(identity.ReauthRequiredDetails.safeParse({ method: 'recovery_code' }).success).toBe(false);
  });

  it('ReauthGrant: token và hạn ISO 8601', () => {
    const grant = { reauthToken: 'abc', expiresAt: '2026-11-08T03:09:00.000Z' };
    expect(identity.ReauthGrant.parse(grant)).toEqual(grant);
    expect(identity.ReauthGrant.safeParse({ ...grant, reauthToken: '' }).success).toBe(false);
  });
});
