import { Controller, Get, Header, Inject, Injectable, Param } from '@nestjs/common';
import type { EventAvailability } from '@tickee/contracts';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { Public } from '../../platform/http/index.js';
import { assertPublicSlug, publicEventBySlug } from '../event/index.js';
import { sellabilityOf } from './sellability.js';

/** Token DI của đồng hồ (ms) dùng cho `now` của `sellability` và hạn memo; test tiêm đồng hồ cố định. */
export const AVAILABILITY_CLOCK = Symbol('AVAILABILITY_CLOCK');
export type AvailabilityClock = () => number;

/** Memo trong process theo slug sống chừng này ms (khớp `Cache-Control: max-age=2`). */
export const AVAILABILITY_TTL_MS = 2_000;
/** Số slug tối đa trong memo; đầy thì bỏ mục hết hạn, rồi bỏ mục cũ nhất. */
export const AVAILABILITY_MEMO_MAX = 1_000;

interface MemoEntry {
  expiresAt: number;
  value: Promise<EventAvailability>;
}

/**
 * Trạng thái bán theo slug, có memo trong process 2 giây (AD-37): nhiều người cùng xem một Sự kiện chỉ tốn khoảng một
 * truy vấn mỗi 2 giây cho mỗi process, kể cả khi không có CDN trước API. Request đến khi đang tính dùng chung promise.
 * Lỗi (vd. 404) không được memo. "Còn N vé" lệch tối đa 2 giây; tạo Đơn (Epic 3) vẫn kiểm lại trong transaction.
 */
@Injectable()
export class AvailabilityMemo {
  private readonly entries = new Map<string, MemoEntry>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AVAILABILITY_CLOCK) private readonly clock: AvailabilityClock,
  ) {}

  get(slug: string): Promise<EventAvailability> {
    // Slug sai dạng/quá dài bị từ chối trước, không chiếm chỗ trong memo.
    try {
      assertPublicSlug(slug);
    } catch (err) {
      return Promise.reject(err);
    }
    const now = this.clock();
    const cached = this.entries.get(slug);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.entries.delete(slug);
    this.makeRoom(now);
    const value = this.compute(slug, new Date(now));
    const entry: MemoEntry = { expiresAt: now + AVAILABILITY_TTL_MS, value };
    this.entries.set(slug, entry);
    value.catch(() => {
      if (this.entries.get(slug) === entry) this.entries.delete(slug);
    });
    return value;
  }

  /** Số mục đang giữ (cho test). */
  get size(): number {
    return this.entries.size;
  }

  private async compute(slug: string, now: Date): Promise<EventAvailability> {
    const event = await publicEventBySlug(this.db.orm, slug);
    return sellabilityOf(this.db.orm, event, now);
  }

  private makeRoom(now: number): void {
    if (this.entries.size < AVAILABILITY_MEMO_MAX) return;
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    // Map giữ thứ tự chèn: mục đầu là mục cũ nhất.
    while (this.entries.size >= AVAILABILITY_MEMO_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** `GET /v1/events/:slug/availability` (không cần đăng nhập). Nháp, slug sai hoặc quá dài → `404 EVENT_NOT_FOUND`. */
@Public()
@Controller('events')
export class PublicAvailabilityController {
  constructor(@Inject(AvailabilityMemo) private readonly memo: AvailabilityMemo) {}

  @Get(':slug/availability')
  @Header('Cache-Control', 'public, max-age=2')
  get(@Param('slug') slug: string): Promise<EventAvailability> {
    return this.memo.get(slug);
  }
}
