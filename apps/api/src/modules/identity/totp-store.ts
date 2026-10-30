import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import type { Auth } from './auth.js';
import { sessions, twoFactors, users } from './schema.js';

/** Cookie session của Better Auth với `cookiePrefix: 'tickee'` (thêm `__Secure-` khi api chạy HTTPS). */
const SESSION_COOKIE = /^(?:__Secure-)?tickee\.session_token$/;

/**
 * Token session trong các header `set-cookie` (nếu có). Better Auth 1.7 ký cookie dạng
 * `encodeURIComponent("<token>.<chữ ký>")`; token (`generateId(32)`) không chứa dấu chấm.
 */
function sessionTokenFrom(headers: Headers): string | null {
  for (const cookie of headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const eqAt = pair?.indexOf('=') ?? -1;
    if (!pair || eqAt < 0 || !SESSION_COOKIE.test(pair.slice(0, eqAt).trim())) continue;
    const value = decodeURIComponent(pair.slice(eqAt + 1).trim());
    const dot = value.indexOf('.');
    if (dot <= 0) continue;
    return value.slice(0, dot);
  }
  return null;
}

/** Mã lỗi (`body.code`) của `APIError` Better Auth, nếu là `APIError`. */
function apiErrorCode(err: unknown): string | undefined {
  return isAPIError(err) ? (err.body as { code?: string } | undefined)?.code : undefined;
}

export interface TotpEnrollment {
  /** `otpauth://totp/Tickee:<email>?secret=…&issuer=Tickee&digits=6&period=30` */
  totpUri: string;
  /** Khóa base32 (tham số `secret` của URI) để nhập tay. */
  manualKey: string;
}

export type TotpVerification =
  /** Mã sai. */
  | { status: 'invalid' }
  /** User chưa bắt đầu đăng ký (không có hàng `two_factors`). */
  | { status: 'not_started' }
  | {
      status: 'valid';
      /** Header `set-cookie` (session mới khi plugin xoay session lúc xác nhận đăng ký; rỗng khi step-up). */
      headers: Headers;
      /** Token của session mới nếu plugin vừa xoay session, ngược lại `null` (session hiện tại giữ nguyên). */
      rotatedSessionToken: string | null;
    };

/**
 * Nơi duy nhất chạm vào phần nội bộ của plugin `twoFactor` (Better Auth 1.7): `auth.api.enableTwoFactor`,
 * `auth.api.verifyTOTP`, bảng `two_factors`, cột `users.two_factor_enabled` và việc plugin xoay session lúc xác nhận
 * đăng ký. Hành vi này ghim ở `test/identity/totp-store.test.ts`: nâng phiên bản Better Auth thì kiểm lại.
 */
@Injectable()
export class TotpStore {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService<Auth>,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /**
   * Sinh secret mới (plugin mã hóa trước khi lưu) và ghi/thay hàng `two_factors` với `verified = false`. Plugin từ
   * chối nếu user đã có TOTP đã xác nhận (`TOTP_ALREADY_ENABLED`): người gọi phải kiểm `twoFactorEnabled` trước.
   * Mã dự phòng plugin sinh kèm bị bỏ (Tickee dùng `totp_recovery_codes`).
   */
  async beginEnrollment(requestHeaders: Headers): Promise<TotpEnrollment> {
    const response = await this.auth.api.enableTwoFactor({ body: { method: 'totp' }, headers: requestHeaders });
    if (!('totpURI' in response) || typeof response.totpURI !== 'string') {
      throw new Error('Better Auth không trả TOTP URI');
    }
    const manualKey = new URL(response.totpURI).searchParams.get('secret');
    if (!manualKey) throw new Error('TOTP URI không có secret');
    return { totpUri: response.totpURI, manualKey };
  }

  /**
   * Xác minh mã TOTP cho session trong `requestHeaders`. Lần xác minh đúng đầu tiên sau `beginEnrollment` làm plugin
   * đặt `verified = true`, bật `users.two_factor_enabled`, rồi xoay session (tạo session mới chép mọi trường của
   * session cũ, xóa session cũ, set cookie mới). Lockout của plugin không chạy khi đã có session: bộ đếm do
   * `TotpAttemptLimiter` lo.
   */
  async verify(requestHeaders: Headers, code: string): Promise<TotpVerification> {
    try {
      const { headers } = await this.auth.api.verifyTOTP({
        body: { code },
        headers: requestHeaders,
        returnHeaders: true,
      });
      return { status: 'valid', headers, rotatedSessionToken: sessionTokenFrom(headers) };
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 'INVALID_CODE') return { status: 'invalid' };
      if (code === 'TOTP_NOT_ENABLED') return { status: 'not_started' };
      throw err;
    }
  }

  /** User đã xác nhận đăng ký TOTP chưa (đọc thẳng DB, không qua session). */
  async isEnabled(userId: string): Promise<boolean> {
    const [row] = await this.db.orm
      .select({ enabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, userId));
    return row?.enabled ?? false;
  }

  /**
   * Gỡ TOTP của user (dùng mã khôi phục): xóa secret, tắt `two_factor_enabled` và xóa `step_up_at` của mọi session
   * của user (người gọi tự đánh dấu lại session hiện tại nếu cần), để session khác không qua guard sau khi đăng ký lại.
   */
  async remove(tx: Tx, userId: string): Promise<void> {
    await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
    await tx.update(sessions).set({ stepUpAt: null }).where(eq(sessions.userId, userId));
    await tx
      .update(users)
      .set({ twoFactorEnabled: false, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
  }

  /**
   * Ghi `step_up_at = now()` cho session (theo token, kèm `userId` để không ghi nhầm session người khác).
   * @returns mốc step-up, hoặc `null` nếu không thấy session.
   */
  async markStepUp(tx: Tx, userId: string, sessionToken: string): Promise<Date | null> {
    const [row] = await tx
      .update(sessions)
      .set({ stepUpAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(sessions.token, sessionToken), eq(sessions.userId, userId)))
      .returning({ stepUpAt: sessions.stepUpAt });
    return row?.stepUpAt ?? null;
  }
}
