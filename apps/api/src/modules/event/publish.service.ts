import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  MIN_PAID_PRICE,
  PublishConditionCode,
  unmetConditions,
  type EventDetail,
  type EventNotReadyDetails,
  type PublishCondition,
  type PublishReadiness,
} from '@tickee/contracts';
import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database, type DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { detailOf, notFound, UUID } from './event.service.js';
import { enqueuePublicPageRevalidation, PublicPageQueues } from './public-page-jobs.js';
import { organizationLocked, paidSalesAllowed, refundPolicySet } from './sale-rules.js';
import { events } from './schema.js';
import { ticketTypesOf } from './ticket-type.service.js';

/*
 * Điều kiện mở bán và mở bán Sự kiện (FR-8, Story 2.10, AD-34). `publishReadiness` là nơi duy nhất xét điều kiện:
 * `GET …/publish-readiness` trả kết quả cho web, lệnh "Mở bán" gọi lại đúng hàm này trong transaction (sau khi khóa
 * dòng `events`) rồi chuyển `draft` → `published` bằng compare-and-set. Khóa Sự kiện (`locked_at`) và trạng thái
 * dịch vụ thanh toán không chặn mở bán (chỉ làm "Tạm ngừng bán" sau khi mở bán, qua `ordering.sellability`).
 */

type EventRow = typeof events.$inferSelect;

/**
 * Điều kiện mở bán của một Sự kiện (đã đọc, thuộc BTC trong `ctx`), đọc qua `db` (truyền `tx` để đọc trong cùng
 * transaction với lệnh mở bán). Chỉ trả các mã áp dụng, theo thứ tự của `PublishConditionCode`.
 */
export async function publishReadiness(
  db: DbExecutor,
  ctx: AccessContext,
  event: Pick<EventRow, 'id' | 'refundPolicy' | 'effectiveEndAt'>,
  now: Date = new Date(),
): Promise<PublishReadiness> {
  const ticketTypes = await ticketTypesOf(db, ctx, event.id);
  const locked = await organizationLocked(db, ctx);
  const conditions: PublishCondition[] = [
    { code: PublishConditionCode.REFUND_POLICY, satisfied: refundPolicySet(event.refundPolicy) },
    { code: PublishConditionCode.HAS_TICKET_TYPE, satisfied: ticketTypes.length > 0 },
    { code: PublishConditionCode.EVENT_NOT_ENDED, satisfied: event.effectiveEndAt.getTime() > now.getTime() },
    { code: PublishConditionCode.ORGANIZATION_NOT_LOCKED, satisfied: !locked },
  ];
  const paidPrices = ticketTypes.map((t) => t.price).filter((price) => price > 0);
  if (paidPrices.length > 0) {
    const paid = await paidSalesAllowed(db, ctx);
    conditions.push(
      { code: PublishConditionCode.CLOSED_BETA_APPROVED, satisfied: paid.closedBetaApproved },
      { code: PublishConditionCode.PAYOUT_ACCOUNT_LINKED, satisfied: paid.payoutLinked },
      { code: PublishConditionCode.PAID_PRICE_MINIMUM, satisfied: paidPrices.every((p) => p >= MIN_PAID_PRICE) },
    );
  }
  return { conditions };
}

@Injectable()
export class PublishService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(PublicPageQueues) private readonly publicPageQueues: PublicPageQueues,
  ) {}

  /** Điều kiện mở bán của Sự kiện; id lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`. */
  async readiness(ctx: AccessContext, eventId: string): Promise<PublishReadiness> {
    if (!UUID.test(eventId)) throw notFound();
    const [row] = await this.db.orm
      .select({ id: events.id, refundPolicy: events.refundPolicy, effectiveEndAt: events.effectiveEndAt })
      .from(events)
      .where(and(orgScope(ctx)(events), eq(events.id, eventId)));
    if (!row) throw notFound();
    return publishReadiness(this.db.orm, ctx, row);
  }

  /**
   * Mở bán: khóa dòng Sự kiện, không còn nháp → `409 EVENT_NOT_DRAFT`; tính lại điều kiện trong cùng transaction, còn
   * thiếu → `409 EVENT_NOT_READY` (`details.unmet`). Đạt hết thì CAS `draft` → `published`, audit `event.published` và
   * enqueue revalidate trang `/e/{slug}` (xóa trang 404 cũ nếu đã cache) trong cùng transaction.
   */
  async publish(ctx: AccessContext, eventId: string): Promise<EventDetail> {
    if (!UUID.test(eventId)) throw notFound();
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` cần cả hai.
    await this.publicPageQueues.ready();
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(events)
        .where(and(orgScope(ctx)(events), eq(events.id, eventId)))
        .for('update');
      if (!current) throw notFound();
      if (current.status !== 'draft') throw notDraft();
      const unmet = unmetConditions(await publishReadiness(tx, ctx, current));
      if (unmet.length > 0) {
        const details: EventNotReadyDetails = { unmet };
        throw new AppError(ErrorCode.EVENT_NOT_READY, 'Sự kiện chưa đủ điều kiện mở bán.', { details });
      }
      const [updated] = await tx
        .update(events)
        .set({ status: 'published' })
        .where(and(orgScope(ctx)(events), eq(events.id, eventId), eq(events.status, 'draft')))
        .returning();
      if (!updated) throw notDraft();
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event.published',
        target: { type: 'event', id: updated.id },
      });
      await enqueuePublicPageRevalidation(this.boss, tx, updated.slug);
      return updated;
    });
    return detailOf(row);
  }
}

const notDraft = () => new AppError(ErrorCode.EVENT_NOT_DRAFT, 'Sự kiện không còn ở trạng thái nháp.');
