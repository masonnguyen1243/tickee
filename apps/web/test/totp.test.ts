import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { disableTotpRequest, isTotpNotEnabled, isTotpRequired, RECOVERY_USED_PATH } from '@/lib/auth/totp';

describe('disableTotpRequest', () => {
  it('đúng 6 chữ số (bỏ khoảng trắng) → mã TOTP', () => {
    expect(disableTotpRequest('123456')).toEqual({ code: '123456' });
    expect(disableTotpRequest(' 123 456 ')).toEqual({ code: '123456' });
  });

  it('còn lại → mã khôi phục (api chuẩn hóa và kiểm)', () => {
    expect(disableTotpRequest(' abcde-fgh23 ')).toEqual({ recoveryCode: 'abcde-fgh23' });
    expect(disableTotpRequest('12345')).toEqual({ recoveryCode: '12345' });
  });
});

describe('phân loại lỗi 2FA', () => {
  it('TOTP_REQUIRED luôn mở dialog, không phân biệt lý do', () => {
    expect(isTotpRequired(new ApiError('TOTP_REQUIRED', 'x', { reason: 'step_up' }, 403))).toBe(true);
    expect(isTotpRequired(new ApiError('TOTP_REQUIRED', 'x', null, 403))).toBe(true);
    expect(isTotpRequired(new ApiError('FORBIDDEN_ROLE', 'x', null, 403))).toBe(false);
  });

  it('409 VALIDATION_FAILED = chưa bật 2FA', () => {
    expect(isTotpNotEnabled(new ApiError('VALIDATION_FAILED', 'x', null, 409))).toBe(true);
    expect(isTotpNotEnabled(new ApiError('VALIDATION_FAILED', 'x', null, 400))).toBe(false);
  });

  it('sau mã khôi phục: trang Bảo mật tài khoản kèm cờ banner', () => {
    expect(RECOVERY_USED_PATH).toBe('/tai-khoan/bao-mat?da-dung-ma-khoi-phuc=1');
  });
});
