import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';

/*
 * Bảng của Better Auth (AD-19), do `identity` sở hữu. Khóa của object (users, sessions…) và tên thuộc tính
 * (emailVerified, expiresAt…) phải khớp đúng tên Better Auth dùng (`usePlural`), vì adapter Drizzle tìm bảng
 * và cột theo các tên này; tên cột trong DB là snake_case. PK do Postgres sinh (`uuidv7()`, `generateId: false`).
 */

const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  /** Để rỗng với đăng nhập OTP; Story 1.4 lấy từ Google. */
  name: text('name').notNull().default(''),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** Thời điểm đồng ý xử lý dữ liệu cá nhân (NĐ 13/2023); `null` = chưa đồng ý. */
  consentedAt: timestamptz('consented_at'),
  /** Plugin `twoFactor` bật khi xác nhận đăng ký TOTP; `TotpStore` tắt khi user dùng mã khôi phục. */
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Mốc step-up TOTP gần nhất của session (Story 2.2); hiệu lực tới hết session. `null` = chưa step-up. */
    stepUpAt: timestamptz('step_up_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text('scope'),
    /** Better Auth bắt buộc có cột này trong schema; Tickee không bật đăng nhập mật khẩu nên luôn `null`. */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_user_id_idx').on(t.userId),
    uniqueIndex('accounts_provider_id_account_id_key').on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    /** OTP: `"<hash SHA-256 của mã>:<số lần nhập sai>"`. */
    value: text('value').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Unique: khi gửi mã mới (rotate), plugin emailOTP chỉ xóa mã cũ khi insert bị lỗi trùng.
  (t) => [uniqueIndex('verifications_identifier_key').on(t.identifier)],
);

/** Nhật ký gửi OTP để giới hạn tần suất (NFR-6). Chỉ lưu HMAC, không bao giờ lưu email hay IP dạng rõ. */
export const otpSendEvents = pgTable(
  'otp_send_events',
  {
    id: id(),
    emailHmac: text('email_hmac').notNull(),
    ipHmac: text('ip_hmac').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('otp_send_events_email_hmac_created_at_idx').on(t.emailHmac, t.createdAt),
    index('otp_send_events_ip_hmac_created_at_idx').on(t.ipHmac, t.createdAt),
  ],
);

/**
 * Lần xác minh mã sai (NFR-6, khóa theo ngày): quá `OTP_DAILY_FAILURE_LIMIT` lần trong 24 giờ thì email bị khóa
 * gửi và xác minh. Chỉ lưu HMAC của email.
 */
export const otpVerifyFailures = pgTable(
  'otp_verify_failures',
  {
    id: id(),
    emailHmac: text('email_hmac').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('otp_verify_failures_email_hmac_created_at_idx').on(t.emailHmac, t.createdAt)],
);

/**
 * Lần bắt đầu đăng nhập Google (`GET /v1/identity/google`) để giới hạn theo IP: mỗi lần ghi một dòng
 * `verifications` (state OAuth). Chỉ lưu HMAC của IP.
 */
export const googleStartEvents = pgTable(
  'google_start_events',
  {
    id: id(),
    ipHmac: text('ip_hmac').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('google_start_events_ip_hmac_created_at_idx').on(t.ipHmac, t.createdAt)],
);

/**
 * Bảng của plugin `twoFactor` (Better Auth 1.7, model `twoFactor`). Chỉ `TotpStore` đọc/ghi trực tiếp.
 * `secret` và `backupCodes` do plugin mã hóa đối xứng bằng `BETTER_AUTH_SECRET`; mã dự phòng của plugin không dùng
 * (mã khôi phục của Tickee ở `totp_recovery_codes`). Lockout của plugin chỉ chạy khi chưa có session nên hai cột
 * đếm/khóa không dùng; bộ đếm của Tickee ở `totp_verify_failures`.
 */
export const twoFactors = pgTable('two_factors', {
  id: id(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** `false` khi mới bắt đầu đăng ký, `true` sau khi xác nhận mã đầu tiên. */
  verified: boolean('verified').notNull().default(true),
  failedVerificationCount: integer('failed_verification_count').notNull().default(0),
  lockedUntil: timestamptz('locked_until'),
});

/** Mã khôi phục TOTP: 10 mã mỗi lần đăng ký, dùng một lần. Chỉ lưu HMAC của mã đã chuẩn hóa. */
export const totpRecoveryCodes = pgTable(
  'totp_recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHmac: text('code_hmac').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('totp_recovery_codes_user_id_code_hmac_key').on(t.userId, t.codeHmac)],
);

/**
 * Bộ đếm xác minh TOTP sai liên tiếp theo user (cả TOTP lẫn mã khôi phục): đủ `TOTP_MAX_FAILURES` lần thì khóa tới
 * `locked_until`. Đúng thì đặt lại về 0.
 */
export const totpVerifyFailures = pgTable('totp_verify_failures', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: timestamptz('locked_until'),
  updatedAt: updatedAt(),
});

/** Schema truyền cho adapter Drizzle của Better Auth. */
export const authSchema = { users, sessions, accounts, verifications, twoFactors };
