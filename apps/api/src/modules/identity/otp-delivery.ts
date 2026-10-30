import { AsyncLocalStorage } from 'node:async_hooks';

/** Gửi email OTP thất bại (SMTP lỗi): request gửi mã trả 503 và không tính vào giới hạn. */
export class EmailDeliveryError extends Error {
  constructor(cause: unknown) {
    super('Gửi email OTP thất bại', { cause });
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Better Auth nuốt lỗi của `sendVerificationOTP` (`runInBackgroundOrAwait` chỉ log rồi trả 200), nên lỗi gửi
 * email được báo ngược về request đang gửi mã qua AsyncLocalStorage bao quanh lời gọi `auth.api`.
 */
export interface OtpDeliveryState {
  failure?: EmailDeliveryError;
}
export const otpDelivery = new AsyncLocalStorage<OtpDeliveryState>();
