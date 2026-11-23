import { and, eq, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { notFound, UUID } from './event.service.js';
import { events } from './schema.js';

/*
 * Phần Sự kiện mà `checkin` cần cho link mời CTV (Story 5.1, AD-30). `checkin` không đọc bảng `events` (chỉ `schema.ts`
 * của nó được import `event/schema.ts` để khai FK), nên đọc và khóa Sự kiện đi qua đây. Mọi truy vấn qua `orgScope(ctx)`:
 * id lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`, kiểm trước mọi thứ khác.
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
    .select({ ...columns, ended: sql<boolean>`${events.endedManuallyAt} IS NOT NULL OR now() >= ${events.effectiveEndAt}` })
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
