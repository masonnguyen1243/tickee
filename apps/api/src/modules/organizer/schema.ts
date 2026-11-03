import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
     * Khóa định tuyến IPN của BTC (AD-7): URL IPN là `{API_PUBLIC_URL}/v1/payments/tingee/ipn/{ipnKey}`. Chuỗi ngẫu
     * nhiên 128 bit (base64url), không phải secret. Sinh khi BTC lưu credential Tingee lần đầu và không đổi khi đổi key
     * (BTC không phải dán lại URL IPN). Đặt ở BTC, không ở credential: "mỗi BTC một chuỗi" (Story 2.6 › Design Notes).
     */
    tingeeIpnKey: text('tingee_ipn_key'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('organizations_closed_beta_status_check', sql`${t.closedBetaStatus} IN ('pending', 'approved', 'revoked')`),
    index('organizations_closed_beta_status_created_at_idx').on(t.closedBetaStatus, t.createdAt),
    uniqueIndex('organizations_tingee_ipn_key_key').on(t.tingeeIpnKey),
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
 * API key Tingee của BTC (Story 2.6, AD-9, AD-10): mỗi BTC dùng tài khoản merchant Tingee của chính mình. Secret Token chỉ
 * lưu dạng ciphertext AES-256-GCM có phiên bản (`v<k>:…`, `platform/crypto`), không bao giờ trả về web hay ghi log.
 * Mỗi BTC có tối đa một credential hiện hành (`retired_at IS NULL`); credential cũ không xóa (IPN và Đối soát bù của Đơn
 * đã tạo bằng nó, AD-35).
 */
export const tingeeCredentials = pgTable(
  'tingee_credentials',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** `x-client-id`; web chỉ thấy dạng che (`maskTingeeClientId`). */
    clientId: text('client_id').notNull(),
    secretTokenCiphertext: text('secret_token_ciphertext').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    retiredAt: timestamptz('retired_at'),
  },
  (t) => [
    uniqueIndex('tingee_credentials_one_current_per_organization_key')
      .on(t.organizationId)
      .where(sql`${t.retiredAt} IS NULL`),
    index('tingee_credentials_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
    // Lưới an toàn: không bao giờ lưu plaintext (ciphertext luôn có tiền tố phiên bản khóa).
    check('tingee_credentials_secret_token_ciphertext_check', sql`${t.secretTokenCiphertext} ~ '^v[1-9][0-9]*:'`),
  ],
);

/**
 * Tài khoản nhận tiền đã chọn (Story 2.6): một VA trong tài khoản Tingee của BTC, đọc bằng credential `tingee_credential_id`.
 * Một BTC có nhiều tài khoản hiện hành (`retired_at IS NULL`), mỗi VA tối đa một lần. Hủy liên kết là đặt
 * `retired_at`, không xóa dòng: Đơn đã chụp `orders.payout_account_id` vẫn tìm được tài khoản và credential (AD-35).
 * BTC còn tài khoản hiện hành thì có đúng một tài khoản `is_default` (Đơn mới nhận tiền vào VA này, AD-6); index một
 * phần chỉ chặn "nhiều hơn một", "đúng một" do service giữ (khóa dòng BTC). Không bao giờ lưu số tài khoản đầy đủ hay
 * số dư: chỉ 4 số cuối. `account_name`, `account_last4` là PII (`PII_COLUMNS.organizer`).
 */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tingeeCredentialId: uuid('tingee_credential_id')
      .notNull()
      .references(() => tingeeCredentials.id),
    /** Số VA Tingee dùng để nhận tiền (`create-link` truyền số này, AD-6). */
    vaAccountNumber: text('va_account_number').notNull(),
    bankBin: text('bank_bin').notNull(),
    bankName: text('bank_name').notNull(),
    /** Loại tài khoản theo Tingee (vd. `personal-account`). */
    accountType: text('account_type').notNull(),
    accountLast4: text('account_last4').notNull(),
    accountName: text('account_name').notNull(),
    tingeeShopId: bigint('tingee_shop_id', { mode: 'number' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    /** Tài khoản mặc định của BTC. Hủy liên kết thì cột này về `false` (dòng đã hủy không bao giờ là mặc định). */
    isDefault: boolean('is_default').notNull().default(false),
    linkedAt: timestamptz('linked_at').notNull().defaultNow(),
    retiredAt: timestamptz('retired_at'),
  },
  (t) => [
    uniqueIndex('payout_accounts_current_va_per_organization_key')
      .on(t.organizationId, t.vaAccountNumber)
      .where(sql`${t.retiredAt} IS NULL`),
    uniqueIndex('payout_accounts_one_default_per_organization_key')
      .on(t.organizationId)
      .where(sql`${t.isDefault} AND ${t.retiredAt} IS NULL`),
    index('payout_accounts_organization_id_linked_at_idx').on(t.organizationId, t.linkedAt),
    index('payout_accounts_tingee_credential_id_idx').on(t.tingeeCredentialId),
  ],
);
