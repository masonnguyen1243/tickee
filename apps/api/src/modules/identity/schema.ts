import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

/** Schema truyền cho adapter Drizzle của Better Auth. */
export const authSchema = { users, sessions, accounts, verifications };
