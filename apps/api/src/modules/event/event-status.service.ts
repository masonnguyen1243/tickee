import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type EventDetail, type EventStatus, type EventStatusConflictDetails } from '@tickee/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit, type AuditAction } from '../../platform/audit/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { detailOf, notFound, UUID } from './event.service.js';
import { enqueuePublicPageRevalidation, PublicPageQueues } from './public-page-jobs.js';
import { events } from './schema.js';

/*
 * Ẩn, Hiện lại và Kết thúc sớm Sự kiện (Story 2.12, AD-14). Cả ba chung một khung: khóa dòng `events` → kiểm trạng
 * thái → compare-and-set → audit → enqueue revalidate trang `/e/{slug}`, tất cả trong một transaction (như
 * `PublishService.publish`). "Kết thúc" không đổi `status`: đặt `ended_manually_at` = `effective_end_at` = lúc bấm;
 * "Đã kết thúc" luôn tính từ `effective_end_at`; `ordering.sellability` xét `effectiveEndAt <= now` trước `hidden` nên
 * "Đã kết thúc" thắng "Ẩn". Vì thế Ẩn/Hiện lại sau khi đã kết thúc vô nghĩa → `409 EVENT_ALREADY_ENDED`.
 */

type EventRow = typeof events.$inferSelect;

interface Transition {
  /** Trạng thái cho phép; khác → `409 EVENT_STATUS_CONFLICT` (`details.status`). */
  allowed: readonly EventStatus[];
  action: AuditAction;
  /** Kiểm thêm sau trạng thái (dòng đã khóa, `now` lấy trong transaction); ném `AppError` nếu không được. */
  check?: (row: EventRow, now: Date) => void;
  /** Cột ghi khi đạt. */
  set: (now: Date) => Partial<Pick<EventRow, 'status' | 'endedManuallyAt' | 'effectiveEndAt'>>;
}

const statusConflict = (status: EventStatus) => {
  const details: EventStatusConflictDetails = { status };
  return new AppError(ErrorCode.EVENT_STATUS_CONFLICT, 'Trạng thái Sự kiện đã đổi. Tải lại để xem trạng thái mới.', {
    details,
  });
};

const notEnded = (row: EventRow, now: Date): void => {
  if (row.effectiveEndAt.getTime() <= now.getTime()) {
    throw new AppError(ErrorCode.EVENT_ALREADY_ENDED, 'Sự kiện đã kết thúc.');
  }
};

const HIDE: Transition = {
  allowed: ['published'],
  action: 'event.hidden',
  check: notEnded,
  set: () => ({ status: 'hidden' }),
};
const UNHIDE: Transition = {
  allowed: ['hidden'],
  action: 'event.unhidden',
  check: notEnded,
  set: () => ({ status: 'published' }),
};
const END: Transition = {
  allowed: ['published', 'hidden'],
  action: 'event.ended',
  // "Đã kết thúc" kiểm trước "chưa bắt đầu" (Design Notes).
  check: (row, now) => {
    notEnded(row, now);
    if (row.startsAt.getTime() > now.getTime()) {
      throw new AppError(ErrorCode.EVENT_NOT_STARTED, 'Sự kiện chưa bắt đầu — dùng Ẩn để dừng nhận Đơn.');
    }
  },
  set: (now) => ({ endedManuallyAt: now, effectiveEndAt: now }),
};

@Injectable()
export class EventStatusService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(PublicPageQueues) private readonly publicPageQueues: PublicPageQueues,
  ) {}

  /** Ẩn: `published` → `hidden`. Link vẫn mở được, không nhận Đơn mới. Đã kết thúc → `409 EVENT_ALREADY_ENDED`. */
  hide(ctx: AccessContext, eventId: string): Promise<EventDetail> {
    return this.transition(ctx, eventId, HIDE);
  }

  /** Hiện lại: `hidden` → `published`. Đã kết thúc → `409 EVENT_ALREADY_ENDED`. */
  unhide(ctx: AccessContext, eventId: string): Promise<EventDetail> {
    return this.transition(ctx, eventId, UNHIDE);
  }

  /**
   * Kết thúc sớm: `published`/`hidden` và `starts_at <= now < effective_end_at`. Đã kết thúc → `409
   * EVENT_ALREADY_ENDED`; chưa bắt đầu → `409 EVENT_NOT_STARTED`. Không hoàn tác được.
   */
  end(ctx: AccessContext, eventId: string): Promise<EventDetail> {
    return this.transition(ctx, eventId, END);
  }

  private async transition(ctx: AccessContext, eventId: string, t: Transition): Promise<EventDetail> {
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
      if (!t.allowed.includes(current.status)) throw statusConflict(current.status);
      const now = new Date();
      t.check?.(current, now);
      const [updated] = await tx
        .update(events)
        .set(t.set(now))
        .where(and(orgScope(ctx)(events), eq(events.id, eventId), inArray(events.status, [...t.allowed])))
        .returning();
      if (!updated) throw statusConflict(current.status);
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: t.action,
        target: { type: 'event', id: updated.id },
      });
      await enqueuePublicPageRevalidation(this.boss, tx, updated.slug);
      return updated;
    });
    return detailOf(row);
  }
}
