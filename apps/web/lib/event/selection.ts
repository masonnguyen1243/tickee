import {
  effectiveEndAt,
  EventStatus,
  formatVnd,
  parseSelection,
  serializeSelection,
  SELECTION_PARAM,
  TierSaleStatus,
  type EventAvailability,
  type PublicEvent,
  type PublicTicketType,
  type TicketSelectionItem,
  type TierAvailability,
} from '@tickee/contracts';

/*
 * Lựa chọn Vé của trang Sự kiện và Checkout (Story 3.1): hàm thuần, không React. Lựa chọn chỉ sống trong state của
 * trang và trên URL (`?items=`, AD-19), không bao giờ trong localStorage hay cookie.
 */

/** Hạng vé → số Vé đã chọn. Chỉ giữ số > 0. */
export type Selection = ReadonlyMap<string, number>;

export const EMPTY_SELECTION: Selection = new Map();

type TicketTypeRef = Pick<PublicTicketType, 'id'>;
type PricedTicketType = Pick<PublicTicketType, 'id' | 'price'>;

/** Giá một Hạng vé: 0đ hiện "Miễn phí". */
export const priceLabel = (price: number): string => (price === 0 ? 'Miễn phí' : formatVnd(price));

/** Sự kiện miễn phí: có Hạng vé và mọi Hạng vé giá 0 (thanh mua hiện "Miễn phí" + "Đăng ký"). */
export const isFreeEvent = (ticketTypes: readonly PricedTicketType[]): boolean =>
  ticketTypes.length > 0 && ticketTypes.every((t) => t.price === 0);

/** Tổng số Vé đã chọn. */
export function selectedCount(selection: Selection): number {
  let count = 0;
  for (const quantity of selection.values()) count += quantity;
  return count;
}

/**
 * Trần của nút "+" ở một Hạng vé: min(`remaining` của hạng, giới hạn Vé/Đơn − tổng đã chọn ở các hạng khác). Hạng vé
 * không `on_sale` (hoặc chưa có số vé) → 0.
 */
export function plusCeiling(
  ticketTypeId: string,
  selection: Selection,
  tier: TierAvailability | undefined,
  maxTicketsPerOrder: number,
): number {
  if (tier?.status !== TierSaleStatus.ON_SALE) return 0;
  const others = selectedCount(selection) - (selection.get(ticketTypeId) ?? 0);
  return Math.max(0, Math.min(tier.remaining, maxTicketsPerOrder - others));
}

/** Đặt số Vé của một Hạng vé (0 → bỏ khỏi lựa chọn). Không kẹp: người gọi đã chặn bằng `plusCeiling`. */
export function setQuantity(selection: Selection, ticketTypeId: string, quantity: number): Selection {
  const next = new Map(selection);
  if (quantity > 0) next.set(ticketTypeId, quantity);
  else next.delete(ticketTypeId);
  return next;
}

/**
 * Kẹp lựa chọn theo số vé mới nhất và giới hạn Vé/Đơn, theo thứ tự Hạng vé: hạng không `on_sale` hoặc không còn trong
 * Sự kiện về 0, số Vé không vượt `remaining`, tổng không vượt giới hạn (hạng đứng sau bị cắt trước). Không bao giờ
 * tăng.
 */
export function clampSelection(
  selection: Selection,
  ticketTypes: readonly TicketTypeRef[],
  availability: EventAvailability,
  maxTicketsPerOrder: number,
): Selection {
  const tiers = new Map(availability.tiers.map((t) => [t.ticketTypeId, t]));
  const next = new Map<string, number>();
  let budget = maxTicketsPerOrder;
  for (const { id } of ticketTypes) {
    const wanted = selection.get(id) ?? 0;
    const tier = tiers.get(id);
    if (wanted === 0 || tier?.status !== TierSaleStatus.ON_SALE) continue;
    const quantity = Math.min(wanted, tier.remaining, budget);
    if (quantity <= 0) continue;
    next.set(id, quantity);
    budget -= quantity;
  }
  return next;
}

/** Hai lựa chọn giống nhau (cùng hạng, cùng số). */
export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.size !== b.size) return false;
  for (const [id, quantity] of a) if (b.get(id) !== quantity) return false;
  return true;
}

/** Tổng số Vé và tổng tiền (đồng) của lựa chọn. */
export function selectionTotals(
  selection: Selection,
  ticketTypes: readonly PricedTicketType[],
): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const { id, price } of ticketTypes) {
    const quantity = selection.get(id) ?? 0;
    count += quantity;
    amount += quantity * price;
  }
  return { count, amount };
}

/** Lựa chọn thành các dòng theo thứ tự Hạng vé (để đưa lên URL). */
export function selectionItems(selection: Selection, ticketTypes: readonly TicketTypeRef[]): TicketSelectionItem[] {
  return ticketTypes.flatMap(({ id }) => {
    const quantity = selection.get(id) ?? 0;
    return quantity > 0 ? [{ ticketTypeId: id, quantity }] : [];
  });
}

/** `path?items=…` mang lựa chọn (theo thứ tự Hạng vé); lựa chọn trống → `path`. */
export function withSelection(path: string, selection: Selection, ticketTypes: readonly TicketTypeRef[]): string {
  const items = selectionItems(selection, ticketTypes);
  return items.length === 0 ? path : `${path}?${SELECTION_PARAM}=${serializeSelection(items)}`;
}

/**
 * `items` trên URL → lựa chọn hợp lệ với phần tĩnh của Sự kiện: chuỗi đúng định dạng, mọi Hạng vé có trong Sự kiện,
 * tổng không vượt giới hạn Vé/Đơn. Sai bất kỳ chỗ nào → `null` (sửa tay sai coi như không có lựa chọn).
 */
export function selectionFromItems(
  raw: unknown,
  event: Pick<PublicEvent, 'ticketTypes' | 'maxTicketsPerOrder'>,
): Selection | null {
  const items = parseSelection(raw);
  if (!items) return null;
  const known = new Set(event.ticketTypes.map((t) => t.id));
  if (!items.every((i) => known.has(i.ticketTypeId))) return null;
  const selection = new Map(items.map((i) => [i.ticketTypeId, i.quantity]));
  return selectedCount(selection) > event.maxTicketsPerOrder ? null : selection;
}

/**
 * Lựa chọn hợp lệ để mở Checkout, kiểm theo phần tĩnh của Sự kiện (server không có số vé): như `selectionFromItems`,
 * thêm Sự kiện đang mở bán (không Ẩn, không hủy, chưa qua mốc tự kết thúc) và mọi Hạng vé đã chọn đang trong giờ bán.
 * Hết chỗ, tạm ngừng bán hay bị khóa do `sellability` kiểm lại lúc gửi Đơn (Story 3.2). Sai → `null`.
 */
export function checkoutSelection(event: PublicEvent, raw: unknown, now: Date): Selection | null {
  if (event.status !== EventStatus.PUBLISHED) return null;
  if (effectiveEndAt(new Date(event.endsAt)).getTime() <= now.getTime()) return null;
  const selection = selectionFromItems(raw, event);
  if (!selection) return null;
  const at = now.getTime();
  const inSaleWindow = (t: PublicTicketType) =>
    (t.saleStartsAt === null || at >= Date.parse(t.saleStartsAt)) &&
    (t.saleEndsAt === null || at < Date.parse(t.saleEndsAt));
  return event.ticketTypes.every((t) => !selection.has(t.id) || inSaleWindow(t)) ? selection : null;
}

/** Trạng thái `purchase-bar` của trang Sự kiện. */
export type PurchaseBarState =
  /** Chưa có số vé, hoặc không Hạng vé nào bán được mà không phải hết sạch (banner đã giải thích): không có thanh. */
  | { kind: 'hidden' }
  /** Mọi Hạng vé hết: thanh thay bằng thông báo "Hết vé". */
  | { kind: 'sold-out' }
  /** Có Hạng vé đang bán, chưa chọn: nút tắt + "Chọn vé để tiếp tục". */
  | { kind: 'empty' }
  | { kind: 'ready'; count: number; amount: number };

export function purchaseBarState(
  ticketTypes: readonly PricedTicketType[],
  availability: EventAvailability | undefined,
  selection: Selection,
): PurchaseBarState {
  if (!availability || ticketTypes.length === 0) return { kind: 'hidden' };
  const statusOf = new Map(availability.tiers.map((t) => [t.ticketTypeId, t.status]));
  const statuses = ticketTypes.map((t) => statusOf.get(t.id));
  if (statuses.every((s) => s === TierSaleStatus.SOLD_OUT)) return { kind: 'sold-out' };
  if (!statuses.includes(TierSaleStatus.ON_SALE)) return { kind: 'hidden' };
  const { count, amount } = selectionTotals(selection, ticketTypes);
  return count === 0 ? { kind: 'empty' } : { kind: 'ready', count, amount };
}

/** Dòng tóm tắt Đơn ở Checkout, theo thứ tự Hạng vé. `price`: giá một Vé; `amount`: thành tiền. */
export type CheckoutLine = { ticketTypeId: string; name: string; price: number; quantity: number; amount: number };

export function checkoutLines(
  selection: Selection,
  ticketTypes: readonly Pick<PublicTicketType, 'id' | 'name' | 'price'>[],
): CheckoutLine[] {
  return ticketTypes.flatMap(({ id, name, price }) => {
    const quantity = selection.get(id) ?? 0;
    return quantity > 0 ? [{ ticketTypeId: id, name, price, quantity, amount: quantity * price }] : [];
  });
}
