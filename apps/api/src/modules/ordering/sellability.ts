import {
  EventSaleReason,
  PaymentServiceStatus,
  TierSaleStatus,
  toEventIso,
  type EventAvailability,
  type EventSaleStatus,
  type TierAvailability,
} from '@tickee/contracts';
import type { AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import {
  eventNotFound,
  organizationLocked,
  paidSalesAllowed,
  refundPolicySet,
  saleEventById,
  saleEventsOfOrganization,
  ticketTypesOf,
  ticketTypesOfEvents,
  type PublicEventRef,
  type TicketTypeRow,
} from '../event/index.js';
import { paymentServiceStateOf } from '../organizer/index.js';
import { inventoryOf, type InventoryRow } from './inventory.service.js';

/*
 * `ordering.sellability` (AD-21, Story 2.11-a): nguồn duy nhất cho trạng thái bán. Luật nằm ở một hàm thuần
 * (`saleStatusOf`); trang Sự kiện công khai (`GET /v1/events/:slug/availability`) và tạo Đơn (TX1, Story 3.2, trong `tx`
 * sau khi khóa Sự kiện) cùng đọc dữ liệu qua `sellabilityOf` rồi gọi hàm đó, nên không có hai bộ luật. Luật điều kiện
 * (chính sách hoàn vé, khóa BTC, Closed Beta, tài khoản nhận tiền) lấy từ `event` (`sale-rules.ts`), dùng chung với
 * `publishReadiness`. Chốt link thanh toán (E3-2, `PaymentLinks`) hỏi phần cấp Sự kiện của cùng luật (`linkBlockOf`,
 * đọc qua `paymentLinkBlock`) trước mọi lời gọi Tingee. Nhãn trạng thái bán trên dashboard BTC (Story 4.2-c) đọc theo lô
 * qua `organizationSaleStatuses` rồi cũng gọi `saleStatusOf` cho từng Sự kiện.
 */

/**
 * Trạng thái dịch vụ thanh toán của BTC (chỉ áp cho Hạng vé > 0đ; Story 4.2): cờ `payment_service_status` đọc qua read
 * model của `organizer`. `suspended` → mọi Hạng vé > 0đ "Tạm ngừng bán" ở trang công khai, TX1 và chốt link; không
 * chặn `publishReadiness`. BTC không còn → `active` (Sự kiện đã tra luôn có BTC).
 */
export async function paymentServiceStatus(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<PaymentServiceStatus> {
  return (await paymentServiceStateOf(db, scope))?.status ?? PaymentServiceStatus.ACTIVE;
}

type SaleEvent = Pick<PublicEventRef, 'status' | 'lockedAt' | 'effectiveEndAt' | 'refundPolicy'>;

/** Lý do cấp Sự kiện làm mọi Hạng vé `unavailable`, theo thứ tự ưu tiên; không có → `null`. */
function blockingReason(event: SaleEvent, orgLocked: boolean, now: Date): EventSaleReason | null {
  if (event.status === 'cancelled') return EventSaleReason.CANCELLED;
  if (event.lockedAt !== null || orgLocked) return EventSaleReason.LOCKED;
  // "Đã kết thúc" thắng "Ẩn" (Story 2.12).
  if (event.effectiveEndAt.getTime() <= now.getTime()) return EventSaleReason.ENDED;
  if (event.status === 'hidden') return EventSaleReason.HIDDEN;
  return null;
}

/** Hạng vé như luật bán cần: giá và giờ mở/đóng bán. */
export type SaleTier = Pick<TicketTypeRow, 'id' | 'price' | 'saleStartsAt' | 'saleEndsAt'>;

/** Dữ liệu đã đọc mà luật bán cần (`saleStatusOf`). */
export interface SaleFacts<T extends SaleTier = SaleTier> {
  event: SaleEvent;
  /** BTC đang bị khóa. */
  orgLocked: boolean;
  /** BTC đủ điều kiện bán Vé có phí (Closed Beta, tài khoản nhận tiền, dịch vụ thanh toán). Chỉ xét Hạng vé > 0đ. */
  paidOk: boolean;
  /** Hạng vé của Sự kiện, tạo trước đứng trước. */
  tiers: readonly T[];
  /** Số vé còn bán được của Hạng vé (`capacity − sold − held`, không âm). */
  remaining: (ticketTypeId: string) => number;
}

/**
 * Luật bán (hàm thuần): `eventReason` cấp Sự kiện và trạng thái từng Hạng vé tại `now`. Sự kiện hủy, bị khóa (hoặc BTC
 * bị khóa), đã kết thúc hay Ẩn → mọi Hạng vé `unavailable`. Không thì theo thứ tự: thiếu chính sách hoàn vé hoặc Hạng vé
 * có phí mà BTC chưa đủ điều kiện → `paused`; trước giờ mở → `not_started`; từ giờ đóng → `closed`; hết chỗ →
 * `sold_out`; còn lại `on_sale`.
 */
export function saleStatusOf(facts: SaleFacts, now: Date): EventAvailability {
  const { event, tiers, remaining } = facts;
  const blocked = blockingReason(event, facts.orgLocked, now);
  if (blocked !== null) {
    return {
      eventReason: blocked,
      tiers: tiers.map((t) => ({
        ticketTypeId: t.id,
        status: TierSaleStatus.UNAVAILABLE,
        remaining: remaining(t.id),
        saleStartsAt: t.saleStartsAt ? toEventIso(t.saleStartsAt) : null,
      })),
    };
  }

  const refundPolicyOk = refundPolicySet(event.refundPolicy);
  const result: TierAvailability[] = tiers.map((t) => {
    const left = remaining(t.id);
    let status: TierSaleStatus;
    if (!refundPolicyOk || (t.price > 0 && !facts.paidOk)) status = TierSaleStatus.PAUSED;
    else if (t.saleStartsAt && now.getTime() < t.saleStartsAt.getTime()) status = TierSaleStatus.NOT_STARTED;
    else if (t.saleEndsAt && now.getTime() >= t.saleEndsAt.getTime()) status = TierSaleStatus.CLOSED;
    else if (left === 0) status = TierSaleStatus.SOLD_OUT;
    else status = TierSaleStatus.ON_SALE;
    return { ticketTypeId: t.id, status, remaining: left, saleStartsAt: t.saleStartsAt ? toEventIso(t.saleStartsAt) : null };
  });
  const anyPaused = result.some((t) => t.status === TierSaleStatus.PAUSED);
  return { eventReason: anyPaused ? EventSaleReason.PAUSED : null, tiers: result };
}

/** Phần dữ liệu luật bán mà chốt link thanh toán cần (`linkBlockOf`): Sự kiện, khóa BTC, điều kiện bán Vé có phí. */
export type LinkFacts = Pick<SaleFacts, 'event' | 'orgLocked' | 'paidOk'>;

/**
 * Chốt link thanh toán (E3-2, hàm thuần): lý do Đơn có phí đã giữ chỗ không được tạo link mới tại `now`, `null` khi còn
 * bán. Cùng thứ tự với trang công khai và TX1 (`blockingReason`: hủy > khóa > kết thúc > Ẩn), rồi `paused` khi BTC không
 * còn đủ điều kiện bán Vé có phí (`paidOk`, gồm dịch vụ thanh toán `active` của Story 4.2). Không xét giờ mở/đóng bán, tồn
 * kho hay chính sách hoàn vé: Đơn đã giữ chỗ khi còn bán.
 */
export function linkBlockOf(facts: LinkFacts, now: Date): EventSaleReason | null {
  return blockingReason(facts.event, facts.orgLocked, now) ?? (facts.paidOk ? null : EventSaleReason.PAUSED);
}

/** BTC đủ điều kiện bán Vé có phí: Closed Beta đã duyệt, còn tài khoản nhận tiền, dịch vụ thanh toán `active`. */
async function paidOkOf(db: DbExecutor, scope: Pick<AccessContext, 'organizationId'>): Promise<boolean> {
  const [paid, payment] = await Promise.all([paidSalesAllowed(db, scope), paymentServiceStatus(db, scope)]);
  return paid.closedBetaApproved && paid.payoutLinked && payment === PaymentServiceStatus.ACTIVE;
}

/** Số vé còn bán được theo tồn kho đã đọc (`capacity − sold − held`, không âm); không có dòng tồn kho → 0. */
const remainingIn =
  (inventory: ReadonlyMap<string, InventoryRow>) =>
  (ticketTypeId: string): number => {
    const row = inventory.get(ticketTypeId);
    return row ? Math.max(0, row.capacity - row.sold - row.held) : 0;
  };

/**
 * Đọc dữ liệu luật bán của một Sự kiện đã tra (không còn nháp): Hạng vé, tồn kho (không khóa), khóa BTC và điều kiện bán
 * Vé có phí (chỉ khi có Hạng vé > 0đ). `db` là `tx` khi gọi trong TX1.
 */
export async function saleFactsOf(db: DbExecutor, event: PublicEventRef): Promise<SaleFacts<TicketTypeRow>> {
  if (event.status === 'draft') throw eventNotFound();
  const scope = { organizationId: event.organizationId };
  const [tiers, orgLocked] = await Promise.all([ticketTypesOf(db, scope, event.id), organizationLocked(db, scope)]);
  const inventory = await inventoryOf(db, tiers.map((t) => t.id));
  const paidOk = tiers.some((t) => t.price > 0) ? await paidOkOf(db, scope) : true;
  return { event, orgLocked, paidOk, tiers, remaining: remainingIn(inventory) };
}

/** Trạng thái bán của một Sự kiện đã đọc (không còn nháp). Dùng khi người gọi đã tra Sự kiện (vd. theo slug). */
export async function sellabilityOf(
  db: DbExecutor,
  event: PublicEventRef,
  now: Date = new Date(),
): Promise<EventAvailability> {
  return saleStatusOf(await saleFactsOf(db, event), now);
}

/**
 * Trạng thái bán của Sự kiện `eventId`: `eventReason` cấp Sự kiện và trạng thái từng Hạng vé (tạo trước đứng trước).
 * Id sai dạng, không tồn tại hoặc Sự kiện còn nháp → `404 EVENT_NOT_FOUND`.
 */
export async function sellability(db: DbExecutor, eventId: string, now: Date = new Date()): Promise<EventAvailability> {
  return sellabilityOf(db, await saleEventById(db, eventId), now);
}

/**
 * Chốt link thanh toán của một Đơn có phí thuộc Sự kiện `eventId` (E3-2, `PaymentLinks`): đọc Sự kiện (không khóa),
 * khóa BTC và điều kiện bán Vé có phí (luôn đọc: Đơn có phí), rồi `linkBlockOf` tại `now` (đồng hồ DB của người gọi).
 * Không đọc Hạng vé hay tồn kho. Id sai dạng, không tồn tại hoặc Sự kiện còn nháp → `404 EVENT_NOT_FOUND` (không xảy
 * ra với Đơn đã có).
 */
export async function paymentLinkBlock(db: DbExecutor, eventId: string, now: Date): Promise<EventSaleReason | null> {
  const event = await saleEventById(db, eventId);
  const scope = { organizationId: event.organizationId };
  const [orgLocked, paidOk] = await Promise.all([organizationLocked(db, scope), paidOkOf(db, scope)]);
  return linkBlockOf({ event, orgLocked, paidOk }, now);
}

/**
 * Trạng thái bán cấp Sự kiện của mọi Sự kiện đã mở bán (không còn nháp) của BTC, mới tạo trước: nhãn trạng thái bán trên
 * dashboard BTC (Story 4.2-c, retro Epic 2 C5). Cùng luật `saleStatusOf` với trang công khai, TX1 và chốt link (AD-21):
 * `reason` = `eventReason`; `partial` = `reason` là `paused` mà còn ít nhất một Hạng vé `on_sale` (khớp câu "một phần" của
 * trang công khai; Hạng vé còn lại hết vé, chưa mở hay đã đóng thì `false`).
 *
 * Đọc theo lô, số truy vấn không tăng theo số Sự kiện: Sự kiện, Hạng vé và tồn kho mỗi thứ một truy vấn theo danh sách
 * Sự kiện; khóa BTC và điều kiện bán Vé có phí (chỉ khi BTC có Hạng vé > 0đ) đọc một lần cho cả BTC. `now` là đồng hồ DB
 * của người gọi (AD-14); gọi trong một transaction để mọi truy vấn cùng một snapshot.
 */
export async function organizationSaleStatuses(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  now: Date,
): Promise<EventSaleStatus[]> {
  const events = await saleEventsOfOrganization(db, scope);
  if (events.length === 0) return [];
  const eventIds = events.map((e) => e.id);
  const [tiers, orgLocked] = await Promise.all([ticketTypesOfEvents(db, scope, eventIds), organizationLocked(db, scope)]);
  const inventory = await inventoryOf(db, tiers.map((t) => t.id));
  const paidOk = tiers.some((t) => t.price > 0) ? await paidOkOf(db, scope) : true;
  const tiersByEvent = new Map<string, TicketTypeRow[]>();
  for (const tier of tiers) {
    const list = tiersByEvent.get(tier.eventId);
    if (list) list.push(tier);
    else tiersByEvent.set(tier.eventId, [tier]);
  }
  const remaining = remainingIn(inventory);
  return events.map((event) => {
    const result = saleStatusOf({ event, orgLocked, paidOk, tiers: tiersByEvent.get(event.id) ?? [], remaining }, now);
    const reason = result.eventReason;
    const partial = reason === EventSaleReason.PAUSED && result.tiers.some((t) => t.status === TierSaleStatus.ON_SALE);
    return { eventId: event.id, reason, partial };
  });
}
