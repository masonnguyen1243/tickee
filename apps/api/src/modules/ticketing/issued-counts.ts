import { count } from 'drizzle-orm';
import type { DbExecutor } from '../../platform/db/index.js';
import { tickets } from './schema.js';

/**
 * Số Vé đã phát theo Hạng vé (`ticket_type_id` → số Vé), cho đối chiếu tồn kho của `ordering` (Story 4.6-c, AD-2). Đếm
 * **mọi** Vé, không lọc `status`: Vé `cancelled` vẫn giữ suất (`paid` → `cancelled` không trả chỗ), nên
 * `ticket_type_inventory.sold` phải bằng đúng số này. Hạng vé chưa phát Vé nào không có trong Map. Người gọi truyền `tx`
 * của mình để cùng snapshot với các câu đọc khác (đối chiếu chạy trong transaction REPEATABLE READ). Quét theo index
 * `tickets_ticket_type_id_idx`: chi phí tăng theo tổng số Vé.
 */
export async function issuedTicketCountsByType(db: DbExecutor): Promise<Map<string, number>> {
  const rows = await db
    .select({ ticketTypeId: tickets.ticketTypeId, issued: count() })
    .from(tickets)
    .groupBy(tickets.ticketTypeId);
  return new Map(rows.map((row) => [row.ticketTypeId, row.issued]));
}
