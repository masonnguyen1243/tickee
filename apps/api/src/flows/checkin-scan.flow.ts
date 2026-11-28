import {
  ScanCheckerRole,
  ScanInvalidReason,
  ScanOutcome,
  toEventIso,
  type ScanCheckedBy,
  type ScanRequest,
  type ScanResult,
} from '@tickee/contracts';
import { userContacts } from '../modules/identity/index.js';
import { memberRoleOf } from '../modules/organizer/index.js';
import type { PgBoss } from 'pg-boss';
import {
  checkIn,
  verifyTicketQr,
  type CheckInResult,
  type SheetRowChangedQueues,
  type TicketQrKeys,
} from '../modules/ticketing/index.js';
import type { EventAccessContext } from '../platform/access/index.js';
import type { Database, DbExecutor } from '../platform/db/index.js';
import { measured, type MeasuredOutcome } from '../platform/telemetry/index.js';

/*
 * Quét Mã QR vé (Story 5.3, FR-27, FR-28, AD-15, AD-16). Ở flows vì kết quả `already` cần tên (`identity`) và vai trong
 * BTC (`organizer`) của người quét trước, mà `checkin` và `ticketing` không được gọi hai mô-đun đó. Mã QR vé chỉ được
 * kiểm chữ ký ở đây: không vào DB, log, span hay response.
 */

/** Histogram thời gian (giây) của mỗi lần quét, theo `outcome` và `reason` (chỉ khi `invalid`). Đo ở server, NFR-2. */
export const CHECKIN_SCAN_DURATION_METRIC = 'tickee.checkin.scan.duration';

/** Kết quả quét lên span và histogram: `outcome`, thêm `reason` khi Vé không hợp lệ (giá trị ít, không id). */
function scanOutcome(result: ScanResult): MeasuredOutcome {
  if (result.outcome === ScanOutcome.INVALID) {
    return { outcome: result.outcome, error: false, attributes: { reason: result.reason } };
  }
  return { outcome: result.outcome, error: false };
}

/**
 * Người đã check-in Vé, theo thứ tự: chính người đang quét → `self`; tài khoản có tên (đã trim; tài khoản OTP không có)
 * → `name`; còn lại → vai trong BTC sở hữu Sự kiện, hoặc `checker` khi không phải thành viên (kể cả tài khoản không còn,
 * hoặc Vé không ghi người quét). Không bao giờ dùng email.
 */
async function checkedByOf(
  db: DbExecutor,
  ctx: EventAccessContext,
  checkedInBy: string | null,
): Promise<ScanCheckedBy> {
  if (checkedInBy === ctx.userId) return { kind: 'self' };
  if (checkedInBy === null) return { kind: 'role', role: ScanCheckerRole.CHECKER };
  const name = (await userContacts(db, [checkedInBy])).get(checkedInBy)?.name.trim();
  if (name) return { kind: 'name', name };
  const role = await memberRoleOf(db, checkedInBy, ctx.organizationId);
  return { kind: 'role', role: role ?? ScanCheckerRole.CHECKER };
}

/**
 * Queue `sheet_row_changed` (Story 6.5) mà check-in enqueue vào trong transaction: pg-boss của vai api và producer của
 * queue (`ready()` trước transaction).
 */
export interface SheetRowChanges {
  boss: PgBoss;
  queues: SheetRowChangedQueues;
}

/**
 * `ScanResult` của một lần check-in (quét, hay check-in tay ở `checkin-lookup.flow.ts`): `already` thì dựng `checkedBy`
 * (đọc `identity`, `organizer`), gọi sau khi transaction check-in đã xong (đọc ngoài khóa).
 */
export async function toScanResult(db: DbExecutor, ctx: EventAccessContext, result: CheckInResult): Promise<ScanResult> {
  switch (result.outcome) {
    case 'ok':
      return {
        outcome: ScanOutcome.OK,
        holderName: result.holderName,
        seq: result.seq,
        count: result.count,
        ticketTypeName: result.ticketTypeName,
      };
    case 'recent':
      return { outcome: ScanOutcome.RECENT };
    case 'already':
      return {
        outcome: ScanOutcome.ALREADY,
        checkedInAt: toEventIso(result.checkedInAt),
        checkedBy: await checkedByOf(db, ctx, result.checkedInBy),
      };
    case 'invalid':
      return { outcome: ScanOutcome.INVALID, reason: result.reason };
  }
}

/**
 * Một lần quét ở Sự kiện `ctx.eventId` (người gọi đã qua `PermissionGuard`, `checkin.scan`): kiểm chữ ký Mã QR vé trước
 * mọi truy vấn DB (sai dạng, sai chữ ký, khóa `k` lạ → `invalid BAD_SIGNATURE`, không chạm DB hay pg-boss); rồi chờ queue
 * `sheet_row_changed` sẵn sàng và `ticketing.checkIn` (`method: scan`) trong một transaction; `already` thì dựng
 * `checkedBy` sau khi transaction xong (đọc ngoài khóa). Mỗi lần quét chạy trong span `checkin scan` và ghi
 * `CHECKIN_SCAN_DURATION_METRIC`; lỗi DB thì ném lại (span lỗi, không ghi histogram).
 */
export function scanTicket(
  db: Database,
  keys: TicketQrKeys,
  ctx: EventAccessContext,
  input: ScanRequest,
  sheets: SheetRowChanges,
): Promise<ScanResult> {
  return measured(
    {
      span: 'checkin scan',
      metric: CHECKIN_SCAN_DURATION_METRIC,
      description: 'Thời gian một lần quét Mã QR vé ở server (kiểm chữ ký, check-in, dựng kết quả).',
      attributes: {},
      outcome: scanOutcome,
    },
    async () => {
      const verified = verifyTicketQr(keys, input.code);
      if (!verified) return { outcome: ScanOutcome.INVALID, reason: ScanInvalidReason.BAD_SIGNATURE };
      await sheets.queues.ready();
      const result = await db.transaction((tx) =>
        checkIn(tx, sheets.boss, {
          ticketId: verified.ticketId,
          eventId: ctx.eventId,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          // Cột uuid trả chữ thường: so phát lại theo cùng dạng dù client gửi chữ hoa.
          scanId: input.scanId.toLowerCase(),
          method: 'scan',
        }),
      );
      return toScanResult(db.orm, ctx, result);
    },
  );
}
