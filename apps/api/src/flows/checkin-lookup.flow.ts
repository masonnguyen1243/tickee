import type { CheckinLookupResult, LookupQuery, ScanResult } from '@tickee/contracts';
import { orderIdsByBuyerContact } from '../modules/ordering/index.js';
import { checkIn, validTicketsOfOrders } from '../modules/ticketing/index.js';
import type { EventAccessContext } from '../platform/access/index.js';
import type { Database } from '../platform/db/index.js';
import { toScanResult, type SheetRowChanges } from './checkin-scan.flow.js';

/*
 * Tra tay và check-in tay (Story 5.5, FR-29, AD-31, AD-35). Ở flows vì SĐT/email Người mua là bản chụp trên Đơn
 * (`ordering`), mà `checkin` và `ticketing` không được gọi `ordering`. Giá trị đã tra chỉ đi vào câu SQL dạng tham số:
 * không log, không lên span, không vào response hay lỗi.
 */

/**
 * Tra Vé của Sự kiện `ctx.eventId` (người gọi đã qua `PermissionGuard`, `checkin.lookup`, và bộ đếm tra tay) theo SĐT
 * hoặc email đã chuẩn hóa: `ordering` trả id các Đơn của Sự kiện có SĐT/email Người mua khớp đầy đủ, rồi `ticketing` trả
 * Vé `valid` của các Đơn đó (bản chụp trên Vé), sắp theo mã Đơn rồi `seq`. Cả hai câu trong `orgScope` và `event_id`.
 * Không khớp (kể cả Đơn chỉ còn Vé đã hủy, hay Đơn của Sự kiện khác) → `{ tickets: [] }`.
 */
export async function lookupTickets(
  db: Database,
  ctx: EventAccessContext,
  query: LookupQuery,
): Promise<CheckinLookupResult> {
  const orderIds = await orderIdsByBuyerContact(db.orm, ctx, ctx.eventId, query);
  const rows = await validTicketsOfOrders(db.orm, ctx, ctx.eventId, orderIds);
  return {
    tickets: rows.map((row) => ({
      ticketId: row.id,
      holderName: row.holderName,
      ticketTypeName: row.ticketTypeName,
      seq: row.seq,
      count: row.count,
      checkedIn: row.checkedIn,
    })),
  };
}

/**
 * Check-in tay Vé `ticketId` ở Sự kiện `ctx.eventId` (người gọi đã qua `PermissionGuard`, `checkin.lookup`): chờ queue
 * `sheet_row_changed` sẵn sàng rồi cùng `ticketing.checkIn` như khi quét (`method: manual`, Story 6.5), trong một
 * transaction, với `Idempotency-Key` (chữ thường) làm `scanId`. Gửi lại cùng
 * khóa bằng cùng tài khoản phát lại kết quả lần đầu (kể cả khi Sự kiện vừa đóng hay Vé vừa bị hủy); `checked_in_by` là
 * người bấm. Kết quả dựng bằng cùng `toScanResult` của quét. `ticketId` không có Vé → `invalid BAD_SIGNATURE`; Vé của Sự
 * kiện khác → `invalid OTHER_EVENT` (UI không đi tới hai nhánh này).
 */
export async function manualCheckIn(
  db: Database,
  ctx: EventAccessContext,
  ticketId: string,
  idempotencyKey: string,
  sheets: SheetRowChanges,
): Promise<ScanResult> {
  await sheets.queues.ready();
  const result = await db.transaction((tx) =>
    checkIn(tx, sheets.boss, {
      ticketId: ticketId.toLowerCase(),
      eventId: ctx.eventId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      // Cột uuid trả chữ thường: so phát lại theo cùng dạng dù client gửi chữ hoa.
      scanId: idempotencyKey.toLowerCase(),
      method: 'manual',
    }),
  );
  return toScanResult(db.orm, ctx, result);
}
