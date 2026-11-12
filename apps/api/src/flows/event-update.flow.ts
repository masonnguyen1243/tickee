import { notifiesBuyers, timeOrVenueChanged, type EventBuyerCount, type EventDetail } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import {
  applyEventEdit,
  assertEventOfOrganization,
  eventDetailOf,
  type EventDraftValues,
} from '../modules/event/index.js';
import { enqueueEventChangeEmail, paidBuyerCount } from '../modules/ordering/index.js';
import type { AccessContext } from '../platform/access/index.js';
import { dbNow, type Database } from '../platform/db/index.js';

/*
 * Sửa thông tin Sự kiện (Story 2.12) kèm báo Người mua khi đổi giờ hoặc địa điểm (Story 3.10, FR-7, AD-12, AD-25): một
 * lệnh vừa ghi `events` (`event.applyEventEdit`) vừa enqueue job email của `ordering` trong cùng transaction, nên đặt ở
 * flows (`event` không được gọi `ordering`). Rollback (lỗi ghi, lỗi enqueue…) thì không có job và `time_venue_version`
 * giữ nguyên. Người gọi đã `PublicPageQueues.ready()` và `EventChangeEmailQueues.ready()` trước transaction.
 */

/**
 * `PATCH /v1/orgs/:orgId/events/:eventId`: sửa như Story 2.12 (`applyEventEdit`), rồi enqueue đúng một job gốc email
 * `{ eventId, version }` khi đủ cả bốn điều kiện: Sự kiện không ở `draft`/`cancelled`, có đổi giờ hoặc địa điểm, sau khi
 * sửa chưa kết thúc theo đồng hồ DB (`notifiesBuyers`), và có ít nhất một Người mua (`paidBuyerCount`, đếm sau khi đã khóa
 * dòng Sự kiện).
 */
export async function updateEvent(
  db: Database,
  boss: PgBoss,
  ctx: AccessContext,
  eventId: string,
  input: EventDraftValues,
): Promise<EventDetail> {
  const row = await db.transaction(async (tx) => {
    const { before, after } = await applyEventEdit(tx, boss, ctx, eventId, input);
    // Chỉ đọc đồng hồ DB khi có đổi giờ/địa điểm (nháp, sửa mô tả, lưu lặp không tốn thêm truy vấn).
    if (
      timeOrVenueChanged(before, after) &&
      notifiesBuyers(before, after, await dbNow(tx)) &&
      (await paidBuyerCount(tx, after.id)) > 0
    ) {
      await enqueueEventChangeEmail(boss, tx, { eventId: after.id, version: after.timeVenueVersion });
    }
    return after;
  });
  return eventDetailOf(row);
}

/**
 * `GET /v1/orgs/:orgId/events/:eventId/buyer-count`: số Người mua (`user_id` có Đơn `paid`) của Sự kiện. Sự kiện lạ, sai
 * dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
 */
export async function eventBuyerCount(db: Database, ctx: AccessContext, eventId: string): Promise<EventBuyerCount> {
  await assertEventOfOrganization(db.orm, ctx, eventId);
  return { buyers: await paidBuyerCount(db.orm, eventId) };
}
