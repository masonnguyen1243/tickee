import { and, count, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../platform/db/index.js';
import { eventOpenForTickets, ticketEventsByIds } from '../event/index.js';
import type { TicketQrKeys } from './qr.js';
import { tickets } from './schema.js';

/*
 * Kiểm khóa Mã QR vé lúc khởi động (Story 4.7-g, AD-16, AD-29). Vé còn dùng ký bằng một phiên bản khóa mà
 * `TICKET_QR_KEYS` của instance không có thì trên instance đó Trang Đơn và Chi tiết Vé trả 500, link chia sẻ trả 404 và
 * job email Vé vào dead-letter. Hàm thuần trên DB, không cần Nest: provider `TicketQrKeyCheck` (`ticketing.module.ts`)
 * gọi một lần mỗi lần vai api hoặc worker khởi động.
 */

/** Số Sự kiện tối đa mỗi lần `ticketEventsByIds` (một tham số mỗi id; Postgres giới hạn 65 535 tham số mỗi câu). */
const EVENT_BATCH = 1_000;

/** Một phiên bản khóa mà Vé còn dùng nhưng `TICKET_QR_KEYS` của instance không có. */
export interface MissingQrKeyVersion {
  qrKeyVersion: number;
  /** Số Vé còn dùng ký bằng phiên bản này. */
  tickets: number;
}

/**
 * Các phiên bản khóa của Vé còn dùng mà `keys` không có, tăng dần theo phiên bản; đủ khóa → `[]`. Vé còn dùng: `valid` và
 * Sự kiện còn mở cho Vé (`eventOpenForTickets`: chưa hủy, đồng hồ DB chưa quá `effective_end_at`). Vé đã hủy, Vé của Sự
 * kiện đã kết thúc hay đã hủy không cần khóa. Báo cả phiên bản nhỏ hơn `keys.currentVersion` (khóa cũ đã bị gỡ) lẫn lớn
 * hơn (instance chưa có khóa mới khi deploy dần).
 *
 * Ba bước: các phiên bản của Vé `valid` (quét bảng `tickets`: không có index theo phiên bản), giữ phiên bản `keys.has` là
 * false; chỉ khi có phiên bản thiếu (thường không có) mới đếm Vé theo `(phiên bản, Sự kiện)` rồi đọc Sự kiện theo lô.
 * Không trả id Vé. Người gọi truyền `tx` để mọi câu cùng một snapshot và một `now()`.
 */
export async function missingQrKeyVersions(db: DbExecutor, keys: TicketQrKeys): Promise<MissingQrKeyVersion[]> {
  const used = await db
    .selectDistinct({ qrKeyVersion: tickets.qrKeyVersion })
    .from(tickets)
    .where(eq(tickets.status, 'valid'));
  const missing = used.map((row) => row.qrKeyVersion).filter((version) => !keys.has(version));
  if (missing.length === 0) return [];

  const groups = await db
    .select({ qrKeyVersion: tickets.qrKeyVersion, eventId: tickets.eventId, tickets: count() })
    .from(tickets)
    .where(and(eq(tickets.status, 'valid'), inArray(tickets.qrKeyVersion, missing)))
    .groupBy(tickets.qrKeyVersion, tickets.eventId);
  const eventIds = [...new Set(groups.map((group) => group.eventId))];
  const openEventIds = new Set<string>();
  for (let i = 0; i < eventIds.length; i += EVENT_BATCH) {
    const events = await ticketEventsByIds(db, eventIds.slice(i, i + EVENT_BATCH));
    for (const [id, event] of events) if (eventOpenForTickets(event)) openEventIds.add(id);
  }

  const counts = new Map<number, number>();
  for (const group of groups) {
    if (openEventIds.has(group.eventId)) {
      counts.set(group.qrKeyVersion, (counts.get(group.qrKeyVersion) ?? 0) + group.tickets);
    }
  }
  return [...counts]
    .map(([qrKeyVersion, total]) => ({ qrKeyVersion, tickets: total }))
    .sort((a, b) => a.qrKeyVersion - b.qrKeyVersion);
}
