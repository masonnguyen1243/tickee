import {
  ErrorCode,
  exceedsFreeEventCap,
  FREE_EVENT_TICKET_CAP,
  type TicketTypeDetail,
  type TicketTypeList,
} from '@tickee/contracts';
import {
  assertEventOfOrganization,
  assertTicketTypeId,
  deleteTicketTypeRow,
  insertTicketType,
  lockEventForTicketTypes,
  ticketTypeChangedFields,
  ticketTypeDetailOf,
  ticketTypeNotFound,
  ticketTypesOf,
  updateTicketTypeRow,
  type TicketTypeValues,
} from '../modules/event/index.js';
import {
  changeCapacity,
  createInventory,
  deleteInventory,
  inventoryOf,
  lockInventoryForEvent,
  type InventoryRow,
} from '../modules/ordering/index.js';
import type { AccessContext } from '../platform/access/index.js';
import { audit } from '../platform/audit/index.js';
import type { Database, Tx } from '../platform/db/index.js';
import { AppError } from '../platform/http/index.js';

/*
 * Hạng vé và tồn kho (Story 2.8, AD-25): ghi chạm cả `event` (`ticket_types`) lẫn `ordering` (`ticket_type_inventory`)
 * nên đặt ở flows, mỗi lệnh một transaction kèm audit. Thứ tự khóa luôn là dòng `events` rồi mọi dòng tồn kho của Sự kiện
 * theo `ticket_type_id` (AD-2): khóa Sự kiện trước thì hai lệnh Hạng vé của cùng Sự kiện (kể cả thêm Hạng vé mới) chạy
 * tuần tự, nên phép kiểm trần 200 Vé của Sự kiện miễn phí cộng tổng trên dữ liệu không đổi được giữa chừng.
 */

const freeCapExceeded = () =>
  new AppError(ErrorCode.FREE_EVENT_CAPACITY_EXCEEDED, `Sự kiện miễn phí tối đa ${FREE_EVENT_TICKET_CAP} Vé.`, {
    details: { limit: FREE_EVENT_TICKET_CAP },
  });

interface LockedEvent {
  ticketTypes: Awaited<ReturnType<typeof ticketTypesOf>>;
  inventory: Map<string, InventoryRow>;
}

/** Khóa dòng Sự kiện rồi mọi dòng tồn kho (theo id), sau đó mới đọc Hạng vé. */
async function lockEvent(tx: Tx, ctx: AccessContext, eventId: string): Promise<LockedEvent> {
  await lockEventForTicketTypes(tx, ctx, eventId);
  const rows = await lockInventoryForEvent(tx, eventId);
  const ticketTypes = await ticketTypesOf(tx, ctx, eventId);
  return { ticketTypes, inventory: new Map(rows.map((row) => [row.ticketTypeId, row])) };
}

/** Giá và số suất của mọi Hạng vé sau thay đổi (`replace`: Hạng vé bị sửa; `add`: Hạng vé mới). */
function assertFreeCap(
  locked: LockedEvent,
  change: { replace?: string; add: { price: number; capacity: number } },
): void {
  const after = locked.ticketTypes
    .filter((t) => t.id !== change.replace)
    .map((t) => ({ price: t.price, capacity: locked.inventory.get(t.id)?.capacity ?? 0 }));
  after.push(change.add);
  if (exceedsFreeEventCap(after)) throw freeCapExceeded();
}

/** Hạng vé của Sự kiện kèm tồn kho; Sự kiện lạ hoặc của BTC khác → `404 EVENT_NOT_FOUND`. */
export async function listTicketTypes(db: Database, ctx: AccessContext, eventId: string): Promise<TicketTypeList> {
  await assertEventOfOrganization(db.orm, ctx, eventId);
  const rows = await ticketTypesOf(db.orm, ctx, eventId);
  const inventory = await inventoryOf(
    db.orm,
    rows.map((r) => r.id),
  );
  // Hạng vé và tồn kho đọc bằng hai câu: Hạng vé bị xóa xen giữa (không còn dòng tồn kho) thì bỏ, không trả hàng ma.
  return rows.flatMap((row) => {
    const stock = inventory.get(row.id);
    return stock ? [ticketTypeDetailOf(row, stock)] : [];
  });
}

/**
 * Tạo Hạng vé và dòng tồn kho `(capacity, 0, 0)` trong một transaction, audit `ticket_type.created`. Sau khi thêm mà
 * mọi Hạng vé đều 0đ và tổng số suất > 200 → `409 FREE_EVENT_CAPACITY_EXCEEDED`.
 */
export async function createTicketType(
  db: Database,
  ctx: AccessContext,
  eventId: string,
  input: TicketTypeValues,
): Promise<TicketTypeDetail> {
  return db.transaction(async (tx) => {
    const locked = await lockEvent(tx, ctx, eventId);
    assertFreeCap(locked, { add: { price: input.price, capacity: input.capacity } });
    const row = await insertTicketType(tx, ctx, eventId, input);
    const inventory = await createInventory(tx, { ticketTypeId: row.id, eventId, capacity: input.capacity });
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'ticket_type.created',
      target: { type: 'ticket_type', id: row.id },
    });
    return ticketTypeDetailOf(row, inventory);
  });
}

/**
 * Sửa Hạng vé (thay toàn bộ các trường). Số suất đổi thì gọi `changeCapacity` (không dưới đã bán + đang giữ chỗ → `409
 * CAPACITY_BELOW_COMMITTED`). Kiểm lại trần Sự kiện miễn phí với giá và số suất mới. Audit `ticket_type.updated` chỉ khi
 * có trường đổi.
 */
export async function updateTicketType(
  db: Database,
  ctx: AccessContext,
  eventId: string,
  ticketTypeId: string,
  input: TicketTypeValues,
): Promise<TicketTypeDetail> {
  return db.transaction(async (tx) => {
    const locked = await lockEvent(tx, ctx, eventId);
    assertTicketTypeId(ticketTypeId);
    const current = locked.ticketTypes.find((t) => t.id === ticketTypeId.toLowerCase());
    const currentInventory = current ? locked.inventory.get(current.id) : undefined;
    if (!current || !currentInventory) throw ticketTypeNotFound();

    const changedFields = ticketTypeChangedFields(current, currentInventory.capacity, input);
    if (changedFields.length === 0) return ticketTypeDetailOf(current, currentInventory);

    let inventory = currentInventory;
    if (changedFields.includes('capacity')) inventory = await changeCapacity(tx, current.id, input.capacity);
    assertFreeCap(locked, { replace: current.id, add: { price: input.price, capacity: input.capacity } });
    const row = await updateTicketTypeRow(tx, ctx, current.id, input);
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'ticket_type.updated',
      target: { type: 'ticket_type', id: row.id },
      changedFields,
    });
    return ticketTypeDetailOf(row, inventory);
  });
}

/**
 * Xóa Hạng vé chưa bán, chưa giữ chỗ cùng dòng tồn kho trong một transaction (khóa Sự kiện → tồn kho như khi tạo),
 * audit `ticket_type.deleted`. Đã bán hoặc đang giữ chỗ → `409 TICKET_TYPE_IN_USE`. Xóa Hạng vé có phí cuối cùng mà các
 * Hạng vé còn lại (đều 0đ) vượt trần Sự kiện miễn phí → `409 FREE_EVENT_CAPACITY_EXCEEDED`.
 */
export async function deleteTicketType(
  db: Database,
  ctx: AccessContext,
  eventId: string,
  ticketTypeId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockEvent(tx, ctx, eventId);
    assertTicketTypeId(ticketTypeId);
    const current = locked.ticketTypes.find((t) => t.id === ticketTypeId.toLowerCase());
    if (!current) throw ticketTypeNotFound();
    // Kiểm "đã bán/giữ chỗ" trước trần miễn phí: Hạng vé đã có người mua luôn báo `TICKET_TYPE_IN_USE`. Trần vượt thì
    // ném lỗi sau khi đã xóa dòng tồn kho, nhưng cả transaction rollback.
    await deleteInventory(tx, current.id);
    const remaining = locked.ticketTypes
      .filter((t) => t.id !== current.id)
      .map((t) => ({ price: t.price, capacity: locked.inventory.get(t.id)?.capacity ?? 0 }));
    if (exceedsFreeEventCap(remaining)) throw freeCapExceeded();
    await deleteTicketTypeRow(tx, ctx, current.id);
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'ticket_type.deleted',
      target: { type: 'ticket_type', id: current.id },
    });
  });
}
