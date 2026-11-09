import { Inject, Injectable } from '@nestjs/common';
import { FunnelEventType, type FunnelEventInput } from '@tickee/contracts';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { publicEventBySlug } from '../event/index.js';
import { checkoutFunnelEvents } from './schema.js';

/*
 * Phễu mua (Story 3.1, SM-C2): ghi `buy_clicked` lúc bấm "Mua" và `login_completed` lúc tới Checkout sau khi đăng
 * nhập. Không PII, không `user_id`; hai sự kiện nối bằng `funnel_id`. `login_completed` chỉ ghi khi đã có `buy_clicked`
 * cùng `funnel_id` của cùng Sự kiện, nên muốn bơm rác phải gửi theo cặp. Trùng `(funnel_id, type)` → không thêm dòng.
 * Chưa giới hạn tốc độ theo IP (deferred, Story 4.6).
 */
@Injectable()
export class FunnelService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Slug sai dạng, lạ hoặc Sự kiện nháp → `404 EVENT_NOT_FOUND`. Sự kiện bị bỏ qua (không ghi) vẫn không báo lỗi. */
  async record(slug: string, input: FunnelEventInput): Promise<void> {
    const event = await publicEventBySlug(this.db.orm, slug);
    const target = [checkoutFunnelEvents.funnelId, checkoutFunnelEvents.type];

    if (input.type === FunnelEventType.BUY_CLICKED) {
      await this.db.orm
        .insert(checkoutFunnelEvents)
        .values({ eventId: event.id, type: input.type, funnelId: input.funnelId, loginRequired: input.loginRequired })
        .onConflictDoNothing({ target });
      return;
    }

    // Bảng chỉ INSERT: `buy_clicked` đã thấy thì không bao giờ mất, nên đọc rồi ghi không cần transaction.
    const [buy] = await this.db.orm
      .select({ id: checkoutFunnelEvents.id })
      .from(checkoutFunnelEvents)
      .where(
        and(
          eq(checkoutFunnelEvents.funnelId, input.funnelId),
          eq(checkoutFunnelEvents.type, FunnelEventType.BUY_CLICKED),
          eq(checkoutFunnelEvents.eventId, event.id),
        ),
      )
      .limit(1);
    if (!buy) return;
    await this.db.orm
      .insert(checkoutFunnelEvents)
      .values({ eventId: event.id, type: input.type, funnelId: input.funnelId, loginRequired: null })
      .onConflictDoNothing({ target });
  }
}
