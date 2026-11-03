import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { users } from '../identity/schema.js';

/** BTC (Ban tổ chức). Kênh liên hệ là PII (`PII_COLUMNS.organizer`): log tự che, không bao giờ vào audit. */
export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    /**
     * Closed Beta (FR-37, `ClosedBetaStatus`): BTC mới `pending`; Quản trị Tingee đổi bằng compare-and-set
     * (`pending|revoked → approved`, `approved → revoked`). Story 2.10 đọc cột này để chặn bán Vé có phí.
     */
    closedBetaStatus: text('closed_beta_status', { enum: ['pending', 'approved', 'revoked'] })
      .notNull()
      .default('pending'),
    /** Lần đổi trạng thái Closed Beta gần nhất; `null` khi chưa từng đổi (vẫn `pending` từ lúc tạo). */
    closedBetaChangedAt: timestamptz('closed_beta_changed_at'),
    /**
     * Id Merchant con của BTC ở Tingee (`POST /v1/merchant/create`, Story 2.6). Tạo lười ở lần liên kết tài khoản nhận
     * tiền đầu tiên và lưu ngay (transaction riêng), nên lần thử sau không tạo Merchant con lần nữa.
     */
    tingeeMerchantId: bigint('tingee_merchant_id', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('organizations_closed_beta_status_check', sql`${t.closedBetaStatus} IN ('pending', 'approved', 'revoked')`),
    index('organizations_closed_beta_status_created_at_idx').on(t.closedBetaStatus, t.createdAt),
  ],
);

/**
 * Thành viên BTC (`owner`/`admin`). Unique index một phần chỉ bảo đảm tối đa một Owner mỗi BTC; "đúng một" do luồng
 * tạo BTC (cùng transaction) giữ, DB không chặn BTC không có Owner.
 */
export const members = pgTable(
  'members',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['owner', 'admin'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('members_organization_id_user_id_key').on(t.organizationId, t.userId),
    uniqueIndex('members_one_owner_per_organization_key').on(t.organizationId).where(sql`${t.role} = 'owner'`),
    index('members_user_id_idx').on(t.userId),
    check('members_role_check', sql`${t.role} IN ('owner', 'admin')`),
  ],
);

/**
 * Lời mời Admin (Story 2.4). `email` là PII (`PII_COLUMNS.organizer`): log tự che, không bao giờ vào audit.
 * `token_hash` (SHA-256 của token 128 bit) do worker ghi lúc gửi email, nên còn `null` tới khi job chạy; token thô chỉ
 * nằm trong email. Mỗi BTC có tối đa một lời mời còn treo (chưa nhận, chưa thu hồi) cho mỗi email; lời mời quá hạn vẫn
 * tính là còn treo tới khi bị thu hồi hoặc mời lại.
 */
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Đã chuẩn hóa (trim, chữ thường). */
    email: text('email').notNull(),
    tokenHash: text('token_hash'),
    expiresAt: timestamptz('expires_at').notNull(),
    emailSentAt: timestamptz('email_sent_at'),
    acceptedAt: timestamptz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    revokedAt: timestamptz('revoked_at'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('organization_invitations_pending_email_key')
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    uniqueIndex('organization_invitations_token_hash_key').on(t.tokenHash),
    index('organization_invitations_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
    check(
      'organization_invitations_accepted_check',
      sql`(${t.acceptedAt} IS NULL) = (${t.acceptedBy} IS NULL)`,
    ),
  ],
);

/**
 * Lần thử liên kết tài khoản nhận tiền (Story 2.6): `linking → awaiting_otp → linked` hoặc `failed`, đổi bằng
 * compare-and-set. Mỗi BTC có tối đa một dòng `linked` (tài khoản nhận tiền hiện hành). Không bao giờ lưu số tài khoản
 * đầy đủ, CCCD hay số dư: chỉ 4 số cuối. `account_name`, `account_last4` là PII (`PII_COLUMNS.organizer`).
 * `failure_code` là mã lỗi miền (`ErrorCode`).
 */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['linking', 'awaiting_otp', 'linked', 'failed'] }).notNull(),
    bankBin: text('bank_bin').notNull(),
    accountType: text('account_type', { enum: ['personal-account'] }).notNull(),
    accountLast4: text('account_last4').notNull(),
    accountName: text('account_name').notNull(),
    /** Số VA nhận tiền Tingee cấp khi `linked`. */
    vaAccountNumber: text('va_account_number'),
    tingeeShopId: bigint('tingee_shop_id', { mode: 'number' }),
    /** `confirmId` của Tingee khi chờ OTP ngân hàng. */
    confirmId: text('confirm_id'),
    failureCode: text('failure_code'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    linkedAt: timestamptz('linked_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('payout_accounts_one_linked_per_organization_key')
      .on(t.organizationId)
      .where(sql`${t.status} = 'linked'`),
    index('payout_accounts_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
    check('payout_accounts_status_check', sql`${t.status} IN ('linking', 'awaiting_otp', 'linked', 'failed')`),
    check('payout_accounts_account_type_check', sql`${t.accountType} IN ('personal-account')`),
    check(
      'payout_accounts_linked_check',
      sql`(${t.status} = 'linked') = (${t.linkedAt} IS NOT NULL AND ${t.vaAccountNumber} IS NOT NULL)`,
    ),
  ],
);
