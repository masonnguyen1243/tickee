import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EVENT_DRAFT_FIELDS,
  EVENT_SLUG_PATTERN,
  EVENT_SLUG_SUFFIX_LENGTH,
  EventDraftInput,
  effectiveEndAt,
  ErrorCode,
  slugBase,
  toEventIso,
  type EventDetail,
  type EventDraftField,
  type EventList,
  type PublicEvent,
} from '@tickee/contracts';
import { and, desc, eq, ne } from 'drizzle-orm';
import pg from 'pg';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { events } from './schema.js';

/*
 * Sự kiện nháp (FR-6, Story 2.7): Owner và Admin tạo, sửa, đọc Sự kiện của BTC mình; mọi truy vấn qua `orgScope(ctx)`.
 * Mỗi lần ghi là một transaction có audit (`event.created`, `event.updated` chỉ ghi tên trường đổi). API công khai theo
 * slug không bao giờ trả Sự kiện nháp: nháp và slug không tồn tại cùng `404 EVENT_NOT_FOUND`.
 */

/** Token DI của hàm sinh hậu tố slug (test tiêm hàm cố định để ép trùng slug). */
export const EVENT_SLUG_SUFFIX = Symbol('EVENT_SLUG_SUFFIX');
export type SlugSuffixGenerator = () => string;

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** Hậu tố ngẫu nhiên `[a-z0-9]{4}` (CSPRNG). */
export const randomSlugSuffix: SlugSuffixGenerator = () =>
  Array.from({ length: EVENT_SLUG_SUFFIX_LENGTH }, () => SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]).join('');

/** Unique index của slug; trùng thì sinh lại (không SELECT kiểm trước: hai request có thể chạy song song). */
const SLUG_KEY = 'events_slug_key';
const SLUG_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new AppError(ErrorCode.EVENT_NOT_FOUND, 'Không tìm thấy Sự kiện này.');

/** Vi phạm unique index `constraint` (ở chính lỗi hoặc một tầng `cause` của Drizzle). */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof pg.DatabaseError && current.code === '23505' && current.constraint === constraint) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type EventRow = typeof events.$inferSelect;
type DraftValues = z.output<typeof EventDraftInput>;

const detailOf = (row: EventRow): EventDetail => ({
  id: row.id,
  organizationId: row.organizationId,
  slug: row.slug,
  name: row.name,
  status: row.status,
  startsAt: toEventIso(row.startsAt),
  endsAt: toEventIso(row.endsAt),
  effectiveEndAt: toEventIso(row.effectiveEndAt),
  venue: row.venue,
  description: row.description,
  refundPolicy: row.refundPolicy,
  createdAt: toEventIso(row.createdAt),
  updatedAt: toEventIso(row.updatedAt),
});

/** Cột ghi từ input (giờ đã đổi sang `Date`, `effective_end_at` tính lại). */
function columnsOf(input: DraftValues) {
  const endsAt = new Date(input.endsAt);
  return {
    name: input.name,
    startsAt: new Date(input.startsAt),
    endsAt,
    effectiveEndAt: effectiveEndAt(endsAt),
    venue: input.venue,
    description: input.description,
    refundPolicy: input.refundPolicy,
  };
}

/** Tên các trường đổi (theo `EVENT_DRAFT_FIELDS`), so giờ theo mốc thời gian chứ không theo chuỗi. */
function changedFieldsOf(row: EventRow, next: ReturnType<typeof columnsOf>): EventDraftField[] {
  return EVENT_DRAFT_FIELDS.filter((field) => {
    const before = row[field];
    const after = next[field];
    return before instanceof Date && after instanceof Date ? before.getTime() !== after.getTime() : before !== after;
  });
}

@Injectable()
export class EventService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EVENT_SLUG_SUFFIX) private readonly slugSuffix: SlugSuffixGenerator,
  ) {}

  /** Tạo Sự kiện nháp kèm audit `event.created`. Slug trùng thì sinh hậu tố khác, tối đa `SLUG_ATTEMPTS` lần. */
  async create(ctx: AccessContext, input: DraftValues): Promise<EventDetail> {
    const base = slugBase(input.name);
    for (let attempt = 1; ; attempt++) {
      const slug = `${base}-${this.slugSuffix()}`;
      try {
        const row = await this.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(events)
            .values({ organizationId: ctx.organizationId, slug, status: 'draft', ...columnsOf(input) })
            .returning();
          if (!created) throw new Error('INSERT events không trả về dòng nào');
          await audit.record(tx, {
            actorUserId: ctx.userId,
            organizationId: ctx.organizationId,
            action: 'event.created',
            target: { type: 'event', id: created.id },
          });
          return created;
        });
        return detailOf(row);
      } catch (err) {
        if (attempt < SLUG_ATTEMPTS && isUniqueViolation(err, SLUG_KEY)) continue;
        throw err;
      }
    }
  }

  /** Sự kiện của BTC, mới tạo trước. */
  async list(ctx: AccessContext): Promise<EventList> {
    const rows = await this.db.orm
      .select({
        id: events.id,
        slug: events.slug,
        name: events.name,
        status: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
      })
      .from(events)
      .where(orgScope(ctx)(events))
      .orderBy(desc(events.createdAt), desc(events.id));
    return rows.map((row) => ({ ...row, startsAt: toEventIso(row.startsAt), endsAt: toEventIso(row.endsAt) }));
  }

  /** Một Sự kiện của BTC; id lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`. */
  async get(ctx: AccessContext, eventId: string): Promise<EventDetail> {
    if (!UUID.test(eventId)) throw notFound();
    const [row] = await this.db.orm
      .select()
      .from(events)
      .where(and(orgScope(ctx)(events), eq(events.id, eventId)));
    if (!row) throw notFound();
    return detailOf(row);
  }

  /**
   * Sửa Sự kiện (thay toàn bộ các trường của `EventDraftInput`). Slug giữ nguyên; `effective_end_at` tính lại. Audit
   * `event.updated` chỉ khi có trường đổi, `changedFields` là tên trường (không ghi giá trị).
   */
  async update(ctx: AccessContext, eventId: string, input: DraftValues): Promise<EventDetail> {
    if (!UUID.test(eventId)) throw notFound();
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(events)
        .where(and(orgScope(ctx)(events), eq(events.id, eventId)))
        .for('update');
      if (!current) throw notFound();
      const next = columnsOf(input);
      const changedFields = changedFieldsOf(current, next);
      if (changedFields.length === 0) return current;
      const [updated] = await tx
        .update(events)
        .set(next)
        .where(and(orgScope(ctx)(events), eq(events.id, eventId)))
        .returning();
      if (!updated) throw notFound();
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event.updated',
        target: { type: 'event', id: updated.id },
        changedFields,
      });
      return updated;
    });
    return detailOf(row);
  }

  /** Trang công khai theo slug (không cần đăng nhập): nháp và slug không tồn tại cùng `404 EVENT_NOT_FOUND`. */
  async publicBySlug(slug: string): Promise<PublicEvent> {
    if (slug.length > 100 || !EVENT_SLUG_PATTERN.test(slug)) throw notFound();
    const [row] = await this.db.orm
      .select({
        slug: events.slug,
        name: events.name,
        status: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        venue: events.venue,
        description: events.description,
        refundPolicy: events.refundPolicy,
      })
      .from(events)
      .where(and(eq(events.slug, slug), ne(events.status, 'draft')));
    if (!row) throw notFound();
    return { ...row, startsAt: toEventIso(row.startsAt), endsAt: toEventIso(row.endsAt) };
  }
}
