import {
  ErrorCode,
  RecoveryCodeResponse,
  StepUpResponse,
  TotpEnrollResponse,
  TotpEnrollVerifyResponse,
  TotpInvalidDetails,
  TotpLockedDetails,
  TotpRequiredDetails,
  type TotpRequiredReason,
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

/** Step-up bằng mã khôi phục: TOTP cũ bị gỡ, phải đăng ký lại. */
export const stepUpWithRecoveryCode = (recoveryCode: string) =>
  apiRequest('/identity/totp/recovery', { schema: RecoveryCodeResponse, init: post({ recoveryCode }) });

/** Lý do của lỗi `TOTP_REQUIRED`, hoặc `null` nếu không phải lỗi này. */
export function totpRequiredReason(error: unknown): TotpRequiredReason | null {
  if (!(error instanceof ApiError) || error.code !== ErrorCode.TOTP_REQUIRED) return null;
  const parsed = TotpRequiredDetails.safeParse(error.details);
  // Thiếu `details` hợp lệ: coi như cần step-up (dialog tự chuyển sang đăng ký nếu api báo chưa đăng ký).
  return parsed.success ? parsed.data.reason : 'step_up';
}

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
    'sau đó Tickee sẽ yêu cầu đăng ký lại xác thực hai lớp.',
    '',
    ...codes,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
