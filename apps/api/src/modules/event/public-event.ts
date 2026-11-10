import { EVENT_SLUG_PATTERN, toEventIso, type PublicEvent } from '@tickee/contracts';
import { and, eq, ne } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { organizationNameOf } from '../organizer/index.js';
import { notFound, UUID } from './event.service.js';
import { events } from './schema.js';
import { ticketTypesOf } from './ticket-type.service.js';

/*
 * Sự kiện theo slug cho API công khai (không cần đăng nhập, FR-7). Một luật 404 cho mọi route công khai: slug sai dạng,
 * quá dài, không tồn tại hoặc Sự kiện còn nháp → `404 EVENT_NOT_FOUND`. Sự kiện `hidden`, `cancelled` hoặc bị khóa vẫn
 * trả về (Ẩn vẫn mở được bằng link); trạng thái bán do `ordering.sellability` quyết định.
 */

const SLUG_MAX = 100;
type EventRow = typeof events.$inferSelect;

/** Slug sai dạng hoặc quá dài → `404 EVENT_NOT_FOUND` (không chạm DB). */
export function assertPublicSlug(slug: string): void {
  if (slug.length > SLUG_MAX || !EVENT_SLUG_PATTERN.test(slug)) throw notFound();
}

/** `404 EVENT_NOT_FOUND` cho mô-đun khác (vd. `ordering.sellabilityOf` nhận Sự kiện nháp). */
export const eventNotFound = notFound;

async function publishedRowBySlug(db: DbExecutor, slug: string): Promise<EventRow> {
  assertPublicSlug(slug);
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), ne(events.status, 'draft')));
  if (!row) throw notFound();
  return row;
}

/**
 * Phần Sự kiện mà `ordering` cần: luật bán của `sellability`, cùng slug, tên, giới hạn Vé/Đơn và chính sách hoàn vé
 * cho tạo Đơn (bản chụp) và trang Đơn.
 */
export type PublicEventRef = Pick<
  EventRow,
  | 'id'
  | 'organizationId'
  | 'slug'
  | 'name'
  | 'status'
  | 'lockedAt'
  | 'effectiveEndAt'
  | 'refundPolicy'
  | 'maxTicketsPerOrder'
>;

const refColumns = {
  id: events.id,
  organizationId: events.organizationId,
  slug: events.slug,
  name: events.name,
  status: events.status,
  lockedAt: events.lockedAt,
  effectiveEndAt: events.effectiveEndAt,
  refundPolicy: events.refundPolicy,
  maxTicketsPerOrder: events.maxTicketsPerOrder,
};

/** Tra Sự kiện công khai theo slug (cùng luật 404 với `GET /v1/events/:slug`). */
export async function publicEventBySlug(db: DbExecutor, slug: string): Promise<PublicEventRef> {
  assertPublicSlug(slug);
  const [row] = await db
    .select(refColumns)
    .from(events)
    .where(and(eq(events.slug, slug), ne(events.status, 'draft')));
  if (!row) throw notFound();
  return row;
}

/**
 * Khóa dòng Sự kiện công khai theo slug `FOR SHARE` trong `tx` của tạo Đơn (TX1, Story 3.2) rồi trả về (cùng luật 404 với
 * `publicEventBySlug`). Các TX1 song song không chờ nhau trên dòng `events`; mọi lệnh ghi của BTC lên Sự kiện (Hạng vé,
 * Ẩn/Kết thúc, form, thông tin) khóa `FOR UPDATE` nên chờ các TX1 đang chạy xong, và TX1 luôn thấy trạng thái đã
 * commit. Thứ tự khóa: Sự kiện trước, rồi tồn kho. Không cần `AccessContext` (Người mua không thuộc BTC).
 */
export async function lockSaleEventBySlug(tx: Tx, slug: string): Promise<PublicEventRef> {
  assertPublicSlug(slug);
  const [row] = await tx
    .select(refColumns)
    .from(events)
    .where(and(eq(events.slug, slug), ne(events.status, 'draft')))
    .for('share');
  if (!row) throw notFound();
  return row;
}

/**
 * Tra Sự kiện đã mở bán (không còn nháp) theo id, cho `ordering.sellability` khi người gọi chỉ có id (vd. trang Đơn,
 * Epic 3). Id sai dạng, không tồn tại hoặc còn nháp → `404 EVENT_NOT_FOUND`.
 */
export async function saleEventById(db: DbExecutor, eventId: string): Promise<PublicEventRef> {
  if (!UUID.test(eventId)) throw notFound();
  const [row] = await db
    .select(refColumns)
    .from(events)
    .where(and(eq(events.id, eventId), ne(events.status, 'draft')));
  if (!row) throw notFound();
  return row;
}

/**
 * Phần tĩnh của trang Sự kiện: thông tin Sự kiện, tên BTC, giới hạn Vé/Đơn, Hạng vé (tạo trước đứng trước, không có
 * số vé).
 */
export async function publicEventDetail(db: DbExecutor, slug: string): Promise<PublicEvent> {
  const row = await publishedRowBySlug(db, slug);
  const scope = { organizationId: row.organizationId };
  const [organizationName, tiers] = await Promise.all([
    organizationNameOf(db, scope),
    ticketTypesOf(db, scope, row.id),
  ]);
  if (organizationName === null) throw notFound();
  return {
    slug: row.slug,
    name: row.name,
    status: row.status,
    startsAt: toEventIso(row.startsAt),
    endsAt: toEventIso(row.endsAt),
    venue: row.venue,
    description: row.description,
    refundPolicy: row.refundPolicy,
    organizationName,
    maxTicketsPerOrder: row.maxTicketsPerOrder,
    ticketTypes: tiers.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      price: t.price,
      saleStartsAt: t.saleStartsAt ? toEventIso(t.saleStartsAt) : null,
      saleEndsAt: t.saleEndsAt ? toEventIso(t.saleEndsAt) : null,
    })),
  };
}
