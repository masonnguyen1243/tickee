import { JobQueue, SheetFlushPayload } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import type { Tx } from '../../platform/db/index.js';
import { defineQueue } from '../../platform/jobs/index.js';

/*
 * Queue flush dòng bẩn lên Google Sheets (Story 6.5, AD-23), tách khỏi handler để lần đẩy đầu (`sheet-sync-jobs.ts`) và
 * flush (`sheet-flush-jobs.ts`) cùng hẹn flush mà không import vòng.
 */

/**
 * Cửa sổ debounce của flush (giây), Quyết định 4 của Story 6.5: lệch có chủ đích so với "tối đa một lần mỗi phút" của
 * AD-23, để P95 từ lúc Đơn đổi tới lúc lên Sheet ≤ 1 phút cả khi Đơn đổ liên tục. Test thay qua tùy chọn của
 * `IntegrationJobsModule.forRoot`, không qua env.
 */
export const SHEET_FLUSH_WINDOW_SECONDS = 45;

/** Token DI: cài đặt của flush ở vai worker (cửa sổ debounce). */
export const SHEET_FLUSH_SETTINGS = Symbol('SHEET_FLUSH_SETTINGS');

export interface SheetFlushSettings {
  /** Cửa sổ debounce (giây); mặc định `SHEET_FLUSH_WINDOW_SECONDS`. */
  windowSeconds: number;
}

/**
 * Queue flush: policy `singleton` (tối đa một job `active` cho mỗi `singleton_key` = id kết nối, và fetch bỏ qua kết nối
 * đang có lượt chạy), nên không bao giờ hai lượt của cùng kết nối chạy song song (lượt retry và lượt của khe mới). Retry
 * như lần đẩy đầu: 5 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 10 phút); hết lượt thì sang dead-letter. Poll mỗi giây.
 */
export const SHEET_FLUSH_QUEUE = defineQueue({
  name: JobQueue.INTEGRATION_SHEET_FLUSH,
  deadLetter: JobQueue.INTEGRATION_SHEET_FLUSH_DEAD_LETTER,
  options: { policy: 'singleton', retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 },
  work: { batchSize: 5, pollingIntervalSeconds: 1, perJobResults: true },
  payload: SheetFlushPayload,
});

/**
 * Hẹn một lượt flush cho kết nối `connectionId` bằng `tx` của người gọi, debounce theo kết nối (`sendDebounced` của
 * pg-boss: `singletonKey` = id kết nối, khe `windowSeconds` giây): khe hiện tại chưa có job → job chạy ngay; đã có (lượt
 * đã chạy hay đang chạy) → job ở đầu khe kế; khe kế cũng có rồi → không tạo gì, vì job đó chưa chạy và sẽ đọc mọi dòng
 * bẩn mới. Nhờ vậy mọi thay đổi luôn có một lượt flush sau nó.
 */
export async function scheduleSheetFlush(
  boss: PgBoss,
  tx: Tx,
  connectionId: string,
  windowSeconds: number = SHEET_FLUSH_WINDOW_SECONDS,
): Promise<void> {
  await SHEET_FLUSH_QUEUE.enqueue(
    boss,
    tx,
    { connectionId },
    { singletonKey: connectionId, singletonSeconds: windowSeconds, singletonNextSlot: true },
  );
}
