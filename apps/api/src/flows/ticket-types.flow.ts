import {
  ErrorCode,
  exceedsFreeEventCap,
  FREE_EVENT_TICKET_CAP,
  PublishConditionCode,
  unmetConditions,
  type PaidTicketTypeNotAllowedDetails,
  type TicketTypeDetail,
  type TicketTypeList,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import {
  assertEventOfOrganization,
  assertTicketTypeId,
  deleteTicketTypeRow,
  enqueuePublicPageRevalidation,
  insertTicketType,
  lockEventForTicketTypes,
  paidSalesAllowed,
  ticketTypeChangedFields,
  ticketTypeDetailOf,
  ticketTypeNotFound,
  ticketTypesOf,
  updateTicketTypeRow,
  type LockedEventRef,
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
 * tuần tự, nên phép kiểm trần 200 suất miễn phí cộng tổng trên dữ liệu không đổi được giữa chừng.
 *
 * Guard (E2-3), đều chạy sau khi khóa, lỗi thì cả transaction rollback (không lưu, không audit, không revalidate):
 * - Trần suất miễn phí (`exceedsFreeEventCap`): mọi Sự kiện, mọi trạng thái, kể cả Sự kiện có Hạng vé có phí; chỉ chặn
 *   thay đổi làm tăng tổng suất 0đ.
 * - Sự kiện không còn nháp: Hạng vé trở thành có phí (tạo mới, hoặc 0đ → có phí) thì BTC phải đủ điều kiện bán Vé có phí
 *   (`paidSalesAllowed`, cùng luật với mở bán); không được xóa Hạng vé cuối cùng. Sự kiện nháp chỉ kiểm lúc mở bán.
 *
 * Sự kiện đã mở bán: tạo, sửa (có trường đổi) hay xóa Hạng vé enqueue revalidate trang `/e/{slug}` trong cùng transaction
 * (Story 2.11-c). Người gọi đã `PublicPageQueues.ready()` trước transaction.
 */

const FREE_CAP_MESSAGE = `Tối đa ${FREE_EVENT_TICKET_CAP} suất miễn phí mỗi Sự kiện.`;

const freeCapExceeded = () =>
  new AppError(ErrorCode.FREE_EVENT_CAPACITY_EXCEEDED, FREE_CAP_MESSAGE, { details: { limit: FREE_EVENT_TICKET_CAP } });

interface LockedEvent {
  event: LockedEventRef;
  ticketTypes: Awaited<ReturnType<typeof ticketTypesOf>>;
  inventory: Map<string, InventoryRow>;
}

/** Khóa dòng Sự kiện rồi mọi dòng tồn kho (theo id), sau đó mới đọc Hạng vé. */
async function lockEvent(tx: Tx, ctx: AccessContext, eventId: string): Promise<LockedEvent> {
  const event = await lockEventForTicketTypes(tx, ctx, eventId);
  const rows = await lockInventoryForEvent(tx, eventId);
  const ticketTypes = await ticketTypesOf(tx, ctx, eventId);
  return { event, ticketTypes, inventory: new Map(rows.map((row) => [row.ticketTypeId, row])) };
}

/** Sự kiện không còn nháp → enqueue revalidate trang `/e/{slug}` bằng `tx` (rollback thì không có job). */
async function revalidatePublicPage(boss: PgBoss, tx: Tx, event: LockedEventRef): Promise<void> {
  if (event.status !== 'draft') await enqueuePublicPageRevalidation(boss, tx, event.slug);
}

type PriceAndCapacity = { price: number; capacity: number };

const freeSeats = (ticketTypes: readonly PriceAndCapacity[]): number =>
  ticketTypes.filter((t) => t.price === 0).reduce((sum, t) => sum + t.capacity, 0);

/**
 * Trần suất miễn phí trên giá và số suất của mọi Hạng vé sau thay đổi (`replace`: Hạng vé bị sửa; `add`: Hạng vé mới)
 * → `409 FREE_EVENT_CAPACITY_EXCEEDED`. Chỉ chặn khi thay đổi làm tăng tổng suất 0đ: Sự kiện đã vượt trần từ trước (hợp lệ
 * theo luật cũ, vd. 0đ 250 + có phí) vẫn giảm suất miễn phí hay sửa, thêm Hạng vé có phí được.
 */
function assertFreeCap(locked: LockedEvent, change: { replace?: string; add: PriceAndCapacity }): void {
  const seats = (t: LockedEvent['ticketTypes'][number]): PriceAndCapacity => ({
    price: t.price,
    capacity: locked.inventory.get(t.id)?.capacity ?? 0,
  });
  const before = locked.ticketTypes.map(seats);
  const after = locked.ticketTypes.filter((t) => t.id !== change.replace).map(seats);
  after.push(change.add);
  if (exceedsFreeEventCap(after) && freeSeats(after) > freeSeats(before)) throw freeCapExceeded();
}

/** Câu báo nêu đúng các điều kiện còn thiếu. */
const UNMET_PAID_CONDITION: Partial<Record<PublishConditionCode, string>> = {
  CLOSED_BETA_APPROVED: 'chưa được duyệt Closed Beta',
  PAYOUT_ACCOUNT_LINKED: 'chưa có tài khoản nhận tiền',
};

/**
 * Sự kiện không còn nháp, Hạng vé trở thành có phí (tạo mới giá > 0, hoặc sửa từ 0đ sang giá > 0): BTC phải đạt điều kiện
 * bán Vé có phí của mở bán (Closed Beta, tài khoản nhận tiền; `paidSalesAllowed`), không thì `409
 * PAID_TICKET_TYPE_NOT_ALLOWED` kèm `details.unmet`. Hạng vé đã có phí sửa được như thường (`sellability` tạm ngừng bán khi
 * BTC mất điều kiện). Sàn giá 2.000đ đã kiểm ở `TicketTypeInput`.
 */
async function assertPaidSalesAllowed(tx: Tx, ctx: AccessContext, locked: LockedEvent): Promise<void> {
  if (locked.event.status === 'draft') return;
  const paid = await paidSalesAllowed(tx, ctx);
  const unmet = unmetConditions({
    conditions: [
      { code: PublishConditionCode.CLOSED_BETA_APPROVED, satisfied: paid.closedBetaApproved },
      { code: PublishConditionCode.PAYOUT_ACCOUNT_LINKED, satisfied: paid.payoutLinked },
    ],
  });
  if (unmet.length === 0) return;
  const details: PaidTicketTypeNotAllowedDetails = { unmet };
  const reasons = unmet.map((code) => UNMET_PAID_CONDITION[code]).join(' và ');
  throw new AppError(ErrorCode.PAID_TICKET_TYPE_NOT_ALLOWED, `BTC ${reasons} nên chưa bán được Vé có phí.`, { details });
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
 * tổng số suất của các Hạng vé 0đ tăng lên quá 200 → `409 FREE_EVENT_CAPACITY_EXCEEDED`. Sự kiện không còn nháp, Hạng
 * vé giá > 0 và BTC chưa đủ điều kiện bán Vé có phí → `409 PAID_TICKET_TYPE_NOT_ALLOWED`.
 */
export async function createTicketType(
  db: Database,
  boss: PgBoss,
  ctx: AccessContext,
  eventId: string,
  input: TicketTypeValues,
): Promise<TicketTypeDetail> {
  return db.transaction(async (tx) => {
    const locked = await lockEvent(tx, ctx, eventId);
    assertFreeCap(locked, { add: { price: input.price, capacity: input.capacity } });
    if (input.price > 0) await assertPaidSalesAllowed(tx, ctx, locked);
    const row = await insertTicketType(tx, ctx, eventId, input);
    const inventory = await createInventory(tx, { ticketTypeId: row.id, eventId, capacity: input.capacity });
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'ticket_type.created',
      target: { type: 'ticket_type', id: row.id },
    });
    await revalidatePublicPage(boss, tx, locked.event);
    return ticketTypeDetailOf(row, inventory);
  });
}

/**
 * Sửa Hạng vé (thay toàn bộ các trường). Sự kiện không còn nháp và Hạng vé đổi từ 0đ sang giá > 0 thì BTC phải đủ điều
 * kiện bán Vé có phí (`409 PAID_TICKET_TYPE_NOT_ALLOWED`); Hạng vé đã có phí sửa được như thường. Số suất đổi thì gọi
 * `changeCapacity` (không dưới đã bán + đang giữ chỗ → `409 CAPACITY_BELOW_COMMITTED`). Kiểm lại trần suất miễn phí với
 * giá và số suất mới. Không có trường đổi thì trả lại Hạng vé, không kiểm và không audit; có thì audit
 * `ticket_type.updated`.
 */
export async function updateTicketType(
  db: Database,
  boss: PgBoss,
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

    if (current.price === 0 && input.price > 0) await assertPaidSalesAllowed(tx, ctx, locked);
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
    await revalidatePublicPage(boss, tx, locked.event);
    return ticketTypeDetailOf(row, inventory);
  });
}

/**
 * Xóa Hạng vé chưa bán, chưa giữ chỗ cùng dòng tồn kho trong một transaction (khóa Sự kiện → tồn kho như khi tạo),
 * audit `ticket_type.deleted`. Sự kiện không còn nháp mà chỉ còn Hạng vé này → `409 LAST_TICKET_TYPE`. Đã bán hoặc đang
 * giữ chỗ → `409 TICKET_TYPE_IN_USE`. Xóa không làm tăng tổng suất miễn phí nên không kiểm trần.
 */
export async function deleteTicketType(
  db: Database,
  boss: PgBoss,
  ctx: AccessContext,
  eventId: string,
  ticketTypeId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockEvent(tx, ctx, eventId);
    assertTicketTypeId(ticketTypeId);
    const current = locked.ticketTypes.find((t) => t.id === ticketTypeId.toLowerCase());
    if (!current) throw ticketTypeNotFound();
    if (locked.event.status !== 'draft' && locked.ticketTypes.length === 1) {
      throw new AppError(ErrorCode.LAST_TICKET_TYPE, 'Sự kiện đã mở bán phải còn ít nhất một Hạng vé.');
    }
    await deleteInventory(tx, current.id);
    await deleteTicketTypeRow(tx, ctx, current.id);
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'ticket_type.deleted',
      target: { type: 'ticket_type', id: current.id },
    });
    await revalidatePublicPage(boss, tx, locked.event);
  });
}
