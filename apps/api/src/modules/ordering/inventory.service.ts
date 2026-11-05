import { ErrorCode } from '@tickee/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { ticketTypeInventory } from './schema.js';

/*
 * Tồn kho Hạng vé (Story 2.8): `ordering` là mô-đun duy nhất ghi `ticket_type_inventory`. Các hàm nhận `tx` của người
 * gọi (`flows/ticket-types.flow.ts`), nên tạo Hạng vé và dòng tồn kho nằm trong cùng một transaction. Người gọi đã kiểm
 * Sự kiện thuộc BTC (`orgScope`) và khóa dòng `events` trước khi gọi các hàm ở đây.
 */

export interface InventoryRow {
  ticketTypeId: string;
  capacity: number;
  sold: number;
  held: number;
}

const columns = {
  ticketTypeId: ticketTypeInventory.ticketTypeId,
  capacity: ticketTypeInventory.capacity,
  sold: ticketTypeInventory.sold,
  held: ticketTypeInventory.held,
};

/** Dòng tồn kho mới `(capacity, 0, 0)` của Hạng vé vừa tạo. */
export async function createInventory(
  tx: Tx,
  input: { ticketTypeId: string; eventId: string; capacity: number },
): Promise<InventoryRow> {
  const [row] = await tx.insert(ticketTypeInventory).values(input).returning(columns);
  if (!row) throw new Error('INSERT ticket_type_inventory không trả về dòng nào');
  return row;
}

/**
 * Khóa mọi dòng tồn kho của Sự kiện (`FOR UPDATE`, theo thứ tự `ticket_type_id` để hai transaction không khóa chéo)
 * rồi trả về. Gọi sau khi đã khóa dòng `events` (thứ tự khóa: Sự kiện → tồn kho theo id).
 */
export function lockInventoryForEvent(tx: Tx, eventId: string): Promise<InventoryRow[]> {
  return tx
    .select(columns)
    .from(ticketTypeInventory)
    .where(eq(ticketTypeInventory.eventId, eventId))
    .orderBy(asc(ticketTypeInventory.ticketTypeId))
    .for('update');
}

/**
 * Đổi số suất bằng đúng một câu `UPDATE … SET capacity = :c WHERE ticket_type_id = :id AND sold + held <= :c`.
 * 0 dòng → `409 CAPACITY_BELOW_COMMITTED` với `details.minimum = sold + held`.
 */
export async function changeCapacity(tx: Tx, ticketTypeId: string, capacity: number): Promise<InventoryRow> {
  const [row] = await tx
    .update(ticketTypeInventory)
    .set({ capacity })
    .where(
      and(
        eq(ticketTypeInventory.ticketTypeId, ticketTypeId),
        sql`${ticketTypeInventory.sold} + ${ticketTypeInventory.held} <= ${capacity}`,
      ),
    )
    .returning(columns);
  if (row) return row;
  const [current] = await tx
    .select({ committed: sql<number>`${ticketTypeInventory.sold} + ${ticketTypeInventory.held}` })
    .from(ticketTypeInventory)
    .where(eq(ticketTypeInventory.ticketTypeId, ticketTypeId));
  if (!current) throw new Error('Không có dòng tồn kho cho Hạng vé');
  const minimum = Number(current.committed);
  throw new AppError(ErrorCode.CAPACITY_BELOW_COMMITTED, `Tối thiểu ${minimum} — đã bán và đang giữ chỗ.`, {
    details: { minimum },
  });
}

/**
 * Xóa dòng tồn kho của Hạng vé chưa bán, chưa giữ chỗ (`sold + held = 0`). Đã có → `409 TICKET_TYPE_IN_USE`.
 */
export async function deleteInventory(tx: Tx, ticketTypeId: string): Promise<void> {
  const deleted = await tx
    .delete(ticketTypeInventory)
    .where(
      and(
        eq(ticketTypeInventory.ticketTypeId, ticketTypeId),
        sql`${ticketTypeInventory.sold} + ${ticketTypeInventory.held} = 0`,
      ),
    )
    .returning({ ticketTypeId: ticketTypeInventory.ticketTypeId });
  if (deleted.length === 0) {
    throw new AppError(
      ErrorCode.TICKET_TYPE_IN_USE,
      'Hạng vé đã có người mua hoặc đang giữ chỗ, không xóa được.',
    );
  }
}

/** Tồn kho của các Hạng vé (không khóa), theo `ticketTypeId`. */
export async function inventoryOf(db: DbExecutor, ticketTypeIds: readonly string[]): Promise<Map<string, InventoryRow>> {
  if (ticketTypeIds.length === 0) return new Map();
  const rows = await db
    .select(columns)
    .from(ticketTypeInventory)
    .where(inArray(ticketTypeInventory.ticketTypeId, [...ticketTypeIds]));
  return new Map(rows.map((row) => [row.ticketTypeId, row]));
}
