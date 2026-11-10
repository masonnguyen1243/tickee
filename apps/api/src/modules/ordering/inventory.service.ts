import { ErrorCode } from '@tickee/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { orderItems, ticketTypeInventory } from './schema.js';

/*
 * Tồn kho Hạng vé (Story 2.8): `ordering` là mô-đun duy nhất ghi `ticket_type_inventory`. Các hàm nhận `tx` của người
 * gọi (`flows/ticket-types.flow.ts`, tạo Đơn, hết hạn Đơn), nên thay đổi tồn kho nằm trong cùng transaction với thay
 * đổi gây ra nó. Thứ tự khóa luôn là dòng `events` (nếu có) rồi tồn kho theo `ticket_type_id` tăng dần (AD-2).
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
 * Xóa dòng tồn kho của Hạng vé chưa bán, chưa giữ chỗ (`sold + held = 0`) và chưa từng có dòng Đơn (`order_items`, kể
 * cả Đơn đã hết hạn: bản chụp Đơn trỏ tới Hạng vé, không xóa mềm). Có → `409 TICKET_TYPE_IN_USE`. Người gọi đã khóa
 * Sự kiện `FOR UPDATE`, nên không TX1 nào chen thêm dòng Đơn giữa lúc kiểm và lúc xóa.
 */
export async function deleteInventory(tx: Tx, ticketTypeId: string): Promise<void> {
  const deleted = await tx
    .delete(ticketTypeInventory)
    .where(
      and(
        eq(ticketTypeInventory.ticketTypeId, ticketTypeId),
        sql`${ticketTypeInventory.sold} + ${ticketTypeInventory.held} = 0`,
        sql`NOT EXISTS (SELECT 1 FROM ${orderItems} WHERE ${orderItems.ticketTypeId} = ${ticketTypeInventory.ticketTypeId})`,
      ),
    )
    .returning({ ticketTypeId: ticketTypeInventory.ticketTypeId });
  if (deleted.length === 0) {
    throw new AppError(
      ErrorCode.TICKET_TYPE_IN_USE,
      'Hạng vé đã có Đơn, không xóa được. Muốn ngừng bán thì đặt giờ kết thúc bán của Hạng vé.',
    );
  }
}

/** Một dòng giữ chỗ / nhả chỗ: Hạng vé và số Vé. */
export interface InventoryLine {
  ticketTypeId: string;
  quantity: number;
}

/** Theo `ticket_type_id` tăng dần (cùng thứ tự với `lockInventoryForEvent` và với Postgres so uuid). */
const byTicketTypeId = (lines: readonly InventoryLine[]): InventoryLine[] =>
  [...lines].sort((a, b) => (a.ticketTypeId < b.ticketTypeId ? -1 : a.ticketTypeId > b.ticketTypeId ? 1 : 0));

/**
 * Giữ chỗ có điều kiện cho cả Đơn (AD-2): mỗi dòng một câu `UPDATE … SET held = held + :n WHERE ticket_type_id = :id
 * AND sold + held + :n <= capacity`, theo `ticket_type_id` tăng dần. Dòng đầu tiên trả 0 dòng → trả `ticketTypeId` của
 * dòng đó và dừng; người gọi ném lỗi để rollback cả transaction (không giữ chỗ Hạng vé nào). Đủ chỗ → `null`. Id phải
 * là chữ thường. Người gọi đã khóa dòng `events` (`FOR SHARE`) trước.
 */
export async function holdInventory(tx: Tx, lines: readonly InventoryLine[]): Promise<string | null> {
  for (const { ticketTypeId, quantity } of byTicketTypeId(lines)) {
    const held = await tx
      .update(ticketTypeInventory)
      .set({ held: sql`${ticketTypeInventory.held} + ${quantity}` })
      .where(
        and(
          eq(ticketTypeInventory.ticketTypeId, ticketTypeId),
          sql`${ticketTypeInventory.sold} + ${ticketTypeInventory.held} + ${quantity} <= ${ticketTypeInventory.capacity}`,
        ),
      )
      .returning({ ticketTypeId: ticketTypeInventory.ticketTypeId });
    if (held.length === 0) return ticketTypeId;
  }
  return null;
}

/**
 * Nhả chỗ đang giữ của một Đơn (`held -= n`), theo `ticket_type_id` tăng dần. CHECK `held >= 0` chặn nhả quá số đang
 * giữ (lỗi lập trình → transaction lỗi, không âm thầm sai số).
 */
export async function releaseHeld(tx: Tx, lines: readonly InventoryLine[]): Promise<void> {
  for (const { ticketTypeId, quantity } of byTicketTypeId(lines)) {
    await tx
      .update(ticketTypeInventory)
      .set({ held: sql`${ticketTypeInventory.held} - ${quantity}` })
      .where(eq(ticketTypeInventory.ticketTypeId, ticketTypeId));
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
