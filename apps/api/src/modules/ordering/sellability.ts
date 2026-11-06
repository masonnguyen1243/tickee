import {
  EventSaleReason,
  TierSaleStatus,
  toEventIso,
  type EventAvailability,
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
  ticketTypesOf,
  type PublicEventRef,
} from '../event/index.js';
import { inventoryOf } from './inventory.service.js';

/*
 * `ordering.sellability` (AD-21, Story 2.11-a): nguồn duy nhất cho trạng thái bán. Trang Sự kiện công khai
 * (`GET /v1/events/:slug/availability`) và tạo Đơn (Epic 3) cùng gọi hàm này. Luật điều kiện (chính sách hoàn vé, khóa
 * BTC, Closed Beta, tài khoản nhận tiền) lấy từ `event` (`sale-rules.ts`), dùng chung với `publishReadiness`.
 */

/** Trạng thái dịch vụ thanh toán của BTC (chỉ áp cho Hạng vé > 0đ). */
export type PaymentServiceStatus = 'active' | 'suspended';

/**
 * Trạng thái dịch vụ thanh toán của BTC. Chưa có `payment_service_status` (Epic 4) nên luôn `active`; Epic 4 thay phần
 * thân hàm này bằng truy vấn thật.
 */
export async function paymentServiceStatus(
  _db: DbExecutor,
  _scope: Pick<AccessContext, 'organizationId'>,
): Promise<PaymentServiceStatus> {
  return 'active';
}

/** Lý do cấp Sự kiện làm mọi Hạng vé `unavailable`, theo thứ tự ưu tiên; không có → `null`. */
function blockingReason(event: PublicEventRef, orgLocked: boolean, now: Date): EventSaleReason | null {
  if (event.status === 'cancelled') return EventSaleReason.CANCELLED;
  if (event.lockedAt !== null || orgLocked) return EventSaleReason.LOCKED;
  if (event.status === 'hidden') return EventSaleReason.HIDDEN;
  if (event.effectiveEndAt.getTime() <= now.getTime()) return EventSaleReason.ENDED;
  return null;
}

/** Trạng thái bán của một Sự kiện đã đọc (không còn nháp). Dùng khi người gọi đã tra Sự kiện (vd. theo slug). */
export async function sellabilityOf(
  db: DbExecutor,
  event: PublicEventRef,
  now: Date = new Date(),
): Promise<EventAvailability> {
  if (event.status === 'draft') throw eventNotFound();
  const scope = { organizationId: event.organizationId };
  const [tiers, orgLocked] = await Promise.all([ticketTypesOf(db, scope, event.id), organizationLocked(db, scope)]);
  const inventory = await inventoryOf(db, tiers.map((t) => t.id));
  const remainingOf = (ticketTypeId: string): number => {
    const row = inventory.get(ticketTypeId);
    return row ? Math.max(0, row.capacity - row.sold - row.held) : 0;
  };

  const blocked = blockingReason(event, orgLocked, now);
  if (blocked !== null) {
    return {
      eventReason: blocked,
      tiers: tiers.map((t) => ({
        ticketTypeId: t.id,
        status: TierSaleStatus.UNAVAILABLE,
        remaining: remainingOf(t.id),
        saleStartsAt: t.saleStartsAt ? toEventIso(t.saleStartsAt) : null,
      })),
    };
  }

  const refundPolicyOk = refundPolicySet(event.refundPolicy);
  let paidOk = true;
  if (tiers.some((t) => t.price > 0)) {
    const [paid, payment] = await Promise.all([
      paidSalesAllowed(db, scope),
      paymentServiceStatus(db, scope),
    ]);
    paidOk = paid.closedBetaApproved && paid.payoutLinked && payment === 'active';
  }

  const result: TierAvailability[] = tiers.map((t) => {
    const remaining = remainingOf(t.id);
    let status: TierSaleStatus;
    if (!refundPolicyOk || (t.price > 0 && !paidOk)) status = TierSaleStatus.PAUSED;
    else if (t.saleStartsAt && now.getTime() < t.saleStartsAt.getTime()) status = TierSaleStatus.NOT_STARTED;
    else if (t.saleEndsAt && now.getTime() >= t.saleEndsAt.getTime()) status = TierSaleStatus.CLOSED;
    else if (remaining === 0) status = TierSaleStatus.SOLD_OUT;
    else status = TierSaleStatus.ON_SALE;
    return { ticketTypeId: t.id, status, remaining, saleStartsAt: t.saleStartsAt ? toEventIso(t.saleStartsAt) : null };
  });
  const anyPaused = result.some((t) => t.status === TierSaleStatus.PAUSED);
  return { eventReason: anyPaused ? EventSaleReason.PAUSED : null, tiers: result };
}

/**
 * Trạng thái bán của Sự kiện `eventId`: `eventReason` cấp Sự kiện và trạng thái từng Hạng vé (tạo trước đứng trước).
 * Id sai dạng, không tồn tại hoặc Sự kiện còn nháp → `404 EVENT_NOT_FOUND`.
 */
export async function sellability(db: DbExecutor, eventId: string, now: Date = new Date()): Promise<EventAvailability> {
  return sellabilityOf(db, await saleEventById(db, eventId), now);
}
