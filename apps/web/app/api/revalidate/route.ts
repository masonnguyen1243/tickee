import { createHash, timingSafeEqual } from 'node:crypto';

import { EVENT_SLUG_PATTERN, publicEventTag } from '@tickee/contracts';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';

/*
 * Route nội bộ cho worker (Story 2.11-c): khi BTC sửa Sự kiện đã mở bán, job `event.revalidate-public-page` gọi
 * `POST /api/revalidate` với `Authorization: Bearer <REVALIDATE_SECRET>` và body `{ "tag": "event:{slug}" }`. Route xóa
 * cache phần tĩnh của trang `/e/{slug}` (và ảnh OG, cùng tag) để request kế tiếp lấy bản mới, không chờ 30 giây.
 *
 * `REVALIDATE_SECRET` chỉ đọc ở server. Thiếu biến → 503; sai/thiếu header → 401; body sai → 400; hợp lệ → 204.
 */

export const dynamic = 'force-dynamic';

/** Cùng giới hạn độ dài slug với API công khai (`assertPublicSlug`). */
const SLUG_MAX = 100;
const TAG_PREFIX = 'event:';

const RevalidateBody = z.object({ tag: z.string() });

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** So sánh hằng thời gian trên hash SHA-256: hai chuỗi khác độ dài vẫn so được (không ném, không lộ độ dài). */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

/** Tag `event:{slug}` hợp lệ (slug đúng dạng của Sự kiện) → tag; còn lại → `null`. */
function eventTagOf(body: unknown): string | null {
  const parsed = RevalidateBody.safeParse(body);
  if (!parsed.success || !parsed.data.tag.startsWith(TAG_PREFIX)) return null;
  const slug = parsed.data.tag.slice(TAG_PREFIX.length);
  return slug.length <= SLUG_MAX && EVENT_SLUG_PATTERN.test(slug) ? publicEventTag(slug) : null;
}

const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return empty(503);
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return empty(401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return empty(400);
  }
  const tag = eventTagOf(body);
  if (!tag) return empty(400);

  // `{ expire: 0 }`: không trả bản cũ thêm lần nào (`'max'` vẫn trả bản cũ một lần; `updateTag` chỉ chạy trong Server
  // Action).
  revalidateTag(tag, { expire: 0 });
  return empty(204);
}
