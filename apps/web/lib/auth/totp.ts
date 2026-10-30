import {
  ACCOUNT_SECURITY_PATH,
  ErrorCode,
  RecoveryCodeResponse,
  StepUpResponse,
  TOTP_DIGITS,
  TotpDisableResponse,
  TotpEnrollResponse,
  TotpEnrollVerifyResponse,
  TotpInvalidDetails,
  TotpLockedDetails,
  type TotpDisableRequest,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

const post = (body?: unknown): RequestInit =>
  body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) };

/** Bắt đầu đăng ký TOTP: URI cho QR và khóa nhập tay. */
export const beginTotpEnrollment = () =>
  apiRequest('/identity/totp/enroll', { schema: TotpEnrollResponse, init: post() });

/** Xác nhận đăng ký bằng mã đầu tiên → 10 mã khôi phục (api đặt cookie session mới đã step-up). */
export const confirmTotpEnrollment = (code: string) =>
  apiRequest('/identity/totp/enroll/verify', { schema: TotpEnrollVerifyResponse, init: post({ code }) });

export const stepUpWithTotp = (code: string) =>
  apiRequest('/identity/totp/step-up', { schema: StepUpResponse, init: post({ code }) });

/** Step-up bằng mã khôi phục: TOTP cũ bị gỡ (2FA về chưa bật), bật lại ở trang Bảo mật tài khoản. */
export const stepUpWithRecoveryCode = (recoveryCode: string) =>
  apiRequest('/identity/totp/recovery', { schema: RecoveryCodeResponse, init: post({ recoveryCode }) });

/** Tắt 2FA bằng mã TOTP hoặc mã khôi phục (xem `disableTotpRequest`). */
export const disableTotp = (body: TotpDisableRequest) =>
  apiRequest('/identity/totp/disable', { schema: TotpDisableResponse, init: post(body) });

const TOTP_INPUT = new RegExp(`^\\d{${TOTP_DIGITS}}$`);

/**
 * Một ô nhận cả mã TOTP lẫn mã khôi phục: đúng `TOTP_DIGITS` chữ số là mã TOTP (mã khôi phục không bao giờ toàn số
 * và dài hơn), còn lại gửi như mã khôi phục (api chuẩn hóa và kiểm).
 */
export function disableTotpRequest(input: string): TotpDisableRequest {
  const value = input.replace(/\s+/g, '');
  return TOTP_INPUT.test(value) ? { code: value } : { recoveryCode: input.trim() };
}

/** Lỗi là `TOTP_REQUIRED` (tài khoản đã bật 2FA mà session chưa qua lớp hai). */
export const isTotpRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCode.TOTP_REQUIRED;

/** 409 `VALIDATION_FAILED` của step-up / mã khôi phục / tắt: tài khoản đã không còn bật 2FA (vd. tắt ở nơi khác). */
export const isTotpNotEnabled = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ErrorCode.VALIDATION_FAILED && error.status === 409;

/** Tham số query của trang Bảo mật tài khoản: vừa dùng mã khôi phục (2FA cũ đã bị gỡ) → hiện banner bật lại. */
export const RECOVERY_USED_PARAM = 'da-dung-ma-khoi-phuc';

/** Trang Bảo mật tài khoản kèm banner "Xác thực hai lớp cũ đã được gỡ…". */
export const RECOVERY_USED_PATH = `${ACCOUNT_SECURITY_PATH}?${RECOVERY_USED_PARAM}=1`;

/** Thông báo lỗi tại ô cho mã TOTP / mã khôi phục. */
export function totpErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === ErrorCode.TOTP_INVALID) {
    const parsed = TotpInvalidDetails.safeParse(error.details);
    return parsed.success ? `Mã chưa đúng, còn ${parsed.data.remainingAttempts} lần.` : 'Mã chưa đúng.';
  }
  if (error instanceof ApiError && error.code === ErrorCode.TOTP_LOCKED) {
    const parsed = TotpLockedDetails.safeParse(error.details);
    const minutes = Math.max(1, Math.ceil((parsed.success ? parsed.data.retryAfterSeconds : 900) / 60));
    return `Bạn đã nhập sai quá nhiều lần. Thử lại sau ${minutes} phút.`;
  }
  if (error instanceof ApiError && error.code === ErrorCode.VALIDATION_FAILED && error.status === 400) {
    return 'Mã chưa đúng định dạng.';
  }
  return error instanceof ApiError ? error.message : 'Vui lòng thử lại.';
}

/** Nhóm khóa base32 thành cụm 4 ký tự cho dễ nhập tay. */
export const groupManualKey = (key: string): string => key.replace(/=+$/, '').match(/.{1,4}/g)?.join(' ') ?? key;

/** Nội dung file `.txt` mã khôi phục. */
export function recoveryCodesText(codes: readonly string[], email?: string): string {
  return [
    'Mã khôi phục Tickee',
    email ? `Tài khoản: ${email}` : null,
    '',
    'Mỗi mã chỉ dùng được một lần. Dùng một mã khi không mở được ứng dụng xác thực;',
    'xác thực hai lớp cũ sẽ được gỡ và bạn bật lại trong Bảo mật tài khoản.',
    '',
    ...codes,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
