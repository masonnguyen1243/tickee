import { RealtimeSignal, type OrganizationRealtimeTopic, type RealtimeTopic } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { Tx } from '../db/index.js';

/** Kênh Postgres duy nhất của realtime (AD-17): mọi topic đi chung, hub lọc theo payload. */
export const REALTIME_CHANNEL = 'tickee_realtime';

/** Đối tượng vừa đổi: id (vd. id Đơn), BTC và Sự kiện của nó. */
export interface RealtimeIds {
  id: string;
  organizationId: string;
  eventId: string;
}

/**
 * Phát tín hiệu realtime trong cùng transaction với thay đổi (`tx`), như `audit.record`: Postgres chỉ giao `NOTIFY` khi
 * `tx` commit, nên thay đổi rollback thì không ai nhận gì; nhiều lần cùng payload trong một `tx` được gộp làm một. Hàm
 * thuần, dùng được ở cả vai api lẫn worker (worker không cần hub). Payload đúng `RealtimeSignal` (`{type, id,
 * organizationId, eventId}`), không PII. Không gọi trong TX1 tạo Đơn (AD-17).
 */
export const realtime = {
  async notify(tx: Tx, topic: Exclude<RealtimeTopic, OrganizationRealtimeTopic>, ids: RealtimeIds): Promise<void> {
    const payload = RealtimeSignal.parse({
      type: topic,
      id: ids.id,
      organizationId: ids.organizationId,
      eventId: ids.eventId,
    });
    await tx.execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(payload)})`);
  },

  /**
   * Tín hiệu cấp BTC (`ORGANIZATION_REALTIME_TOPICS`, vd. `org_status_changed` của Story 4.2) trong `tx`, như `notify`:
   * payload `{type, id: organizationId, organizationId}`, không có `eventId`, nên bộ lọc của stream một Sự kiện không
   * khớp. Chỉ nhận topic cấp BTC (kiểu `OrganizationRealtimeTopic`).
   */
  async notifyOrganization(tx: Tx, topic: OrganizationRealtimeTopic, organizationId: string): Promise<void> {
    const payload = RealtimeSignal.parse({ type: topic, id: organizationId, organizationId });
    await tx.execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(payload)})`);
  },
};
