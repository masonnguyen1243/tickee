import { and, eq, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { notFound, UUID } from './event.service.js';
import { events } from './schema.js';

/*
 * Phần Sự kiện mà `checkin` cần cho link mời CTV (Story 5.1, AD-30) và CTV (Story 5.2), và cổng check-in của
 * `ticketing.checkIn` (Story 5.3, `assertCheckinOpen`). `checkin` không đọc bảng `events`
 * (chỉ `schema.ts` của nó được import `event/schema.ts` để khai FK), nên đọc và khóa Sự kiện đi qua đây. Route BTC đi qua
 * `orgScope(ctx)`: id lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`, kiểm trước mọi thứ khác. Luồng CTV và nhận
 * lời mời không có `AccessContext` (người gọi không thuộc BTC): đọc theo id, không có thì `null` để bên gọi chọn lỗi.
 */

/**
 * Sự kiện của link mời CTV: trạng thái, `effective_end_at` (mốc hết hạn trần của link) và `endedManually` (BTC đã bấm
 * "Kết thúc": đã kết thúc dù mốc ghi bằng đồng hồ máy chủ ứng dụng có thể còn "tương lai" với đồng hồ DB).
 */
export interface CheckinEventRef {
  id: string;
  status: (typeof events.$inferSelect)['status'];
  effectiveEndAt: Date;
  endedManually: boolean;
}

/**
 * `CheckinEventRef` kèm `ended`: đã bấm "Kết thúc", hoặc đồng hồ DB (`now()` của transaction) đã tới `effective_end_at`
 * (cùng luật `effective_end_at <= now` của Ẩn/Kết thúc và `isEventEnded` của web).
 */
export type LockedCheckinEventRef = CheckinEventRef & { ended: boolean };

/** Sự kiện đã kết thúc theo luật của check-in: đã bấm "Kết thúc", hoặc đồng hồ DB đã tới `effective_end_at`. */
const checkinEnded = sql<boolean>`${events.endedManuallyAt} IS NOT NULL OR now() >= ${events.effectiveEndAt}`;

const columns = {
  id: events.id,
  status: events.status,
  effectiveEndAt: events.effectiveEndAt,
  endedManually: sql<boolean>`${events.endedManuallyAt} IS NOT NULL`,
};

/**
 * Khóa dòng Sự kiện của BTC (`FOR UPDATE`) trong `tx` của "Tạo link mới": hai lần tạo đồng thời xếp hàng trên dòng này,
 * và chạy tuần tự với mọi lệnh ghi khác của BTC lên Sự kiện (Ẩn, Kết thúc, sửa giờ…).
 */
export async function lockEventForCheckerInvite(
  tx: Tx,
  ctx: AccessContext,
  eventId: string,
): Promise<LockedCheckinEventRef> {
  if (!UUID.test(eventId)) throw notFound();
  const [row] = await tx
    .select({ ...columns, ended: checkinEnded })
    .from(events)
    .where(and(orgScope(ctx)(events), eq(events.id, eventId)))
    .for('update');
  if (!row) throw notFound();
  return row;
}

/** Đọc (không khóa) Sự kiện của BTC cho `GET` link mời CTV. */
export async function checkinEventOf(db: DbExecutor, ctx: AccessContext, eventId: string): Promise<CheckinEventRef> {
  if (!UUID.test(eventId)) throw notFound();
  const [row] = await db
    .select(columns)
    .from(events)
    .where(and(orgScope(ctx)(events), eq(events.id, eventId)));
  if (!row) throw notFound();
  return row;
}

/**
 * `CheckinEventRef` kèm BTC sở hữu và tên Sự kiện: cho cổng quyền CTV (`PermissionGuard`), Màn quét và nhận lời mời CTV
 * (Story 5.2), nơi chỉ có id Sự kiện.
 */
export type CheckinEventDetail = CheckinEventRef & { organizationId: string; name: string };

const detailColumns = { ...columns, organizationId: events.organizationId, name: events.name };

/** Đọc (không khóa) Sự kiện theo id, không cần ctx. Id sai dạng hoặc không tồn tại → `null`. */
export async function checkinEventById(db: DbExecutor, eventId: string): Promise<CheckinEventDetail | null> {
  if (!UUID.test(eventId)) return null;
  const [row] = await db.select(detailColumns).from(events).where(eq(events.id, eventId));
  return row ?? null;
}

/**
 * Khóa dòng Sự kiện theo id `FOR SHARE` trong `tx` của nhận lời mời CTV (`flows.acceptCheckerInvite`), không cần ctx: các
 * lần nhận song song không chờ nhau, còn mọi lệnh ghi của BTC lên Sự kiện (Hủy, Kết thúc, sửa giờ; khóa `FOR UPDATE`) chờ
 * lần nhận đang chạy xong, nên luật hiệu lực của link đọc trên trạng thái đã commit. Id sai dạng hoặc không tồn tại → `null`.
 */
export async function lockCheckinEventByIdForShare(tx: Tx, eventId: string): Promise<CheckinEventDetail | null> {
  if (!UUID.test(eventId)) return null;
  const [row] = await tx.select(detailColumns).from(events).where(eq(events.id, eventId)).for('share');
  return row ?? null;
}

/** Lý do Sự kiện không còn nhận check-in (Story 5.3): đã hủy, hoặc đã kết thúc. */
export type CheckinClosedReason = 'CANCELLED' | 'EVENT_ENDED';

/**
 * Cổng check-in của `ticketing.checkIn` (Story 5.3, AD-15), trong `tx` của bên gọi: khóa dòng Sự kiện `FOR SHARE` (các
 * lần quét song song không chờ nhau; Hủy, "Kết thúc", sửa giờ khóa `FOR UPDATE` nên chờ lần quét đang chạy xong) rồi trả
 * lý do đóng thay vì ném lỗi HTTP: đã hủy → `CANCELLED`; đã kết thúc (đã bấm "Kết thúc", hoặc đồng hồ DB `now()` đã tới
 * `effective_end_at`, cùng luật `ended` của `lockEventForCheckerInvite`) → `EVENT_ENDED`; còn mở → `null`. Bên gọi đã
 * qua guard quyền (Sự kiện có thật), nên id sai dạng hay không tồn tại là lỗi cấu hình (ném `Error`, 500).
 */
export async function assertCheckinOpen(tx: Tx, eventId: string): Promise<CheckinClosedReason | null> {
  const [row] = UUID.test(eventId)
    ? await tx
        .select({ status: events.status, ended: checkinEnded })
        .from(events)
        .where(eq(events.id, eventId))
        .for('share')
    : [];
  if (!row) throw new Error('assertCheckinOpen: Sự kiện không tồn tại (người gọi phải qua guard quyền trước)');
  if (row.status === 'cancelled') return 'CANCELLED';
  return row.ended ? 'EVENT_ENDED' : null;
}
