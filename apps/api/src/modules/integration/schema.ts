import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../../platform/db/index.js';
import { events } from '../event/schema.js';
import { users } from '../identity/schema.js';
import { organizations } from '../organizer/schema.js';

/**
 * Kết nối Google Sheets của một Sự kiện (Story 6.4, FR-32, AD-23): tối đa một kết nối mỗi Sự kiện (unique `event_id`).
 * Callback OAuth tạo dòng `syncing` (thua race khi INSERT thì không ghi đè dòng có sẵn); worker tạo spreadsheet, lưu
 * `spreadsheet_id`/`spreadsheet_url` ngay sau khi tạo (retry dùng lại, không tạo Sheet thứ hai), đẩy Đơn hiện có rồi chuyển
 * `active`. Google lỗi tạm thời → `retrying` + `last_error_code`; mất quyền → `auth_revoked`. "Ngắt kết nối" xóa dòng (refresh
 * token đi theo); Sheet giữ nguyên trong Drive.
 *
 * `refresh_token`: refresh token Google mã hóa AES-256-GCM bằng `GOOGLE_SHEETS_TOKEN_KEYS` (`v<k>:…`), không bao giờ ở dạng
 * gốc, không bao giờ trong response hay log. `granted_by_user_id`: người cấp OAuth (Owner/Admin bấm "Kết nối").
 *
 * `sheet_tab_id` (Story 6.5): `sheetId` của tab chứa Đơn trong spreadsheet (mặc định 0, id đặt lúc tạo Sheet). Worker tìm
 * tab theo id này, không theo tên, nên BTC đổi tên tab vẫn ghi được. Sheet mất (spreadsheet 404, mất tab, mất cột Mã Đơn)
 * thì flush đặt lại `spreadsheet_id`/`spreadsheet_url`/`last_synced_at`/`sheet_tab_id`, chuyển `syncing` và chạy lại lần
 * đẩy đầu (Quyết định 2 của Story 6.5).
 *
 * `auth_revoked_at` (Story 6.6): lúc kết nối chuyển `auth_revoked` (đồng hồ DB), có khi và chỉ khi `status =
 * 'auth_revoked'` (CHECK). Là khóa chống gửi lặp của email mất quyền và `version` của banner: mất quyền lần mới (sau khi
 * đã kết nối lại) là một mốc mới. "Kết nối lại" xóa mốc cùng `last_error_code`.
 */
export const sheetConnections = pgTable(
  'sheet_connections',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    grantedByUserId: uuid('granted_by_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['active', 'syncing', 'retrying', 'auth_revoked'] }).notNull(),
    spreadsheetId: text('spreadsheet_id'),
    spreadsheetUrl: text('spreadsheet_url'),
    refreshToken: text('refresh_token').notNull(),
    sheetTabId: integer('sheet_tab_id').notNull().default(0),
    lastSyncedAt: timestamptz('last_synced_at'),
    lastErrorCode: text('last_error_code'),
    authRevokedAt: timestamptz('auth_revoked_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sheet_connections_event_id_key').on(t.eventId),
    index('sheet_connections_organization_id_idx').on(t.organizationId),
    check('sheet_connections_status_check', sql`${t.status} IN ('active', 'syncing', 'retrying', 'auth_revoked')`),
    // Ciphertext của `SecretBox` (`v<k>:<iv>.<tag>.<ciphertext>`): DB từ chối token gốc lỡ ghi thẳng.
    check('sheet_connections_refresh_token_check', sql`${t.refreshToken} ~ '^v[1-9][0-9]*:'`),
    // Id và URL của spreadsheet luôn đi cùng nhau (lưu một lần ngay sau khi tạo Sheet).
    check(
      'sheet_connections_spreadsheet_check',
      sql`(${t.spreadsheetId} IS NULL) = (${t.spreadsheetUrl} IS NULL)`,
    ),
    check('sheet_connections_sheet_tab_id_check', sql`${t.sheetTabId} >= 0`),
    // Mốc mất quyền đi cùng trạng thái `auth_revoked` (Story 6.6).
    check(
      'sheet_connections_auth_revoked_check',
      sql`(${t.status} = 'auth_revoked') = (${t.authRevokedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Dòng bẩn của kết nối Google Sheets (Story 6.5, AD-23): Đơn cần ghi lại lên Sheet. Handler `sheet_row_changed` upsert
 * `(connection_id, order_id)` và tăng `version`; flush đọc `(order_id, version)`, ghi Google rồi chỉ xóa dòng có `version`
 * vẫn bằng giá trị đã đọc, nên thay đổi đến giữa lượt không bị mất. Không dùng con trỏ `updated_at`. "Ngắt kết nối" xóa
 * kết nối thì dòng bẩn đi theo (`ON DELETE CASCADE`). `order_id` không có FK: `integration` chỉ đọc `ordering` qua read
 * model.
 */
export const sheetDirtyRows = pgTable(
  'sheet_dirty_rows',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => sheetConnections.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull(),
    version: integer('version').notNull().default(1),
    markedAt: timestamptz('marked_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.orderId] }),
    index('sheet_dirty_rows_connection_id_marked_at_idx').on(t.connectionId, t.markedAt),
    check('sheet_dirty_rows_version_check', sql`${t.version} >= 1`),
  ],
);

/**
 * Lượt OAuth Google Sheets đang chờ callback (Story 6.4): một dòng mỗi lần bấm "Kết nối Google Sheets". `state` 32 byte
 * ngẫu nhiên chỉ nằm trong URL ủy quyền; DB lưu `state_hash` (SHA-256 hex, unique). `code_verifier` PKCE mã hóa bằng
 * `GOOGLE_SHEETS_TOKEN_KEYS`. Callback xóa dòng bằng `DELETE … RETURNING` (dùng một lần) rồi mới kiểm hạn
 * (`expires_at` = lúc tạo + 10 phút, đồng hồ DB), người dùng và quyền. Tạo lượt mới thì xóa luôn mọi dòng đã hết hạn
 * (của bất kỳ ai).
 */
export const sheetOauthStates = pgTable(
  'sheet_oauth_states',
  {
    id: id(),
    stateHash: text('state_hash').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeVerifier: text('code_verifier').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sheet_oauth_states_state_hash_key').on(t.stateHash),
    index('sheet_oauth_states_user_id_idx').on(t.userId),
    check('sheet_oauth_states_state_hash_check', sql`${t.stateHash} ~ '^[0-9a-f]{64}$'`),
    check('sheet_oauth_states_code_verifier_check', sql`${t.codeVerifier} ~ '^v[1-9][0-9]*:'`),
  ],
);
