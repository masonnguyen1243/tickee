import {
  ErrorCode,
  TICKET_TYPE_FIELDS,
  TicketTypeInput,
  toEventIso,
  type TicketTypeDetail,
  type TicketTypeField,
} from '@tickee/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { notFound, UUID } from './event.service.js';
import { events, ticketTypes } from './schema.js';

/*
 * Hạng vé (FR-7, Story 2.8): `event` sở hữu `ticket_types` (tên, mô tả, giá, giờ bán). Số suất và tồn kho thuộc
 * `ordering`, nên mọi lần ghi đi qua `flows/ticket-types.flow.ts`: các hàm dưới đây nhận `tx` của flow và luôn lọc qua
 * `orgScope(ctx)`. Thứ tự khóa: dòng `events` (`lockEventForTicketTypes`) trước, rồi tồn kho theo id.
 */

export type TicketTypeRow = typeof ticketTypes.$inferSelect;
export type TicketTypeValues = z.output<typeof TicketTypeInput>;

export const ticketTypeNotFound = () => new AppError(ErrorCode.TICKET_TYPE_NOT_FOUND, 'Không tìm thấy Hạng vé này.');

/** `ticketTypeId` sai dạng → `404 TICKET_TYPE_NOT_FOUND` (không chạm DB). */
export function assertTicketTypeId(ticketTypeId: string): void {
  if (!UUID.test(ticketTypeId)) throw ticketTypeNotFound();
}

/** Sự kiện vừa khóa: trạng thái và slug để biết có cần revalidate trang `/e/{slug}` không. */
export type LockedEventRef = Pick<typeof events.$inferSelect, 'id' | 'status' | 'slug'>;

/**
 * Khóa dòng Sự kiện của BTC (`FOR UPDATE`): mọi thao tác Hạng vé của cùng Sự kiện chạy tuần tự, kể cả thêm Hạng vé mới
 * (khóa tồn kho không chặn được dòng chưa có). Id lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
 */
export async function lockEventForTicketTypes(tx: Tx, ctx: AccessContext, eventId: string): Promise<LockedEventRef> {
  if (!UUID.test(eventId)) throw notFound();
  const [row] = await tx
    .select({ id: events.id, status: events.status, slug: events.slug })
    .from(events)
    .where(and(orgScope(ctx)(events), eq(events.id, eventId)))
    .for('update');
  if (!row) throw notFound();
  return row;
}

/** Sự kiện có thuộc BTC không (không khóa); không → `404 EVENT_NOT_FOUND`. */
export async function assertEventOfOrganization(db: DbExecutor, ctx: AccessContext, eventId: string): Promise<void> {
  if (!UUID.test(eventId)) throw notFound();
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(orgScope(ctx)(events), eq(events.id, eventId)));
  if (!row) throw notFound();
}

/** Hạng vé của một Sự kiện thuộc BTC, tạo trước đứng trước. Người gọi đã kiểm Sự kiện tồn tại. */
export function ticketTypesOf(
  db: DbExecutor,
  ctx: Pick<AccessContext, 'organizationId'>,
  eventId: string,
): Promise<TicketTypeRow[]> {
  return db
    .select()
    .from(ticketTypes)
    .where(and(orgScope(ctx)(ticketTypes), eq(ticketTypes.eventId, eventId)))
    .orderBy(asc(ticketTypes.createdAt), asc(ticketTypes.id));
}

/**
 * Bản theo lô của `ticketTypesOf` (trạng thái bán trên dashboard BTC, Story 4.2-c): một truy vấn cho Hạng vé của mọi
 * Sự kiện trong `eventIds` thuộc BTC, tạo trước đứng trước. Danh sách rỗng → không chạm DB.
 */
export async function ticketTypesOfEvents(
  db: DbExecutor,
  ctx: Pick<AccessContext, 'organizationId'>,
  eventIds: readonly string[],
): Promise<TicketTypeRow[]> {
  if (eventIds.length === 0) return [];
  return db
    .select()
    .from(ticketTypes)
    .where(and(orgScope(ctx)(ticketTypes), inArray(ticketTypes.eventId, [...eventIds])))
    .orderBy(asc(ticketTypes.createdAt), asc(ticketTypes.id));
}

const columnsOf = (input: TicketTypeValues) => ({
  name: input.name,
  description: input.description,
  price: input.price,
  saleStartsAt: input.saleStartsAt ? new Date(input.saleStartsAt) : null,
  saleEndsAt: input.saleEndsAt ? new Date(input.saleEndsAt) : null,
});

export async function insertTicketType(
  tx: Tx,
  ctx: AccessContext,
  eventId: string,
  input: TicketTypeValues,
): Promise<TicketTypeRow> {
  const [row] = await tx
    .insert(ticketTypes)
    .values({ organizationId: ctx.organizationId, eventId, ...columnsOf(input) })
    .returning();
  if (!row) throw new Error('INSERT ticket_types không trả về dòng nào');
  return row;
}

/** Ghi tên, mô tả, giá, giờ bán của Hạng vé (số suất do `ordering` ghi). */
export async function updateTicketTypeRow(
  tx: Tx,
  ctx: AccessContext,
  ticketTypeId: string,
  input: TicketTypeValues,
): Promise<TicketTypeRow> {
  const [row] = await tx
    .update(ticketTypes)
    .set(columnsOf(input))
    .where(and(orgScope(ctx)(ticketTypes), eq(ticketTypes.id, ticketTypeId)))
    .returning();
  if (!row) throw ticketTypeNotFound();
  return row;
}

export async function deleteTicketTypeRow(tx: Tx, ctx: AccessContext, ticketTypeId: string): Promise<void> {
  const deleted = await tx
    .delete(ticketTypes)
    .where(and(orgScope(ctx)(ticketTypes), eq(ticketTypes.id, ticketTypeId)))
    .returning({ id: ticketTypes.id });
  if (deleted.length === 0) throw ticketTypeNotFound();
}

const time = (date: Date | null) => date?.getTime() ?? null;

/** Tên các trường đổi (theo `TICKET_TYPE_FIELDS`); giờ so theo mốc thời gian, không theo chuỗi. */
export function ticketTypeChangedFields(
  row: TicketTypeRow,
  capacity: number,
  input: TicketTypeValues,
): TicketTypeField[] {
  const next = columnsOf(input);
  const changed: Record<TicketTypeField, boolean> = {
    name: row.name !== next.name,
    description: row.description !== next.description,
    price: row.price !== next.price,
    capacity: capacity !== input.capacity,
    saleStartsAt: time(row.saleStartsAt) !== time(next.saleStartsAt),
    saleEndsAt: time(row.saleEndsAt) !== time(next.saleEndsAt),
  };
  return TICKET_TYPE_FIELDS.filter((field) => changed[field]);
}

/** Hạng vé kèm tồn kho (do `ordering` cung cấp) cho response. */
export function ticketTypeDetailOf(
  row: TicketTypeRow,
  inventory: { capacity: number; sold: number; held: number },
): TicketTypeDetail {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    description: row.description,
    price: row.price,
    capacity: inventory.capacity,
    saleStartsAt: row.saleStartsAt ? toEventIso(row.saleStartsAt) : null,
    saleEndsAt: row.saleEndsAt ? toEventIso(row.saleEndsAt) : null,
    sold: inventory.sold,
    held: inventory.held,
    createdAt: toEventIso(row.createdAt),
    updatedAt: toEventIso(row.updatedAt),
  };
}
