import { toEventIso, type CheckerList } from '@tickee/contracts';
import { checkersOf } from '../modules/checkin/index.js';
import { checkinEventOf } from '../modules/event/index.js';
import { userContacts } from '../modules/identity/index.js';
import type { AccessContext } from '../platform/access/index.js';
import type { Database } from '../platform/db/index.js';

/*
 * Danh sách CTV của Sự kiện ở tab Check-in (Story 5.6, FR-26, UX-DR39). Ở flows vì cần tên và email của tài khoản
 * (`identity.userContacts`), mà `checkin` chỉ được gọi `ticketing` và `event`.
 */

/**
 * Mọi CTV đã nhận lời mời của Sự kiện `eventId` (kể cả đã bị thu hồi), theo lúc nhận tăng dần. Sự kiện kiểm trước qua
 * `orgScope` (lạ, sai dạng, của BTC khác → `404 EVENT_NOT_FOUND`). `name`: tên đã trim, rỗng → `null`; tài khoản không
 * còn → `name` và `email` đều `null`.
 */
export async function listCheckers(db: Database, ctx: AccessContext, eventId: string): Promise<CheckerList> {
  const event = await checkinEventOf(db.orm, ctx, eventId);
  const rows = await checkersOf(db.orm, ctx, event.id);
  const contacts = await userContacts(db.orm, rows.map((row) => row.userId));
  return {
    checkers: rows.map((row) => {
      const contact = contacts.get(row.userId);
      return {
        id: row.id,
        name: contact?.name.trim() || null,
        email: contact?.email ?? null,
        acceptedAt: toEventIso(row.acceptedAt),
        status: row.status,
        revokedAt: row.revokedAt ? toEventIso(row.revokedAt) : null,
      };
    }),
  };
}
