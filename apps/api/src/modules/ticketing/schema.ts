import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz } from '../../platform/db/index.js';
import { events, ticketTypes } from '../event/schema.js';

/** Trạng thái Vé: `valid` lúc phát; `cancelled` (Epic 4/7, kèm `cancel_reason`). Check-in ghi `checked_in_at` (Epic 5). */
export const TICKET_STATUSES = ['valid', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Lý do hủy Vé (`cancel_reason`, chỉ khi `status = 'cancelled'`): Sự kiện bị hủy (Story 7.1) hoặc Vé bị vô hiệu (Story
 * 7.5; quét ra `VOIDED`). Cột là text, DB không CHECK giá trị: nơi ghi và nơi đọc đều dùng hằng này.
 */
export const TICKET_CANCEL_REASON = { EVENT_CANCELLED: 'event_cancelled', VOIDED: 'voided' } as const;
export type TicketCancelReason = (typeof TICKET_CANCEL_REASON)[keyof typeof TICKET_CANCEL_REASON];

/**
 * Vé (Story 3.3, AD-1, AD-35): chỉ phát bên trong `ordering.markPaid`, cùng transaction với Đơn chuyển `paid`. Mỗi Vé
 * một dòng, bản chụp lúc phát không đổi được (`UPDATE_PROTECTED_COLUMNS`): `seq` 1..N trong Đơn (theo Hạng vé tăng
 * dần theo id), `order_ticket_count` (N), tên Người mua (`holder_name`, PII), tên Hạng vé, mã Đơn, giờ phát. Mã QR vé
 * không lưu: tính lại khi đọc từ `id` và `qr_key_version` (phiên bản khóa ký trong `TICKET_QR_KEYS`), nên lộ DB không lộ
 * Mã QR hợp lệ.
 *
 * Link chia sẻ Vé (AD-29, Story 3.8): `share_version` (bắt đầu 1) và `share_token_hash` (SHA-256 hex của token suy ra từ
 * id Vé, `share_version` và khóa `qr_key_version`; unique). Không lưu token dạng rõ. "Tạo lại link" tăng `share_version`
 * và ghi hash mới trong cùng một `UPDATE`. Vé phát trước Story 3.8 có hash `NULL` (link 404 tới khi chủ Vé tạo lại).
 *
 * Check-in (Story 5.3, AD-15): `checked_in_at` (đồng hồ DB lúc ghi), `checked_in_by` (tài khoản người quét) và
 * `checkin_scan_id` (uuid client sinh cho lần quét, để phát lại cùng kết quả khi gửi lại). Chỉ `ticketing.checkIn` ghi,
 * bằng một UPDATE có điều kiện (`status = 'valid' AND checked_in_at IS NULL`), nên mỗi Vé check-in đúng một lần. Hai cột
 * sau phải `NULL` khi chưa check-in (CHECK); `checked_in_by` không có FK (`ticketing` không phụ thuộc `identity`).
 *
 * `order_id`, `organization_id`, `user_id` không có FK: `ticketing` không phụ thuộc `ordering`, `organizer` hay
 * `identity` (module-graph, AD-10). FK tới `events` và `ticket_types` (`ticketing → event`): Hạng vé đã phát Vé không
 * xóa được.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id),
    seq: integer('seq').notNull(),
    orderTicketCount: integer('order_ticket_count').notNull(),
    holderName: text('holder_name').notNull(),
    ticketTypeName: text('ticket_type_name').notNull(),
    orderCode: text('order_code').notNull(),
    issuedAt: timestamptz('issued_at').notNull(),
    qrKeyVersion: integer('qr_key_version').notNull(),
    status: text('status', { enum: TICKET_STATUSES }).notNull().default('valid'),
    cancelReason: text('cancel_reason'),
    checkedInAt: timestamptz('checked_in_at'),
    checkedInBy: uuid('checked_in_by'),
    checkinScanId: uuid('checkin_scan_id'),
    shareVersion: integer('share_version').notNull().default(1),
    shareTokenHash: text('share_token_hash'),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('tickets_order_id_seq_key').on(t.orderId, t.seq),
    uniqueIndex('tickets_share_token_hash_key').on(t.shareTokenHash),
    index('tickets_event_id_idx').on(t.eventId),
    index('tickets_user_id_event_id_idx').on(t.userId, t.eventId),
    index('tickets_ticket_type_id_idx').on(t.ticketTypeId),
    check('tickets_status_check', sql`${t.status} IN ('valid', 'cancelled')`),
    check('tickets_seq_check', sql`${t.seq} >= 1 AND ${t.seq} <= ${t.orderTicketCount}`),
    check('tickets_qr_key_version_check', sql`${t.qrKeyVersion} >= 1`),
    check('tickets_cancel_reason_check', sql`${t.status} = 'cancelled' OR ${t.cancelReason} IS NULL`),
    check('tickets_order_code_check', sql`${t.orderCode} ~ '^TK[0-9A-HJKMNP-TV-Z]{8}$'`),
    check('tickets_share_version_check', sql`${t.shareVersion} >= 1`),
    check('tickets_share_token_hash_check', sql`${t.shareTokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'tickets_checkin_check',
      sql`${t.checkedInAt} IS NOT NULL OR (${t.checkedInBy} IS NULL AND ${t.checkinScanId} IS NULL)`,
    ),
  ],
);
