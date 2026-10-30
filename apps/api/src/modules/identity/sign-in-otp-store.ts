import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { OTP_MAX_ATTEMPTS } from '@tickee/contracts';
import type { Auth } from './auth.js';

/**
 * Định danh verification mà plugin emailOTP dùng cho mã đăng nhập (`toOTPIdentifier('sign-in', email)`).
 * Email chữ thường như Better Auth tự làm ở mọi route trước khi dựng định danh (`routes.mjs`).
 * Phụ thuộc Better Auth 1.7 (`plugins/email-otp/utils.mjs`): nâng phiên bản thì kiểm lại, test
 * `sign-in-otp-store.test.ts` ghim hành vi này.
 */
const signInIdentifier = (email: string): string => `sign-in-otp-${email.toLowerCase()}`;

/**
 * Số lần nhập sai đã ghi trong verification. Better Auth 1.7 lưu `"<hash>:<attempts>"` và tăng phần sau dấu `:`
 * cuối cùng mỗi lần sai (`splitAtLastColon`, `routes.mjs`).
 */
function usedAttempts(value: string): number {
  const n = Number.parseInt(value.slice(value.lastIndexOf(':') + 1), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Nơi duy nhất chạm vào phần nội bộ của Better Auth (`$context.internalAdapter`) để đọc/xóa mã đăng nhập OTP.
 * Định danh và định dạng lưu là chi tiết riêng của Better Auth 1.7, không lộ ra ngoài file này.
 */
@Injectable()
export class SignInOtpStore {
  constructor(@Inject(AuthService) private readonly auth: AuthService<Auth>) {}

  /** Email có mã đăng nhập đang lưu không (kể cả mã đã hết hạn nhưng chưa bị thay/tiêu). */
  async has(email: string): Promise<boolean> {
    return (await this.find(email)) !== null;
  }

  /** Số lượt nhập còn lại của mã hiện tại; không có mã → 0. */
  async remainingAttempts(email: string): Promise<number> {
    const verification = await this.find(email);
    return verification ? OTP_MAX_ATTEMPTS - usedAttempts(verification.value) : 0;
  }

  /** Xóa mã đăng nhập của email (mã cũ không còn xác minh được). */
  async delete(email: string): Promise<void> {
    const context = await this.auth.instance.$context;
    await context.internalAdapter.deleteVerificationByIdentifier(signInIdentifier(email));
  }

  private async find(email: string): Promise<{ value: string } | null> {
    const context = await this.auth.instance.$context;
    return context.internalAdapter.findVerificationValue(signInIdentifier(email));
  }
}
