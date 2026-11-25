import type { LookupQuery } from '@tickee/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { orders } from './schema.js';

/*
 * Read model của tra tay (Story 5.5, FR-29, AD-35): `checkin` và `ticketing` không được gọi `ordering`, nên `flows` đọc
 * id Đơn ở đây rồi hỏi `ticketing` Vé của các Đơn đó. Khớp **đầy đủ** với bản chụp SĐT/email Người mua trên Đơn lúc đặt
 * (không theo email tài khoản hiện tại, không khớp một phần). Chỉ trả id Đơn: SĐT, email hay tên không bao giờ rời đây.
 */

/** Phạm vi BTC của người tra. */
export type BuyerContactScope = Pick<AccessContext, 'organizationId'>;

/**
 * Id các Đơn (mọi trạng thái) của Sự kiện `eventId` thuộc BTC `scope` có SĐT (`buyer_phone`, E.164) hoặc email
 * (`lower(buyer_email)`: Đơn đặt bằng tài khoản Google có thể lưu email chưa viết thường) khớp đầy đủ với `contact` đã chuẩn
 * hóa (`parseLookupQuery`). Lọc theo `event_id` (index `orders_event_id_created_at_idx`), không index riêng cho SĐT/email.
 * Người gọi đã kiểm Sự kiện thuộc BTC.
 */
export async function orderIdsByBuyerContact(
  db: DbExecutor,
  scope: BuyerContactScope,
  eventId: string,
  contact: LookupQuery,
): Promise<string[]> {
  const match =
    contact.kind === 'phone' ? eq(orders.buyerPhone, contact.phone) : sql`lower(${orders.buyerEmail}) = ${contact.email}`;
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(orgScope(scope)(orders), eq(orders.eventId, eventId), match));
  return rows.map((row) => row.id);
}
